/**
 * 用户原始需求 [2026-09-18]：「可以在界面上提供在编辑器中打开配置文件」。
 * 正交意图：
 * 1. 平台 opener：以系统默认关联程序打开 server-owned 的 search-config.toml
 *    （macOS `open` / Windows `start` / Linux `xdg-open`）。
 * 2. 类型化失败：spawn 失败抛 DomainError(UNAVAILABLE)——能力是尽力而为的
 *    OS 副作用，失败必须可见而非静默。
 */
import { spawn } from "node:child_process";
import { DomainError } from "./domain-error.js";

export type SearchConfigOpener = (filePath: string) => Promise<void>;

/**
 * 以系统默认程序打开文件路径（best-effort fire：detached + ignore stdio，
 * 平台差异只在命令选择，路径恒由调用方从 server-owned 常量派生）。
 */
export function platformOpenFile(filePath: string): Promise<void> {
  const command =
    process.platform === "win32"
      ? { file: "cmd", args: ["/c", "start", "", filePath] }
      : process.platform === "darwin"
        ? { file: "open", args: [filePath] }
        : { file: "xdg-open", args: [filePath] };
  return new Promise((resolve, reject) => {
    try {
      const child = spawn(command.file, command.args, {
        detached: true,
        stdio: "ignore",
      });
      child.on("error", (error) => {
        reject(
          new DomainError(
            "UNAVAILABLE",
            `Cannot open the search config with ${command.file}: ${error.message}`,
            { cause: error },
          ),
        );
      });
      child.unref();
      resolve();
    } catch (error) {
      reject(
        new DomainError(
          "UNAVAILABLE",
          `Cannot open the search config with ${command.file}: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        ),
      );
    }
  });
}
