/**
 * 原始需求 [2026-07-14]：「参考 ../../pnpm-pub 这个项目的架构：cli+gui(webui+opentray)」。
 * 正交意图：
 * 1. 先取得单实例 IPC 所有权，再暴露运行时服务。
 * 2. 启动受权的 HTTP/WebSocket 服务。
 * 3. 挂载 OpenTray，并显式投影 headless 降级。
 * 4. 统一协调启动、信号与 IPC stop 的幂等回收。
 * 妥协声明：启动顺序与逆序回收共享同一组句柄，必须留在单一编排文件；具体能力均已拆入服务模块。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { ensureAppDirs } from "../shared/paths.js";
import { WEB_TOKEN_PLACEHOLDER } from "../shared/index.js";
import type { DaemonStatus } from "../shared/contracts/daemon.js";
import type { TrayPinFrame } from "../shared/contracts/tray.js";
import { createDaemonDomain, type DaemonDomain } from "./domain.js";
import { IpcServer } from "./ipc-server.js";
import { WebServer } from "./web-server.js";
import { mountTray, type TrayHost } from "./tray-host.js";
import { PreferencesStore } from "./preferences-store.js";
import { log } from "./log.js";

/** 生产与开发 daemon 入口共享的启动配置。 */
export interface DaemonOptions {
  cliVersion: string;
  webuiDir?: string;
  port?: number;
  /** Skip tray mount (tests / headless). */
  withTray?: boolean;
  /** Open the WebView inspector (dev only). */
  enableDevtools?: boolean;
  /** URL the tray window loads; defaults to the daemon's own WebServer URL. */
  webviewUrl?: string;
  /** Deterministic token for isolated dev/browser verification only. */
  webToken?: string;
  /** Native tray mount adapter; replace only at the daemon lifecycle test boundary. */
  trayMounter?: typeof mountTray;
  exitProcess?: (code: number) => void;
}

/** daemon 已启动服务及其统一回收边界。 */
export interface DaemonHandles {
  web: WebServer;
  ipc: IpcServer;
  port: number;
  webToken: string;
  status: DaemonStatus;
  trayHost: TrayHost | null;
  preferencesStore: PreferencesStore;
  stop: (opts?: { exit?: boolean }) => Promise<void>;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHUTDOWN_GRACE_MS = 1_000;
const SHUTDOWN_TASK_TIMEOUT_MS = 2_000;

async function settleTeardown(label: string, action: () => void | Promise<void>): Promise<void> {
  let task: Promise<void>;
  try {
    task = Promise.resolve(action());
  } catch (error) {
    log(`${label} teardown: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  let timeout: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      task,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`timed out after ${SHUTDOWN_TASK_TIMEOUT_MS}ms`)),
          SHUTDOWN_TASK_TIMEOUT_MS,
        );
      }),
    ]);
  } catch (error) {
    log(`${label} teardown: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

/** Resolve the directory holding the built SvelteKit SPA. */
function resolveWebuiDir(override?: string): string {
  if (override) return path.resolve(override);
  const candidates = [
    path.join(__dirname, "webui"), // dist/webui (bundled)
    path.join(__dirname, "..", "..", "webui", "build"), // dev: webui/build
    path.join(process.cwd(), "dist", "webui"),
    path.join(process.cwd(), "webui", "build"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[0]!;
}

/**
 * 解析 tray 窗口 URL。
 *
 * dev 模式：vite 插件在 daemon token 未知时就构造了 webviewUrl（含占位符
 * WEB_TOKEN_PLACEHOLDER），这里用真实 webToken 替换它。
 * release 模式：webviewUrl 为 undefined，fallback 到 daemon 自身 URL（已含真实 token）。
 */
function resolveWebviewUrl(
  webviewUrl: string | undefined,
  fallbackUrl: string,
  webToken: string,
): string {
  return webviewUrl?.replace(WEB_TOKEN_PLACEHOLDER, encodeURIComponent(webToken)) ?? fallbackUrl;
}

/** 启动一个 daemon；IPC socket 已被其他进程占用时返回 `null`。 */
export async function bootDaemon(opts: DaemonOptions): Promise<DaemonHandles | null> {
  ensureAppDirs();

  // Single-instance lock: the IPC socket bind is the source of truth.
  const webToken = opts.webToken ?? randomBytes(32).toString("hex");
  const preferencesStore = new PreferencesStore();

  const status: DaemonStatus = {
    active: true,
    pid: process.pid,
    version: opts.cliVersion,
    port: 0,
    startedAt: Date.now(),
    tray: opts.withTray === false ? "headless" : "starting",
  };

  let stopPromise: Promise<void> | null = null;
  let stopCompleted = false;
  let exitRequested = false;
  let exitInvoked = false;
  let removeSignalHandlers = (): void => {};
  type StopDaemon = (opts?: { exit?: boolean }) => Promise<void>;
  let resolveStopReady: (stop: StopDaemon) => void = () => {};
  const stopReady = new Promise<StopDaemon>((resolve) => {
    resolveStopReady = resolve;
  });

  // Declared before the IPC server so onOpen can reference it safely (the IPC
  // handler may fire before the rest of bootDaemon finishes assigning it).
  const handlesRef: { trayHost: TrayHost | null; stopPlacement: () => void } = {
    trayHost: null,
    stopPlacement: () => {},
  };

  const ipc = new IpcServer({
    onStatus: () => status,
    onOpen: async () => {
      if (!handlesRef.trayHost) throw new Error(status.trayError ?? "Tray window is unavailable.");
      await handlesRef.trayHost.show();
    },
    onStop: async () => {
      return async () => {
        const stop = await stopReady;
        await stop({ exit: true });
      };
    },
  });

  const ipcOk = await ipc.start();
  if (!ipcOk) {
    // Another daemon holds the socket.
    return null;
  }

  let domain: DaemonDomain;
  try {
    domain = createDaemonDomain();
  } catch (error) {
    await ipc.stop();
    throw error;
  }

  let web: WebServer;
  let port: number;
  const webuiDir = resolveWebuiDir(opts.webuiDir);
  try {
    web = new WebServer({
      webToken,
      webuiDir,
      status: () => status,
      domain,
      preferencesStore,
    });
    port = await web.start(opts.port ?? 0);
  } catch (error) {
    await domain.repository.dispose();
    await ipc.stop();
    throw error;
  }
  status.port = port;
  log(`web server listening on 127.0.0.1:${port}`);

  const performStop = async (): Promise<void> => {
    log("daemon stop requested");
    try {
      const tasks = [
        settleTeardown("tray placement", () => handlesRef.stopPlacement()),
        settleTeardown("tray host", async () => handlesRef.trayHost?.destroy()),
        settleTeardown("web server", () => web.stop({ graceMs: SHUTDOWN_GRACE_MS })),
        settleTeardown("web subscriptions", () => web.dispose()),
        settleTeardown("IPC server", () => ipc.stop({ graceMs: SHUTDOWN_GRACE_MS })),
        settleTeardown("repository sessions", () => domain.repository.dispose()),
        settleTeardown("preferences store", () => preferencesStore.close()),
      ];
      await Promise.allSettled(tasks);
    } finally {
      removeSignalHandlers();
      status.active = false;
      stopCompleted = true;
    }
  };
  const exitIfRequested = (): void => {
    if (!stopCompleted || !exitRequested || exitInvoked) return;
    exitInvoked = true;
    (opts.exitProcess ?? process.exit)(0);
  };
  const stop = (stopOpts: { exit?: boolean } = {}): Promise<void> => {
    if (stopOpts.exit) exitRequested = true;
    stopPromise ??= performStop();
    return stopPromise.then(exitIfRequested);
  };
  resolveStopReady(stop);

  const onSigint = (): void => {
    log("received SIGINT — stopping daemon");
    void stop({ exit: true });
  };
  const onSigterm = (): void => {
    log("received SIGTERM — stopping daemon");
    void stop({ exit: true });
  };
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);
  removeSignalHandlers = () => {
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
  };

  // Tray mount (best-effort). Headless when unavailable — WebUI stays browser-reachable.
  if (opts.withTray !== false) {
    const url = resolveWebviewUrl(opts.webviewUrl, web.webUiUrl(port), webToken);
    const onPinFrame = (frame: TrayPinFrame): void => web.broadcast({ type: "pin", ...frame });
    const { result, host } = await (opts.trayMounter ?? mountTray)(preferencesStore, {
      url,
      packageVersion: opts.cliVersion,
      enableDevtools: opts.enableDevtools ?? false,
      webuiDir,
      onQuit: async () => {
        const stop = await stopReady;
        await stop({ exit: true });
      },
      onPinFrame,
    });
    if (stopPromise) {
      // stop 已在进行 —— mount 迟到，立即销毁，绝不保留迟到 native handle。
      await Promise.allSettled([
        settleTeardown("late tray placement", () => result.stopPlacement()),
        settleTeardown("late tray host", async () => host?.destroy()),
      ]);
    } else {
      handlesRef.trayHost = host;
      handlesRef.stopPlacement = result.stopPlacement;
      status.tray = result.window ? "mounted" : "headless";
      if (result.failure) {
        status.trayError = `[${result.failure.kind}@${result.failure.stage}] ${
          result.failure.cause instanceof Error
            ? result.failure.cause.message
            : String(result.failure.cause)
        }`;
      }
      // 后置注入 tray host，使 WebUI 投影首帧与 tray RPC 可访问其状态。
      web.attachTray(host);
      // 迟到的首帧：mount 完成后立刻广播当前 pin 状态，补齐先于 attachTray 连接的客户端。
      if (host) onPinFrame(host.getPinState());
    }
  }
  status.webUrl = web.webUiUrl(port);
  if (status.active) log(`WebUI available at ${web.webUiUrlRedacted(port)}`);

  return {
    web,
    ipc,
    port,
    webToken,
    status,
    trayHost: handlesRef.trayHost,
    preferencesStore,
    stop,
  };
}
