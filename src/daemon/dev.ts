/**
 * 原始需求 [2026-07-14]：「opentray 的一些适配没做好，好好学习 pnpm-pub」。
 * 用户原始需求 [2026-07-21]：「开发模式下，配置启动命令成 `pnpm dev`；Dock 点击要恢复完整开发进程树。」
 * 正交意图：
 * 1. 由 Vite 启动隔离的开发 daemon，不读写正式用户状态。
 * 2. 注入固定 HTTP 端口、WebUI URL 与测试 token，支持 HMR 和自动化验收。
 * 3. 挂载开发态 OpenTray，并在 Vite 退出后清理孤儿进程。
 * 4. 将 Vite 监督器的 pnpm dev 向量持久化为 Dock 冷启动入口。
 */
import fs from "node:fs";
import { bootDaemon } from "./index.js";
import { setHomeOverride } from "../shared/paths.js";
import { readPackageVersion } from "./package-version.js";
import { parseDevAppLaunch, SKILL_CREATOR_DEV_APP_LAUNCH_ENV } from "../shared/dev-app-launch.js";
import { resolveDevHome } from "../shared/dev-runtime.js";
import { webModeFromEnv } from "../shared/web-mode.js";

async function main(): Promise<void> {
  const devHome = resolveDevHome();
  setHomeOverride(devHome);
  process.env.SKILL_CREATOR_HOME = devHome;

  // [2][3] 读 vite 插件注入的 env。
  const port = readOptionalPort(process.env.SKILL_CREATOR_DEV_DAEMON_PORT);
  const webviewUrl = process.env.SKILL_CREATOR_DEV_WEBVIEW_URL;
  const web = webModeFromEnv();
  const appLaunch = web
    ? undefined
    : parseDevAppLaunch(process.env[SKILL_CREATOR_DEV_APP_LAUNCH_ENV]);

  const handles = await bootDaemon({
    cliVersion: readPackageVersion(),
    port,
    webviewUrl,
    web,
    ...(process.env.SKILL_CREATOR_DEV_WEB_TOKEN
      ? { webToken: process.env.SKILL_CREATOR_DEV_WEB_TOKEN }
      : {}),
    withTray: true,
    enableDevtools: true,
    ...(appLaunch === undefined ? {} : { appLaunch }),
  });

  if (!handles) {
    console.error(
      `[dev] Development runtime takeover failed for ${devHome}. Run \`pnpm skill-creator stop\` and retry.`,
    );
    process.exit(1);
  }

  // [4] 孤儿清理：监视 vite 进程（supervisor），它退出则 daemon 自杀。
  const supervisorWatch = watchDevSupervisor();
  // dev 面向开发者：直接打印带真实 token 的可点击 URL，省去再跑 status 的步骤。
  // viteUrl（5173，带 HMR）和 daemonUrl（直连 daemon）都给出，开发者按需选用。
  const token = handles.webToken;
  const viteUrl = webviewUrl
    ? webviewUrl.replace("__SKILL_CREATOR_WEB_TOKEN__", encodeURIComponent(token))
    : null;
  const daemonUrl = `http://127.0.0.1:${handles.port}/#token=${encodeURIComponent(token)}`;
  console.log(`\n[dev] daemon up. dev home: ${devHome}`);
  console.log(`[dev] WebUI (vite + HMR): ${viteUrl ?? "n/a"}`);
  console.log(`[dev] WebUI (daemon):     ${daemonUrl}\n`);

  process.on("SIGINT", () => {
    void supervisorWatch?.stop();
    void handles.stop({ exit: true });
  });
  process.on("SIGTERM", () => {
    void handles.stop({ exit: true });
  });
}

/** 从 env 读可选端口（undefined → 随机）。 */
function readOptionalPort(env: string | undefined): number | undefined {
  if (!env) return undefined;
  const n = Number.parseInt(env, 10);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

/**
 * 监视 SKILL_CREATOR_DEV_SUPERVISOR_PID（vite 进程）。
 *
 * vite 进程退出时（Ctrl-C / 崩溃），daemon 会变成孤儿。这里每 1.5s 轮询
 * supervisor pid 是否还活着，死了就 process.exit，由 OS 清理 socket/tray。
 */
function watchDevSupervisor(): { stop: () => void } | null {
  const pidEnv = process.env.SKILL_CREATOR_DEV_SUPERVISOR_PID;
  if (!pidEnv) return null;
  const pid = Number.parseInt(pidEnv, 10);
  if (!Number.isInteger(pid) || pid <= 0) return null;

  const timer = setInterval(() => {
    // process.kill(pid, 0) 不发送信号，只检查进程是否存在；不存在则抛 ESRCH。
    try {
      process.kill(pid, 0);
    } catch {
      console.error(`[dev] supervisor (pid=${pid}) exited; daemon self-terminating.`);
      process.exit(0);
    }
    // 同时检查 supervisor 是否仍把自己标记为我们的父（防 daemon 被 reparent 到 init 后误判）。
    try {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
      void stat;
    } catch {
      // /proc 不存在（macOS），已用 process.kill 检测，忽略。
    }
  }, 1500);

  return {
    stop: () => clearInterval(timer),
  };
}

void main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
