/**
 * 用户原始需求 [2026-10-05]（Owner）：「"Open repo" 用 OpenTray 的 ext-opener」。
 * 正交意图：
 *   [1] 持有 ext-opener 的 capability（tray 挂载成功后 attach；仿 dialog-service
 *       的 lazy 集成样板）。
 *   [2] server-owned https 闸：只接受 https URL（与 sources 的 https-only Git
 *       源同族约束；opener 自身的 scheme 白名单之外再收紧产品面）。
 *   [3] headless/挂载失败降级：spawn 系统默认打开（open/xdg-open/start 的 URL
 *       形态——search-config-opener 的同族语义，函数独立因路径/URL 语义分流）。
 * 妥协声明：降级路径不经 ext-opener（它需要 TrayHandle；headless 无 tray 是
 * 生态事实）——Owner 指定的 opener 是首选通道，降级保可用性。
 */
import { spawn } from "node:child_process";
import type { TrayHandle } from "opentray";
import { DomainError } from "./domain-error.js";

/** ext-opener 的 attach 面（测试可注入 stub）。 */
export type OpenerAttachFn = (tray: TrayHandle) => {
  open: (target: string) => Promise<void>;
};
export type OpenerAttacher = (tray: TrayHandle) => Promise<void>;

export interface OpenerService {
  /** tray 挂载后 attach（幂等；失败吞错走降级路径）。 */
  attach(tray: TrayHandle): Promise<void>;
  /** 以用户默认应用打开 https URL（typed 失败：INVALID_INPUT/UNAVAILABLE）。 */
  openHttpsUrl(url: string): Promise<void>;
  /** 测试 seam：替换降级 spawn。 */
  __setFallbackForTests(fn: ((url: string) => Promise<void>) | null): void;
}

/** 动态加载 @opentray/ext-opener 并 attach（真实现；测试注入 stub）。 */
const loadRealAttacher = async (): Promise<OpenerAttachFn> => {
  const mod = (await import("@opentray/ext-opener")) as unknown as {
    attachOpener: OpenerAttachFn;
  };
  return mod.attachOpener;
};

export function createOpenerService(attacher?: OpenerAttachFn): OpenerService {
  let opener: { open: (target: string) => Promise<void> } | null = null;
  let fallback: ((url: string) => Promise<void>) | null = null;

  const spawnFallback = (url: string): Promise<void> => {
    const command =
      process.platform === "win32"
        ? { file: "cmd", args: ["/c", "start", "", url] }
        : process.platform === "darwin"
          ? { file: "open", args: [url] }
          : { file: "xdg-open", args: [url] };
    return new Promise((resolve, reject) => {
      const child = spawn(command.file, command.args, { detached: true, stdio: "ignore" });
      child.on("error", (error) => reject(new DomainError("UNAVAILABLE", String(error))));
      child.unref();
      resolve();
    });
  };

  return {
    async attach(tray: TrayHandle): Promise<void> {
      if (opener !== null) return;
      try {
        const attachFn = attacher ?? (await loadRealAttacher());
        opener = attachFn(tray);
      } catch {
        // 加载/attach 失败：降级路径兜底，不阻塞挂载流程。
      }
    },
    async openHttpsUrl(url: string): Promise<void> {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        throw new DomainError("INVALID_OPERATION", "openExternal requires an absolute URL");
      }
      if (parsed.protocol !== "https:") {
        throw new DomainError("INVALID_OPERATION", "openExternal only accepts https URLs");
      }
      const run = opener?.open(url) ?? (fallback ?? spawnFallback)(url);
      try {
        await run;
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code === "opener_scheme_blocked" || code === "opener_target_invalid") {
          throw new DomainError("INVALID_OPERATION", String(error));
        }
        throw new DomainError("UNAVAILABLE", String(error));
      }
    },
    __setFallbackForTests(fn): void {
      fallback = fn;
    },
  };
}
