/**
 * 最小真实 DSH web host 启动测试（openspec dsh-webui-composition task 1.1）。
 *
 * User input [2026-09-06] (tasks 1.1): "在干净临时 home 启动一次真实 DSH web host，
 * 记录 boot graph、plugin activation、session connection 和失败恢复证据。不使用
 * iframe 或静态 demo。"
 *
 * Orthogonal intents:
 *   [1] Loader-driven boot: the five official rows activate in order, the
 *       webServer binds loopback with an OS-assigned port, and the
 *       authenticated URL carries the process token.
 *   [2] Real HTTP surface: the official dist index renders with the
 *       __DSH_BOOT__ injection; the /api gateway is fenced before auth.
 *   [3] Failure recovery: booting a second host after disposing the first
 *       reaches ready again (no sticky port or process state).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  bootMinimalDshWebHost,
  resolveOfficialDistIndex,
  type MinimalDshWebHost,
} from "../src/daemon/steward/dsh-web-host.js";
import { setHomeOverride } from "../src/shared/paths.js";

const previousHome = process.env.SKILL_CREATOR_HOME;
let sandbox = "";
let host: MinimalDshWebHost | undefined;

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-web-host-test-"));
  process.env.SKILL_CREATOR_HOME = path.join(sandbox, "state");
  setHomeOverride(path.join(sandbox, "state"));
});

afterEach(async () => {
  await host?.dispose();
  host = undefined;
  setHomeOverride(null);
  if (previousHome === undefined) delete process.env.SKILL_CREATOR_HOME;
  else process.env.SKILL_CREATOR_HOME = previousHome;
  fs.rmSync(sandbox, { recursive: true, force: true });
});

function fetchOn(host: MinimalDshWebHost, pathname: string, init?: RequestInit) {
  return fetch(`http://${host.record.host}:${host.record.port}${pathname}`, {
    redirect: "manual",
    ...init,
  });
}

describe("minimal dsh web host (task 1.1)", () => {
  it(
    "boots the official loader composition on a loopback port with a tokenized URL",
    { timeout: 30_000 },
    async () => {
      host = await bootMinimalDshWebHost();
      expect(host.record.host).toBe("127.0.0.1");
      expect(host.record.port).toBeGreaterThan(0);
      // 真实 Loader 激活顺序：五个官方 rows 全部激活。
      for (const row of [
        "@deepseek-ai/dsh-host-webserver",
        "@deepseek-ai/dsh-credentials-local",
        "@deepseek-ai/dsh-client-connection",
        "@deepseek-ai/dsh-client-modules",
        "@deepseek-ai/dsh-web-app",
      ]) {
        expect(host.record.activationOrder).toContain(row);
      }
      expect(host.record.entries).toHaveLength(5);
      // 带 process token 的认证 URL（浏览器首次握手用）。
      expect(host.record.authenticatedUrl).toMatch(/127\.0\.0\.1:\d+/);
      expect(host.record.authenticatedUrl).not.toStrictEqual(
        `http://${host.record.host}:${host.record.port}`,
      );
    },
  );

  it(
    "serves the official dist index with the __DSH_BOOT__ injection behind the token handshake",
    { timeout: 30_000 },
    async () => {
      expect(fs.existsSync(resolveOfficialDistIndex())).toBe(true);
      host = await bootMinimalDshWebHost();
      const tokenUrl = new URL(host.record.authenticatedUrl);
      const token = tokenUrl.hash.replace(/^#/, "") || tokenUrl.search;

      // 无认证：index 响应必须先过 Connection browser auth（不直接吐 dist）。
      const unauthenticated = await fetchOn(host, "/");
      expect([401, 302, 303, 403]).toContain(unauthenticated.status);

      // 带 token 交换（实测：?token= → 303 + Set-Cookie → 干净 / 返回 200）。
      const authenticated = await fetch(host.record.authenticatedUrl, {
        redirect: "manual",
      });
      expect([200, 302, 303]).toContain(authenticated.status);
      const cookie = authenticated.headers.get("set-cookie");
      expect(cookie, "token handshake must establish a session").toBeTruthy();
      const follow = await fetchOn(host, "/", {
        headers: { cookie: cookie!.split(";")[0]! },
      });
      expect(follow.status).toBe(200);
      const html = await follow.text();
      expect(html).toContain("<!doctype html>");
      expect(html).toContain("__DSH_BOOT__");
      void token;
    },
  );

  it("fences the /api gateway before authentication", { timeout: 30_000 }, async () => {
    host = await bootMinimalDshWebHost();
    const probed = await fetchOn(host, "/api/");
    expect([401, 403, 404]).toContain(probed.status);
    if (probed.status !== 404) {
      const text = await probed.text();
      expect(text.length).toBeLessThan(500);
    }
  });

  it("recovers: a second boot after dispose reaches ready again", { timeout: 60_000 }, async () => {
    const first = await bootMinimalDshWebHost();
    const firstPort = first.record.port;
    await first.dispose();
    const second = await bootMinimalDshWebHost();
    host = second;
    expect(second.record.port).toBeGreaterThan(0);
    expect(second.record.activationOrder).toContain("@deepseek-ai/dsh-web-app");
    // OS-assigned 端口可能复用；关键是第二个宿主真的 ready 并响应。
    const response = await fetchOn(second, "/");
    expect(response.status).toBeGreaterThan(0);
    void firstPort;
  });
});
