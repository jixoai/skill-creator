/**
 * 用户原始需求 [2026-07-27]：「参考 gaubee.com 的 AppShell 标准」。
 * 正交意图：
 *   [1] portal-context：AppShell 下发 portal 目标取值器 + 应用上下文。
 *   [2] router-context：AppShell 下发 router 上下文（activity/location/match/params/search）。
 * 参考：gaubee.com/src/lib/app-scaffold/portal-context.svelte.ts + router/hooks.svelte.ts。
 */
import { getContext, hasContext, setContext } from "svelte";
import type { MatchedRouteNode, RouteMatchResult } from "./match.js";
import type { AppManifest } from "./types.js";

/** 应用上下文值（AppShell 下发，子组件通过 useApp 消费）。 */
export interface AppContextValue {
  readonly manifest: Pick<AppManifest, "id" | "name" | "icon">;
  readonly pathname: string;
}

const PORTAL_TARGET_KEY = Symbol("skill-creator:portal-target");
const APP_CONTEXT_KEY = Symbol("skill-creator:app-context");

/** 下发 portal 目标取值器（bits-ui Portal 锚定到 AppShell 内，不逃逸到 body）。 */
export function setPortalTarget(getter: () => HTMLElement | null): void {
  setContext(PORTAL_TARGET_KEY, getter);
}

/** 获取 portal 目标取值器。 */
export function getPortalTarget(): (() => HTMLElement | null) | undefined {
  if (!hasContext(PORTAL_TARGET_KEY)) return undefined;
  return getContext<() => HTMLElement | null>(PORTAL_TARGET_KEY);
}

/** 下发应用上下文。 */
export function setAppContext(value: AppContextValue): void {
  setContext(APP_CONTEXT_KEY, value);
}

/** 消费应用上下文。必须在 AppShell 内调用。 */
export function useApp(): AppContextValue {
  if (!hasContext(APP_CONTEXT_KEY)) {
    throw new Error("[shell] useApp 必须在 <AppShell> 内调用");
  }
  return getContext<AppContextValue>(APP_CONTEXT_KEY);
}

// ---- Router context ----

/** Router 上下文值（AppShell 下发）。 */
export interface RouterContextValue {
  readonly match: RouteMatchResult;
  readonly params: Readonly<Record<string, unknown>> | undefined;
  readonly search: Readonly<Record<string, unknown>> | undefined;
  readonly chain: readonly MatchedRouteNode[];
}

interface RouterContextEntry {
  readonly get: () => RouterContextValue;
}

const ROUTER_CONTEXT_KEY = Symbol("skill-creator:router");

/** 在 AppShell 中注入 router 上下文（getter 函数，保证 location 变化时消费方拿到最新值）。 */
export function setRouterContext(getValue: () => RouterContextValue): void {
  setContext<RouterContextEntry>(ROUTER_CONTEXT_KEY, { get: getValue });
}

/** 获取当前叶子节点 params 的 getter（调用方用 $derived 包装以响应 URL 变化）。 */
export function useParams<T = Record<string, unknown>>(): (() => T | undefined) | undefined {
  if (!hasContext(ROUTER_CONTEXT_KEY)) return undefined;
  const get = getContext<RouterContextEntry>(ROUTER_CONTEXT_KEY).get;
  return () => get().params as T | undefined;
}

/** 获取当前叶子节点 search 的 getter（调用方用 $derived 包装）。 */
export function useSearch<T = Record<string, unknown>>(): (() => T | undefined) | undefined {
  if (!hasContext(ROUTER_CONTEXT_KEY)) return undefined;
  const get = getContext<RouterContextEntry>(ROUTER_CONTEXT_KEY).get;
  return () => get().search as T | undefined;
}

/** 获取当前匹配的叶子 Route 节点的 getter。 */
export function useRoute(): (() => Readonly<MatchedRouteNode> | undefined) | undefined {
  if (!hasContext(ROUTER_CONTEXT_KEY)) return undefined;
  const get = getContext<RouterContextEntry>(ROUTER_CONTEXT_KEY).get;
  return () => {
    const ctx = get();
    if (ctx.match.kind !== "matched") return undefined;
    return ctx.chain[ctx.chain.length - 1];
  };
}
