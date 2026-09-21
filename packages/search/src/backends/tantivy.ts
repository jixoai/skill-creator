/**
 * 用户原始需求 [2026-09-21]：「冒烟不过回落 node:sqlite FTS5……tantivy 由下一子代理接入」
 * （jixoai-search-core tasks 1.8：tantivy 后端 = whitespace 注入 + 目录锁生命周期封装）。
 * 正交意图：
 *   [1] 后端占位：backend: "tantivy" 选项存在且 typed 拒绝（SEARCH_BACKEND_UNAVAILABLE），
 *       信封/契约/API 面已就位，接入时只替换本文件实现。
 * 妥协声明：本阶段抛错即全部行为；召回/持久化实现留给 1.8（native binding 不进本任务）。
 */
import { SearchError, type SearchIndex } from "../api.js";

/** tantivy 后端占位：接入前（tasks 1.8）一律 typed 不可用错误。 */
export function openTantivyIndex(): SearchIndex {
  throw new SearchError(
    "SEARCH_BACKEND_UNAVAILABLE",
    'backend "tantivy" is not available yet (jixoai-search-core task 1.8); use backend "sqlite"',
  );
}
