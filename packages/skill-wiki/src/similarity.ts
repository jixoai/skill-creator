/**
 * 用户原始需求 [2026-09-21]（jixoai-search-core 3.5）：「add 默认在写入后对同
 * scope 执行相似检索，近亲条目以 warning 附带输出……AI 可据警告走 edit（吸收）+
 * remove（删重复页）纠偏」。
 * 正交意图：
 *   [1] scope 查重索引生命周期：<wikiRoot>/search-index/<scope>/，@jixoai/search
 *       sqlite backend（多进程安全默认，与 daemon 选择一致；tantivy 目录锁是
 *       单写者）。信封重建探测 = openIndex 前后 envelope.json 字节比对
 *       （missing 或字节变化 ⟺ 新建/重建 → 全量重灌）。
 *   [2] 相似判定：相对分 = 候选命中分 / 自查询分（该页 title+body 作为 query 时
 *       自身的命中分 = 该 query 的可达上界），阈值冻结为版本化常量。
 * 妥协声明：daemon 侧 wiki 追加不维护本索引（查重归属 CLI/宿主编排，spec
 * 「派生物归属」）；经 daemon 写入的页在下一次全量重灌前不被 find/相似召回
 * （小语料可接受的渐进一致性；信封不匹配自动重建来自包语义）。
 */
import fs from "node:fs";
import path from "node:path";
import { openIndex, type SearchDocument, type SearchIndex } from "@jixoai/search";
import type { WikiScope } from "./workspace.js";

/**
 * @jixoai/search 的信封文件名（包内 ENVELOPE_FILE_NAME 常量未从公共面导出）。
 * 若包侧改名，本探测退化为「每次全量重灌」——安全方向（永不 stale），仅慢。
 */
const INDEX_ENVELOPE_FILE = "envelope.json";

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

/**
 * 打开（必要时创建并全量灌入）某 scope 的查重索引。索引目录不存在、或
 * openIndex 侧发生信封重建（前后字节指纹变化）→ 以 loadPatterns() 全量重灌；
 * 否则复用磁盘索引（增量维护交给调用方的 upsert/remove）。
 */
export async function openScopeSearchIndex(
  wikiRoot: string,
  scope: WikiScope,
  loadPatterns: () => PatternDocSource[],
): Promise<SearchIndex> {
  const directory = scopeSearchIndexDirectory(wikiRoot, scope);
  const before = readEnvelopeFingerprint(directory);
  const index = await openIndex({
    directory,
    fields: WIKI_SEARCH_FIELDS,
    backend: "sqlite",
  });
  const after = readEnvelopeFingerprint(directory);
  if (before === null || before !== after) {
    await index.upsert(loadPatterns().map(patternSearchDoc));
  }
  return index;
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
