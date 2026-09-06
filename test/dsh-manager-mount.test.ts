/**
 * 同源挂载组合测试（openspec dsh-webui-composition task 3.1a step 1）。
 *
 * User input [2026-09-06] (tasks 3.1a / integration-contract Transport Gate):
 * "一个 loopback origin 下保留 Manager /ws/rpc，DSH remote 使用官方 API route；
 * 当前 daemon static fallback 必须在 API/plugin routes 之后。"
 *
 * Orthogonal intents:
 *   [1] 路由分区：Manager 保留 /api/health 与 /ws/rpc、/ws/acp/*；DSH 挂载后其
 *       官方 route（index + /api/* fence）在同源优先生效。
 *   [2] token 握手经代理可达：/?token= → 303 + Set-Cookie → 带 cookie index 200
 *       且注入 __DSH_BOOT__。
 *   [3] 恢复入口：卸载 DSH 后 SPA 静态回退恢复（DSH 不可用时的 Manager-only 面）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDaemonDomain, type DaemonDomain } from "../src/daemon/domain.js";
import { bootOfficialWebProfile } from "../src/daemon/steward/dsh-official-profile.js";
import type { MinimalDshWebHost } from "../src/daemon/steward/dsh-web-host.js";
import { WebServer } from "../src/daemon/web-server.js";
import { setHomeOverride } from "../src/shared/paths.js";

let sandbox = "";
let domain: DaemonDomain;
let web: WebServer | null = null;
let dshHost: MinimalDshWebHost | null = null;

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-manager-mount-"));
  const isolatedHome = path.join(sandbox, "state");
  process.env.SKILL_CREATOR_HOME = isolatedHome;
  setHomeOverride(isolatedHome);
  domain = createDaemonDomain();
});

afterEach(async () => {
  await web?.stop({ graceMs: 0 });
  web = null;
  if (dshHost) {
    await dshHost.dispose().catch(() => undefined);
    dshHost = null;
  }
  await domain.repository.dispose();
  await domain.steward.dispose();
  setHomeOverride(null);
  fs.rmSync(sandbox, { recursive: true, force: true });
});

describe("same-origin DSH mount (task 3.1a step 1)", () => {
  it("partitions Manager and DSH routes on one loopback origin", { timeout: 240_000 }, async () => {
    const webuiDir = path.join(sandbox, "webui");
    fs.mkdirSync(webuiDir, { recursive: true });
    fs.writeFileSync(path.join(webuiDir, "index.html"), "<!doctype html><title>Recovery</title>");
    fs.writeFileSync(path.join(webuiDir, "dsh-island.js"), "// skill-creator-dsh-island");
    web = new WebServer({
      webToken: "mount-test-token",
      webuiDir,
      domain,
      status: () => ({
        active: true,
        pid: process.pid,
        port: 0,
        tray: "headless",
      }),
    });
    const port = await web.start(0);

    // DSH host 未挂载：SPA 静态回退是唯一入口。
    const before = await fetch(`http://127.0.0.1:${port}/`);
    expect(before.status).toBe(200);
    expect(await before.text()).toContain("Recovery");

    dshHost = await bootOfficialWebProfile({ home: path.join(sandbox, "dsh-home") });
    web.mountDsh({
      host: dshHost.record.host,
      port: dshHost.record.port,
      server: dshHost.server(),
    });

    // Manager 端点保留：健康检查与 DSH 无关。
    const health = await fetch(`http://127.0.0.1:${port}/api/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ ok: true });

    // Manager 保留资产前缀：/manager/* 从静态目录服务（island bundle 通道）。
    const islandAsset = await fetch(`http://127.0.0.1:${port}/manager/dsh-island.js`);
    expect(islandAsset.status).toBe(200);
    expect(await islandAsset.text()).toContain("skill-creator-dsh-island");

    // DSH 官方 route 经同源代理生效：index fence 401（未带 token）。
    const unauth = await fetch(`http://127.0.0.1:${port}/`, { redirect: "manual" });
    expect(unauth.status).toBe(401);
    // DSH API fence 同样经代理生效。
    const unauthApi = await fetch(`http://127.0.0.1:${port}/api/session/list`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(unauthApi.status).toBe(401);

    // token 握手（通过代理重定向回同源根路径）→ cookie → index 注入 boot graph。
    const handshakeUrl = `http://127.0.0.1:${port}/?token=${extractToken(dshHost.record.authenticatedUrl)}`;
    const handshake = await fetch(handshakeUrl, { redirect: "manual" });
    expect(handshake.status).toBe(303);
    const cookie = handshake.headers.get("set-cookie")?.split(";")[0];
    expect(cookie).toBeTruthy();
    const index = await fetch(`http://127.0.0.1:${port}/`, {
      headers: { cookie: cookie! },
      redirect: "manual",
    });
    expect(index.status).toBe(200);
    const html = await index.text();
    expect(html).toContain("__DSH_BOOT__");

    // 卸载 DSH：SPA 静态回退恢复（Manager-only 恢复入口）。
    await dshHost.dispose();
    dshHost = null;
    web.mountDsh(null);
    const recovery = await fetch(`http://127.0.0.1:${port}/`);
    expect(recovery.status).toBe(200);
    expect(await recovery.text()).toContain("Recovery");
  });
});

/** 从 authenticatedUrl 中取 token query（不经代理直连 DSH host 的原始 URL）。 */
function extractToken(authenticatedUrl: string): string {
  const url = new URL(authenticatedUrl);
  return url.searchParams.get("token") ?? "";
}
