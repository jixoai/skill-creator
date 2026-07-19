/**
 * Daemon shutdown orchestration contract tests.
 *
 * User input [2026-07-15]: "按照你自己的节奏去推进开发迭代。"
 * Architecture decision [2026-07-15]: concurrent stop sources converge on one
 * bounded teardown without losing a later process-exit request.
 *
 * Orthogonal intents:
 *   [1] Prove concurrent stop calls share completion and merge exit intent.
 *   [2] Prove non-exiting teardown releases process signal listeners.
 *   [3] Bound stop during tray startup and dispose native handles that arrive late.
 */
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootDaemon, type DaemonHandles } from "../src/daemon/index.js";
import { TrayHost } from "../src/daemon/tray-host.js";
import {
  createIpcRequest,
  encodeFrame,
  FrameReader,
  parseIpcResponse,
} from "../src/shared/frame.js";
import { setHomeOverride, socketPath } from "../src/shared/paths.js";
import { socketAcceptsConnections } from "../src/shared/socket-liveness.js";

const previousHome = process.env.SKILL_CREATOR_HOME;
let sandbox = "";
let handles: DaemonHandles | null = null;

beforeEach(() => {
  const prefix =
    process.platform === "win32" ? path.join(os.tmpdir(), "sc-life-") : "/tmp/sc-life-";
  sandbox = fs.mkdtempSync(prefix);
  const isolatedHome = path.join(sandbox, "state");
  process.env.SKILL_CREATOR_HOME = isolatedHome;
  setHomeOverride(isolatedHome);
});

afterEach(async () => {
  await handles?.stop();
  handles = null;
  setHomeOverride(null);
  if (previousHome === undefined) delete process.env.SKILL_CREATOR_HOME;
  else process.env.SKILL_CREATOR_HOME = previousHome;
  fs.rmSync(sandbox, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("daemon shutdown orchestration", () => {
  it("merges a later exit request into an in-flight stop exactly once", async () => {
    const exitProcess = vi.fn<(code: number) => void>();
    handles = await startDaemon(exitProcess);

    const gracefulStop = handles.stop();
    const exitingStop = handles.stop({ exit: true });
    await Promise.all([gracefulStop, exitingStop]);
    await handles.stop({ exit: true });

    expect(handles.status.active).toBe(false);
    expect(exitProcess).toHaveBeenCalledTimes(1);
    expect(exitProcess).toHaveBeenCalledWith(0);
  });

  it("releases its process signal listeners after a non-exiting stop", async () => {
    const sigintBefore = process.listenerCount("SIGINT");
    const sigtermBefore = process.listenerCount("SIGTERM");
    handles = await startDaemon(() => {});
    expect(process.listenerCount("SIGINT")).toBe(sigintBefore + 1);
    expect(process.listenerCount("SIGTERM")).toBe(sigtermBefore + 1);

    await handles.stop();

    expect(process.listenerCount("SIGINT")).toBe(sigintBefore);
    expect(process.listenerCount("SIGTERM")).toBe(sigtermBefore);
  });

  it.each(["IPC", "SIGTERM"] as const)(
    "accepts %s stop while tray mount is pending and destroys handles that arrive late",
    async (stopSource) => {
      const sigintBefore = process.listenerCount("SIGINT");
      const sigtermBefore = process.listenerCount("SIGTERM");
      const sigtermListenersBefore = new Set(process.listeners("SIGTERM"));
      let signalMountStarted: () => void = () => {};
      let releaseMount: () => void = () => {};
      const mountStarted = new Promise<void>((resolve) => {
        signalMountStarted = resolve;
      });
      const mountReleased = new Promise<void>((resolve) => {
        releaseMount = resolve;
      });
      const stopPlacement = vi.fn();
      const destroyTray = vi.fn(async () => {});
      const destroyWindow = vi.fn(async () => {});
      const lateHost = new TrayHost(
        {
          destroy: destroyTray,
          onMenuClick: () => () => {},
          setMenu: async () => {},
        },
        {
          destroy: destroyWindow,
          setStyle: async () => {},
          show: async () => {},
          toVisible: async () => {},
          close: async () => {},
          isVisible: async () => false,
          listen: () => () => {},
        },
        { onQuit: () => {} },
      );
      const exitProcess = vi.fn<(code: number) => void>();
      const webuiDir = path.join(sandbox, "webui");
      fs.mkdirSync(webuiDir, { recursive: true });
      fs.writeFileSync(path.join(webuiDir, "index.html"), "<!doctype html><title>Test</title>");
      const booting = bootDaemon({
        cliVersion: "test",
        exitProcess,
        webuiDir,
        trayMounter: async () => {
          signalMountStarted();
          await mountReleased;
          return {
            result: { tray: null, window: null, stopPlacement },
            host: lateHost,
          };
        },
      });

      await mountStarted;
      expect(process.listenerCount("SIGINT")).toBe(sigintBefore + 1);
      expect(process.listenerCount("SIGTERM")).toBe(sigtermBefore + 1);
      try {
        if (stopSource === "IPC") {
          await expect(requestStop()).resolves.toBeUndefined();
        } else {
          const signalHandler = process
            .listeners("SIGTERM")
            .find((listener) => !sigtermListenersBefore.has(listener));
          if (!signalHandler) throw new Error("Expected daemon SIGTERM listener to be installed.");
          signalHandler();
        }
        await expect(waitForSocketRelease(500)).resolves.toBe(true);
        await vi.waitFor(() => expect(exitProcess).toHaveBeenCalledOnce(), { timeout: 500 });
        expect(process.listenerCount("SIGINT")).toBe(sigintBefore);
        expect(process.listenerCount("SIGTERM")).toBe(sigtermBefore);
      } finally {
        releaseMount();
        handles = await booting;
      }

      expect(handles?.status.active).toBe(false);
      expect(handles?.trayHost).toBeNull();
      expect(stopPlacement).toHaveBeenCalledOnce();
      expect(destroyWindow).toHaveBeenCalledOnce();
      expect(destroyTray).toHaveBeenCalledOnce();
    },
  );
});

async function startDaemon(exitProcess: (code: number) => void): Promise<DaemonHandles> {
  const webuiDir = path.join(sandbox, "webui");
  fs.mkdirSync(webuiDir, { recursive: true });
  fs.writeFileSync(path.join(webuiDir, "index.html"), "<!doctype html><title>Test</title>");
  const started = await bootDaemon({
    cliVersion: "test",
    exitProcess,
    webuiDir,
    withTray: false,
  });
  if (!started) throw new Error("Expected the lifecycle test daemon to own its IPC endpoint.");
  return started;
}

async function requestStop(): Promise<void> {
  const response = await new Promise<unknown>((resolve, reject) => {
    const socket = net.createConnection({ path: socketPath() });
    const reader = new FrameReader();
    const timeout = setTimeout(() => finish(new Error("IPC stop fixture timed out.")), 1_000);
    let settled = false;
    const finish = (result: unknown | Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.destroy();
      if (result instanceof Error) reject(result);
      else resolve(result);
    };
    socket.on("connect", () =>
      socket.write(encodeFrame(createIpcRequest({ type: "stop" }, "test"))),
    );
    socket.on("data", (chunk) => reader.push(chunk));
    socket.on("end", () => reader.close());
    socket.on("close", () => reader.close());
    socket.on("error", finish);
    void (async () => {
      try {
        for await (const body of reader.frames()) {
          const decoded: unknown = JSON.parse(Buffer.from(body).toString("utf8"));
          finish(parseIpcResponse(decoded) ?? new Error("Invalid IPC stop response."));
          return;
        }
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    })();
  });
  expect(response).toEqual({ ok: true });
}

async function waitForSocketRelease(maxMs: number): Promise<boolean> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    if (!(await socketAcceptsConnections(socketPath(), 25))) return true;
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  return false;
}
