/**
 * Web server shutdown contract tests.
 *
 * User input [2026-07-15]: "按照你自己的节奏去推进开发迭代。"
 * Architecture decision [2026-07-15]: a non-cooperative WebSocket client must
 * not keep the daemon alive after bounded shutdown begins.
 *
 * Orthogonal intents:
 *   [1] Exercise the authenticated raw WebSocket admission boundary.
 *   [2] Prove graceful shutdown has a forceful, bounded completion path.
 */
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDaemonDomain, type DaemonDomain } from "../src/daemon/domain.js";
import { WebServer } from "../src/daemon/web-server.js";
import { setHomeOverride } from "../src/shared/paths.js";

const previousHome = process.env.SKILL_CREATOR_HOME;
let sandbox = "";
let domain: DaemonDomain;
let web: WebServer | null = null;
let rawClient: net.Socket | null = null;

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "skill-creator-web-server-test-"));
  const isolatedHome = path.join(sandbox, "state");
  process.env.SKILL_CREATOR_HOME = isolatedHome;
  setHomeOverride(isolatedHome);
  domain = createDaemonDomain();
});

afterEach(async () => {
  rawClient?.destroy();
  rawClient = null;
  await web?.stop({ graceMs: 0 });
  web = null;
  await domain.repository.dispose();
  setHomeOverride(null);
  if (previousHome === undefined) delete process.env.SKILL_CREATOR_HOME;
  else process.env.SKILL_CREATOR_HOME = previousHome;
  fs.rmSync(sandbox, { recursive: true, force: true });
});

describe("Web server shutdown", () => {
  it("force-closes a WebSocket client that ignores the close handshake", async () => {
    const webuiDir = path.join(sandbox, "webui");
    fs.mkdirSync(webuiDir, { recursive: true });
    fs.writeFileSync(path.join(webuiDir, "index.html"), "<!doctype html><title>Test</title>");
    const webToken = "shutdown-test-token";
    web = new WebServer({
      webToken,
      webuiDir,
      domain,
      status: () => ({
        active: true,
        pid: process.pid,
        version: "test",
        port: 0,
        startedAt: 0,
        tray: "headless",
      }),
    });
    const port = await web.start(0);
    rawClient = await openRawWebSocket(port, webToken);
    let clientDidClose = false;
    const clientClosed = new Promise<void>((resolve) =>
      rawClient?.once("close", () => {
        clientDidClose = true;
        resolve();
      }),
    );

    const stopping = web.stop({ graceMs: 20 });
    let stopDidComplete = false;
    void stopping.then(() => {
      stopDidComplete = true;
    });
    expect(web.stop({ graceMs: 0 })).toBe(stopping);
    const completeShutdown = Promise.all([stopping, clientClosed]).then(() => {});
    const completedInTime = await settlesWithin(completeShutdown, 1_000);
    const observedCompletion = { clientDidClose, stopDidComplete };
    rawClient.destroy();
    await completeShutdown;

    expect({ completedInTime, ...observedCompletion }).toEqual({
      clientDidClose: true,
      completedInTime: true,
      stopDidComplete: true,
    });
    expect(rawClient.destroyed).toBe(true);
  });

  it("survives a malformed oRPC websocket frame without crashing the process", async () => {
    const webuiDir = path.join(sandbox, "webui");
    fs.mkdirSync(webuiDir, { recursive: true });
    fs.writeFileSync(path.join(webuiDir, "index.html"), "<!doctype html><title>Test</title>");
    const webToken = "malformed-frame-token";
    web = new WebServer({
      webToken,
      webuiDir,
      domain,
      status: () => ({
        active: true,
        pid: process.pid,
        version: "test",
        port: 0,
        startedAt: 0,
        tray: "headless",
      }),
    });
    const port = await web.start(0);
    rawClient = await openRawWebSocket(port, webToken);

    // 非 oRPC peer 形状的文本帧：1.14.6 的 standard-server-peer 反序列化直接抛错
    // （未捕获 → 进程退出）。守卫层必须吞掉并发起关闭（裸客户端不回 close 握手，
    // 观察关闭帧字节而非 TCP 断开）。
    const closeFrameSeen = new Promise<void>((resolve) => {
      rawClient?.on("data", (chunk: Buffer) => {
        if (chunk.length > 0 && (chunk[0]! & 0x0f) === 0x08) resolve();
      });
    });
    rawClient.write(
      encodeClientTextFrame(
        JSON.stringify({ jsonrpc: "2.0", id: 1, method: "agent.sessions.list" }),
      ),
    );
    expect(await settlesWithin(closeFrameSeen, 2_000)).toBe(true);

    // 进程存活证明：健康检查仍应答（无守卫时此路径以未捕获 rejection 终结进程）。
    const health = await fetch(`http://127.0.0.1:${port}/api/health`);
    expect(health.ok).toBe(true);
  });
});

function openRawWebSocket(port: number, token: string): Promise<net.Socket> {
  return new Promise<net.Socket>((resolve, reject) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const timeout = setTimeout(() => finish(new Error("WebSocket handshake timed out.")), 1_000);
    let response = "";

    const finish = (result: net.Socket | Error): void => {
      clearTimeout(timeout);
      socket.off("data", onData);
      socket.off("error", finish);
      if (result instanceof Error) {
        socket.destroy();
        reject(result);
      } else {
        socket.on("error", () => {});
        socket.resume();
        resolve(result);
      }
    };
    const onData = (chunk: Buffer): void => {
      response += chunk.toString("latin1");
      if (!response.includes("\r\n\r\n")) return;
      if (!response.startsWith("HTTP/1.1 101")) {
        finish(new Error(`Unexpected WebSocket response: ${response.split("\r\n")[0]}`));
        return;
      }
      finish(socket);
    };

    socket.on("data", onData);
    socket.on("error", finish);
    socket.on("connect", () => {
      const key = randomBytes(16).toString("base64");
      socket.write(
        `GET /ws/rpc?token=${encodeURIComponent(token)} HTTP/1.1\r\n` +
          `Host: 127.0.0.1:${port}\r\n` +
          "Connection: Upgrade\r\n" +
          "Upgrade: websocket\r\n" +
          "Sec-WebSocket-Version: 13\r\n" +
          `Sec-WebSocket-Key: ${key}\r\n\r\n`,
      );
    });
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

/** 构造带掩码的客户端 WebSocket 文本帧（RFC 6455：client→server 必须掩码）。 */
function encodeClientTextFrame(payload: string): Buffer {
  const mask = randomBytes(4);
  const data = Buffer.from(payload, "utf8");
  const masked = Buffer.from(data);
  for (let i = 0; i < masked.length; i += 1) {
    masked[i] = data[i]! ^ mask[i % 4]!;
  }
  return Buffer.concat([Buffer.from([0x81, 0x80 | data.length]), mask, masked]);
}
