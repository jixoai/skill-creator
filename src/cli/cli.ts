#!/usr/bin/env node
/**
 * 原始需求 [2026-07-14]：「参考 ../../pnpm-pub 这个项目的架构：cli+gui(webui+opentray)，基于 ../ccski 这个 sdk 来快速搭建一个 “skills 管理器”。」
 * 用户原始需求 [2026-07-22]：「同意，但是改成 `skill-creator openinbrowser`。」
 * 正交意图：
 * 1. 解析并路由公开 CLI 命令。
 * 2. 通过带版本、运行时校验的 IPC 协议调用 daemon。
 * 3. 安全启动、替换或恢复 tray 已失联的分离运行 daemon。
 * 4. 向终端投影 daemon 与 tray 状态，并只由显式命令打开系统浏览器。
 *
 * Routing:
 *   skill-creator start   -> spawn daemon + open tray window
 *   skill-creator open    -> show/focus the tray window of a running daemon
 *   skill-creator openinbrowser -> open the running daemon WebUI in the system browser
 *   skill-creator status  -> query daemon status
 *   skill-creator stop    -> graceful daemon shutdown
 *   skill-creator help    -> print command help
 *   skill-creator version -> print version
 *
 * 妥协声明：CLI 必须同时承载解析、IPC 生命周期与终端投影，拆成多个
 * 进程入口会破坏单一命令边界；daemon 业务逻辑已物理隔离到 src/daemon/。
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { IpcCommand } from "../shared/frame.js";
import { DaemonStatusSchema, type DaemonStatus } from "../shared/contracts/daemon.js";
import { resolveDevHome } from "../shared/dev-runtime.js";
import { openUrlInBrowser as launchBrowser } from "../shared/browser-launch.js";
import { daemonLogPath, ensureAppDirs, socketPath } from "../shared/paths.js";
import { socketAcceptsConnections } from "../shared/socket-liveness.js";
import { parseWebModeFlag, SKILL_CREATOR_WEB_ENV, type WebModeFlag } from "../shared/web-mode.js";
import { DaemonConnectionError, DaemonResponseError, requestDaemon } from "./ipc-client.js";
import { readCliVersion } from "./package-version.js";

/** Process.argv minus node + script path (matches yargs/helpers hideBin). */
function hideBin(argv: string[]): string[] {
  return argv.slice(2);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_VERSION = readCliVersion();

/** Resolve the daemon entry to spawn. Bundled uses Node; source development uses Bun. */
function resolveDaemonEntry(): string {
  const override = process.env.SKILL_CREATOR_DAEMON_ENTRY;
  if (override) return override;
  const bundled = path.join(__dirname, "daemon.js");
  if (fs.existsSync(bundled)) return bundled;
  // Dev fallback: the TypeScript source runs directly through Bun.
  return path.join(__dirname, "..", "daemon", "main.ts");
}

/**
 * Spawn the daemon detached so it outlives the CLI process.
 *
 * `webFlag` 仅在用户显式传 `--web`/`--no-web` 时注入 `SKILL_CREATOR_WEB` env；
 * undefined 时 daemon 侧按平台默认（Linux=true）自行裁决。
 */
function spawnDaemon(webFlag: WebModeFlag = undefined): void {
  const entry = resolveDaemonEntry();
  const isTs = entry.endsWith(".ts");
  const baseEnv = { ...process.env };
  const env =
    webFlag === undefined ? baseEnv : { ...baseEnv, [SKILL_CREATOR_WEB_ENV]: webFlag ? "1" : "0" };
  const child = isTs
    ? spawn("bun", [entry], { detached: true, stdio: "ignore", env })
    : spawn(process.execPath, [entry], { detached: true, stdio: "ignore", env });
  child.unref();
}

/** Send one versioned IPC request and validate its response. */
async function ipcRequest(
  command: IpcCommand,
  timeoutMs = 4000,
  endpoint = socketPath(),
): Promise<unknown> {
  try {
    return await requestDaemon({
      socket: endpoint,
      clientVersion: CLI_VERSION,
      command,
      timeoutMs,
    });
  } catch (error) {
    if (error instanceof DaemonConnectionError) {
      throw new DaemonConnectionError(`${error.message}. Run 'skill-creator start' first.`);
    }
    throw error;
  }
}

/** Query and runtime-validate the daemon status projection. */
async function requestStatus(timeoutMs = 4000): Promise<DaemonStatus> {
  const value = await ipcRequest({ type: "status" }, timeoutMs);
  const parsed = DaemonStatusSchema.safeParse(value);
  if (!parsed.success) throw new DaemonResponseError("Daemon returned an invalid status response.");
  return parsed.data;
}

/**
 * Wait for the current daemon to converge, then open its surface.
 *
 * - `mounted`：发 IPC open，让 daemon 显示原生窗口。
 * - `web`：CLI 直接打开系统浏览器（daemon 的 tray 菜单点击才走 daemon 端打开）。
 * - `headless`：不打开，交由调用方提示 `openinbrowser`。
 */
async function waitForCurrentDaemonToOpen(maxMs = 8000): Promise<DaemonStatus | null> {
  const deadline = Date.now() + maxMs;
  let lastOpenError: Error | null = null;
  while (Date.now() < deadline) {
    try {
      const status = await requestStatus(500);
      if (status.version !== CLI_VERSION) {
        throw new DaemonResponseError(
          `Daemon ${status.version} still owns the socket; expected ${CLI_VERSION}.`,
        );
      }
      if (isDaemonReady(status)) {
        if (status.tray === "mounted") {
          try {
            await ipcRequest({ type: "open" }, 500);
            return status;
          } catch (error) {
            if (!(error instanceof Error)) throw new Error(String(error));
            lastOpenError = error;
          }
        } else if (status.tray === "web") {
          await openUrlInBrowser(webUrl(status));
          return status;
        } else {
          return status;
        }
      }
    } catch (error) {
      if (!(error instanceof DaemonConnectionError)) throw error;
    }
    await sleep(100);
  }
  if (lastOpenError) {
    throw new DaemonResponseError(`Daemon mounted but could not open: ${lastOpenError.message}`);
  }
  return null;
}

function isDaemonReady(status: DaemonStatus): boolean {
  // `starting` 尚不能决定原生窗口或 headless 提示；等待 tray 收敛为终态。
  return status.active && status.port > 0 && status.tray !== "starting";
}

/** Return the authenticated daemon WebUI URL. */
function webUrl(status: DaemonStatus): string {
  return status.webUrl ?? `http://127.0.0.1:${status.port}/`;
}

/** 在系统默认浏览器中打开 URL，并向终端投影结果；返回 launcher 是否成功启动。 */
async function openUrlInBrowser(url: string): Promise<boolean> {
  const result = await launchBrowser(url);
  if (result.opened) {
    console.log(`Opening browser: ${url}`);
    return true;
  }
  console.log(`Open this URL in your browser: ${url}`);
  console.error(`Failed to launch browser: ${result.error ?? "unknown error"}`);
  return false;
}

/** Wait until graceful shutdown has removed the socket from the runtime namespace. */
async function waitForDaemonRelease(maxMs = 8000, endpoint = socketPath()): Promise<boolean> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const acceptsConnections = await socketAcceptsConnections(endpoint);
    const socketRemoved = process.platform === "win32" || !fs.existsSync(endpoint);
    if (!acceptsConnections && socketRemoved) return true;
    await sleep(100);
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runStart(): Promise<number> {
  ensureAppDirs();
  const webFlag = parseWebModeFlag(hideBin(process.argv));
  let runningStatus: DaemonStatus | null = null;
  let spawned = false;
  try {
    runningStatus = await requestStatus(1500);
  } catch (error) {
    if (!(error instanceof DaemonConnectionError)) {
      console.error(error instanceof Error ? error.message : String(error));
      return 1;
    }
  }

  if (runningStatus && runningStatus.version !== CLI_VERSION) {
    console.log(`replacing daemon ${runningStatus.version} with ${CLI_VERSION}...`);
    try {
      await ipcRequest({ type: "stop" });
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      return 1;
    }
    if (!(await waitForDaemonRelease())) {
      console.error("Timed out waiting for the previous daemon socket to be released.");
      return 1;
    }
    runningStatus = null;
  }

  if (runningStatus?.tray === "mounted") {
    try {
      await ipcRequest({ type: "open" }, 750);
      console.log("skill-creator daemon is already running.");
      console.log("Opening the tray window…");
      return 0;
    } catch {
      console.log("restarting daemon because its tray runtime is unavailable...");
      try {
        await ipcRequest({ type: "stop" });
      } catch (stopError) {
        console.error(stopError instanceof Error ? stopError.message : String(stopError));
        return 1;
      }
      if (!(await waitForDaemonRelease())) {
        console.error("Timed out waiting for the unavailable daemon to release its socket.");
        return 1;
      }
      runningStatus = null;
    }
  }

  // 已运行的 web 模式 daemon：CLI 直接打开浏览器，不重开 daemon。
  if (runningStatus?.tray === "web") {
    await openUrlInBrowser(webUrl(runningStatus));
    console.log("skill-creator daemon is already running.");
    console.log("Opening the WebUI in your browser…");
    return 0;
  }

  if (!runningStatus) {
    spawnDaemon(webFlag);
    spawned = true;
  }

  let readyStatus: DaemonStatus | null = null;
  try {
    readyStatus = await waitForCurrentDaemonToOpen();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
  if (!readyStatus) {
    console.error(
      spawned
        ? `Failed to start the daemon. Check ${daemonLogPath()}`
        : "Timed out waiting for the daemon to finish starting.",
    );
    return 1;
  }

  if (spawned) {
    console.log("skill-creator daemon started.");
  } else {
    console.log("skill-creator daemon is already running.");
  }
  if (readyStatus.tray === "mounted") {
    console.log("Opening the tray window…");
  } else if (readyStatus.tray === "web") {
    // waitForCurrentDaemonToOpen 已在 web 状态下打开浏览器；这里只投影终态。
    console.log("The WebUI is opening in your browser.");
  } else {
    console.log(
      "The daemon is running headlessly. Run 'skill-creator openinbrowser' to open the WebUI.",
    );
  }
  return 0;
}

async function runStatus(): Promise<number> {
  try {
    const status = await requestStatus();
    if (hideBin(process.argv).includes("--json")) {
      // 安装态取证（4.8）：完整 DaemonStatus JSON（含 DSH entries/activationOrder 诊断面）。
      console.log(JSON.stringify(status, null, 2));
      return 0;
    }
    const url = webUrl(status);
    const trayLabel =
      status.tray === "headless"
        ? "headless (browser mode)"
        : status.tray === "web"
          ? "web (tray + browser)"
          : status.tray;
    console.log("skill-creator daemon is running:");
    console.log(`  pid:     ${status.pid}`);
    console.log(`  version: ${status.version}`);
    console.log(`  port:    ${status.port}`);
    console.log(`  tray:    ${trayLabel}`);
    if (status.trayError) console.log(`  tray error: ${status.trayError}`);
    // DSH 宿主行（4.8）：安装态取证需要 black-box 可见的组合宿主健康面。
    if (status.dsh) {
      console.log(
        status.dsh.mounted
          ? `  dsh:     mounted (port ${status.dsh.port ?? "?"}, ${status.dsh.entries?.length ?? 0} entries)`
          : `  dsh:     unavailable (${status.dsh.reason ?? "unknown reason"})`,
      );
    }
    console.log(`  url:     ${url}`);
    return 0;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}

async function runStop(): Promise<number> {
  const productionEndpoint = socketPath();
  const developmentEndpoint = socketPath(resolveDevHome());
  const runtimes = [
    { kind: "production" as const, endpoint: productionEndpoint },
    ...(developmentEndpoint === productionEndpoint
      ? []
      : [{ kind: "development" as const, endpoint: developmentEndpoint }]),
  ];
  const stopped: Array<(typeof runtimes)[number]["kind"]> = [];

  for (const runtime of runtimes) {
    if (!(await socketAcceptsConnections(runtime.endpoint, 100))) continue;
    try {
      await ipcRequest({ type: "stop" }, 4_000, runtime.endpoint);
      if (!(await waitForDaemonRelease(8_000, runtime.endpoint))) {
        console.error(
          `${runtime.kind} daemon accepted the stop request but did not release ${runtime.endpoint}.`,
        );
        return 1;
      }
      stopped.push(runtime.kind);
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      return 1;
    }
  }

  if (stopped.length === 0) {
    const endpoints = runtimes.map((runtime) => runtime.endpoint).join(", ");
    console.error(
      `cannot reach a Skill Creator daemon (${endpoints}). Run 'skill-creator start' first.`,
    );
    return 1;
  }

  for (const kind of stopped) {
    console.log(
      kind === "development"
        ? "skill-creator development daemon stopped."
        : "skill-creator daemon stopped.",
    );
  }
  return 0;
}

async function runOpen(): Promise<number> {
  try {
    const status = await requestStatus();
    if (status.tray === "mounted") {
      await ipcRequest({ type: "open" });
      console.log("Opening the tray window…");
      return 0;
    }
    if (status.tray === "web") {
      // web 模式无原生窗口；open 降级为打开浏览器（贴合用户「打开应用」的直觉）。
      return (await openUrlInBrowser(webUrl(status))) ? 0 : 1;
    }
    if (status.tray === "headless") {
      console.error(
        "The daemon is running headlessly. Run 'skill-creator openinbrowser' to open the WebUI.",
      );
      return 1;
    }
    console.error(
      "The native window is still starting. Run 'skill-creator open' again after it mounts.",
    );
    return 1;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}

/** Open the running daemon WebUI in the system browser only on explicit request. */
async function runOpenInBrowser(): Promise<number> {
  try {
    const status = await requestStatus();
    if (!status.active || status.port === 0) {
      console.error(
        "The daemon WebUI is still starting. Run 'skill-creator openinbrowser' again shortly.",
      );
      return 1;
    }
    return (await openUrlInBrowser(webUrl(status))) ? 0 : 1;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}

interface CommandDefinition {
  description: string;
  run: () => number | Promise<number>;
}

const COMMANDS = {
  start: { description: "Boot the daemon and open the tray window", run: runStart },
  open: { description: "Show/focus the tray window of a running daemon", run: runOpen },
  openinbrowser: {
    description: "Open the running WebUI in the system browser",
    run: runOpenInBrowser,
  },
  status: { description: "Check the running daemon", run: runStatus },
  stop: { description: "Gracefully stop the daemon", run: runStop },
  mcp: {
    description: "Run the skill-creator MCP server over stdio (readonly face)",
    run: () => {
      void runMcpStdio();
      return 0;
    },
  },
  version: {
    description: "Print the version",
    run: () => {
      console.log(CLI_VERSION);
      return 0;
    },
  },
  help: {
    description: "Show this help",
    run: () => {
      printHelp();
      return 0;
    },
  },
} as const satisfies Record<string, CommandDefinition>;

type CommandName = keyof typeof COMMANDS;

function isCommandName(value: string): value is CommandName {
  return Object.hasOwn(COMMANDS, value);
}

function printHelp(): void {
  const lines = Object.entries(COMMANDS)
    .map(([name, command]) => `  skill-creator ${name.padEnd(14)} ${command.description}`)
    .join("\n");
  console.log(`skill-creator — skills manager (CLI + tray WebUI)\n\nUsage:\n${lines}\n`);
}

async function main(): Promise<number> {
  const argv = hideBin(process.argv);
  const command = argv.find((a) => !a.startsWith("-"));

  if (!command || !isCommandName(command)) {
    if (argv.includes("-v") || argv.includes("--version")) {
      console.log(CLI_VERSION);
      return 0;
    }
    printHelp();
    return command ? 1 : 0;
  }

  return COMMANDS[command].run();
}

/**
 * `skill-creator mcp`（task 4.1 形态 B）：stdio transport，不依赖 daemon 常驻——
 * 进程内自建 domain（无 IPC/HTTP/tray）。面收窄为 readonly + propose-only：
 * mutation 仅经形态 A 的 daemon 审批链。
 * skill-refs-and-platform-fixes C3：SDK v2 的 serveStdio 入口（开场交换按连接
 * 选纪元——stdio 客户端单连接单纪元，与 HTTP 双纪元入口不同源）。
 */
async function runMcpStdio(): Promise<void> {
  const { serveStdio } = await import("@modelcontextprotocol/server/stdio");
  const { createDaemonDomain } = await import("../daemon/domain.js");
  const { createSkillCreatorMcpServer } = await import("../daemon/mcp/skill-creator-mcp.js");
  const domain = createDaemonDomain();
  console.error("skill-creator mcp: stdio server ready (readonly face)");
  await serveStdio(() =>
    createSkillCreatorMcpServer({
      capabilities: domain.managerCapabilities,
      cards: domain.uiCards,
      face: "stdio",
    }),
  );
}

void main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
