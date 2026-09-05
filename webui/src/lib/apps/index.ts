/**
 * 用户原始需求 [2026-07-27]：「三个导航意味着三个 ChromeTabs」。
 * 正交意图：[1] 统一注册三个 App，供 Shell 启动时调用。
 */

import "./workspaces/manifest.js";
import "./creator/manifest.js";
import "./repository/manifest.js";

export { workspacesApp } from "./workspaces/manifest.js";
export { creatorApp } from "./creator/manifest.js";
export { repositoryApp } from "./repository/manifest.js";

/** 注册全部内置 App。调用一次即完成 appRegistry 注册。 */
export function registerApps(): void {
  // import 即注册（defineApp 内部自注册到 appRegistry），此函数仅作显式入口。
}
