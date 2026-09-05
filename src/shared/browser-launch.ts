/**
 * 用户原始需求 [2026-07-27]：「Linux 默认 web 模式……菜单改成打开浏览器链接」。
 * 正交意图：[1] 跨平台解析系统浏览器启动命令；[2] detached spawn 启动并返回可诊断结果。
 * 妥协声明：浏览器启动是平台 shell 行为，无强类型 SDK；只能 spawn 后观察 error/spawn 事件。
 */
import { spawn } from "node:child_process";

/** 浏览器启动结果；`opened` 为 true 表示 launcher 进程已成功派生。 */
export interface BrowserLaunchResult {
  opened: boolean;
  /** launcher 失败时的错误消息；成功时为 undefined。 */
  error?: string;
}

/** 解析当前平台的系统浏览器启动命令（不执行）。 */
export function resolveBrowserLauncher(
  url: string,
  platform: NodeJS.Platform = process.platform,
): { binary: string; args: string[] } {
  if (platform === "win32") return { binary: "cmd", args: ["/c", "start", "", url] };
  if (platform === "darwin") return { binary: "open", args: [url] };
  return { binary: "xdg-open", args: [url] };
}

/**
 * 在系统默认浏览器中打开 URL（detached，不阻塞调用方）。
 *
 * 返回 launcher 是否成功派生；不向 stdout/stderr 投影——终端文案由调用方决定。
 */
export function openUrlInBrowser(
  url: string,
  platform: NodeJS.Platform = process.platform,
): Promise<BrowserLaunchResult> {
  const { binary, args } = resolveBrowserLauncher(url, platform);
  return new Promise<BrowserLaunchResult>((resolve) => {
    try {
      const child = spawn(binary, args, { stdio: "ignore", detached: true });
      child.once("error", (error) => {
        try {
          child.unref();
        } catch {
          /* child 未成功派生，unref 可能抛错，忽略 */
        }
        resolve({ opened: false, error: error.message });
      });
      child.once("spawn", () => {
        child.unref();
        resolve({ opened: true });
      });
    } catch (error) {
      resolve({ opened: false, error: error instanceof Error ? error.message : String(error) });
    }
  });
}
