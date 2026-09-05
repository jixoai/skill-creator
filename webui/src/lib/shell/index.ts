/**
 * 用户原始需求 [2026-07-27]：「参考 gaubee.com 的 GaubeeOS + AppShell 标准」。
 * 正交意图：[1] 汇总导出 ChromeTabShell 标准的全部公开接口。
 */

// 类型
export type { RouteContract, ErasedRouteContract } from "./contract.js";
export type { AppManifest, AppActivity, AppEntry } from "./types.js";
export { getEntryRoute, getEntryActivity } from "./types.js";
export type { CompiledPattern } from "./path-pattern.js";
export type { MatchedRouteNode, RouteMatchResult } from "./match.js";
export type { NavAction, RouteId, RouteParamsMap, RouteSearchMap, IdTarget } from "./navigate.js";
export type { RouteParams, RouteSearch } from "./navigate.js";
export type { AppContextValue, RouterContextValue } from "./portal-context.svelte.js";
export type { TabIdentity } from "./nav-controller.svelte.js";
export type { DevicePrefs } from "./device-prefs.js";

// 工厂
export { defineRoute } from "./define-route.js";
export { registerActivityRoot } from "./define-route.js";
export { defineActivity, leafRoute } from "./define-activity.js";
export { defineApp } from "./define-app.js";

// 核心函数
export { matchRouteTree } from "./match.js";
export { compilePattern, joinPattern, stringifyPattern } from "./path-pattern.js";
export { stringifySearch, parseSearchString } from "./search.js";
export { sanitizeShellLocation, SHELL_HOME_PATH } from "./route-hygiene.js";
export type { HygieneDecision } from "./route-hygiene.js";

// 注册表
export { routeRegistry, appRegistry } from "./registry.js";
export type { RouteRegistryEntry } from "./registry.js";

// 导航
export {
  goById,
  goTarget,
  buildHrefById,
  targetById,
  setNavControllerAdapter,
} from "./navigate.js";
export type { NavControllerAdapter } from "./navigate.js";

// hooks（Svelte context API）
export { useParams, useSearch, useRoute, useApp } from "./portal-context.svelte.js";
export {
  setPortalTarget,
  getPortalTarget,
  setAppContext,
  setRouterContext,
} from "./portal-context.svelte.js";

// nav controller
export { navStore, navController, resolveTabIdentity } from "./nav-controller.svelte.js";

// device prefs
export {
  DevicePrefsSchema,
  DEFAULT_DEVICE_PREFS,
  readDevicePrefs,
  writeDevicePrefs,
  updateDevicePrefs,
} from "./device-prefs.js";

// 组件
export { default as AppShell } from "./AppShell.svelte";
export { default as TabOutlet } from "./TabOutlet.svelte";
