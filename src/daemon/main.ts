/**
 * 原始需求 [2026-07-14]：「参考 ../../pnpm-pub 这个项目的架构：cli+gui(webui+opentray)」。
 * 正交意图：
 * 1. 将进程环境转换为 daemon 启动参数。
 * 2. 统一处理单实例退出与顶层启动异常。
 * 3. 允许隔离测试显式关闭 native tray，避免污染操作员 OpenTray 状态。
 */
import { bootDaemon } from "./index.js";
import { isDevRuntime, log } from "./log.js";
import { readPackageVersion } from "./package-version.js";

async function main(): Promise<void> {
  const cliVersion = readPackageVersion();
  const webviewUrl = process.env.SKILL_CREATOR_DEV_WEBVIEW_URL;
  const withTray = process.env.SKILL_CREATOR_DISABLE_TRAY !== "1";
  const handles = await bootDaemon({ cliVersion, webviewUrl, withTray });
  if (!handles) {
    // Another instance is running.
    process.exit(0);
  }
}

void main().catch((err: unknown) => {
  const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
  log(`daemon startup failed: ${message}`);
  if (!isDevRuntime()) console.error(message);
  process.exit(1);
});
