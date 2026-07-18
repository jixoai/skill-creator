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
import { PreferencesStore } from "../src/daemon/preferences-store.js";
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
      preferencesStore: new PreferencesStore(),
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
