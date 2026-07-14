#!/usr/bin/env node
/**
 * 原始需求 [2026-07-14]：「参考 ../../pnpm-pub 这个项目的架构：cli+gui(webui+opentray)，基于 ../ccski 这个 sdk 来快速搭建一个 “skills 管理器”。」
 * 正交意图：
 * 1. 解析并路由公开 CLI 命令。
 * 2. 通过带版本、运行时校验的 IPC 协议调用 daemon。
 * 3. 安全启动或替换分离运行的 daemon。
 * 4. 向终端投影 daemon 与 tray 状态。
 *
 * Routing:
 *   skill-creator start   -> spawn daemon + open tray window
 *   skill-creator open    -> show/focus the tray window of a running daemon
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
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createIpcRequest,
  encodeFrame,
  FrameReader,
  parseIpcResponse,
  type IpcCommand,
  type IpcErrorCode,
} from "../shared/frame.js";
import { DaemonStatusSchema, type DaemonStatus } from "../shared/contracts/daemon.js";
import { ensureAppDirs, socketPath } from "../shared/paths.js";
import { socketAcceptsConnections } from "../shared/socket-liveness.js";
import { readCliVersion } from "./package-version.js";

/** Process.argv minus node + script path (matches yargs/helpers hideBin). */
function hideBin(argv: string[]): string[] {
  return argv.slice(2);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_VERSION = readCliVersion();

class DaemonConnectionError extends Error {
  override readonly name = "DaemonConnectionError";
}

class DaemonResponseError extends Error {
  override readonly name = "DaemonResponseError";

  constructor(
    message: string,
    readonly code?: IpcErrorCode,
  ) {
    super(message);
  }
}

/** Resolve the daemon entry to spawn. Bundled uses Node; source development uses Bun. */
function resolveDaemonEntry(): string {
  const override = process.env.SKILL_CREATOR_DAEMON_ENTRY;
  if (override) return override;
  const bundled = path.join(__dirname, "daemon.js");
  if (fs.existsSync(bundled)) return bundled;
  // Dev fallback: the TypeScript source runs directly through Bun.
  return path.join(__dirname, "..", "daemon", "main.ts");
}

/** Spawn the daemon detached so it outlives the CLI process. */
function spawnDaemon(): void {
  const entry = resolveDaemonEntry();
  const isTs = entry.endsWith(".ts");
  const child = isTs
    ? spawn("bun", [entry], {
        detached: true,
        stdio: "ignore",
        env: { ...process.env },
      })
    : spawn(process.execPath, [entry], {
        detached: true,
        stdio: "ignore",
        env: { ...process.env },
      });
  child.unref();
}

/** Send one versioned IPC request and validate its response. */
async function ipcRequest(command: IpcCommand, timeoutMs = 4000): Promise<unknown> {
  return new Promise<unknown>((resolve, reject) => {
    const sock = net.createConnection({ path: socketPath() });
    const reader = new FrameReader();
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      sock.destroy();
      reject(new DaemonConnectionError("IPC request timed out — is the daemon running?"));
    }, timeoutMs);

    sock.on("connect", () => {
      sock.write(encodeFrame(createIpcRequest(command, CLI_VERSION)));
    });
    sock.on("data", (chunk: Buffer) => reader.push(chunk));
    sock.on("error", (err: Error) => {
      reader.close();
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(
        new DaemonConnectionError(
          `cannot reach daemon (${err.message}). Run 'skill-creator start' first.`,
        ),
      );
    });
    sock.on("end", () => reader.close());
    sock.on("close", () => reader.close());

    void (async () => {
      try {
        for await (const body of reader.frames()) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          const decoded: unknown = JSON.parse(Buffer.from(body).toString("utf8"));
          const response = parseIpcResponse(decoded);
          if (!response) {
            reject(new DaemonResponseError("Daemon returned an invalid IPC response."));
            return;
          }
          if (!response.ok) {
            reject(new DaemonResponseError(response.error, response.code));
            return;
          }
          resolve(response.data);
          sock.end();
          return;
        }
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new DaemonConnectionError("daemon closed the connection without responding"));
        }
      } catch (err) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    })();
  });
}

/** Query and runtime-validate the daemon status projection. */
async function requestStatus(timeoutMs = 4000): Promise<DaemonStatus> {
  const value = await ipcRequest({ type: "status" }, timeoutMs);
  const parsed = DaemonStatusSchema.safeParse(value);
  if (!parsed.success) throw new DaemonResponseError("Daemon returned an invalid status response.");
  return parsed.data;
}

/** Wait for the current daemon to mount and successfully accept an open request. */
async function waitForCurrentDaemonToOpen(maxMs = 8000): Promise<boolean> {
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
      if (status.tray === "headless") {
        throw new DaemonResponseError(
          status.trayError ? `Tray is unavailable: ${status.trayError}` : "Tray is unavailable.",
        );
      }
      if (isDaemonReady(status)) {
        try {
          await ipcRequest({ type: "open" }, 500);
          return true;
        } catch (error) {
          if (!(error instanceof Error)) throw new Error(String(error));
          lastOpenError = error;
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
  return false;
}

function isDaemonReady(status: DaemonStatus): boolean {
  return status.active && status.port > 0 && status.tray === "mounted";
}

/** Wait until graceful shutdown has removed the socket from the runtime namespace. */
async function waitForDaemonRelease(maxMs = 8000): Promise<boolean> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const acceptsConnections = await socketAcceptsConnections(socketPath());
    const socketRemoved = process.platform === "win32" || !fs.existsSync(socketPath());
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

  if (!runningStatus) {
    spawnDaemon();
    spawned = true;
  }

  let openable = false;
  try {
    openable = await waitForCurrentDaemonToOpen();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
  if (!openable) {
    console.error(
      spawned
        ? "Failed to start the daemon. Check ~/.skill-creator/logs/daemon.log"
        : "Timed out waiting for the daemon to finish starting.",
    );
    return 1;
  }

  if (spawned) {
    console.log("skill-creator daemon started.");
  } else {
    console.log("skill-creator daemon is already running.");
  }
  console.log("Opening the tray window…");
  return 0;
}

async function runStatus(): Promise<number> {
  try {
    const status = await requestStatus();
    console.log("skill-creator daemon is running:");
    console.log(`  pid:     ${status.pid}`);
    console.log(`  version: ${status.version}`);
    console.log(`  port:    ${status.port}`);
    console.log(`  tray:    ${status.tray}`);
    if (status.trayError) console.log(`  tray error: ${status.trayError}`);
    console.log(`  url:     http://127.0.0.1:${status.port}/`);
    return 0;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}

async function runStop(): Promise<number> {
  try {
    await ipcRequest({ type: "stop" });
    if (!(await waitForDaemonRelease())) {
      console.error("Daemon accepted the stop request but did not release its socket.");
      return 1;
    }
    console.log("skill-creator daemon stopped.");
    return 0;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}

async function runOpen(): Promise<number> {
  try {
    await ipcRequest({ type: "open" });
    console.log("Opening the tray window…");
    return 0;
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
  status: { description: "Check the running daemon", run: runStatus },
  stop: { description: "Gracefully stop the daemon", run: runStop },
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
    .map(([name, command]) => `  skill-creator ${name.padEnd(9)} ${command.description}`)
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

void main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
