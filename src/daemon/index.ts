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
import { IpcServer } from "./ipc-server.js";
import * as repositoryService from "./repository-service.js";
import { WebServer } from "./web-server.js";
import { mountTray, type TrayHost } from "./tray-host.js";
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
  stop: (opts?: { exit?: boolean }) => Promise<void>;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

  const status: DaemonStatus = {
    active: true,
    pid: process.pid,
    version: opts.cliVersion,
    port: 0,
    startedAt: Date.now(),
    tray: opts.withTray === false ? "headless" : "starting",
  };

  let stopping = false;
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

  const web = new WebServer({
    webToken,
    webuiDir: resolveWebuiDir(opts.webuiDir),
    status: () => status,
  });
  const port = await web.start(opts.port ?? 0);
  status.port = port;
  log(`web server listening on 127.0.0.1:${port}`);

  // Tray mount (best-effort). Headless when unavailable.
  if (opts.withTray !== false) {
    const url = resolveWebviewUrl(opts.webviewUrl, web.webUiUrl(port), webToken);
    const { result, host } = await mountTray({
      url,
      packageVersion: opts.cliVersion,
      enableDevtools: opts.enableDevtools ?? false,
      onQuit: async () => {
        const stop = await stopReady;
        await stop({ exit: true });
      },
    });
    handlesRef.trayHost = host;
    handlesRef.stopPlacement = result.stopPlacement;
    status.tray = host ? "mounted" : "headless";
    if (result.failure) {
      status.trayError = `${result.failure.stage}: ${result.failure.cause instanceof Error ? result.failure.cause.message : String(result.failure.cause)}`;
    }
  }
  log(`WebUI available at ${web.webUiUrlRedacted(port)}`);

  const stop = async (stopOpts: { exit?: boolean } = {}): Promise<void> => {
    if (stopping) return;
    stopping = true;
    const exit = stopOpts.exit ?? false;
    log(`daemon stop requested (exit=${String(exit)})`);
    try {
      handlesRef.stopPlacement?.();
      await handlesRef.trayHost?.destroy();
    } catch (err) {
      log(`tray teardown: ${err instanceof Error ? err.message : String(err)}`);
    }
    try {
      repositoryService.clearSessions();
    } catch (err) {
      log(`repository session teardown: ${err instanceof Error ? err.message : String(err)}`);
    }
    await web.stop();
    await ipc.stop();
    status.active = false;
    if (exit) {
      (opts.exitProcess ?? process.exit)(0);
    }
  };
  resolveStopReady(stop);

  process.on("SIGINT", () => {
    log("received SIGINT — stopping daemon");
    void stop({ exit: true });
  });
  process.on("SIGTERM", () => {
    log("received SIGTERM — stopping daemon");
    void stop({ exit: true });
  });

  return { web, ipc, port, webToken, status, trayHost: handlesRef.trayHost, stop };
}
