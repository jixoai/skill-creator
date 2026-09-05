/**
 * 用户原始需求 [2026-09-05]：「不完整、未知或非法身份必须在渲染前清理。」
 * 正交意图：
 *   [1] 判定当前 location 是否需要渲染前重定向（纯函数，可单测）。
 *   [2] params 非法 → 回 app 入口；search 非法 → 剥离 search；未知 app / 无匹配 → 回入口。
 *   [3] 全局兜底入口常量（SHELL_HOME_PATH），未知 app 不得渲染空白壳。
 */
import { matchRouteTree } from "./match.js";
import { appRegistry } from "./registry.js";
import { getEntryActivity } from "./types.js";

/** 未知 app / 无法解析时的全局兜底入口。 */
export const SHELL_HOME_PATH = "/workspaces";

/** 渲染前的卫生决策：ok 直接渲染；redirect 需 replaceState 后再渲染。 */
export type HygieneDecision =
  | { readonly kind: "ok" }
  | { readonly kind: "redirect"; readonly path: string };

/**
 * 判定 location 是否携带非法身份。
 *
 * 判定顺序与 TabOutlet 的 activity 匹配一致：首个 matched 即合法；
 * parse-error 优先于 no-match（结构命中但 ID 非法说明用户意图在此 activity）。
 */
export function sanitizeShellLocation(pathname: string, search: string): HygieneDecision {
  const appId = firstSegment(pathname);
  const app = appId ? appRegistry.get(appId) : undefined;
  if (!app) return { kind: "redirect", path: SHELL_HOME_PATH };
  const entry = getEntryActivity(app);
  if (!entry) return { kind: "redirect", path: SHELL_HOME_PATH };

  for (const activity of app.activities) {
    const result = matchRouteTree(activity.root, pathname, search, activity.pattern);
    if (result.kind === "matched") return { kind: "ok" };
    if (result.kind === "parse-error") {
      return result.reason === "params"
        ? { kind: "redirect", path: entry.pattern }
        : { kind: "redirect", path: pathname };
    }
  }
  // 所有 activity 都 no-match（如 `/workspaces/only-one-segment`）：回入口并清理 URL。
  return { kind: "redirect", path: entry.pattern };
}

function firstSegment(pathname: string): string | null {
  const cleaned = pathname.replace(/^\/+/, "");
  if (!cleaned) return null;
  return cleaned.split("/")[0] ?? null;
}
