/**
 * 生产 DSH 内核宿主生命周期测试（dsh-kernel-rebase task 2.1；原 web 组合宿主
 * 断言改写为 headless 内核等价）。
 *
 * 用户原始需求 [2026-09-08]：「我需要的是 DSH 的内核。」
 *
 * 正交意图：
 *   [1] 内核挂载：mountDshKernelHost boot headless 内核（无 HTTP 面挂载）；
 *       Manager /api/health 与 SPA 不受影响。
 *   [2] 降级恢复：boot 失败（home 不可写）→ mounted:false + reason，daemon
 *       Manager 面照常服务。
 *   [3] 有界停止：dispose 关闭 fiber；幂等。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDaemonDomain, type DaemonDomain } from "../src/daemon/domain.js";
import {
  mountDshKernelHost,
  type ProductionDshKernelHost,
} from "../src/daemon/dsh-host-lifecycle.js";
import { WebServer } from "../src/daemon/web-server.js";
import { setHomeOverride } from "../src/shared/paths.js";
import { randomBytes } from "node:crypto";

let sandbox = "";
let domain: DaemonDomain;
let web: WebServer | null = null;
let host: ProductionDshKernelHost | null = null;

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-kernel-host-"));
  const isolatedHome = path.join(sandbox, "state");
  process.env.SKILL_CREATOR_HOME = isolatedHome;
  setHomeOverride(isolatedHome);
  domain = createDaemonDomain();
});

afterEach(async () => {
  await host?.dispose().catch(() => undefined);
  host = null;
  await web?.stop({ graceMs: 0 });
  web = null;
  await domain.repository.dispose();
  await domain.steward.dispose();
  delete process.env.SKILL_CREATOR_DSH_HOST;
  setHomeOverride(null);
  fs.rmSync(sandbox, { recursive: true, force: true });
});

function makeWeb(): { web: WebServer; token: string; port: number } {
  const webuiDir = path.join(sandbox, "webui");
  fs.mkdirSync(webuiDir, { recursive: true });
  fs.writeFileSync(path.join(webuiDir, "index.html"), "<!doctype html><title>Manager</title>");
  const token = randomBytes(24).toString("base64url");
  const server = new WebServer({
    webToken: token,
    webuiDir,
    domain,
    status: () => ({
      active: true,
      pid: process.pid,
      version: "test",
      port: 0,
      startedAt: Date.now(),
      tray: "headless",
    }),
  });
  return { web: server, token, port: -1 };
}

describe("production DSH kernel host lifecycle (task 2.1)", () => {
  it(
    "mounts the headless kernel without touching the manager HTTP face",
    { timeout: 240_000 },
    async () => {
      const ctx = makeWeb();
      const port = await ctx.web.start(0);
      web = ctx.web;
      host = await mountDshKernelHost({ dshHome: path.join(sandbox, "dsh-home") });
      expect(host.mounted).toBe(true);
      expect(host.record!.entries.length).toBeGreaterThan(40);
      expect(host.kernel).toBeDefined();
      // Manager 面照常：SPA 直接 200（无 DSH 入口握手/同源代理）。
      const spa = await fetch(`http://127.0.0.1:${port}/`);
      expect(spa.status).toBe(200);
      expect(await spa.text()).toContain("Manager");
      const health = await fetch(`http://127.0.0.1:${port}/api/health`);
      expect(health.status).toBe(200);
    },
  );

  it(
    "degrades to mounted:false with a typed reason when the kernel home is unusable",
    { timeout: 240_000 },
    async () => {
      const ctx = makeWeb();
      const port = await ctx.web.start(0);
      web = ctx.web;
      const unusable = path.join(sandbox, "not-a-dir");
      fs.writeFileSync(unusable, "x", "utf8");
      host = await mountDshKernelHost({ dshHome: unusable });
      expect(host.mounted).toBe(false);
      expect(host.reason).toBeTruthy();
      // Manager 面不依赖内核：SPA/health 照常。
      const spa = await fetch(`http://127.0.0.1:${port}/`);
      expect(spa.status).toBe(200);
      const health = await fetch(`http://127.0.0.1:${port}/api/health`);
      expect(health.status).toBe(200);
    },
  );

  it("skips mounting when disabled via env", async () => {
    process.env.SKILL_CREATOR_DSH_HOST = "off";
    host = await mountDshKernelHost({ dshHome: path.join(sandbox, "dsh-home") });
    expect(host.mounted).toBe(false);
    expect(host.reason).toBe("disabled by env");
  });

  it(
    "dispose is bounded and idempotent (manager face survives kernel teardown)",
    { timeout: 240_000 },
    async () => {
      const ctx = makeWeb();
      const port = await ctx.web.start(0);
      web = ctx.web;
      host = await mountDshKernelHost({ dshHome: path.join(sandbox, "dsh-home") });
      expect(host.mounted).toBe(true);
      await host.dispose();
      await host.dispose();
      const health = await fetch(`http://127.0.0.1:${port}/api/health`);
      expect(health.status).toBe(200);
    },
  );
});
