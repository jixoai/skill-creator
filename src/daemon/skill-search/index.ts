/**
 * 用户原始需求 [2026-09-17]：「索引持久化于 <appDir>/search-index.json，信封含五版本与
 * stat 元数据，写入走 0600 原子写；freshen 先做无内容读取的 stat 扫描；错误矩阵闭合
 * （缺失/损坏重建，EACCES/EIO/ENOSPC/rename 失败 hard error）。」（docs/search-design.md §10）
 * 正交意图：
 * 1. MiniSearch 引擎封装：字段×boost/prefix/fuzzy 常量与 tokenizer 全注入（CLI 不直接 import MiniSearch）。
 * 2. 五版本信封（schema/tokenizer/parser/ranking/engine{name,version,configDigest}）持久化与加载收窄。
 * 3. stat 新鲜度增量维护（无内容读取的 diff、discard(id)+add、脏度 >20% 或版本不符全量重建）。
 * 4. 存储字段投影经 Zod safeParse 收窄后供 ranking 消费。
 * 妥协声明：四个意图共享同一 MiniSearch 实例的私有生命周期，物理拆分会把可变索引状态
 * 泄漏成跨模块协议，故聚合于一个 deep module（对外只暴露 SkillSearchIndex 接口）。
 */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import MiniSearch, { type Options } from "minisearch";
import { z } from "zod";
import { appDir } from "../../shared/paths.js";
import { safeParseExternal, safeParseJson } from "../../shared/external-input.js";
import type { SkillInstallation, SkillSearchDocument } from "../../shared/contracts/search.js";
import { SkillInstallationSchema } from "../../shared/contracts/search.js";
import { SkillIdSchema } from "../../shared/contracts/skills.js";
import { atomicWriteUtf8 } from "../path-safety.js";
import type { CanonicalSkillScan } from "./canonicalize.js";
import { PARSER_VERSION } from "./parser.js";
import { RANKING_VERSION, type RankingCandidate } from "./ranking.js";
import { createSkillTokenizer, TOKENIZER_VERSION, type SkillTokenizer } from "./tokenizer.js";

/** 信封结构版本（v2 起：payloadDigest 载荷完整性摘要）。 */
const SCHEMA_VERSION = 2;
/** 引擎名与持久化文件名。 */
const ENGINE_NAME = "minisearch";
const SEARCH_INDEX_FILE = "search-index.json";

/** 索引字段与查询期字段权重（冻结：name×10 description×6 keywords×5 triggers×5 headings×3 body×1）。 */
const SEARCH_FIELDS = ["name", "description", "keywords", "triggers", "headings", "body"] as const;
const FIELD_BOOST: Record<(typeof SEARCH_FIELDS)[number], number> = {
  name: 10,
  description: 6,
  keywords: 5,
  triggers: 5,
  headings: 3,
  body: 1,
};
/** 结果投影所需存储字段（body/headings 只索引不存储，避免 JSON 膨胀）。 */
const STORE_FIELDS = [
  "name",
  "description",
  "keywords",
  "canonicalPath",
  "installations",
  "contentHash",
  "disabled",
  "conflict",
  "invalidFrontmatter",
] as const;
const SEARCH_PREFIX = true;
const SEARCH_FUZZY = 0.2;
/** 增量 freshen 的脏度阈值：discard 操作占比超过该值时全量重建。 */
const REBUILD_DISCARD_RATIO = 0.2;

/** 引擎配置摘要（字段/boost/fuzzy/prefix/processTerm 常量的 JSON 序列化 sha256 前 16 hex）。 */
export const ENGINE_CONFIG_DIGEST = createHash("sha256")
  .update(
    JSON.stringify({
      fields: [...SEARCH_FIELDS],
      boost: FIELD_BOOST,
      prefix: SEARCH_PREFIX,
      fuzzy: SEARCH_FUZZY,
      processTerm: "identity",
    }),
  )
  .digest("hex")
  .slice(0, 16);

/** 每个索引文档的持久化 stat 元数据（信封 stats 值形状）。 */
export interface SkillIndexStat {
  canonicalPath: string;
  mtimeMs: number;
  size: number;
  ino: number;
  ctimeMs: number;
  installations: SkillInstallation[];
  contentHash: string;
  disabled: boolean;
  conflict: boolean;
  invalidFrontmatter: boolean;
}

/** freshen 结果摘要。 */
export interface FreshenSummary {
  mode: "fresh" | "incremental" | "rebuilt";
  documents: number;
  parsed: number;
  discarded: number;
  rebuildReason?: "missing" | "corrupt" | "incompatible" | "dirty-ratio";
}

/** 持久索引的对外抽象：未来可替换为自研 BM25F / Tantivy backend。 */
export interface SkillSearchIndex {
  freshen: (
    scans: readonly CanonicalSkillScan[],
    readDocument: (scan: CanonicalSkillScan) => SkillSearchDocument,
  ) => FreshenSummary;
  search: (query: string) => RankingCandidate[];
  documentCount: () => number;
}

/** 索引 IO 故障（EACCES/EIO/ENOSPC/原子 rename 失败等）：hard error，不降级为空索引。 */
export class SkillSearchIndexError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SkillSearchIndexError";
  }
}

const StatEnvelopeSchema = z
  .object({
    canonicalPath: z.string().min(1),
    mtimeMs: z.number(),
    size: z.number(),
    ino: z.number(),
    ctimeMs: z.number(),
    installations: z.array(SkillInstallationSchema).min(1),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    disabled: z.boolean(),
    conflict: z.boolean(),
    invalidFrontmatter: z.boolean(),
  })
  .strict();

const IndexEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(2),
    tokenizerVersion: z.string(),
    parserVersion: z.string(),
    rankingVersion: z.string(),
    engine: z.object({ name: z.string(), version: z.string(), configDigest: z.string() }).strict(),
    /** 载荷完整性摘要：sha256(JSON.stringify({index, stats}))，写入时计算、加载时重算。 */
    payloadDigest: z.string().regex(/^[a-f0-9]{64}$/),
    index: z.unknown(),
    stats: z.record(SkillIdSchema, StatEnvelopeSchema),
  })
  .strict();

/**
 * 存储字段投影的运行时收窄（index JSON 是外部输入，进入内存前必须 safeParse）。
 * contentHash/canonicalPath/installations 带格式约束：篡改的缓存（伪路径、伪
 * hash）在加载即被拒绝并按损坏重建，不会注入结果元数据。
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

/** 创建生产 MiniSearch 配置（tokenize 全注入、processTerm 恒等、autoVacuum 关闭由脏度阈值接管）。 */
export function createSearchMiniSearch(tokenizer: SkillTokenizer): MiniSearch<SkillSearchDocument> {
  return new MiniSearch<SkillSearchDocument>(miniSearchOptions(tokenizer));
}

/**
 * 以冻结查询参数（字段 boost、prefix、fuzzy 0.2）检索一个 MiniSearch 实例，并把存储
 * 字段经 safeParse 收窄为 ranking 候选。测试与性能脚本经此复用与生产完全一致的常量。
 */
export function searchMiniSearchInstance(
  miniSearch: MiniSearch<SkillSearchDocument>,
  query: string,
): RankingCandidate[] {
  const results = miniSearch.search(query, {
    boost: FIELD_BOOST,
    prefix: SEARCH_PREFIX,
    fuzzy: SEARCH_FUZZY,
  });
  const candidates: RankingCandidate[] = [];
  for (const result of results) {
    const id = SkillIdSchema.safeParse(result.id);
    if (!id.success) continue;
    const stored = miniSearch.getStoredFields(result.id);
    const projection = stored ? safeParseExternal(StoredProjectionSchema, stored) : null;
    if (!projection) continue;
    candidates.push({
      id: id.data,
      bm25: result.score,
      ...projection,
    });
  }
  return candidates;
}

function miniSearchOptions(tokenizer: SkillTokenizer): Options<SkillSearchDocument> {
  return {
    fields: [...SEARCH_FIELDS],
    storeFields: [...STORE_FIELDS],
    tokenize: (text: string) => tokenizer.tokenize(text),
    processTerm: (term: string) => term,
    stringifyField: (value) => (Array.isArray(value) ? value.join(" ") : String(value)),
    autoVacuum: false,
  };
}

/**
 * 创建绑定 appDir 的持久索引。索引文件路径恒由 appDir() 派生（每次 freshen 重新解析，
 * 与 setHomeOverride 测试隔离兼容）；不接受调用方传入的索引路径。
 */
export function createSkillSearchIndex(
  tokenizer: SkillTokenizer = createSkillTokenizer(),
): SkillSearchIndex {
  return new MiniSearchSkillSearchIndex(tokenizer);
}

class MiniSearchSkillSearchIndex implements SkillSearchIndex {
  private miniSearch: MiniSearch<SkillSearchDocument>;
  private stats = new Map<string, SkillIndexStat>();
  private loaded = false;

  constructor(private readonly tokenizer: SkillTokenizer) {
    this.miniSearch = createSearchMiniSearch(tokenizer);
  }

  freshen(
    scans: readonly CanonicalSkillScan[],
    readDocument: (scan: CanonicalSkillScan) => SkillSearchDocument,
  ): FreshenSummary {
    if (!this.loaded) {
      const load = this.loadFromDisk();
      this.loaded = true;
      if (load.kind !== "ok") {
        return this.rebuild(scans, readDocument, load.reason);
      }
      this.miniSearch = load.miniSearch;
      this.stats = load.stats;
    }

    const scanById = new Map(scans.map((scan) => [scan.id as string, scan]));
    const indexedIds = new Set(this.stats.keys());
    const removed = [...indexedIds].filter((id) => !scanById.has(id));
    const changed: CanonicalSkillScan[] = [];
    for (const scan of scans) {
      const stat = this.stats.get(scan.id as string);
      if (!stat || !statIsCurrent(stat, scan)) changed.push(scan);
    }
    const discardOperations =
      removed.length + changed.filter((scan) => indexedIds.has(scan.id as string)).length;
    const dirtyRatio = indexedIds.size === 0 ? 1 : discardOperations / indexedIds.size;
    if (dirtyRatio > REBUILD_DISCARD_RATIO) {
      return this.rebuild(scans, readDocument, "dirty-ratio");
    }

    if (removed.length === 0 && changed.length === 0) {
      return { mode: "fresh", documents: this.stats.size, parsed: 0, discarded: 0 };
    }

    // 批量前置读取：任何文档读取失败（含 TOCTOU 身份错误）发生在内存被触碰
    // 之前——typed error 原样上抛，本轮不留下部分状态。
    const documents = changed.map((scan) => ({ scan, document: readDocument(scan) }));

    // 变更阶段快照：discard/add/save 任一失败时回滚到本轮开始前的完整成员状态。
    const snapshotIndex = this.miniSearch.toJSON();
    const snapshotStats = new Map(this.stats);
    let parsed = 0;
    try {
      for (const id of removed) {
        this.discardIndexed(id);
        this.stats.delete(id);
      }
      for (const { scan, document } of documents) {
        if (indexedIds.has(scan.id as string)) this.discardIndexed(scan.id as string);
        this.miniSearch.add(document);
        this.stats.set(scan.id as string, statEntry(scan, document));
        parsed += 1;
      }
      this.save();
    } catch (error) {
      this.restoreSnapshot(snapshotIndex, snapshotStats);
      if (error instanceof SkillSearchIndexError) this.invalidateAfterSaveFailure();
      throw error;
    }
    return {
      mode: "incremental",
      documents: this.stats.size,
      parsed,
      discarded: discardOperations,
    };
  }

  search(query: string): RankingCandidate[] {
    return searchMiniSearchInstance(this.miniSearch, query);
  }

  documentCount(): number {
    return this.miniSearch.documentCount;
  }

  private rebuild(
    scans: readonly CanonicalSkillScan[],
    readDocument: (scan: CanonicalSkillScan) => SkillSearchDocument,
    reason: FreshenSummary["rebuildReason"],
  ): FreshenSummary {
    const discarded = this.stats.size;
    // 事务式重建：在局部状态上构建，save 成功后才交换成员——中途读取失败或落盘
    // 失败都不留下部分索引。
    const miniSearch = createSearchMiniSearch(this.tokenizer);
    const stats = new Map<string, SkillIndexStat>();
    for (const scan of scans) {
      const document = readDocument(scan);
      miniSearch.add(document);
      stats.set(scan.id as string, statEntry(scan, document));
    }
    const envelopeIndex = miniSearch.toJSON();
    const envelopeStats = Object.fromEntries(stats);
    try {
      this.persist(envelopeIndex, envelopeStats);
    } catch (error) {
      this.invalidateAfterSaveFailure();
      throw error;
    }
    this.miniSearch = miniSearch;
    this.stats = stats;
    return {
      mode: "rebuilt",
      documents: stats.size,
      parsed: scans.length,
      discarded,
      rebuildReason: reason,
    };
  }

  /** 落盘失败后清空不可持久化的内存快照，下一次调用必须重新读取磁盘真相。 */
  private invalidateAfterSaveFailure(): void {
    this.loaded = false;
    this.miniSearch = createSearchMiniSearch(this.tokenizer);
    this.stats = new Map();
  }

  /** 增量变更阶段失败后恢复本轮开始前的完整成员状态（索引原子一致性）。 */
  private restoreSnapshot(
    snapshotIndex: unknown,
    snapshotStats: Map<string, SkillIndexStat>,
  ): void {
    try {
      this.miniSearch = MiniSearch.loadJSON<SkillSearchDocument>(
        JSON.stringify(snapshotIndex),
        miniSearchOptions(this.tokenizer),
      );
      this.stats = snapshotStats;
    } catch {
      // 快照恢复失败（不应发生）：退化为作废内存状态，下次调用从磁盘重来。
      this.invalidateAfterSaveFailure();
    }
  }

  private discardIndexed(id: string): void {
    // MiniSearch 7 discard 接受 id 字符串；对不在索引中的 id discard 会抛错。
    if (this.miniSearch.has(id)) this.miniSearch.discard(id);
  }

  private loadFromDisk():
    | {
        kind: "ok";
        miniSearch: MiniSearch<SkillSearchDocument>;
        stats: Map<string, SkillIndexStat>;
      }
    | { kind: "empty"; reason: "missing" | "corrupt" | "incompatible" } {
    const file = path.join(appDir(), SEARCH_INDEX_FILE);
    let source: string;
    try {
      source = fs.readFileSync(file, "utf8");
    } catch (error) {
      if (error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT") {
        return { kind: "empty", reason: "missing" };
      }
      // EACCES/EIO 等读取故障不静默：hard error，保留原文件。
      throw new SkillSearchIndexError(
        `Cannot read the skill search index ${file}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
    const envelope = safeParseJson(source, IndexEnvelopeSchema);
    if (!envelope) return { kind: "empty", reason: "corrupt" };
    // 载荷摘要优先校验：控制面元数据、倒排、投影文本、stats 的任何未重算摘要的
    // 篡改在此整体失效（含 NaN 注入与合法格式伪造向量）。
    if (payloadDigest(envelope.index, envelope.stats) !== envelope.payloadDigest) {
      return { kind: "empty", reason: "corrupt" };
    }
    if (
      envelope.tokenizerVersion !== TOKENIZER_VERSION ||
      envelope.parserVersion !== PARSER_VERSION ||
      envelope.rankingVersion !== RANKING_VERSION ||
      envelope.engine.name !== ENGINE_NAME ||
      envelope.engine.version !== minisearchRuntimeVersion() ||
      envelope.engine.configDigest !== ENGINE_CONFIG_DIGEST
    ) {
      return { kind: "empty", reason: "incompatible" };
    }
    try {
      // 活跃文档集合等值校验：MiniSearch 7 的 discard() 立即移除 active id 记录
      // （序列化 documentIds 只含活跃文档），因此序列化活跃 id 与 stats 键必须
      // 互为镜像——stats 被裁剪的「幽灵文档」或 stats 多出的悬空条目都按损坏重建。
      // documentIds 的值与 storedFields 的键也必须保持一一映射；仅比较去重后的
      // active id 集合会让重复 id 把一个文档的倒排词伪装成另一个文档。
      const serialized = safeParseExternal(
        z
          .object({
            documentIds: z.record(z.string(), z.string()),
            storedFields: z.record(z.string(), z.unknown()),
          })
          .passthrough(),
        envelope.index,
      );
      if (!serialized) return { kind: "empty", reason: "corrupt" };
      const shortIds = Object.keys(serialized.documentIds);
      const activeIdValues = Object.values(serialized.documentIds);
      const activeIds = new Set(activeIdValues);
      const statIds = new Set(Object.keys(envelope.stats));
      const storedFieldIds = Object.keys(serialized.storedFields);
      if (
        activeIds.size !== activeIdValues.length ||
        activeIds.size !== statIds.size ||
        activeIdValues.some((id) => !statIds.has(id)) ||
        storedFieldIds.length !== shortIds.length ||
        shortIds.some((shortId) => !Object.hasOwn(serialized.storedFields, shortId))
      ) {
        return { kind: "empty", reason: "corrupt" };
      }

      const miniSearch = MiniSearch.loadJSON<SkillSearchDocument>(
        JSON.stringify(envelope.index),
        miniSearchOptions(this.tokenizer),
      );
      // 每个 stats 条目必须在索引中在场，且存储投影与 stats 逐字段一致：stats 是
      // 唯一可重放元数据源，格式合法但与 stats 相矛盾的缓存（伪路径/伪 hash/伪
      // 安装表）在加载即拒绝，不注入结果元数据。
      for (const [id, stat] of Object.entries(envelope.stats)) {
        if (!miniSearch.has(id)) return { kind: "empty", reason: "corrupt" };
        const stored = miniSearch.getStoredFields(id);
        const projection = stored ? safeParseExternal(StoredProjectionSchema, stored) : null;
        if (
          !projection ||
          projection.canonicalPath !== stat.canonicalPath ||
          projection.contentHash !== stat.contentHash ||
          projection.disabled !== stat.disabled ||
          projection.conflict !== stat.conflict ||
          projection.invalidFrontmatter !== stat.invalidFrontmatter ||
          JSON.stringify(projection.installations) !== JSON.stringify(stat.installations)
        ) {
          return { kind: "empty", reason: "corrupt" };
        }
      }
      return { kind: "ok", miniSearch, stats: new Map(Object.entries(envelope.stats)) };
    } catch {
      return { kind: "empty", reason: "corrupt" };
    }
  }

  private save(): void {
    this.persist(this.miniSearch.toJSON(), Object.fromEntries(this.stats));
  }

  /** 组装五版本信封并原子落盘；载荷摘要随写计算。 */
  private persist(index: unknown, stats: Record<string, SkillIndexStat>): void {
    const file = path.join(appDir(), SEARCH_INDEX_FILE);
    const envelope = {
      schemaVersion: SCHEMA_VERSION,
      tokenizerVersion: TOKENIZER_VERSION,
      parserVersion: PARSER_VERSION,
      rankingVersion: RANKING_VERSION,
      engine: {
        name: ENGINE_NAME,
        version: minisearchRuntimeVersion(),
        configDigest: ENGINE_CONFIG_DIGEST,
      },
      payloadDigest: payloadDigest(index, stats),
      index,
      stats,
    };
    try {
      atomicWriteUtf8(file, JSON.stringify(envelope));
    } catch (error) {
      // EACCES/EIO/ENOSPC/rename 失败：命令失败、保留原文件，不降级为空索引。
      throw new SkillSearchIndexError(
        `Cannot persist the skill search index ${file}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }
}

/**
 * 载荷完整性摘要：对 {index, stats} 的 JSON 序列化做 sha256。JSON.stringify 的
 * 键序与数字格式经 stringify→parse→stringify 往返稳定（MiniSearch 载荷只含
 * 字符串/整数/有限浮点）。摘要让一切「不重算摘要的篡改」（控制面元数据、
 * 倒排、投影文本、stats）在加载时整体失效；持有缓存写权限且重算摘要的完整
 * 伪造是无密钥模型的不可约边界（design.md 声明）。导出供测试镜像复用。
 */
export function payloadDigest(index: unknown, stats: unknown): string {
  return createHash("sha256").update(JSON.stringify({ index, stats })).digest("hex");
}

/**
 * stat 键比较：canonicalPath 与四元组（mtimeMs+size+ino+ctimeMs）全等且
 * installations/disabled/conflict 未漂移时视为新鲜（新增 symlink 入口、启停切换会改变
 * installations/disabled/conflict，即使 SKILL.md 字节未变也需重投影）。
 * scan 不读取内容，因此这里不把 contentHash 与当前字节逐次重算绑定；canonicalPath
 * 加四元组绑定真实扫描对象。持有 app 缓存写权限者仍可篡改合法格式的 hash，这是缓存
 * 威胁模型内的残留风险，完整 hash 绑定需额外内容读取成本。
 */
function statIsCurrent(stat: SkillIndexStat, scan: CanonicalSkillScan): boolean {
  if (
    stat.canonicalPath !== scan.canonicalPath ||
    stat.mtimeMs !== scan.stat.mtimeMs ||
    stat.size !== scan.stat.size ||
    stat.ino !== scan.stat.ino ||
    stat.ctimeMs !== scan.stat.ctimeMs ||
    stat.disabled !== scan.disabled ||
    stat.conflict !== scan.conflict
  ) {
    return false;
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

function statEntry(scan: CanonicalSkillScan, document: SkillSearchDocument): SkillIndexStat {
  return {
    canonicalPath: scan.canonicalPath,
    mtimeMs: scan.stat.mtimeMs,
    size: scan.stat.size,
    ino: scan.stat.ino,
    ctimeMs: scan.stat.ctimeMs,
    installations: document.installations,
    contentHash: document.contentHash,
    disabled: document.disabled,
    conflict: document.conflict,
    invalidFrontmatter: document.invalidFrontmatter,
  };
}

let cachedRuntimeVersion: string | null = null;

/** 运行时解析到的确切 minisearch 包版本（非通配；解析失败稳定回退 "unresolved"）。 */
export function minisearchRuntimeVersion(): string {
  if (cachedRuntimeVersion) return cachedRuntimeVersion;
  try {
    const require = createRequire(import.meta.url);
    const entry = require.resolve("minisearch");
    // 入口在 dist/es|cjs/index.js；向上查找真实 package.json（exports 不暴露 ./package.json）。
    let directory = path.dirname(entry);
    for (let hop = 0; hop < 4; hop += 1) {
      const packageFile = path.join(directory, "package.json");
      if (fs.existsSync(packageFile)) {
        const version = safeParseJson(
          fs.readFileSync(packageFile, "utf8"),
          z.object({ version: z.string() }),
        )?.version;
        cachedRuntimeVersion = version ?? "unresolved";
        return cachedRuntimeVersion;
      }
      directory = path.dirname(directory);
    }
    cachedRuntimeVersion = "unresolved";
  } catch {
    cachedRuntimeVersion = "unresolved";
  }
  return cachedRuntimeVersion;
}
