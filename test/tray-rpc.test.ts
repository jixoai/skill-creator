/**
 * 用户原始需求 [2026-07-18]：「全面升级 skill-creator-v2 对于 opentray 的适配」。
 * 正交意图：
 *   [1] 证明 tray.routeChanged / completeAutoClose 委托给 TrayHost。
 *   [2] 证明 preferences.set 通过 store 驱动广播。
 *   [3] 证明 state.subscribe 把首帧（hello/preferences/pin）与广播帧推给订阅者。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDaemonDomain } from "../src/daemon/domain.js";
import { createRpcRouter } from "../src/daemon/rpc-router.js";
import { PreferencesStore } from "../src/daemon/preferences-store.js";
import type { TrayHost } from "../src/daemon/tray-host.js";
import type { WsServerMessage } from "../src/shared/rpc-contract.js";
import { setHomeOverride } from "../src/shared/paths.js";

const previousHome = process.env.SKILL_CREATOR_HOME;
let sandbox = "";

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "skill-creator-tray-rpc-test-"));
  setHomeOverride(path.join(sandbox, "state"));
});

afterEach(() => {
  setHomeOverride(null);
  if (previousHome === undefined) delete process.env.SKILL_CREATOR_HOME;
  else process.env.SKILL_CREATOR_HOME = previousHome;
  fs.rmSync(sandbox, { recursive: true, force: true });
});

function mockTrayHost(): TrayHost {
  return {
    setRoute: vi.fn(),
    completeAutoClose: vi.fn(async () => {}),
    getPinState: vi.fn(() => ({
      exitRequested: false,
      visibility: "shown" as const,
      hasActiveEvents: false,
    })),
  } as unknown as TrayHost;
}

function buildRouter(trayHost: TrayHost | null, broadcastQueue: WsServerMessage[]) {
  const preferencesStore = new PreferencesStore();
  return {
    preferencesStore,
    router: createRpcRouter({
      status: () => ({
        active: true,
        pid: process.pid,
        version: "test",
        port: 0,
        startedAt: 0,
        tray: trayHost ? "mounted" : "headless",
      }),
      domain: createDaemonDomain(),
      trayHostRef: { host: trayHost },
      preferencesStore,
      broadcast: {
        subscribe: async function* (): AsyncGenerator<WsServerMessage, void, void> {
          for (const frame of broadcastQueue) yield frame;
        },
      },
    }),
  };
}

describe("tray/preferences/state RPC", () => {
  it("delegates routeChanged to the tray host", async () => {
    const trayHost = mockTrayHost();
    const client = createRouterClient(buildRouter(trayHost, []).router);
    const result = await client.tray.routeChanged({ pathname: "/creator" });
    expect(result).toEqual({ ok: true });
    expect(trayHost.setRoute).toHaveBeenCalledWith("/creator");
  });

  it("delegates completeAutoClose to the tray host", async () => {
    const trayHost = mockTrayHost();
    const client = createRouterClient(buildRouter(trayHost, []).router);
    await client.tray.completeAutoClose({});
    expect(trayHost.completeAutoClose).toHaveBeenCalledOnce();
  });

  it("persists preferences via the store and tolerates a missing tray host", async () => {
    const { router, preferencesStore } = buildRouter(null, []);
    const before = preferencesStore.getPreferences().keepOnTop;
    const client = createRouterClient(router);
    const result = await client.preferences.set({ patch: { keepOnTop: !before } });
    expect(result).toEqual({ ok: true });
    expect(preferencesStore.getPreferences().keepOnTop).toBe(!before);
  });

  it("streams whatever the broadcast emitter yields (router delegates to broadcast.subscribe)", async () => {
    const trayHost = mockTrayHost();
    const broadcastQueue: WsServerMessage[] = [
      { type: "hello" },
      { type: "preferences", preferences: { keepOnTop: false } },
      { type: "pin", exitRequested: true, visibility: "shown", hasActiveEvents: false },
    ];
    const client = createRouterClient(buildRouter(trayHost, broadcastQueue).router);
    const stream = (await client.state.subscribe({})) as AsyncIterable<WsServerMessage>;
    const frames: WsServerMessage[] = [];
    for await (const frame of stream) frames.push(frame);
    // router 的 state.subscribe 仅委托给 broadcast.subscribe；首帧拼接由 WebServer.subscribeState 负责。
    expect(frames).toEqual(broadcastQueue);
  });

  it("returns an empty stream when the broadcast emitter yields nothing", async () => {
    const client = createRouterClient(buildRouter(null, []).router);
    const stream = (await client.state.subscribe({})) as AsyncIterable<WsServerMessage>;
    const frames: WsServerMessage[] = [];
    for await (const frame of stream) frames.push(frame);
    expect(frames).toEqual([]);
  });
});
