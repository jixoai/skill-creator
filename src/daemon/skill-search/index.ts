/**
 * 用户原始需求 [2026-09-21]：「src/daemon/skill-search 从 MiniSearch 迁移到
 * @jixoai/search，MiniSearch 退役。」（jixoai-search-core Phase 2 tasks 2.1-2.3）
 * 修订依据（同日 tantivy 目录锁探针 /tmp/tantivy-lock-probe.mts）：同目录第二个
 * writer 持锁失败——daemon + CLI `search` + stdio MCP 是既定的多进程并发持有者
 * （AGENTS.md「search 不要求 daemon」），tantivy 默认不可行；backend 默认 sqlite
 * （事务级文件锁，串行多持有者安全），env SKILL_CREATOR_SEARCH_BACKEND=tantivy
 * 显式覆盖（单持有者高语料部署），非法取值回落默认。
 * 正交意图：
 * 1. @jixoai/search 消费封装：字段权重/fuzzy/prefix 常量注入 openIndex，候选
 *    stored 经 safeParse 还原为 ranking 投影（调用方不持有引擎细节）。
 * 2. 两层信封：包索引目录 <searchHome>/index/（包信封自管）+ 自有登记表
 *    <searchHome>/meta.json（schemaVersion 4：documents + payloadDigest +
 *    configDigest）持久化与加载收窄；旧 search-index.json（v3）不再读取 → 等
 *    价空重建。
 * 3. stat 新鲜度增量维护（无内容读取的 diff → 包 upsert/remove 增量；脏度 >20%
 *    或摘要不符全量重建：close + 删 index 目录与 meta + 重新 openIndex 灌全量）。
 * 4. duplicates/documentCount 纯登记表投影（不依赖包枚举 API，同步）+ 引擎金丝雀
 *    （包信封不匹配时 openIndex 静默重建空索引——登记表非空而引擎召回不了任何
 *    已知文档即判失效重建）。
 * 妥协声明：包 API 全 async 且无跨包/登记表事务，freshen/search 经内部操作链
 * 串行化（旧同步原子性的等价物）；「upsert 已提交而 meta 落盘失败」的分裂由下一
 * 轮 freshen 的 stat diff 幂等收敛（upsert 同 id 覆盖、remove 缺席幂等）。
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  openIndex,
  SearchError,
  SCORING_CONSTANTS,
  TOKENIZER_VERSION as PACKAGE_TOKENIZER_VERSION,
  type SearchBackend,
  type SearchDocument,
  type SearchHit,
  type SearchIndex,
} from "@jixoai/search";
import { appDir } from "../../shared/paths.js";
import { safeParseExternal, safeParseJson } from "../../shared/external-input.js";
import type { SkillInstallation, SkillSearchDocument } from "../../shared/contracts/search.js";
import { SkillInstallationSchema } from "../../shared/contracts/search.js";
import { SkillIdSchema } from "../../shared/contracts/skills.js";
import { DomainError } from "../domain-error.js";
import { atomicWriteUtf8 } from "../path-safety.js";
import type { CanonicalSkillScan } from "./canonicalize.js";
import { PARSER_VERSION } from "./parser.js";
import { RANKING_VERSION, type RankingCandidate } from "./ranking.js";
import { createSkillTokenizer, TOKENIZER_VERSION, type SkillTokenizer } from "./tokenizer.js";

/** 登记表结构版本（v4：MiniSearch 单文件信封 → 两层信封迁移）。 */
const META_SCHEMA_VERSION = 4;
/** 引擎名（进 configDigest；引擎替换即全量重建）。 */
const ENGINE_NAME = "@jixoai/search";
/** searchHome：appDir 下的检索自有子目录（包索引与登记表的共同父目录）。 */
const SEARCH_HOME_DIR_NAME = "search";
const INDEX_DIR_NAME = "index";
const META_FILE_NAME = "meta.json";

/** 索引字段与权重（冻结：name×10 description×6 keywords×5 triggers×5 headings×3 body×1）。 */
const SEARCH_FIELDS = ["name", "description", "keywords", "triggers", "headings", "body"] as const;
const FIELD_BOOST: Record<(typeof SEARCH_FIELDS)[number], number> = {
  name: 10,
  description: 6,
  keywords: 5,
  triggers: 5,
  headings: 3,
  body: 1,
};
/** openIndex 的字段声明（与 FIELD_BOOST 同源；测试经此复用生产配置）。 */
export const SKILL_SEARCH_FIELD_SPECS: Record<(typeof SEARCH_FIELDS)[number], { weight: number }> =
  {
    name: { weight: FIELD_BOOST.name },
    description: { weight: FIELD_BOOST.description },
    keywords: { weight: FIELD_BOOST.keywords },
    triggers: { weight: FIELD_BOOST.triggers },
    headings: { weight: FIELD_BOOST.headings },
    body: { weight: FIELD_BOOST.body },
  };
export const SKILL_SEARCH_FUZZY = 0.2;
export const SKILL_SEARCH_PREFIX = true;
/**
 * 引擎候选窗口（包 limit 上限 100）：≥ ranking TOP_CANDIDATES(40)，为池前
 * content-dup 折叠保留副本余量——折叠在 rankResults 内做，引擎侧多取不改变排序。
 */
export const SKILL_SEARCH_ENGINE_LIMIT = 100;
/** 增量 freshen 的脏度阈值：discard 操作占比超过该值时全量重建。 */
const REBUILD_DISCARD_RATIO = 0.2;

/** backend 解析（一行 config）：env 显式覆盖 sqlite|tantivy，缺省/非法回落 sqlite。 */
export function resolveSkillSearchBackend(): SearchBackend {
  const raw = process.env.SKILL_CREATOR_SEARCH_BACKEND;
  return raw === "sqlite" || raw === "tantivy" ? raw : "sqlite";
}

/**
 * configDigest：引擎口径 + 版本面 + 生效排除配置的冻结摘要。任何权重/ fuzzy/
 * prefix / ranking / parser /（daemon 与包双侧）tokenizer / 包打分常量 / backend /
 * search-config.toml 变化都触发全量重建（旧 ENGINE_CONFIG_DIGEST 与
 * searchConfigDigest 两摘要的语义合并）。
 */
export function skillSearchConfigDigest(
  searchConfigDigest: string,
  backend: SearchBackend,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        engine: ENGINE_NAME,
        fields: FIELD_BOOST,
        fuzzy: SKILL_SEARCH_FUZZY,
        prefix: SKILL_SEARCH_PREFIX,
        rankingVersion: RANKING_VERSION,
        parserVersion: PARSER_VERSION,
        tokenizerVersion: TOKENIZER_VERSION,
        packageTokenizerVersion: PACKAGE_TOKENIZER_VERSION,
        scoringConstants: SCORING_CONSTANTS,
        backend,
        searchConfigDigest,
      }),
    )
    .digest("hex");
}

/** 文件集身份（无内容读取的新鲜度键；保时保长的替换由 ino/ctimeMs 检出）。 */
export interface SkillFileIdentity {
  path: string;
  mtimeMs: number;
  size: number;
  ino: number;
  ctimeMs: number;
}

/** 登记表条目（meta.json documents 值形状）：stat 四元组 + 投影元数据 + name。 */
export interface SkillIndexStat {
  canonicalPath: string;
  files: SkillFileIdentity[];
  installations: SkillInstallation[];
  contentHash: string;
  disabled: boolean;
  conflict: boolean;
  invalidFrontmatter: boolean;
  /** duplicates() 的同步投影来源（frontmatter name；无效时为目录名回退）。 */
  name: string;
}

/** freshen 结果摘要。 */
export interface FreshenSummary {
  mode: "fresh" | "incremental" | "rebuilt";
  documents: number;
  parsed: number;
  discarded: number;
  rebuildReason?: "missing" | "corrupt" | "incompatible" | "dirty-ratio";
}

/**
 * 持久索引的对外抽象。freshen/search 为 async（@jixoai/search 全 async 契约）；
 * duplicates/documentCount 是登记表纯内存投影，保持同步（watcher 维护门零改动）。
 */
export interface SkillSearchIndex {
  freshen: (
    scans: readonly CanonicalSkillScan[],
    readDocument: (scan: CanonicalSkillScan) => SkillSearchDocument,
  ) => Promise<FreshenSummary>;
  search: (query: string) => Promise<RankingCandidate[]>;
  /** 无查询的内容重复组投影（contentHash 分组 >1；冻结排序，见 duplicatesOf）。 */
  duplicates: () => IndexDuplicateGroup[];
  documentCount: () => number;
}

/** 索引层重复组成员（name 取登记表投影）。 */
export interface IndexDuplicateGroup {
  contentHash: string;
  members: Array<{
    id: string;
    name: string;
    canonicalPath: string;
    installations: SkillInstallation[];
    disabled: boolean;
    conflict: boolean;
  }>;
}

/**
 * 索引 IO 故障（EACCES/EIO/ENOSPC/原子 rename 失败等）：hard error，不降级为空索引。
 * 继承 DomainError(UNAVAILABLE)：RPC 错误边界把它投影为 typed 失败而非 INTERNAL_SERVER_ERROR。
 */
export class SkillSearchIndexError extends DomainError {
  constructor(message: string, options?: { cause?: unknown }) {
    super("UNAVAILABLE", message, options);
    this.name = "SkillSearchIndexError";
  }
}

const FileIdentitySchema = z
  .object({
    path: z.string().min(1),
    mtimeMs: z.number(),
    size: z.number(),
    ino: z.number(),
    ctimeMs: z.number(),
  })
  .strict();

const RegistryEntrySchema = z
  .object({
    canonicalPath: z.string().min(1),
    files: z.array(FileIdentitySchema).min(1),
    installations: z.array(SkillInstallationSchema).min(1),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    disabled: z.boolean(),
    conflict: z.boolean(),
    invalidFrontmatter: z.boolean(),
    name: z.string(),
  })
  .strict();

const MetaEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(META_SCHEMA_VERSION),
    /** 引擎口径 + 版本面 + 排除配置的冻结摘要（任一变化触发全量重建）。 */
    configDigest: z.string().min(1),
    /** 载荷完整性摘要：sha256(JSON.stringify(documents))，写入时计算、加载时重算。 */
    payloadDigest: z.string().regex(/^[a-f0-9]{64}$/),
    documents: z.record(SkillIdSchema, RegistryEntrySchema),
  })
  .strict();

/**
 * 存储字段投影的运行时收窄（引擎 stored JSON 是外部输入，进入内存前必须
 * safeParse）。contentHash/canonicalPath/installations 带格式约束：篡改的缓存
 * （伪路径、伪 hash）在命中还原即被丢弃，不注入结果元数据。
 */
const StoredProjectionSchema = z.object({
  name: z.string(),
  description: z.string(),
  keywords: z.array(z.string()),
  canonicalPath: z.string().min(1),
  installations: z.array(SkillInstallationSchema).min(1),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  disabled: z.boolean(),
  conflict: z.boolean(),
  invalidFrontmatter: z.boolean(),
});

/** searchHome 与两层信封路径（每次调用由 appDir() 重新派生，setHomeOverride 兼容）。 */
function searchHome(): string {
  return path.join(appDir(), SEARCH_HOME_DIR_NAME);
}
function searchIndexDirectory(): string {
  return path.join(searchHome(), INDEX_DIR_NAME);
}
function searchMetaFile(): string {
  return path.join(searchHome(), META_FILE_NAME);
}

/**
 * 创建绑定 appDir 的持久索引。索引路径恒由 appDir() 派生，不接受调用方传入；
 * getSearchConfigDigest 在加载校验与落盘时求值（配置可在 daemon 生命周期内被
 * 用户编辑——摘要变化触发全量重建）。
 */
export function createSkillSearchIndex(
  tokenizer: SkillTokenizer = createSkillTokenizer(),
  getSearchConfigDigest: () => string = () => "",
): SkillSearchIndex {
  return new PersistentSkillSearchIndex(tokenizer, getSearchConfigDigest);
}

class PersistentSkillSearchIndex implements SkillSearchIndex {
  private engine: SearchIndex | null = null;
  private registry = new Map<string, SkillIndexStat>();
  private loaded = false;
  /** 操作串行链：包 API 全 async，freshen/search 按到达次序执行（读不见半更新）。 */
  private opChain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly tokenizer: SkillTokenizer,
    private readonly getSearchConfigDigest: () => string,
  ) {}

  freshen(
    scans: readonly CanonicalSkillScan[],
    readDocument: (scan: CanonicalSkillScan) => SkillSearchDocument,
  ): Promise<FreshenSummary> {
    return this.enqueue(() => this.freshenLocked(scans, readDocument));
  }

  async search(query: string): Promise<RankingCandidate[]> {
    return this.enqueue(async () => {
      if (!this.loaded || this.engine === null) return [];
      const result = await this.engine.search(query, { limit: SKILL_SEARCH_ENGINE_LIMIT });
      return rankingCandidatesFromHits(result.hits);
    });
  }

  duplicates(): IndexDuplicateGroup[] {
    // 数据源为登记表（不发查询）；分组键 contentHash，仅保留成员数 >1 的组。
    // 排序冻结：组间按成员 canonicalPath 最小值升序，组内按 canonicalPath
    // 升序——与搜索结果 tie-break 同族的稳定可重放次序。
    const byHash = new Map<string, Array<{ id: string; stat: SkillIndexStat }>>();
    for (const [id, stat] of this.registry) {
      const group = byHash.get(stat.contentHash) ?? [];
      group.push({ id, stat });
      byHash.set(stat.contentHash, group);
    }
    const groups: IndexDuplicateGroup[] = [];
    for (const [contentHash, entries] of byHash) {
      if (entries.length < 2) continue;
      entries.sort((left, right) =>
        compareCanonicalPath(left.stat.canonicalPath, right.stat.canonicalPath),
      );
      groups.push({
        contentHash,
        members: entries.map(({ id, stat }) => ({
          id,
          name: stat.name,
          canonicalPath: stat.canonicalPath,
          installations: stat.installations,
          disabled: stat.disabled,
          conflict: stat.conflict,
        })),
      });
    }
    groups.sort((left, right) =>
      compareCanonicalPath(left.members[0].canonicalPath, right.members[0].canonicalPath),
    );
    return groups;
  }

  documentCount(): number {
    return this.registry.size;
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.opChain.then(operation);
    this.opChain = run.catch(() => undefined);
    return run;
  }

  private async freshenLocked(
    scans: readonly CanonicalSkillScan[],
    readDocument: (scan: CanonicalSkillScan) => SkillSearchDocument,
  ): Promise<FreshenSummary> {
    if (!this.loaded) {
      const load = await this.loadFromDisk();
      this.loaded = true;
      if (load.kind !== "ok") {
        return this.rebuild(scans, readDocument, load.reason);
      }
      this.engine = load.engine;
      this.registry = load.registry;
    }

    const scanById = new Map(scans.map((scan) => [scan.id as string, scan]));
    const indexedIds = new Set(this.registry.keys());
    const removed = [...indexedIds].filter((id) => !scanById.has(id));
    const changed: CanonicalSkillScan[] = [];
    for (const scan of scans) {
      const stat = this.registry.get(scan.id as string);
      if (!stat || !statIsCurrent(stat, scan)) changed.push(scan);
    }
    const discardOperations =
      removed.length + changed.filter((scan) => indexedIds.has(scan.id as string)).length;
    const dirtyRatio = indexedIds.size === 0 ? 1 : discardOperations / indexedIds.size;
    if (dirtyRatio > REBUILD_DISCARD_RATIO) {
      return this.rebuild(scans, readDocument, "dirty-ratio");
    }

    if (removed.length === 0 && changed.length === 0) {
      return { mode: "fresh", documents: this.registry.size, parsed: 0, discarded: 0 };
    }

    // 批量前置读取：任何文档读取失败（含 TOCTOU 身份错误）发生在引擎与登记表
    // 被触碰之前——typed error 原样上抛，本轮不留下部分状态。
    const documents = changed.map((scan) => ({ scan, document: readDocument(scan) }));

    const nextRegistry = new Map(this.registry);
    for (const id of removed) nextRegistry.delete(id);
    for (const { scan, document } of documents) {
      nextRegistry.set(scan.id as string, registryEntry(scan, document));
    }
    const engine = this.requireEngine();
    try {
      if (removed.length > 0) await engine.remove(removed);
      if (documents.length > 0) {
        await engine.upsert(documents.map(({ document }) => toSearchDocument(document)));
      }
      this.persistRegistry(nextRegistry);
    } catch (error) {
      // 包操作自身幂等回滚（sqlite 事务 / tantivy 引擎 rollback）；meta 未写 →
      // 登记表不变。「upsert 已提交而 meta 落盘失败」的分裂由下一轮 freshen 的
      // stat diff 幂等收敛。作废内存状态，下一次调用从磁盘真相重来。
      this.invalidateAfterMutationFailure();
      throw wrapEngineError(error);
    }
    this.registry = nextRegistry;
    return {
      mode: "incremental",
      documents: nextRegistry.size,
      parsed: documents.length,
      discarded: discardOperations,
    };
  }

  private async rebuild(
    scans: readonly CanonicalSkillScan[],
    readDocument: (scan: CanonicalSkillScan) => SkillSearchDocument,
    reason: FreshenSummary["rebuildReason"],
  ): Promise<FreshenSummary> {
    const discarded = this.registry.size;
    // 事务式重建：局部状态上构建，全部落盘成功后才交换成员——中途读取失败或
    // 落盘失败都不留下部分索引。
    const documents = scans.map((scan) => ({ scan, document: readDocument(scan) }));
    const registry = new Map(
      documents.map(({ scan, document }) => [scan.id as string, registryEntry(scan, document)]),
    );
    let engine: SearchIndex | null = null;
    try {
      await this.closeEngineQuietly();
      // 全量重建是 skill-search 对自有 home 子目录的主动行为：直接整目录删除
      //（包信封的安全删除语义不适用于此处——目标是清空而非复用）。
      fs.rmSync(searchIndexDirectory(), { recursive: true, force: true });
      fs.rmSync(searchMetaFile(), { force: true });
      engine = await this.openEngine();
      if (documents.length > 0) {
        await engine.upsert(documents.map(({ document }) => toSearchDocument(document)));
      }
      this.persistRegistry(registry);
    } catch (error) {
      if (engine !== null) await engine.close().catch(() => undefined);
      this.loaded = false;
      this.engine = null;
      this.registry = new Map();
      throw wrapEngineError(error);
    }
    this.engine = engine;
    this.registry = registry;
    return {
      mode: "rebuilt",
      documents: registry.size,
      parsed: scans.length,
      discarded,
      rebuildReason: reason,
    };
  }

  private requireEngine(): SearchIndex {
    if (this.engine === null) throw new SkillSearchIndexError("search index is not open");
    return this.engine;
  }

  private async openEngine(): Promise<SearchIndex> {
    try {
      return await openIndex({
        directory: searchIndexDirectory(),
        fields: SKILL_SEARCH_FIELD_SPECS,
        backend: resolveSkillSearchBackend(),
        fuzzy: SKILL_SEARCH_FUZZY,
        prefix: SKILL_SEARCH_PREFIX,
      });
    } catch (error) {
      throw wrapEngineError(error);
    }
  }

  private async loadFromDisk(): Promise<
    | { kind: "ok"; engine: SearchIndex; registry: Map<string, SkillIndexStat> }
    | { kind: "empty"; reason: "missing" | "corrupt" | "incompatible" }
  > {
    let source: string;
    try {
      source = fs.readFileSync(searchMetaFile(), "utf8");
    } catch (error) {
      if (error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT") {
        // 旧 MiniSearch search-index.json（v3）不再读取：缺席即等价空重建。
        return { kind: "empty", reason: "missing" };
      }
      // EACCES/EIO 等读取故障不静默：hard error，保留原文件。
      throw new SkillSearchIndexError(
        `Cannot read the skill search registry ${searchMetaFile()}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
    const envelope = safeParseJson(source, MetaEnvelopeSchema);
    if (!envelope) return { kind: "empty", reason: "corrupt" };
    if (payloadDigest(envelope.documents) !== envelope.payloadDigest) {
      return { kind: "empty", reason: "corrupt" };
    }
    if (envelope.configDigest !== this.currentConfigDigest()) {
      return { kind: "empty", reason: "incompatible" };
    }
    const registry = new Map(Object.entries(envelope.documents));
    const engine = await this.openEngine();
    // 引擎金丝雀：包信封缺失/不匹配/被篡改时 openIndex 会静默删除重建空索引——
    // 登记表非空而引擎召回不了任何已知文档（名字可分词的条目）即判引擎侧失效，
    // 按损坏全量重建，杜绝「登记表有 N 篇、搜索永远空」的静默分裂。
    if (!(await this.engineAnswersRegistry(engine, registry))) {
      await engine.close().catch(() => undefined);
      return { kind: "empty", reason: "corrupt" };
    }
    return { kind: "ok", engine, registry };
  }

  /** 金丝雀探针：登记表首个名字可分词的条目必须能被引擎召回（total > 0）。 */
  private async engineAnswersRegistry(
    engine: SearchIndex,
    registry: Map<string, SkillIndexStat>,
  ): Promise<boolean> {
    for (const entry of registry.values()) {
      if (this.tokenizer.tokenize(entry.name).length === 0) continue;
      const result = await engine.search(entry.name, { limit: 1 });
      return result.total > 0;
    }
    return true; // 无可探测条目（登记表空或名字全部不可分词）：无从验证，放行
  }

  /** 登记表原子落盘；摘要随写计算。 */
  private persistRegistry(registry: Map<string, SkillIndexStat>): void {
    const documents = Object.fromEntries(registry);
    try {
      atomicWriteUtf8(
        searchMetaFile(),
        JSON.stringify({
          schemaVersion: META_SCHEMA_VERSION,
          configDigest: this.currentConfigDigest(),
          payloadDigest: payloadDigest(documents),
          documents,
        }),
      );
    } catch (error) {
      // EACCES/EIO/ENOSPC/rename 失败：命令失败、保留原文件，不降级为空索引。
      throw new SkillSearchIndexError(
        `Cannot persist the skill search registry ${searchMetaFile()}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }

  private currentConfigDigest(): string {
    return skillSearchConfigDigest(this.getSearchConfigDigest(), resolveSkillSearchBackend());
  }

  /** 变更/落盘失败后作废内存状态：下一次调用重新读取磁盘真相。 */
  private invalidateAfterMutationFailure(): void {
    void this.closeEngineQuietly();
    this.loaded = false;
    this.engine = null;
    this.registry = new Map();
  }

  private async closeEngineQuietly(): Promise<void> {
    const engine = this.engine;
    this.engine = null;
    if (engine === null) return;
    await engine.close().catch(() => undefined);
  }
}

/**
 * SkillSearchDocument → 包文档映射（生产与测试共用，不复制常量）：
 * 六个检索字段进 fields（keywords/triggers 数组 join(" ")，与 MiniSearch
 * stringifyField 口径一致）；ranking 投影所需的九个字段进 stored 原样回传。
 */
export function toSearchDocument(document: SkillSearchDocument): SearchDocument {
  return {
    id: document.id as string,
    fields: {
      name: document.name,
      description: document.description,
      keywords: document.keywords.join(" "),
      triggers: document.triggers.join(" "),
      headings: document.headings,
      body: document.body,
    },
    stored: {
      name: document.name,
      description: document.description,
      keywords: document.keywords,
      canonicalPath: document.canonicalPath,
      installations: document.installations,
      contentHash: document.contentHash,
      disabled: document.disabled,
      conflict: document.conflict,
      invalidFrontmatter: document.invalidFrontmatter,
    },
  };
}

/**
 * 包命中 → ranking 候选还原（id 收窄 + stored safeParse；生产 search 与测试
 * 复用同一路径，等价于旧 searchMiniSearchInstance 的投影半段）。
 */
export function rankingCandidatesFromHits(hits: readonly SearchHit[]): RankingCandidate[] {
  const candidates: RankingCandidate[] = [];
  for (const hit of hits) {
    const id = SkillIdSchema.safeParse(hit.id);
    if (!id.success) continue;
    const projection = hit.stored ? safeParseExternal(StoredProjectionSchema, hit.stored) : null;
    if (!projection) continue;
    candidates.push({
      id: id.data,
      bm25: hit.score,
      ...projection,
    });
  }
  return candidates;
}

/** canonicalPath 升序比较（重复组冻结排序共用）。 */
function compareCanonicalPath(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * 载荷完整性摘要：对登记表的 JSON 序列化做 sha256。JSON.stringify 的键序与数字
 * 格式经 stringify→parse→stringify 往返稳定（登记表只含字符串/整数/有限浮点）。
 * 摘要让一切「不重算摘要的篡改」（控制面元数据、stat 四元组、投影元数据）在
 * 加载时整体失效；持有缓存写权限且重算摘要的完整伪造是无密钥模型的不可约边界
 * （docs/search-design.md 声明）。导出供测试镜像复用。
 */
export function payloadDigest(documents: unknown): string {
  return createHash("sha256").update(JSON.stringify(documents)).digest("hex");
}

/**
 * 引擎/文件系统错误 → 领域 typed 错误（SEARCH_IO/BACKEND_UNAVAILABLE/EACCES 等
 * 一律 hard error 上抛；readDocument 的 typed 失败在 try 块之前抛出，不受影响）。
 */
function wrapEngineError(error: unknown): SkillSearchIndexError {
  if (error instanceof SkillSearchIndexError) return error;
  if (error instanceof SearchError) {
    return new SkillSearchIndexError(
      `The @jixoai/search engine failed: ${error.code}: ${error.message}`,
      { cause: error },
    );
  }
  return new SkillSearchIndexError(
    `The skill search index mutation failed: ${error instanceof Error ? error.message : String(error)}`,
    { cause: error },
  );
}

/**
 * stat 键比较：canonicalPath 与文件集（路径 + 逐文件四元组）全等且 installations/
 * disabled/conflict 未漂移时视为新鲜（新增 symlink 入口、启停切换会改变
 * installations/disabled/conflict，即使文件字节未变也需重投影）。scan 不读取内容，
 * 因此这里不把 contentHash 与当前字节逐次重算绑定；canonicalPath 加文件集身份绑定
 * 真实扫描对象。持有 app 缓存写权限者仍可篡改合法格式的 hash，这是缓存威胁模型内
 * 的残留风险，完整 hash 绑定需额外内容读取成本。
 */
function statIsCurrent(stat: SkillIndexStat, scan: CanonicalSkillScan): boolean {
  if (
    stat.canonicalPath !== scan.canonicalPath ||
    stat.disabled !== scan.disabled ||
    stat.conflict !== scan.conflict ||
    stat.files.length !== scan.files.length
  ) {
    return false;
  }
  for (let index = 0; index < stat.files.length; index += 1) {
    const indexed = stat.files[index];
    const candidate = scan.files[index];
    if (
      indexed.path !== candidate.path ||
      indexed.mtimeMs !== candidate.mtimeMs ||
      indexed.size !== candidate.size ||
      indexed.ino !== candidate.ino ||
      indexed.ctimeMs !== candidate.ctimeMs
    ) {
      return false;
    }
  }
  return (
    stat.installations.length === scan.installations.length &&
    stat.installations.every((installation, index) => {
      const candidate = scan.installations[index];
      return (
        installation.path === candidate.path &&
        installation.workspaceId === candidate.workspaceId &&
        installation.providerId === candidate.providerId
      );
    })
  );
}

function registryEntry(scan: CanonicalSkillScan, document: SkillSearchDocument): SkillIndexStat {
  return {
    canonicalPath: scan.canonicalPath,
    files: scan.files,
    installations: document.installations,
    contentHash: document.contentHash,
    disabled: document.disabled,
    conflict: document.conflict,
    invalidFrontmatter: document.invalidFrontmatter,
    name: document.name,
  };
}
