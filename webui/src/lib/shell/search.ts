/**
 * 用户原始需求 [2026-07-27]：「URL 也是一个关于存储视图的最好的地方」。
 * 正交意图：
 *   [1] 把 search params 对象序列化为 query string。
 *   [2] 把 query string 解析为扁平 key-value 对象（zod coerce 在 match 阶段做）。
 * 参考：gaubee.com/src/lib/router/search.ts。
 */

/** 把 search 参数对象序列化为 query string（含前导 `?`）。 */
export function stringifySearch(params: Readonly<Record<string, unknown>>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null);
  if (entries.length === 0) return "";
  const sp = new URLSearchParams();
  for (const [key, value] of entries) {
    sp.set(key, typeof value === "string" ? value : String(value));
  }
  const str = sp.toString();
  return str ? `?${str}` : "";
}

/** 把 query string（含或不含前导 `?`）解析为扁平对象。值类型均为 string。 */
export function parseSearchString(search: string): Record<string, string> {
  const q = search.startsWith("?") ? search.slice(1) : search;
  if (!q) return {};
  const result: Record<string, string> = {};
  const sp = new URLSearchParams(q);
  for (const [key, value] of sp) {
    result[key] = value;
  }
  return result;
}
