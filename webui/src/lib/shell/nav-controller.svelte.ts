/**
 * 用户原始需求 [2026-07-27]：「URL 也是一个关于存储视图的最好的地方」。
 * 正交意图：
 *   [1] navStore：响应式 URL 状态（pathname + search），驱动 Shell 渲染。
 *   [2] navController：navigate/focusApp 等操作入口（修改 URL = 修改状态）。
 *   [3] tab 身份解析：从 URL pathname 推导当前 app + instanceKey。
 * 参考：gaubee.com/src/lib/nav/（精简版，去掉三 area 编码，只保留单 main area）。
 */
import { page } from "$app/state";

/** tab 身份（app + instanceKey）。 */
export interface TabIdentity {
  readonly app: string;
  readonly instanceKey: string;
}

/** 当前激活的 tab 身份（从 URL pathname 解析）。 */
export const navStore = {
  get pathname(): string {
    return page.url.pathname;
  },
  get search(): string {
    return page.url.search;
  },
};

/** 从 pathname 解析 tab 身份。pathname 格式：`/<app>/<instanceKey>/...`。 */
export function resolveTabIdentity(pathname: string): TabIdentity | null {
  const cleaned = pathname.replace(/^\/+|\/+$/g, "");
  if (!cleaned) return null;
  const segments = cleaned.split("/");
  const app = segments[0];
  if (!app) return null;
  const instanceKey = segments[1] ?? "home";
  return { app, instanceKey };
}

/** NavControllerAdapter 实现（注入到 navigate 模块）。 */
export const navController = {
  navigate(path: string, action: "PUSH" | "REPLACE" = "PUSH"): void {
    if (action === "REPLACE") {
      void import("$app/navigation").then(({ replaceState }) => replaceState(path, {}));
    } else {
      void import("$app/navigation").then(({ goto }) => goto(path));
    }
  },
  replace(path: string): void {
    this.navigate(path, "REPLACE");
  },
};
