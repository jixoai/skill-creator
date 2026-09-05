/**
 * 用户原始需求 [2026-07-27]：「参考 gaubee.com 的 GaubeeOS + AppShell 标准」。
 * 正交意图：
 *   [1] defineActivity 工厂：绑定绝对 pattern 与 Route 树，回填 absolutePattern。
 *   [2] leafRoute 快捷工厂：单页面 Activity 的 root（pattern 为空，仅 component）。
 * 参考：gaubee.com/src/lib/router/define-activity.ts + leaf-route.ts。
 */
import type { AppActivity } from "./types.js";
import type { ErasedRouteContract, RouteContract, ViewLoader } from "./contract.js";
import { registerActivityRoot } from "./define-route.js";

/** defineActivity 配置。 */
export interface DefineActivityConfig {
  /** 该场景的绝对 pattern（如 `/workspaces`）。 */
  pattern: string;
  /** 场景的根 Route 树。 */
  root: RouteContract;
  /** 是否为应用入口场景。 */
  entry?: boolean;
}

/** 工厂：定义一个屏幕场景，回填其 Route 树的 absolutePattern。 */
export function defineActivity(config: DefineActivityConfig): AppActivity {
  registerActivityRoot(config.pattern, config.root as ErasedRouteContract);
  return {
    pattern: config.pattern,
    root: config.root,
    entry: config.entry,
  };
}

/** leafRoute 配置。 */
export interface LeafRouteConfig {
  /** 全局唯一 id。 */
  id: string;
  /** 视图懒加载器。 */
  component: ViewLoader;
  /** 可选 search schema。 */
  search?: RouteContract["search"];
}

/** 快捷工厂：单页面 Activity 的 root（pattern 为空，仅一个 component）。 */
export function leafRoute(config: LeafRouteConfig): RouteContract {
  return {
    id: config.id,
    pattern: "",
    search: config.search,
    component: config.component,
  };
}
