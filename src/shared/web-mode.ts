/**
 * 用户原始需求 [2026-07-27]：「引入 --web 参数，在 Linux 默认为 true。如果启动该参数，
 * 那么不使用 opentray 来打开 ext-webview」。
 * 正交意图：[1] 解析 --web/--no-web CLI flag；[2] 按平台默认 + 显式覆盖投影 web 模式。
 */

/** daemon 侧读取的 web 模式 env 名。 */
export const SKILL_CREATOR_WEB_ENV = "SKILL_CREATOR_WEB";

/** CLI `--web` flag 的三态解析结果。 */
export type WebModeFlag = boolean | undefined;

/** 从 argv 解析 --web / --no-web flag；未出现时返回 undefined（交由平台默认）。 */
export function parseWebModeFlag(argv: readonly string[]): WebModeFlag {
  if (argv.includes("--web")) return true;
  if (argv.includes("--no-web")) return false;
  return undefined;
}

/**
 * 投影最终 web 模式。
 *
 * - flag === true  → 显式开启
 * - flag === false → 显式关闭
 * - flag === undefined && linux → 默认开启（@opentray/ext-webview 无 Linux 原生包）
 * - flag === undefined && 其他平台 → 默认关闭
 */
export function isWebMode(
  flag: WebModeFlag,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (flag === true) return true;
  if (flag === false) return false;
  return platform === "linux";
}

/** daemon 侧从 env 读 web 模式（"1"=开, "0"=关, 未设置=按平台默认）。 */
export function webModeFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const value = env[SKILL_CREATOR_WEB_ENV];
  if (value === "1") return true;
  if (value === "0") return false;
  return isWebMode(undefined, platform);
}
