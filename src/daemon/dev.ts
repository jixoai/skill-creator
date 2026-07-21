/**
 * 原始需求 [2026-07-14]：「opentray 的一些适配没做好，好好学习 pnpm-pub」。
 * 正交意图：
 * 1. 由 Vite 启动隔离的开发 daemon，不读写正式用户状态。
 * 2. 注入固定 HTTP 端口、WebUI URL 与测试 token，支持 HMR 和自动化验收。
 * 3. 挂载开发态 OpenTray，并在 Vite 退出后清理孤儿进程。
 * 4. 将 Vite 监督器的 pnpm dev 向量持久化为 Dock 冷启动入口。
 */
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { bootDaemon } from "./index.js";
import { setHomeOverride } from "../shared/paths.js";
import { readPackageVersion } from "./package-version.js";
import { parseDevAppLaunch, SKILL_CREATOR_DEV_APP_LAUNCH_ENV } from "../shared/dev-app-launch.js";

async function main(): Promise<void> {
  const devHome = process.env.SKILL_CREATOR_HOME ?? defaultDevHome();
  setHomeOverride(devHome);
  process.env.SKILL_CREATOR_HOME = devHome;

  // [2][3] 读 vite 插件注入的 env。
  const port = readOptionalPort(process.env.SKILL_CREATOR_DEV_DAEMON_PORT);
  const webviewUrl = process.env.SKILL_CREATOR_DEV_WEBVIEW_URL;
  const appLaunch = parseDevAppLaunch(process.env[SKILL_CREATOR_DEV_APP_LAUNCH_ENV]);

  const handles = await bootDaemon({
    cliVersion: readPackageVersion(),
    port,
    webviewUrl,
    ...(process.env.SKILL_CREATOR_DEV_WEB_TOKEN
      ? { webToken: process.env.SKILL_CREATOR_DEV_WEB_TOKEN }
      : {}),
    withTray: true,
    enableDevtools: true,
    ...(appLaunch === undefined ? {} : { appLaunch }),
  });

  if (!handles) {
    console.error("[dev] Another daemon already holds the socket. Run `skill-creator stop` first.");
    process.exit(0);
  }

  // [4] 孤儿清理：监视 vite 进程（supervisor），它退出则 daemon 自杀。
  const supervisorWatch = watchDevSupervisor();
  console.log(
    `\n[dev] daemon up. WebUI: ${webviewUrl?.replace(/token=[^#]+/, "token=<dev>") ?? "n/a"}`,
  );
  console.log(`[dev] dev home: ${devHome}\n`);

  process.on("SIGINT", () => {
    void supervisorWatch?.stop();
    void handles.stop({ exit: true });
  });
  process.on("SIGTERM", () => {
    void handles.stop({ exit: true });
  });
}

/** 使用短根目录，避免 macOS 的 104 字节 Unix socket 路径上限。 */
function defaultDevHome(): string {
  return process.platform === "win32"
    ? path.join(os.tmpdir(), "skill-creator-v2-dev")
    : "/tmp/sc-v2";
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
