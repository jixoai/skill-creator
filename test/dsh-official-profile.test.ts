/**
 * 官方 DSH web profile 完整启动测试（openspec dsh-webui-composition task 2.1 step 1）。
 *
 * User input [2026-09-06] (tasks 2.1): "复用 DSH 的 model/provider/profile、session
 * list/detail、stream transcript、permission 和 approval presentation。" —— session/
 * settings controller 的 peer 链（26 包）要求完整官方 profile（base + web-app）。
 *
 * Orthogonal intents:
 *   [1] 官方组合装载：dsh-app-boot profile 机制 + 官方 boot()（assertEntriesActivated
 *       保证全部 rows 激活，失败 typed 抛错）。
 *   [2] 完整浏览器 roster：boot graph 注入包含 settings/session UI 的 client 模块
 *       （dsh-client-ui-settings / ui-session / ui-chat），token 会话后 index 可取。
 *   [3] 恢复语义：dispose 后二次 profile boot 达 ready（干净 home 重新 initProfile）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  bootOfficialWebProfile,
  type OfficialWebProfileOptions,
} from "../src/daemon/steward/dsh-official-profile.js";
import type { MinimalDshWebHost } from "../src/daemon/steward/dsh-web-host.js";

let sandbox = "";
let host: MinimalDshWebHost | undefined;
const booted: MinimalDshWebHost[] = [];

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-official-profile-test-"));
});

afterEach(async () => {
  for (const instance of booted.splice(0)) {
    await instance.dispose().catch(() => undefined);
  }
  host = undefined;
  fs.rmSync(sandbox, { recursive: true, force: true });
});

function options(): OfficialWebProfileOptions {
  return { home: path.join(sandbox, "dsh-home") };
}

async function fetchIndexWithSession(target: MinimalDshWebHost): Promise<string> {
  const handshake = await fetch(target.record.authenticatedUrl, { redirect: "manual" });
  const cookie = handshake.headers.get("set-cookie")?.split(";")[0];
  expect(cookie).toBeTruthy();
  const index = await fetch(`http://${target.record.host}:${target.record.port}/`, {
    headers: { cookie: cookie! },
    redirect: "manual",
  });
  expect(index.status).toBe(200);
  return index.text();
}

describe("official dsh web profile (task 2.1 step 1)", () => {
  it(
    "boots the full base+web-app composition with every entry activated",
    { timeout: 120_000 },
    async () => {
      host = await bootOfficialWebProfile(options());
      booted.push(host);
      expect(host.record.host).toBe("127.0.0.1");
      expect(host.record.port).toBeGreaterThan(0);
      // boot() 内部 assertEntriesActivated 已保证：任何 row 未激活都会 reject。
      const unauth = await fetch(`http://${host.record.host}:${host.record.port}/`, {
        redirect: "manual",
      });
      expect(unauth.status).toBe(401);
    },
  );

  it(
    "injects the full browser roster including settings and session UI",
    { timeout: 120_000 },
    async () => {
      host = await bootOfficialWebProfile(options());
      booted.push(host);
      const html = await fetchIndexWithSession(host);
      expect(html).toContain("__DSH_BOOT__");
      // 完整 roster：settings/session/chat/approval 的 client 模块都在 boot graph。
      for (const rosterModule of [
        "@deepseek-ai/dsh-client-ui-settings",
        "@deepseek-ai/dsh-client-ui-session",
        "@deepseek-ai/dsh-client-ui-chat",
        "@deepseek-ai/dsh-client-ui-approval",
      ]) {
        expect(html).toContain(rosterModule);
      }
      const comboCount = (html.match(/dsh-client-/g) ?? []).length;
      expect(comboCount).toBeGreaterThan(50);
      // combo script 本身可取回（roster 插件工厂真实可服务）。
      const comboUrl = /(?:src|href)="(\/plugins\/[^"]+)"/.exec(html)?.[1];
      expect(comboUrl).toBeDefined();
      const combo = await fetch(
        `http://${host.record.host}:${host.record.port}${comboUrl!.replace(/&amp;/g, "&")}`,
        {
          headers: {
            cookie: (await fetch(host.record.authenticatedUrl, { redirect: "manual" })).headers
              .get("set-cookie")!
              .split(";")[0]!,
          },
        },
      );
      expect(combo.status).toBe(200);
    },
  );

  it(
    "recovers: a second clean-home profile boot reaches ready after dispose",
    { timeout: 240_000 },
    async () => {
      const first = await bootOfficialWebProfile(options());
      booted.push(first);
      const firstHtml = await fetchIndexWithSession(first);
      expect(firstHtml).toContain("__DSH_BOOT__");
      await first.dispose();
      const second = await bootOfficialWebProfile(options());
      booted.push(second);
      expect(second.record.port).toBeGreaterThan(0);
      const secondHtml = await fetchIndexWithSession(second);
      expect(secondHtml).toContain("__DSH_BOOT__");
    },
  );
});
