/**
 * 原始需求 [2026-07-14]：「参考 ../../pnpm-pub 这个项目的架构：cli+gui(webui+opentray)」。
 * 正交意图：
 * 1. 将进程环境转换为 daemon 启动参数。
 * 2. 统一处理单实例退出与顶层启动异常。
 */
import { bootDaemon } from "./index.js";
import { readPackageVersion } from "./package-version.js";

async function main(): Promise<void> {
  const cliVersion = readPackageVersion();
  const webviewUrl = process.env.SKILL_CREATOR_DEV_WEBVIEW_URL;
  const handles = await bootDaemon({ cliVersion, webviewUrl });
  if (!handles) {
    // Another instance is running.
    process.exit(0);
  }
}

void main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
