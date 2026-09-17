/**
 * 用户原始需求 [2026-09-18]：「可以在界面上提供在编辑器中打开配置文件」。
 * 正交意图：
 * 1. 平台 opener：以系统默认关联程序打开 server-owned 的 search-config.toml
 *    （macOS `open` / Windows `start` / Linux `xdg-open`）。
 * 2. 类型化失败：spawn 失败抛 DomainError(UNAVAILABLE)；darwin/linux 的退出码
 *    非零同样视为失败（走查 W3 复盘：无 .toml 关联应用时 `open` 以 exit 1
 *    静默失败）；win32 的 explorer 返回码不可信（成功也常返回 1），保持
 *    fire-and-forget，只认 spawn 期错误。
 */
import { spawn } from "node:child_process";
import { DomainError } from "./domain-error.js";

export type SearchConfigOpener = (filePath: string) => Promise<void>;

/**
 * 以系统默认程序打开文件路径（路径恒由调用方从 server-owned 常量派生）。
 */
export function platformOpenFile(filePath: string): Promise<void> {
  const platform = process.platform;
  if (platform === "win32") {
    return spawnDetached({ file: "cmd", args: ["/c", "start", "", filePath] });
  }
  const command =
    platform === "darwin"
      ? { file: "open", args: [filePath] }
      : { file: "xdg-open", args: [filePath] };
  return spawnDetached(command, { checkExitCode: true });
}

function spawnDetached(
  command: { file: string; args: string[] },
  options: { checkExitCode?: boolean } = {},
): Promise<void> {
  const label = `${command.file} ${command.args.join(" ")}`;
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(command.file, command.args, { detached: true, stdio: "ignore" });
    } catch (error) {
      reject(openerError(label, error));
      return;
    }
    child.on("error", (error) => reject(openerError(label, error)));
    child.unref();
    if (!options.checkExitCode) {
      resolve();
      return;
    }
    // checkExitCode 模式：首个 settle 生效（error 或 exit 先到者）。
    child.on("exit", (code) => {
      if (code !== null && code !== 0) {
        reject(
          new DomainError(
            "UNAVAILABLE",
            `Cannot open the search config with ${label}: exited with code ${code} (no default application?)`,
          ),
        );
      } else {
        resolve();
      }
    });
  });
}

function openerError(label: string, cause: unknown): DomainError {
  return new DomainError(
    "UNAVAILABLE",
    `Cannot open the search config with ${label}: ${cause instanceof Error ? cause.message : String(cause)}`,
    { cause },
  );
}
