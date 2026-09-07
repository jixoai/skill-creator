/**
 * 生产 DSH 组合宿主生命周期测试（openspec dsh-webui-composition task 4.1）。
 *
 * 用户原始需求 [2026-09-07]（tasks 4.1）：「验证组合宿主启动/停止/重启；DSH 缺失/
 * 版本错误/插件失败」——daemon 默认入口切 DSH host，SPA 仅恢复夹具。
 *
 * 正交意图：
 *   [1] 启动挂载与同源分区：mountProductionDshHost 挂官方 profile；Manager
 *       /api/health 保留；DSH token 握手生效。
 *   [2] 降级恢复：boot 失败（home 不可写）→ mounted:false + reason + SPA 立即可达。
 *   [3] 有界停止：dispose 卸载挂载、关闭官方 server；SPA 回退生效；幂等。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDaemonDomain, type DaemonDomain } from "../src/daemon/domain.js";
import {
  mountProductionDshHost,
  type ProductionDshHost,
} from "../src/daemon/dsh-host-lifecycle.js";
import { WebServer } from "../src/daemon/web-server.js";
import { setHomeOverride } from "../src/shared/paths.js";
import { randomBytes } from "node:crypto";

let sandbox = "";
let domain: DaemonDomain;
let web: WebServer | null = null;
let host: ProductionDshHost | null = null;

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-host-lifecycle-"));
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
  fs.writeFileSync(path.join(webuiDir, "index.html"), "<!doctype html><title>Recovery</title>");
  const token = randomBytes(24).toString("base64url");
  const server = new WebServer({
    webToken: token,
    webuiDir,
    domain,
    status: () => ({
      active: true,
      pid: process.pid,
      version: "0.0.0-test",
      port: 0,
      startedAt: Date.now(),
      tray: "headless" as const,
    }),
  });
  return { web: server, token, port: -1 };
}

async function start(server: WebServer): Promise<number> {
  return server.start(0);
}

describe("production DSH composition host lifecycle (task 4.1)", () => {
  it(
    "boots, mounts same-origin, keeps Manager health, and degrades back on dispose",
    {
      timeout: 240_000,
    },
    async () => {
      const fixture = makeWeb();
      web = fixture.web;
      const port = await start(web);
      host = await mountProductionDshHost(web, { dshHome: path.join(sandbox, "dsh-home") });
      expect(host.mounted).toBe(true);
      expect(host.record!.port).toBeGreaterThan(0);
      expect(host.record!.authenticatedUrl).toContain("token=");
      // boot graph：真实 loader/entry-init 激活序（官方 rows + Manager client plugin）。
      expect(host.record!.entries.length).toBeGreaterThan(0);
      expect(host.record!.activationOrder.length).toBe(host.record!.entries.length);
      expect(host.record!.entries.map((entry) => entry.name)).toContain(
        "@skill-creator/dsh-client",
      );
      expect(host.profile).toBeDefined();

      // Manager 分区保留。
      const health = await fetch(`http://127.0.0.1:${port}/api/health`);
      expect(health.status).toBe(200);
      // DSH token 握手在同源生效（303 重定向 = 官方 connection 拿到 token）。
      const handshake = await fetch(
        `http://127.0.0.1:${port}/?token=${host.record!.authenticatedUrl.split("token=")[1]}`,
        {
          redirect: "manual",
        },
      );
      expect([303, 200]).toContain(handshake.status);

      // 有界停止：卸载 → SPA 恢复夹具立刻可达；dispose 幂等。
      await host.dispose();
      await host.dispose();
      const spa = await fetch(`http://127.0.0.1:${port}/`);
      expect(spa.status).toBe(200);
      const body = await spa.text();
      expect(body).toContain("Recovery");
    },
  );

  it(
    "degrades to the SPA recovery fixture when the DSH home is unusable",
    {
      timeout: 120_000,
    },
    async () => {
      const fixture = makeWeb();
      web = fixture.web;
      const port = await start(web);
      // home 是一个普通文件：storage 初始化必然失败 → boot 失败。
      const badHome = path.join(sandbox, "not-a-dir");
      fs.writeFileSync(badHome, "x", "utf8");
      host = await mountProductionDshHost(web, { dshHome: badHome });
      expect(host.mounted).toBe(false);
      expect(typeof host.reason).toBe("string");
      expect(host.reason!.length).toBeGreaterThan(0);
      // 降级不阻塞 daemon：SPA 立即可达。
      const spa = await fetch(`http://127.0.0.1:${port}/`);
      expect(spa.status).toBe(200);
      expect(await spa.text()).toContain("Recovery");
    },
  );

  it("skips mounting when disabled via env", async () => {
    const fixture = makeWeb();
    web = fixture.web;
    await start(web);
    process.env.SKILL_CREATOR_DSH_HOST = "off";
    host = await mountProductionDshHost(web, { dshHome: path.join(sandbox, "dsh-home") });
    expect(host.mounted).toBe(false);
    expect(host.reason).toContain("disabled by env");
  });
});
