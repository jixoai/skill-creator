/**
 * 原始需求 [2026-07-14]：「opentray 的一些适配没做好，好好学习 pnpm-pub」。
 * 正交意图：
 * 1. 将带时间戳的诊断信息追加到 daemon 日志。
 * 2. 开发态同步输出 stderr，且任何日志失败都不影响主流程。
 */
import fs from "node:fs";
import { daemonLogPath } from "../shared/paths.js";

/** 以 best-effort 方式记录一条 daemon 日志。 */
export function log(message: string): void {
  try {
    fs.appendFileSync(daemonLogPath(), `[${new Date().toISOString()}] ${message}\n`);
  } catch {
    /* best effort */
  }
  if (isDevRuntime()) {
    process.stderr.write(`[daemon] ${message}\n`);
  }
}

/** 判断当前 daemon 是否由开发监督器或 Vite 环境启动。 */
export function isDevRuntime(): boolean {
  return Boolean(
    process.env.SKILL_CREATOR_DEV_SUPERVISOR_PID ||
    process.env.SKILL_CREATOR_DEV_DAEMON_PORT ||
    process.env.SKILL_CREATOR_DEV_WEBVIEW_URL,
  );
}
