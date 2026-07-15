/**
 * User input [2026-07-14]: "参考 ../../pnpm-pub 这个项目的架构：cli+gui(webui+opentray)"
 * Architecture decision [2026-07-14]: live sockets retain ownership, stale
 * sockets require a failed liveness probe, and stop acknowledgement is truthful.
 *
 * Orthogonal intents:
 *   [1] Prove bind-first ownership never removes a live socket and retries stale cleanup once.
 *   [2] Prove stop acknowledgement ordering and bounded connection teardown.
 *   [3] Prove oversized wire input receives a stable protocol rejection.
 */
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IpcServer } from "../src/daemon/ipc-server.js";
import {
  createIpcRequest,
  encodeFrame,
  FrameReader,
  IPC_PROTOCOL_VERSION,
  MAX_IPC_FRAME_BYTES,
  parseIpcResponse,
  type IpcResponse,
} from "../src/shared/frame.js";
import { setHomeOverride, socketPath } from "../src/shared/paths.js";
import { socketAcceptsConnections } from "../src/shared/socket-liveness.js";

const temporaryDirectories: string[] = [];
const servers: IpcServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop()));
  setHomeOverride(null);
  vi.restoreAllMocks();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.promises.rm(directory, { recursive: true, force: true })),
  );
});

describe("IPC socket ownership", () => {
  it.skipIf(process.platform === "win32")("does not remove or seize a live socket", async () => {
    await useTemporaryHome();
    const owner = trackServer(createServer());
    const contender = trackServer(createServer());
    expect(await owner.start()).toBe(true);
    const unlink = vi.spyOn(fs, "unlinkSync");

    expect(await contender.start()).toBe(false);
    expect(unlink).not.toHaveBeenCalled();
    expect(await socketAcceptsConnections(socketPath())).toBe(true);
  });

  it.skipIf(process.platform === "win32")(
    "removes a stale pathname once after its liveness probe fails",
    async () => {
      await useTemporaryHome();
      fs.mkdirSync(path.dirname(socketPath()), { recursive: true });
      fs.writeFileSync(socketPath(), "stale socket fixture");
      const unlink = vi.spyOn(fs, "unlinkSync");
      const server = trackServer(createServer());

      expect(await server.start()).toBe(true);
      expect(unlink).toHaveBeenCalledTimes(1);
      expect(unlink).toHaveBeenCalledWith(socketPath());
      expect(await socketAcceptsConnections(socketPath())).toBe(true);
    },
  );
});

describe("IPC stop lifecycle", () => {
  it("returns an error and keeps listening when stop preparation rejects", async () => {
    await useTemporaryHome();
    const server = trackServer(
      new IpcServer({
        onStatus: daemonStatus,
        onOpen: async () => {},
        onStop: async () => {
          throw new Error("Stop was refused.");
        },
      }),
    );
    expect(await server.start()).toBe(true);

    await expect(request({ type: "stop" })).resolves.toEqual({
      ok: false,
      error: "Stop was refused.",
    });
    expect(await socketAcceptsConnections(socketPath())).toBe(true);
  });

  it("flushes a successful acknowledgement before running asynchronous teardown", async () => {
    await useTemporaryHome();
    let teardownStarted = false;
    let server: IpcServer;
    server = trackServer(
      new IpcServer({
        onStatus: daemonStatus,
        onOpen: async () => {},
        onStop: async () => async () => {
          teardownStarted = true;
          await server.stop();
        },
      }),
    );
    expect(await server.start()).toBe(true);

    await expect(request({ type: "stop" })).resolves.toEqual({ ok: true });
    await expect(waitForSocketRelease()).resolves.toBe(true);
    expect(teardownStarted).toBe(true);
  });

  it("force-closes an idle client after the graceful shutdown window", async () => {
    await useTemporaryHome();
    const server = trackServer(createServer());
    expect(await server.start()).toBe(true);
    const client = await connectIdleClient();

    const stopping = server.stop({ graceMs: 20 });
    const completedInTime = await settlesWithin(stopping, 250);
    client.destroy();
    await stopping;

    expect(completedInTime).toBe(true);
  });

  it("rejects a client using an incompatible protocol version", async () => {
    await useTemporaryHome();
    const server = trackServer(createServer());
    expect(await server.start()).toBe(true);

    await expect(
      exchange(
        encodeFrame({
          protocolVersion: IPC_PROTOCOL_VERSION + 1,
          cliVersion: "test",
          type: "status",
        }),
      ),
    ).resolves.toEqual({
      ok: false,
      code: "protocol-mismatch",
      error: `IPC protocol mismatch: daemon=${IPC_PROTOCOL_VERSION}, client=${IPC_PROTOCOL_VERSION + 1}.`,
    });
  });

  it("rejects an oversized frame before reading its body", async () => {
    await useTemporaryHome();
    const server = trackServer(createServer());
    expect(await server.start()).toBe(true);
    const header = Buffer.alloc(4);
    header.writeUInt32BE(MAX_IPC_FRAME_BYTES + 1);

    await expect(exchange(header)).resolves.toEqual({
      ok: false,
      code: "frame-too-large",
      error: `IPC frame body is ${MAX_IPC_FRAME_BYTES + 1} bytes; maximum is ${MAX_IPC_FRAME_BYTES} bytes.`,
    });
  });
});

function createServer(): IpcServer {
  return new IpcServer({
    onStatus: daemonStatus,
    onOpen: async () => {},
    onStop: async () => async () => {},
  });
}

function trackServer(server: IpcServer): IpcServer {
  servers.push(server);
  return server;
}

function daemonStatus() {
  return {
    active: true,
    pid: process.pid,
    version: "test",
    port: 4567,
    startedAt: 0,
    tray: "mounted" as const,
  };
}

async function useTemporaryHome(): Promise<void> {
  const directory = await fs.promises.mkdtemp("/tmp/sc-ipc-test-");
  temporaryDirectories.push(directory);
  setHomeOverride(directory);
}

async function request(command: { type: "open" | "status" | "stop" }): Promise<IpcResponse> {
  return exchange(encodeFrame(createIpcRequest(command, "test")));
}

function exchange(payload: Buffer): Promise<IpcResponse> {
  return new Promise<IpcResponse>((resolve, reject) => {
    const socket = net.createConnection({ path: socketPath() });
    const reader = new FrameReader();
    let settled = false;
    const finish = (result: IpcResponse | Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.destroy();
      if (result instanceof Error) reject(result);
      else resolve(result);
    };
    const timeout = setTimeout(() => finish(new Error("IPC fixture timed out.")), 2_000);
    socket.on("connect", () => socket.write(payload));
    socket.on("data", (chunk) => reader.push(chunk));
    socket.on("end", () => reader.close());
    socket.on("close", () => reader.close());
    socket.on("error", (error) => finish(error));
    void (async () => {
      try {
        for await (const body of reader.frames()) {
          const decoded: unknown = JSON.parse(Buffer.from(body).toString("utf8"));
          const response = parseIpcResponse(decoded);
          finish(response ?? new Error("Fixture received an invalid IPC response."));
          return;
        }
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    })();
  });
}

async function waitForSocketRelease(maxMs = 2_000): Promise<boolean> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    if (!(await socketAcceptsConnections(socketPath(), 50))) return true;
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
  return false;
}

function connectIdleClient(): Promise<net.Socket> {
  return new Promise<net.Socket>((resolve, reject) => {
    const socket = net.createConnection({ path: socketPath(), allowHalfOpen: true });
    socket.once("connect", () => resolve(socket));
    socket.once("error", reject);
  });
}

async function settlesWithin(promise: Promise<void>, maxMs: number): Promise<boolean> {
  let timeout: NodeJS.Timeout | undefined;
  const result = await Promise.race([
    promise.then(() => true),
    new Promise<false>((resolve) => {
      timeout = setTimeout(() => resolve(false), maxMs);
    }),
  ]);
  if (timeout) clearTimeout(timeout);
  return result;
}
