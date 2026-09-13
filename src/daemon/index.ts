/**
 * 原始需求 [2026-07-14]：「参考 ../../pnpm-pub 这个项目的架构：cli+gui(webui+opentray)」。
 * 用户原始需求 [2026-07-20]：「将 Vite 生成的 appIcon 用于 dev/build 的 daemon 运行时」。
 * 用户原始需求 [2026-07-21]：「placement直接居中就行，不用跟随tray。」
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
import { openUrlInBrowser } from "../shared/browser-launch.js";
import type { DaemonStatus } from "../shared/contracts/daemon.js";
import { createDaemonDomain, type DaemonDomain } from "./domain.js";
import { runBootSessionCleanup } from "./kernel/session-cleanup.js";
import { IpcServer } from "./ipc-server.js";
import { WebServer } from "./web-server.js";
import { mountDshKernelHost, type ProductionDshKernelHost } from "./dsh-host-lifecycle.js";
import { createDshSessionBinder } from "./steward/dsh-session-binder.js";
import { createSkillCreatorMcpServer } from "./mcp/skill-creator-mcp.js";
import { mountTray, type TrayHost } from "./tray-host.js";
import { log } from "./log.js";
import type { OpenTrayAppLaunchOptions } from "opentray";

/** 生产与开发 daemon 入口共享的启动配置。 */
export interface DaemonOptions {
  cliVersion: string;
  webuiDir?: string;
  port?: number;
  /** Skip tray mount (tests / headless). */
  withTray?: boolean;
  /** 4.1：DSH 组合宿主（缺省尝试挂载；false 走 SPA 恢复夹具）。 */
  withDshHost?: boolean;
  /** web 模式：只挂纯 tray（菜单+图标），主项打开浏览器，不创建原生窗口。 */
  web?: boolean;
  /** Open the WebView inspector (dev only). */
  enableDevtools?: boolean;
  /** URL the tray window loads; defaults to the daemon's own WebServer URL. */
  webviewUrl?: string;
  /** Deterministic token for isolated dev/browser verification only. */
  webToken?: string;
  /** Stable cold-launch vector; development points at the Vite supervisor command. */
  appLaunch?: OpenTrayAppLaunchOptions;
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
  /** 同进程 domain（进程内组合/取证用；跨进程消费者走 RPC/IPC，不共享此句柄）。 */
  domain: DaemonDomain;
  /** 4.1 DSH 组合宿主句柄（boot graph + 有界 dispose）。 */
  dshHost: ProductionDshKernelHost;
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
    path.join(__dirname, "..", "..", "webui", "static"), // source dev: Vite static assets
    path.join(__dirname, "..", "..", "webui", "build"), // source production build
    path.join(process.cwd(), "dist", "webui"),
    path.join(process.cwd(), "webui", "static"),
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
  const handlesRef: { trayHost: TrayHost | null } = {
    trayHost: null,
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
  // R14-C：启动即按 settings.session.sessionCleanupDays 扫一遍过期面板转录
  // （fire-and-forget；有界 try/catch 在 runBootSessionCleanup 内，不打断启动，
  // 也不触碰 $DSH_HOME 内核会话日志）。
  void runBootSessionCleanup({
    cleanupDays: async () =>
      (await domain.dshSettings.getView()).settings.session.sessionCleanupDays,
    cleanup: (beforeDays) => domain.agentSessions.cleanup({ beforeDays }),
    log,
  });

  let web: WebServer;
  let port: number;
  const webuiDir = resolveWebuiDir(opts.webuiDir);
  try {
    web = new WebServer({
      webToken,
      webuiDir,
      status: () => status,
      domain,
    });
    port = await web.start(opts.port ?? 0);
  } catch (error) {
    await domain.repository.dispose();
    await ipc.stop();
    throw error;
  }
  status.port = port;
  log(`web server listening on 127.0.0.1:${port}`);

  // 2.1 内核形态：boot headless DSH 内核（boot 失败降级，daemon 不阻塞；无 HTTP
  // 挂载——Agent 会话由 shell 面板经 agent.* RPC 消费内核 ctx）。
  // 4.1b：内核组合 mcp-client 行，连接本 daemon 的 /mcp（Bearer web token 经
  // env 模板注入，不落 profile YAML）。web 已监听（port 可用）。
  const dshHost = await mountDshKernelHost({
    disabled: opts.withDshHost === false,
    mcp: { url: `http://127.0.0.1:${port}/mcp`, token: webToken },
  });
  if (dshHost.mounted) {
    status.dsh = {
      mounted: true,
      entries: dshHost.record!.entries,
      activationOrder: dshHost.record!.activationOrder,
    };
    log(`dsh kernel mounted: ${dshHost.record!.entries.length} entries activated (headless)`);
  } else {
    status.dsh = { mounted: false, reason: dshHost.reason };
    log(`dsh kernel unavailable (manager face keeps serving): ${dshHost.reason}`);
  }
  // 2.2：内核句柄注入 domain——agent.* RPC 面即时刻可用（降级时 typed UNAVAILABLE）。
  // 2.3：steward run 绑定内核 session（binder 只消费 ctx；turn/tool 事件喂进
  // 脱敏 stream 环形缓冲）。内核降级时 binder 保持缺席（run 不绑定，stream 空）。
  if (dshHost.mounted && dshHost.kernel) {
    const kernel = dshHost.kernel;
    domain.setKernelHost(kernel);
    domain.skillSteward.setDshSessionBinder(
      createDshSessionBinder({
        host: () => (dshHost.mounted ? kernel : null),
        createCollector: (runId, sessionId) =>
          domain.dshSettings.createStreamCollector(runId, sessionId),
      }),
    );
  }
  // 4.1 形态 A：skill-creator MCP 面（/mcp，loopback + Bearer web token）。
  web.mountMcp(() =>
    createSkillCreatorMcpServer({
      capabilities: domain.managerCapabilities,
      cards: domain.uiCards,
      proposals: domain.mcpProposals,
      face: "in-process",
    }),
  );

  const performStop = async (): Promise<void> => {
    log("daemon stop requested");
    try {
      const tasks = [
        settleTeardown("tray host", async () => handlesRef.trayHost?.destroy()),
        settleTeardown("agent sessions", () => domain.agentSessions.dispose()),
        settleTeardown("dsh kernel host", () => dshHost.dispose()),
        settleTeardown("web server", () => web.stop({ graceMs: SHUTDOWN_GRACE_MS })),
        settleTeardown("IPC server", () => ipc.stop({ graceMs: SHUTDOWN_GRACE_MS })),
        settleTeardown("repository sessions", () => domain.repository.dispose()),
        // ACP 子进程池：有界杀光所有 agent 子进程，避免孤儿进程泄漏。
        settleTeardown("acp bridge", () => domain.acpBridge.dispose()),
        // steward：取消活动 run、回收隔离 execution root、dispose backend adapter。
        settleTeardown("steward service", () => domain.steward.dispose()),
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
    const webMode = opts.web === true;
    const { result, host } = await (opts.trayMounter ?? mountTray)({
      url,
      packageVersion: opts.cliVersion,
      enableDevtools: opts.enableDevtools ?? false,
      webuiDir,
      web: webMode,
      // web 模式无原生窗口，不需要 Dock 冷启动向量；tray 菜单点击由 onOpenInBrowser 接管。
      ...(webMode || opts.appLaunch === undefined ? {} : { appLaunch: opts.appLaunch }),
      onOpenInBrowser: webMode
        ? async () => {
            const launched = await openUrlInBrowser(web.webUiUrl(port));
            if (!launched.opened) {
              log(`web-mode browser launch failed: ${launched.error ?? "unknown"}`);
            }
          }
        : undefined,
      onQuit: async () => {
        const stop = await stopReady;
        await stop({ exit: true });
      },
    });
    if (stopPromise) {
      // stop 已在进行 —— mount 迟到，立即销毁，绝不保留迟到 native handle。
      await Promise.allSettled([settleTeardown("late tray host", async () => host?.destroy())]);
    } else {
      handlesRef.trayHost = host;
      // windowed 成功 → mounted；web 模式 tray 挂载 → web；否则 headless。
      status.tray = result.window ? "mounted" : webMode && result.tray ? "web" : "headless";
      if (result.failure) {
        status.trayError = `[${result.failure.kind}@${result.failure.stage}] ${
          result.failure.cause instanceof Error
            ? result.failure.cause.message
            : String(result.failure.cause)
        }`;
      }
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
    domain,
    dshHost,
    stop,
  };
}
