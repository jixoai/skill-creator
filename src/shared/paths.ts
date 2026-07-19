/**
 * 原始需求 [2026-07-14]：「参考 ../../pnpm-pub 这个项目的架构：cli+gui(webui+opentray)」。
 * 正交意图：
 * 1. 定义每用户 `.skill-creator` 目录拓扑。
 * 2. 为 CLI 与 daemon 提供一致的 socket 和日志路径。
 * 3. 允许测试及开发进程隔离 home。
 */
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

/** 用户 home 下的固定应用目录名。 */
export const APP_DIR_NAME = ".skill-creator";

/** macOS 与 Linux 的 IPC socket 文件名。 */
export const SOCKET_FILE = "skill-creator.sock";

/** daemon 日志文件名。 */
export const DAEMON_LOG_FILE = "daemon.log";

let homeOverride: string | null = null;

/** 覆盖 home，用于隔离测试与开发状态。 */
export function setHomeOverride(home: string | null): void {
  homeOverride = home;
}

/**
 * Resolved home directory. Resolution order:
 *   1. in-process override (tests / dev runner)
 *   2. SKILL_CREATOR_HOME env var (so a spawned CLI process agrees with the
 *      daemon that launched it)
 *   3. os.homedir()
 */
export function homeDir(): string {
  if (homeOverride) return homeOverride;
  const env = process.env.SKILL_CREATOR_HOME;
  if (env && env.length > 0) return env;
  return os.homedir();
}

/** 返回应用状态根目录。 */
export function appDir(): string {
  return path.join(homeDir(), APP_DIR_NAME);
}

/** 返回 macOS 与 Linux 的 Unix socket 目录。 */
export function runDir(): string {
  return path.join(appDir(), "run");
}

/** 返回 daemon 日志目录。 */
export function logsDir(): string {
  return path.join(appDir(), "logs");
}

/** 返回 daemon 日志文件路径。 */
export function daemonLogPath(): string {
  return path.join(logsDir(), DAEMON_LOG_FILE);
}

/**
 * 返回当前平台的 IPC socket 路径。
 *  - macOS / linux: Unix Domain Socket at ~/.skill-creator/run/skill-creator.sock
 *  - Windows: Named Pipe at \\.\pipe\skill-creator-sock
 */
export function socketPath(): string {
  if (process.platform === "win32") {
    return "\\\\.\\pipe\\skill-creator-sock";
  }
  return path.join(runDir(), SOCKET_FILE);
}

/** 确保应用状态目录树存在。 */
export function ensureAppDirs(): void {
  for (const dir of [appDir(), runDir(), logsDir()]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
