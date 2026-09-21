/**
 * 用户原始需求 [2026-09-21]：「tantivy 召回 + JS 冻结打分已跑通且指标逐位复原基准
 * ——照此实现产品化：后端只做召回与持久化，打分常在 JS 共享层。」
 * （jixoai-search-core tasks 1.8；D1 冒烟 /tmp/tantivy-smoke/report.md 定型路线 A。）
 * 正交意图：
 *   [1] 持久化：whitespace 注入路径（SkillTokenizer 分词 → 空格 join → tantivy
 *       whitespace 字段；内部 f_ 前缀字段名杜绝与声明字段冲突）+ raw id/stored
 *       字段（term 精确匹配 → deleteDocumentsByTerm 幂等覆盖，任意 id 字符集安全）。
 *   [2] 召回：per (token, field) 的 exact termQuery ∪ prefix 逐 term termQuery
 *       ∪ fuzzy（引擎 fuzzyTermQuery 距离 ≤2；距离需求 >2 或 CJK 口径回退
 *       scoring.expandFuzzyTerms 展开变体的 termQuery 集合）Should-OR——召回面
 *       与 sqlite 后端逐 token 同构，命中回 JS scoreCorpus 计分排序分页。
 *   [3] 生命周期：native binding 动态 import（加载失败/平台缺失 → typed
 *       SEARCH_BACKEND_UNAVAILABLE，消息含原因；失败不缓存可重试）；close =
 *       waitMergingThreads 释放目录锁（同进程重开可再取 writer）；同步 binding
 *       API 以 async 方法包装，接口形状不暴露同步性。
 * 妥协声明：引擎分数弃用（tantivy 原生 BM25 无 d 底分/乘数面，D1 路线 B typo 差
 * 1 hit 的根因），召回命中只取 docAddress；打分统计镜像常驻内存（docCount/
 * totalTokens/per-field df，open 时全量重建 + mutation 增量维护 + 失败日志回滚），
 * 词表分桶与大语料优化与 sqlite 后端同口径留给后续。
 */
import { z } from "zod";
import {
  SearchError,
  type SearchDocument,
  type SearchFieldSpec,
  type SearchHit,
  type SearchIndex,
  type SearchQueryOptions,
  type SearchResult,
} from "../api.js";
import {
  expandFuzzyTerms,
  maxFuzzyDistance,
  scoreCorpus,
  type FieldTermStats,
  type ScoringOptions,
} from "../scoring.js";
import { createSkillTokenizer } from "../tokenizer.js";
import type * as TantivyBinding from "@oxdev03/node-tantivy-binding";

/** binding 模块形状（type-only import：运行时经 dynamic import 加载）。 */
type TantivyModule = typeof TantivyBinding;
type TantivySchema = InstanceType<TantivyModule["Schema"]>;
type TantivyIndex = InstanceType<TantivyModule["Index"]>;
type TantivyWriter = InstanceType<TantivyModule["IndexWriter"]>;
type TantivyDocument = InstanceType<TantivyModule["Document"]>;
type TantivyQuery = InstanceType<TantivyModule["Query"]>;

/** 声明字段在 tantivy schema 内的列名前缀（与 sqlite 后端 f_ 列名同构，防内部字段冲突）。 */
const FIELD_PREFIX = "f_";
/** 内部字段：raw tokenizer 的精确 id term（delete/upsert 定位）。 */
const ID_FIELD = "id";
/** 内部字段：stored 投影的 JSON 落盘（raw tokenizer，永不进查询面）。 */
const STORED_FIELD = "stored";
/** 注入 tokenizer 注册名。 */
const TOKENIZER_WHITESPACE = "sc-whitespace";
const TOKENIZER_RAW = "sc-raw";

/**
 * Occur.Should 的数值（index.d.ts 声明序 Must=0/Should=1/MustNot=2）：
 * ambient const enum 在 isolatedModules 下不可成员访问（TS2748），取字面值。
 */
const OCCUR_SHOULD = 1;

/** fuzzy 召回跳过 CJK token（与 scoring.expandFuzzyTerms 同规则；scoring.ts 冻结不改，此处局部镜像）。 */
const CJK_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/** 引擎 fuzzyTermQuery 的距离上限（D1 实测：传 3 报 Levenshtein distance not allowed）。 */
const ENGINE_FUZZY_MAX_DISTANCE = 2;

/** stored 落盘 JSON 的读取收窄：不兼容（含 null/缺失）投影为无 stored。 */
const StoredSchema = z.record(z.string(), z.unknown());

/** binding 加载缓存；失败置空可重试（如补装平台子包后同进程恢复）。 */
let bindingPromise: Promise<TantivyModule> | null = null;

function loadTantivyBinding(): Promise<TantivyModule> {
  bindingPromise ??= import("@oxdev03/node-tantivy-binding").catch((error: unknown) => {
    bindingPromise = null;
    throw new SearchError(
      "SEARCH_BACKEND_UNAVAILABLE",
      `backend "tantivy" is unavailable: failed to load the native binding ` +
        `@oxdev03/node-tantivy-binding (${error instanceof Error ? error.message : String(error)}); ` +
        `install the package (or its platform subpackage) or use backend "sqlite"`,
      { cause: error },
    );
  });
  return bindingPromise;
}

/** 预检后端可用性（openIndex 在触碰目录前调用：不可用后端不得产生重建副作用）。 */
export async function assertTantivyBackendAvailable(): Promise<void> {
  await loadTantivyBinding();
}

/** 打开（必要时创建）tantivy 索引；目录必须已存在（openIndex 信封编排保证）。 */
export async function openTantivyIndex(params: {
  directory: string;
  fields: Record<string, SearchFieldSpec>;
  scoring: ScoringOptions;
}): Promise<SearchIndex> {
  const binding = await loadTantivyBinding();
  return new TantivySearchIndex(binding, params.directory, params.fields, params.scoring);
}

class TantivySearchIndex implements SearchIndex {
  private readonly binding: TantivyModule;
  private readonly fieldNames: string[];
  private readonly weights: Record<string, number>;
  private readonly scoring: ScoringOptions;
  private readonly tokenizer = createSkillTokenizer();
  private readonly schema: TantivySchema;
  private readonly index: TantivyIndex;
  private writer: TantivyWriter | null;
  /** 打分统计镜像：docCount 含全空文档（MiniSearch avgFieldLength 口径）。 */
  private docCount = 0;
  private readonly totals = new Map<string, number>();
  private readonly df = new Map<string, Map<string, number>>();
  private closed = false;

  constructor(
    binding: TantivyModule,
    directory: string,
    fields: Record<string, SearchFieldSpec>,
    scoring: ScoringOptions,
  ) {
    this.binding = binding;
    this.fieldNames = Object.keys(fields);
    this.weights = Object.fromEntries(
      this.fieldNames.map((field) => [field, fields[field].weight]),
    );
    this.scoring = scoring;
    let index: TantivyIndex | null = null;
    let writer: TantivyWriter | null = null;
    try {
      const { SchemaBuilder, TextAnalyzerBuilder, TokenizerStatic, Index } = binding;
      const builder = new SchemaBuilder();
      for (const field of this.fieldNames) {
        builder.addTextField(`${FIELD_PREFIX}${field}`, {
          stored: true,
          tokenizerName: TOKENIZER_WHITESPACE,
          indexOption: "position",
        });
      }
      builder.addTextField(ID_FIELD, { stored: true, tokenizerName: TOKENIZER_RAW });
      builder.addTextField(STORED_FIELD, { stored: true, tokenizerName: TOKENIZER_RAW });
      this.schema = builder.build();
      // reuse=Index.exists：信封匹配的既有目录原样续用；空/重建目录新建。
      index = new Index(this.schema, directory, Index.exists(directory));
      index.registerTokenizer(
        TOKENIZER_WHITESPACE,
        new TextAnalyzerBuilder(TokenizerStatic.whitespace()).build(),
      );
      index.registerTokenizer(
        TOKENIZER_RAW,
        new TextAnalyzerBuilder(TokenizerStatic.raw()).build(),
      );
      writer = index.writer();
      this.index = index;
      this.writer = writer;
      this.rebuildStatsFromIndex();
    } catch (error) {
      // 构造失败也要释放已取得的目录锁（否则同进程重开永远取不到 writer）。
      try {
        writer?.waitMergingThreads();
      } catch {
        // 保留原始错误（构造失败原因优先）。
      }
      throw new SearchError("SEARCH_IO", "failed to open tantivy search index", { cause: error });
    }
  }

  private assertOpen(): void {
    if (this.closed) throw new SearchError("SEARCH_IO", "search index is closed");
  }

  private requireWriter(): TantivyWriter {
    if (this.writer === null) throw new SearchError("SEARCH_IO", "search index is closed");
    return this.writer;
  }

  /** open 时全量重建打分统计镜像（allQuery 枚举 + stored 字段读回）。 */
  private rebuildStatsFromIndex(): void {
    this.docCount = 0;
    this.totals.clear();
    this.df.clear();
    const searcher = this.index.searcher();
    if (searcher.numDocs === 0) return;
    const all = searcher.search(this.binding.Query.allQuery(), searcher.numDocs, false);
    for (const hit of all.hits) {
      this.applyDocStats(this.fieldTokensFromDocument(searcher.doc(hit.docAddress)));
    }
  }

  private tokenizeField(value: string | undefined): string[] {
    return this.tokenizer.tokenize(value ?? "");
  }

  private fieldTokensFromDocument(doc: TantivyDocument): Map<string, string[]> {
    const perField = new Map<string, string[]>();
    for (const field of this.fieldNames) {
      perField.set(field, splitStoredTokens(doc.getFirst(`${FIELD_PREFIX}${field}`)));
    }
    return perField;
  }

  /** 按 id raw term 精确取回一条文档的 per-field token 流（不存在返回 null）。 */
  private fetchFieldTokens(id: string): Map<string, string[]> | null {
    const searcher = this.index.searcher();
    const result = searcher.search(
      this.binding.Query.termQuery(this.schema, ID_FIELD, id),
      1,
      false,
    );
    const hit = result.hits[0];
    if (!hit) return null;
    return this.fieldTokensFromDocument(searcher.doc(hit.docAddress));
  }

  private applyDocStats(perField: Map<string, string[]>): void {
    this.docCount += 1;
    for (const [field, tokens] of perField) {
      this.totals.set(field, (this.totals.get(field) ?? 0) + tokens.length);
      let fieldDf = this.df.get(field);
      if (!fieldDf) {
        fieldDf = new Map<string, number>();
        this.df.set(field, fieldDf);
      }
      for (const term of new Set(tokens)) {
        fieldDf.set(term, (fieldDf.get(term) ?? 0) + 1);
      }
    }
  }

  /** 撤销一条文档的统计贡献（df 减尽删除、totals 下限 0——与 sqlite retractDocument 同口径）。 */
  private retractDocStats(perField: Map<string, string[]>): void {
    this.docCount = Math.max(0, this.docCount - 1);
    for (const [field, tokens] of perField) {
      if (tokens.length > 0) {
        this.totals.set(field, Math.max(0, (this.totals.get(field) ?? 0) - tokens.length));
      }
      const fieldDf = this.df.get(field);
      if (!fieldDf) continue;
      for (const term of new Set(tokens)) {
        const next = (fieldDf.get(term) ?? 0) - 1;
        if (next > 0) fieldDf.set(term, next);
        else fieldDf.delete(term);
      }
    }
  }

  private newDocument(doc: SearchDocument, perField: Map<string, string[]>): TantivyDocument {
    const document = new this.binding.Document();
    for (const [field, tokens] of perField) {
      document.addText(`${FIELD_PREFIX}${field}`, tokens.join(" "));
    }
    document.addText(ID_FIELD, doc.id);
    if (doc.stored !== undefined) document.addText(STORED_FIELD, JSON.stringify(doc.stored));
    return document;
  }

  /** 提交并刷新 reader 视图（commit 阻塞发布；显式 reload 保证确定性）。 */
  private commit(): void {
    this.requireWriter().commit();
    this.index.reload();
  }

  private rollbackSilently(): void {
    try {
      this.writer?.rollback();
    } catch {
      // 回滚自身失败时保留原始错误（索引句柄由调用方 close）。
    }
  }

  async upsert(docs: SearchDocument[]): Promise<void> {
    this.assertOpen();
    // 统计逆操作日志：引擎 rollback 后按逆序回放，镜像与盘面同步还原。
    const undo: Array<() => void> = [];
    // 同批同 id 的后续读改走批内最新状态（searcher 看不到未提交 delete）。
    const overlay = new Map<string, Map<string, string[]>>();
    try {
      for (const doc of docs) {
        const previous = overlay.has(doc.id) ? overlay.get(doc.id) : this.fetchFieldTokens(doc.id);
        if (previous) {
          this.retractDocStats(previous);
          undo.push(() => this.applyDocStats(previous));
          this.requireWriter().deleteDocumentsByTerm(ID_FIELD, doc.id);
        }
        const perField = new Map(
          this.fieldNames.map((field) => [field, this.tokenizeField(doc.fields[field])]),
        );
        this.applyDocStats(perField);
        undo.push(() => this.retractDocStats(perField));
        this.requireWriter().addDocument(this.newDocument(doc, perField));
        overlay.set(doc.id, perField);
      }
      this.commit();
    } catch (error) {
      this.rollbackSilently();
      for (const inverse of undo.reverse()) inverse();
      throw new SearchError("SEARCH_IO", "tantivy index mutation failed", { cause: error });
    }
  }

  async remove(ids: string[]): Promise<void> {
    this.assertOpen();
    const undo: Array<() => void> = [];
    const removedInBatch = new Set<string>();
    try {
      for (const id of ids) {
        if (removedInBatch.has(id)) continue;
        removedInBatch.add(id);
        const existing = this.fetchFieldTokens(id);
        if (!existing) continue;
        this.retractDocStats(existing);
        undo.push(() => this.applyDocStats(existing));
        this.requireWriter().deleteDocumentsByTerm(ID_FIELD, id);
      }
      this.commit();
    } catch (error) {
      this.rollbackSilently();
      for (const inverse of undo.reverse()) inverse();
      throw new SearchError("SEARCH_IO", "tantivy index mutation failed", { cause: error });
    }
  }

  async search(query: string, options: SearchQueryOptions = {}): Promise<SearchResult> {
    this.assertOpen();
    const limit = options.limit ?? 10;
    const offset = options.offset ?? 0;
    const tokens = this.tokenizer.tokenize(query);
    if (tokens.length === 0) return { hits: [], total: 0 };

    const fieldStats = this.scoringFieldStats();
    const searcher = this.index.searcher();
    const recallQuery = this.buildRecallQuery(tokens, fieldStats);
    if (recallQuery) {
      // 全量召回（limit=numDocs 为命中上界）：与 sqlite FTS5 无界 MATCH 同口径，
      // total 与命中集合由 JS 打分层决定，不受引擎排序影响。
      const recalled = searcher.search(recallQuery, Math.max(searcher.numDocs, 1), false);
      const docFieldTokens = new Map<string, Map<string, string[]>>();
      const storedById = new Map<string, SearchDocument["stored"]>();
      for (const hit of recalled.hits) {
        const doc = searcher.doc(hit.docAddress);
        const id = doc.getFirst(ID_FIELD);
        if (typeof id !== "string") continue;
        docFieldTokens.set(id, this.fieldTokensFromDocument(doc));
        storedById.set(id, parseStored(doc.getFirst(STORED_FIELD)));
      }
      const scores = scoreCorpus(
        {
          docCount: this.docCount,
          fields: this.fieldNames,
          weights: this.weights,
          fieldStats,
          docFieldTokens,
        },
        tokens,
        this.scoring,
      );
      const hits: SearchHit[] = [...scores.entries()]
        .map(([id, score]) => ({ id, score, stored: storedById.get(id) }))
        .sort(
          (left, right) =>
            right.score - left.score || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
        )
        .slice(offset, offset + limit);
      return { hits, total: scores.size };
    }
    return { hits: [], total: 0 };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const writer = this.writer;
    this.writer = null;
    if (!writer) return;
    try {
      // 消费 writer 并 join 合并线程：目录锁随之释放（同进程可重开）。
      writer.waitMergingThreads();
    } catch (error) {
      throw new SearchError("SEARCH_IO", "failed to release tantivy index writer", {
        cause: error,
      });
    }
  }

  /**
   * 打分统计快照：df 键按字典序排序（sqlite 侧 term_df ORDER BY field, term 的
   * 逐位对齐——浮点求和次序确定，两后端分数可逐位重放）。
   */
  private scoringFieldStats(): Map<string, FieldTermStats> {
    const fieldStats = new Map<string, FieldTermStats>();
    for (const field of this.fieldNames) {
      const entries = [...(this.df.get(field) ?? [])].sort(([left], [right]) =>
        left < right ? -1 : left > right ? 1 : 0,
      );
      fieldStats.set(field, {
        avgFieldLength: this.docCount > 0 ? (this.totals.get(field) ?? 0) / this.docCount : 0,
        df: new Map(entries),
      });
    }
    return fieldStats;
  }

  /**
   * 召回查询（Should-OR）：per (token, field) exact ∪ prefix 逐 term ∪ fuzzy。
   * 引擎分数弃用——boost 无意义，子句只承载命中面。prefix 逐 term termQuery
   * （termSetQuery 无 BM25 权重但此处只做召回，仍逐 term 以保持与 sqlite 召回
   * 面逐 token 同构）；fuzzy 距离 ≤2 且非 CJK 用引擎 fuzzyTermQuery
   * （transpositionCostOne=false 对齐标准 Levenshtein），距离需求 >2 或 CJK
   * 跳过规则回退 expandFuzzyTerms 展开变体集合。
   */
  private buildRecallQuery(
    tokens: string[],
    fieldStats: Map<string, FieldTermStats>,
  ): TantivyQuery | null {
    const { Query } = this.binding;
    const vocabulary = unionVocabulary(fieldStats);
    const subs: Array<{ occur: number; query: TantivyQuery }> = [];
    for (const token of tokens) {
      const maxDistance = maxFuzzyDistance(token, this.scoring.fuzzy);
      const engineFuzzy =
        maxDistance >= 1 && maxDistance <= ENGINE_FUZZY_MAX_DISTANCE && !CJK_RE.test(token);
      const expandedFuzzy = engineFuzzy
        ? null
        : expandFuzzyTerms(token, vocabulary, {
            prefix: this.scoring.prefix,
            maxDistance,
          });
      for (const field of this.fieldNames) {
        const column = `${FIELD_PREFIX}${field}`;
        subs.push({ occur: OCCUR_SHOULD, query: Query.termQuery(this.schema, column, token) });
        if (this.scoring.prefix) {
          for (const term of vocabulary) {
            if (term !== token && term.startsWith(token)) {
              subs.push({ occur: OCCUR_SHOULD, query: Query.termQuery(this.schema, column, term) });
            }
          }
        }
        if (engineFuzzy) {
          subs.push({
            occur: OCCUR_SHOULD,
            query: Query.fuzzyTermQuery(
              this.schema,
              column,
              token,
              maxDistance,
              /* transpositionCostOne */ false,
            ),
          });
        } else if (expandedFuzzy) {
          for (const term of expandedFuzzy.keys()) {
            subs.push({ occur: OCCUR_SHOULD, query: Query.termQuery(this.schema, column, term) });
          }
        }
      }
    }
    return subs.length > 0 ? Query.booleanQuery(subs) : null;
  }
}

/** stored 字段读回的 token 切分（缺失/null/空串 → 空；与 sqlite splitTokens 同口径）。 */
function splitStoredTokens(value: unknown): string[] {
  return typeof value === "string" && value.length > 0 ? value.split(" ") : [];
}

/** stored JSON 读回收窄：不兼容投影为无 stored（与 sqlite parseStored 同口径）。 */
function parseStored(value: unknown): SearchDocument["stored"] {
  if (typeof value !== "string") return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return undefined;
  }
  const result = StoredSchema.safeParse(parsed);
  return result.success ? result.data : undefined;
}

/** 各字段词表并集（fuzzy/prefix 召回展开口径；scoringFieldStats 已排序 → 确定性）。 */
function unionVocabulary(fieldStats: Map<string, FieldTermStats>): string[] {
  const union = new Set<string>();
  for (const stats of fieldStats.values()) {
    for (const term of stats.df.keys()) union.add(term);
  }
  return [...union];
}
