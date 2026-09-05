/**
 * 用户原始需求 [2026-07-27]：「URL 也是一个关于存储视图的最好的地方」。
 * 正交意图：
 *   [1] 类型安全的导航 API：go / goById / buildHref / targetById。
 *   [2] NavControllerAdapter 注入点（解耦 navigate 与底层 URL 操作）。
 * 参考：gaubee.com/src/lib/router/navigate.ts。
 */
import type { ZodSchema, infer as zInfer } from "zod";
import type { RouteContract } from "./contract.js";
import { routeRegistry } from "./registry.js";
import { stringifyPattern } from "./path-pattern.js";
import { stringifySearch } from "./search.js";

/** 浏览器 history 动作类型。 */
export type NavAction = "PUSH" | "REPLACE";

/** 从 RouteContract 提取 params inferred 类型。 */
export type RouteParams<T extends RouteContract> =
  T extends RouteContract<infer P, infer _S>
    ? P extends ZodSchema
      ? zInfer<P>
      : undefined
    : never;

/** 从 RouteContract 提取 search inferred 类型。 */
export type RouteSearch<T extends RouteContract> =
  T extends RouteContract<infer _P, infer S>
    ? S extends ZodSchema
      ? zInfer<S>
      : undefined
    : never;

/** 字符串 RouteId（codegen 产物，未 codegen 时为宽松 string）。 */
export type RouteId = string;

/** RouteId → params 类型映射（codegen 产物）。 */
export interface RouteParamsMap {
  [id: string]: unknown;
}

/** RouteId → search 类型映射（codegen 产物）。 */
export interface RouteSearchMap {
  [id: string]: unknown;
}

/** NavController 适配器接口。 */
export interface NavControllerAdapter {
  navigate(path: string, action?: NavAction): void;
}

let navAdapter: NavControllerAdapter | null = null;

/** 注入 NavController 适配器（在 Shell 启动时调用）。 */
export function setNavControllerAdapter(adapter: NavControllerAdapter): void {
  navAdapter = adapter;
}

/** 按 id 构造 href。从 routeRegistry 查 absolutePattern 并渲染。 */
export function buildHrefById<R extends RouteId>(
  routeId: R,
  params?: RouteParamsMap[R],
  search?: RouteSearchMap[R],
): string {
  const entry = routeRegistry.get(routeId);
  if (!entry) {
    if (import.meta.env.DEV) {
      console.error(`[buildHrefById] route id "${routeId}" 未在 routeRegistry 注册`);
    }
    return "/";
  }
  return stringifyRoute(entry.absolutePattern, params, search);
}

/** 执行导航（字符串 RouteId 版本，跨应用引用场景）。 */
export function goById<R extends RouteId>(
  routeId: R,
  params?: RouteParamsMap[R],
  search?: RouteSearchMap[R],
  action?: NavAction,
): void {
  const href = buildHrefById(routeId, params, search);
  navAdapter?.navigate(href, action);
}

/** 字符串 id 版本的导航目标（可存入延迟跳转场景）。 */
export interface IdTarget<R extends RouteId = RouteId> {
  readonly routeId: R;
  readonly params?: RouteParamsMap[R];
  readonly search?: RouteSearchMap[R];
}

/** 构造一个 id 目标（不触发导航）。 */
export function targetById<R extends RouteId>(
  routeId: R,
  params?: RouteParamsMap[R],
  search?: RouteSearchMap[R],
): IdTarget<R> {
  return { routeId, params, search };
}

/** 解析一个 IdTarget 并执行导航。 */
export function goTarget(t: IdTarget): void {
  goById(t.routeId, t.params, t.search as RouteSearchMap[RouteId]);
}

/** 把 pattern + params + search 渲染成完整路径。 */
function stringifyRoute(pattern: string, params: unknown, search?: unknown): string {
  const paramRecord = (params ?? {}) as Record<string, string>;
  const href = stringifyPattern(pattern, paramRecord);
  const searchStr = search ? stringifySearch(search as Record<string, unknown>) : "";
  return `${href}${searchStr}`;
}
