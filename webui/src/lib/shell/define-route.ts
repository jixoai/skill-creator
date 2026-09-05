/**
 * 用户原始需求 [2026-07-27]：「ChromeTabs 和路由做深度的绑定」。
 * 正交意图：
 *   [1] defineRoute 工厂：类型参数从 zod schema 推导 + 运行时自注册。
 *   [2] registerActivityRoot：当 Route 被用作 Activity root 时回填 absolutePattern。
 * 参考：gaubee.com/src/lib/router/define-route.ts。
 */
import type { ZodSchema } from "zod";
import type { ErasedRouteContract, RouteContract, ViewLoader } from "./contract.js";
import { routeRegistry } from "./registry.js";

/** defineRoute 配置。 */
export interface DefineRouteConfig<
  P extends ZodSchema | undefined = ZodSchema | undefined,
  S extends ZodSchema | undefined = ZodSchema | undefined,
> {
  /** 全局唯一 id（如 `workspaces.provider`）。 */
  id: string;
  /** 相对 pattern，如 `repo/:owner/:repo` 或 ``（index）。 */
  pattern: string;
  /** pathname 参数 schema。 */
  params?: P;
  /** search 参数 schema。 */
  search?: S;
  /** 视图懒加载器。 */
  component: ViewLoader;
  /** 嵌套子路由。 */
  children?: readonly RouteContract[];
}

/** 工厂：构造一个 RouteContract 并自注册到 routeRegistry。 */
export function defineRoute<
  P extends ZodSchema | undefined = undefined,
  S extends ZodSchema | undefined = undefined,
>(config: DefineRouteConfig<P, S>): RouteContract<P, S> {
  if (import.meta.env.DEV) {
    validateRouteId(config.id);
    validatePattern(config.pattern);
  }
  const route: RouteContract<P, S> = {
    id: config.id,
    pattern: config.pattern,
    params: config.params,
    search: config.search,
    component: config.component,
    children: config.children,
  };
  registerRouteRecursive(route, route.pattern || "/");
  return route;
}

/** 当一个 Route 被作为 Activity root 使用时，回填其 absolutePattern（含 Activity 前缀）。 */
export function registerActivityRoot(activityPattern: string, root: ErasedRouteContract): void {
  registerActivityRootRecursive(activityPattern, root);
}

function registerRouteRecursive(route: ErasedRouteContract, parentAbsolute: string): void {
  routeRegistry.register({ id: route.id, route, absolutePattern: parentAbsolute });
  if (route.children) {
    for (const child of route.children) {
      const childAbs = joinAbsolute(parentAbsolute, child.pattern);
      registerRouteRecursive(child, childAbs);
    }
  }
}

function registerActivityRootRecursive(activityPattern: string, route: ErasedRouteContract): void {
  const abs = joinAbsolute(activityPattern, route.pattern);
  routeRegistry.register({ id: route.id, route, absolutePattern: abs });
  if (route.children) {
    for (const child of route.children) {
      registerActivityRootRecursive(abs, child);
    }
  }
}

function joinAbsolute(parentAbsolute: string, relative: string): string {
  const p = parentAbsolute.replace(/\/+$/, "");
  const r = relative.replace(/^\/+|\/+$/g, "");
  if (r === "") return p || "/";
  return `${p}/${r}`;
}

function validateRouteId(id: string): void {
  if (!id) {
    console.warn("[defineRoute] route id 不能为空");
    return;
  }
  if (!/^[a-z][a-z0-9-]*(\.[a-z0-9-]+)*$/i.test(id)) {
    console.warn(
      `[defineRoute] route id "${id}" 不符合推荐格式（应是小写点号分隔，如 'workspaces.provider'）`,
    );
  }
}

function validatePattern(pattern: string): void {
  const stripped = pattern.replace(/:[A-Za-z_][A-Za-z0-9_]*/g, "");
  if (!/^[A-Za-z0-9_\-/]*$/.test(stripped)) {
    console.warn(`[defineRoute] pattern "${pattern}" 含非法字符（仅支持静态段 + :param）`);
  }
}
