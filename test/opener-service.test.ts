/**
 * 用户原始需求 [2026-10-05]（Owner）：「"Open repo" 用 OpenTray 的 ext-opener」。
 * 正交意图：
 *   [1] ext-opener 通道优先：attach 后 open 走 capability。
 *   [2] server-owned https 闸：非 https / 非绝对 URL typed 拒绝。
 *   [3] headless 降级：未 attach 时 spawn 系统打开（测试 seam 注入断言）。
 *   [4] opener typed 错误码 → DomainError 有限词表映射。
 * 妥协声明：无——纯逻辑 + 注入 stub。
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import { DomainError } from "../src/daemon/domain-error.js";
import { createOpenerService, type OpenerAttachFn } from "../src/daemon/opener-service.js";

const fakeTray = {} as Parameters<OpenerAttachFn>[0];
let opened: string[] = [];
let fallbackCalls: string[] = [];

beforeEach(() => {
  opened = [];
  fallbackCalls = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("opener-service（ext-opener 集成）", () => {
  it("routes open through the attached ext-opener capability", async () => {
    const attach: OpenerAttachFn = () => ({
      open: async (target) => {
        opened.push(target);
      },
    });
    const service = createOpenerService(attach);
    await service.attach(fakeTray);
    await service.openHttpsUrl("https://github.com/example/repo");
    assert.deepEqual(opened, ["https://github.com/example/repo"]);
    assert.deepEqual(fallbackCalls, []);
  });

  it("rejects non-https schemes and malformed URLs at the server boundary", async () => {
    const service = createOpenerService();
    await assert.rejects(
      service.openHttpsUrl("http://insecure.example"),
      (error: unknown) => error instanceof DomainError && error.code === "INVALID_OPERATION",
    );
    await assert.rejects(
      service.openHttpsUrl("not a url"),
      (error: unknown) => error instanceof DomainError && error.code === "INVALID_OPERATION",
    );
  });

  it("falls back to the platform spawn path when no tray is attached (headless)", async () => {
    const service = createOpenerService();
    service.__setFallbackForTests(async (url) => {
      fallbackCalls.push(url);
    });
    await service.openHttpsUrl("https://example.com/repo");
    assert.deepEqual(fallbackCalls, ["https://example.com/repo"]);
  });

  it("maps opener typed rejections to DomainError codes", async () => {
    const attach: OpenerAttachFn = () => ({
      open: async () => {
        throw Object.assign(new Error("blocked"), { code: "opener_scheme_blocked" });
      },
    });
    const service = createOpenerService(attach);
    await service.attach(fakeTray);
    await assert.rejects(
      service.openHttpsUrl("https://example.com"),
      (error: unknown) => error instanceof DomainError && error.code === "INVALID_OPERATION",
    );
  });
});
