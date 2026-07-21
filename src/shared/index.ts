/**
 * 原始需求 [2026-07-14]：「引入各种各样的功能（保持模块化、正交）」。
 * 正交意图：
 * 1. 汇总导出运行时 schema 与 RPC 契约。
 * 2. 汇总导出 CLI 与 daemon 的 IPC frame codec。
 * 3. 定义跨运行时共享的应用身份、菜单与窗口常量。
 */
/** 共享运行时 schema、RPC 契约与 IPC codec。 */
export * from "./contracts/creator.js";
export * from "./contracts/daemon.js";
export * from "./contracts/errors.js";
export * from "./contracts/repository.js";
export * from "./contracts/skills.js";
export * from "./contracts/workspaces.js";
export * from "./provider-catalog.js";
export * from "./rpc-contract.js";
export * from "./frame.js";

/** OpenTray 与 CLI 共用的固定应用身份。 */
export const APP_ID = "skill-creator";
export const APP_TITLE = "Skill Creator";

/** tray 菜单项的稳定 ID。 */
export const MENU_OPEN_ID = 1;
export const MENU_QUIT_ID = 2;

/** tray 窗口几何，单位为逻辑桌面像素。 */
export const WINDOW_WIDTH = 960;
export const WINDOW_HEIGHT = 680;

/**
 * dev 模式 token 占位符。
 *
 * vite dev 插件在 daemon token 尚未生成时，用此占位符构造 webviewUrl；
 * daemon 生成真实 token 后用 `resolveWebviewUrl()` 替换它。这样 tray 窗口
 * URL 能在 daemon 启动后携带真实 token，而 vite 插件无需提前知道 token。
 */
export const WEB_TOKEN_PLACEHOLDER = "__SKILL_CREATOR_WEB_TOKEN__";
