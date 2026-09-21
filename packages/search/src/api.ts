/**
 * 用户原始需求 [2026-09-21]：「通用 API 提供索引/搜索能力，tantivy 的 schema
 * builder / Query 代数 / 同步阻塞全部关在实现层……公共面零引擎概念泄漏」
 * （jixoai-search-core proposal §A；包名 @jixoai/search，检索是 org 级通用能力）。
 * 正交意图：
 *   [1] 领域契约类型：文档/命中/字段声明/索引生命周期（全 async，backend 无关）。
 *   [2] typed 错误面：有限三码错误词汇，mutation 参数非法一律显式拒绝。
 * 妥协声明：排序冻结为 score desc → id asc（消费者侧的折叠/rerank 不属于本包）；
 * limit/offset 为分页唯一语义，total = 分页前命中 doc 总数。
 */

/** 后端选择：召回与持久化实现；BM25 变体打分恒在 JS 共享层（两后端分数逐位一致）。 */
export type SearchBackend = "tantivy" | "sqlite";

/** 字段声明：weight 为该字段的打分乘数（MiniSearch fieldBoost 语义）。 */
export interface SearchFieldSpec {
  weight: number;
}

/** 写入文档：fields 键必须 ⊆ openIndex 声明的字段；stored 回传不打分。 */
export interface SearchDocument {
  id: string;
  fields: Record<string, string>;
  stored?: Record<string, unknown>;
}

/** 命中：score 为冻结口径分数；stored 原样回传。 */
export interface SearchHit {
  id: string;
  score: number;
  stored?: Record<string, unknown>;
}

/** 搜索结果：hits 已按 score desc → id asc 排序并应用 limit/offset；total 为分页前命中数。 */
export interface SearchResult {
  hits: SearchHit[];
  total: number;
}

/** 查询分页：limit 默认 10、上限 100；offset 默认 0。 */
export interface SearchQueryOptions {
  limit?: number;
  offset?: number;
}

/** 打开索引的选项；fuzzy 为编辑距离比例（MiniSearch 兼容语义，默认 0.2），prefix 默认 true。 */
export interface OpenIndexOptions {
  directory: string;
  fields: Record<string, SearchFieldSpec>;
  backend?: SearchBackend;
  fuzzy?: number;
  prefix?: boolean;
}

/** 索引实例：同 id upsert 覆盖（幂等）；close 后再使用返回 SEARCH_IO。 */
export interface SearchIndex {
  upsert(docs: SearchDocument[]): Promise<void>;
  remove(ids: string[]): Promise<void>;
  search(query: string, options?: SearchQueryOptions): Promise<SearchResult>;
  close(): Promise<void>;
}

/**
 * 打开（必要时创建）索引目录；信封不匹配自动删除重建空索引，不抛错。
 * 实现从包入口 `@jixoai/search` 的 openIndex 导出（本文件只承载契约类型）。
 */

/** 包级 typed 错误（不依赖宿主错误体系）。 */
export type SearchErrorCode =
  | "SEARCH_INVALID_ARGUMENT"
  | "SEARCH_BACKEND_UNAVAILABLE"
  | "SEARCH_IO";

export class SearchError extends Error {
  readonly code: SearchErrorCode;
  constructor(code: SearchErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SearchError";
    this.code = code;
  }
}
