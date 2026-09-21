/**
 * 用户原始需求 [2026-09-21]（jixoai-search-core 3.5）：「add 默认在写入后对同
 * scope 执行相似检索，近亲条目以 warning 附带输出……AI 可据警告走 edit（吸收）+
 * remove（删重复页）纠偏」。
 * 修订 [2026-09-21]（终审 P1-2 处置）：查重索引必须感知 patterns/ 的外部变更
 * （编辑器/库 API 直接改盘）——索引目录旁存 corpus 登记（name → contentHash），
 * 每次打开重算当前 patterns 与登记比对：一致复用；漂移增量同步；登记缺失或
 * 全量漂移 >50% → 全量重灌。仅比对 envelope.json 字节的旧探测保留（包信封
 * 重建后 corpus 也重建）。
 * 正交意图：
 *   [1] scope 查重索引生命周期：<wikiRoot>/search-index/<scope>/，@jixoai/search
 *       sqlite backend（多进程安全默认，与 daemon 选择一致；tantivy 目录锁是
 *       单写者）。corpus 登记放在索引目录**旁**（<scope>.corpus.json）——包的
 *       openIndex 重建审计只接受信封与 backend 已知产物，外来文件会拒绝重建。
 *   [2] 相似判定：相对分 = 候选命中分 / 自查询分（该页 title+body 作为 query 时
 *       自身的命中分 = 该 query 的可达上界），阈值冻结为版本化常量。
 */
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { openIndex, type SearchDocument, type SearchIndex } from "@jixoai/search";
import { patternContentHash, type WikiScope } from "./workspace.js";

/**
 * @jixoai/search 的信封文件名（包内 ENVELOPE_FILE_NAME 常量未从公共面导出）。
 * 若包侧改名，本探测退化为「每次全量重灌」——安全方向（永不 stale），仅慢。
 */
const INDEX_ENVELOPE_FILE = "envelope.json";

/** corpus 登记结构版本。 */
const CORPUS_SCHEMA_VERSION = 1;

/** corpus 登记形状（派生物登记：不兼容/缺失 → 全量重建，不 guard 用户数据）。 */
const CorpusFileSchema = z
  .object({
    schemaVersion: z.literal(CORPUS_SCHEMA_VERSION),
    files: z.record(z.string().min(1), z.string().regex(/^[a-f0-9]{64}$/)),
  })
  .strict();

/** 漂移增量超过登记规模的该比例时放弃增量、全量重灌。 */
const CORPUS_FULL_REBUILD_RATIO = 0.5;

/** 查重索引字段声明：title 加权 3、body 加权 1（spec 冻结口径）。 */
export const WIKI_SEARCH_FIELDS: Record<string, { weight: number }> = {
  title: { weight: 3 },
  body: { weight: 1 },
};

/**
 * 相似判定阈值（相对分口径，冻结常量）。
 * v1 [2026-09-21] = 0.35：同义改写的词面重叠通常落在 0.4-0.8，无关条目低于
 * 0.2（小语料实证标定）。调整必须递增版本号并在此说明依据。
 */
export const SIMILARITY_THRESHOLD = 0.35;

/** 相似警告输出的近亲条数上限。 */
export const SIMILARITY_LIMIT = 3;

/** scope 的查重索引目录：<wikiRoot>/search-index/<scope>/。 */
export function scopeSearchIndexDirectory(wikiRoot: string, scope: WikiScope): string {
  return path.join(wikiRoot, "search-index", scope === "~" ? "~" : scope);
}

/** scope 的 corpus 登记文件（索引目录旁的兄弟文件；索引目录内容审计不接受外来文件）。 */
export function scopeCorpusRegistryFile(wikiRoot: string, scope: WikiScope): string {
  return `${scopeSearchIndexDirectory(wikiRoot, scope)}.corpus.json`;
}

/** 索引文档源：一个 pattern 页的可检索投影。 */
export interface PatternDocSource {
  name: string;
  title: string;
  body: string;
}

/** pattern 页 → 查重索引文档（id = name；stored title 供命中回显）。 */
export function patternSearchDoc(source: PatternDocSource): SearchDocument {
  return {
    id: source.name,
    fields: { title: source.title, body: source.body },
    stored: { title: source.title },
  };
}

/** 读取索引目录的信封字节指纹（missing = null）。 */
function readEnvelopeFingerprint(directory: string): string | null {
  try {
    return fs.readFileSync(path.join(directory, INDEX_ENVELOPE_FILE), "utf8");
  } catch {
    return null;
  }
}

/** 读取 corpus 登记（缺失/不兼容 = null：派生物语义，缺失即全量重建）。 */
function readCorpus(file: string): Map<string, string> | null {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = CorpusFileSchema.safeParse(json);
  return parsed.success ? new Map(Object.entries(parsed.data.files)) : null;
}

/** corpus 登记原子落盘（同目录 tmp + rename）。 */
function writeCorpus(file: string, files: Map<string, string>): void {
  const payload = JSON.stringify({
    schemaVersion: CORPUS_SCHEMA_VERSION,
    files: Object.fromEntries(
      [...files].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
    ),
  });
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(temp, `${payload}\n`, "utf8");
  fs.renameSync(temp, file);
}

/**
 * 打开（必要时同步）某 scope 的查重索引。patterns/ 是唯一真相：每次打开都
 * 重算当前 patterns 的 name→contentHash，与 corpus 登记比对——
 * - 登记缺失 → 索引内容不可证明，整目录重建（派生物，安全删除）+ 全量重灌；
 * - openIndex 信封重建（目录缺失/口径漂移）→ 引擎已清空，全量重灌 + 登记重建；
 * - 登记一致 → 复用磁盘索引（增量维护交给调用方的 upsert/remove）；
 * - 漂移 → 增量同步（缺失/变更 upsert、多余 remove）；漂移 >50% → 全量重灌。
 * 外部（编辑器/库 API）对 patterns/ 的增删改由此即时反映，不再静默漏检。
 */
export async function openScopeSearchIndex(
  wikiRoot: string,
  scope: WikiScope,
  loadPatterns: () => PatternDocSource[],
): Promise<SearchIndex> {
  const directory = scopeSearchIndexDirectory(wikiRoot, scope);
  const corpusFile = scopeCorpusRegistryFile(wikiRoot, scope);
  const patterns = loadPatterns();
  const desired = new Map(patterns.map((source) => [source.name, patternContentHash(source.body)]));

  const corpus = readCorpus(corpusFile);
  if (corpus === null) {
    fs.rmSync(directory, { recursive: true, force: true });
    const index = await openIndex({
      directory,
      fields: WIKI_SEARCH_FIELDS,
      backend: "sqlite",
    });
    await index.upsert(patterns.map(patternSearchDoc));
    writeCorpus(corpusFile, desired);
    return index;
  }

  const before = readEnvelopeFingerprint(directory);
  const index = await openIndex({
    directory,
    fields: WIKI_SEARCH_FIELDS,
    backend: "sqlite",
  });
  const after = readEnvelopeFingerprint(directory);
  if (before === null || before !== after) {
    // 包信封重建：引擎已清空，全量重灌并重建 corpus 登记。
    await index.upsert(patterns.map(patternSearchDoc));
    writeCorpus(corpusFile, desired);
    return index;
  }

  const changed = patterns.filter((source) => corpus.get(source.name) !== desired.get(source.name));
  const extra = [...corpus.keys()].filter((name) => !desired.has(name));
  if (changed.length === 0 && extra.length === 0) return index;

  const drift = changed.length + extra.length;
  if (corpus.size === 0 || drift / corpus.size > CORPUS_FULL_REBUILD_RATIO) {
    if (extra.length > 0) await index.remove(extra);
    await index.upsert(patterns.map(patternSearchDoc));
  } else {
    if (changed.length > 0) await index.upsert(changed.map(patternSearchDoc));
    if (extra.length > 0) await index.remove(extra);
  }
  writeCorpus(corpusFile, desired);
  return index;
}

/** 调用方增量 upsert 后同步 corpus 登记（幂等：同 hash 重写）。 */
export function registerScopeCorpusEntries(
  wikiRoot: string,
  scope: WikiScope,
  sources: readonly PatternDocSource[],
): void {
  const file = scopeCorpusRegistryFile(wikiRoot, scope);
  const corpus = readCorpus(file) ?? new Map<string, string>();
  for (const source of sources) corpus.set(source.name, patternContentHash(source.body));
  writeCorpus(file, corpus);
}

/** 调用方增量 remove 后同步 corpus 登记（登记缺失 = 下次打开全量重建，无需维护）。 */
export function unregisterScopeCorpusEntries(
  wikiRoot: string,
  scope: WikiScope,
  names: readonly string[],
): void {
  const file = scopeCorpusRegistryFile(wikiRoot, scope);
  const corpus = readCorpus(file);
  if (corpus === null) return;
  let mutated = false;
  for (const name of names) mutated = corpus.delete(name) || mutated;
  if (mutated) writeCorpus(file, corpus);
}

/** 相似近亲条目（相对分已归一）。 */
export interface SimilarPattern {
  name: string;
  score: number;
}

/**
 * 对某页执行相似检索：query = title + body；自身命中分为归一上界，候选相对分
 * ≥ SIMILARITY_THRESHOLD 且非自身 → 近亲（≤ SIMILARITY_LIMIT 条）。
 */
export async function findSimilarPatterns(
  index: SearchIndex,
  source: PatternDocSource,
): Promise<SimilarPattern[]> {
  const result = await index.search(`${source.title}\n${source.body}`, {
    limit: SIMILARITY_LIMIT + 1,
  });
  const self = result.hits.find((hit) => hit.id === source.name);
  if (!self || self.score <= 0) return [];
  return result.hits
    .filter((hit) => hit.id !== source.name)
    .filter((hit) => hit.score / self.score >= SIMILARITY_THRESHOLD)
    .slice(0, SIMILARITY_LIMIT)
    .map((hit) => ({ name: hit.id, score: hit.score / self.score }));
}
