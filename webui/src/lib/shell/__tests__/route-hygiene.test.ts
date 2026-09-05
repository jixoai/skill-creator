/**
 * 用户原始需求 [2026-09-05]：「不完整、未知或非法身份必须在渲染前清理。」
 * 正交意图：[1] 验证非法 opaque ID / 非法 search / 未知 app 在渲染前产出重定向决策。
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { ErasedRouteContract } from "../contract.js";
import { appRegistry } from "../registry.js";
import { sanitizeShellLocation, SHELL_HOME_PATH } from "../route-hygiene.js";
import type { AppManifest } from "../types.js";

const wsIdSchema = z.enum(["~"]).or(z.string().regex(/^ws_[a-f0-9]{8,}$/));

function makeRoute(overrides: Partial<ErasedRouteContract> = {}): ErasedRouteContract {
  return {
    id: "test-route",
    pattern: "",
    component: () => Promise.resolve({ default: {} as never }),
    ...overrides,
  };
}

/** 构造与 workspaces App 同构的测试 App（home + :wsId/:providerId 实例）。 */
function registerTestApp(): void {
  const manifest: AppManifest = {
    id: "hygiene-test",
    name: "Hygiene Test",
    icon: {} as AppManifest["icon"],
    activities: [
      {
        pattern: "/hygiene-test",
        entry: true,
        root: makeRoute({ id: "hygiene-test.home", pattern: "" }),
      },
      {
        pattern: "/hygiene-test",
        root: makeRoute({
          id: "hygiene-test.provider",
          pattern: ":wsId/:providerId",
          params: z.object({ wsId: wsIdSchema, providerId: z.string().min(1) }),
          search: z.object({ view: z.enum(["list", "detail"]).optional() }),
        }),
      },
    ],
  };
  appRegistry.register(manifest);
}

registerTestApp();

describe("sanitizeShellLocation", () => {
  it("accepts the entry activity path", () => {
    expect(sanitizeShellLocation("/hygiene-test", "")).toEqual({ kind: "ok" });
  });

  it("accepts a valid provider identity", () => {
    expect(sanitizeShellLocation("/hygiene-test/ws_deadbeef/claude-code", "?view=list")).toEqual({
      kind: "ok",
    });
    expect(sanitizeShellLocation("/hygiene-test/%7E/claude-code", "")).toEqual({ kind: "ok" });
  });

  it("redirects an invalid opaque workspace id to the app entry before render", () => {
    const decision = sanitizeShellLocation("/hygiene-test/garbage-id/claude-code", "");
    expect(decision).toEqual({ kind: "redirect", path: "/hygiene-test" });
  });

  it("redirects invalid search params to the same pathname without search", () => {
    const decision = sanitizeShellLocation("/hygiene-test/ws_deadbeef/claude-code", "?view=bogus");
    expect(decision).toEqual({
      kind: "redirect",
      path: "/hygiene-test/ws_deadbeef/claude-code",
    });
  });

  it("redirects an unmatched activity path to the app entry", () => {
    expect(sanitizeShellLocation("/hygiene-test/only-one-segment", "")).toEqual({
      kind: "redirect",
      path: "/hygiene-test",
    });
  });

  it("redirects unknown apps to the global shell home", () => {
    expect(sanitizeShellLocation("/not-registered/ws_deadbeef/x", "")).toEqual({
      kind: "redirect",
      path: SHELL_HOME_PATH,
    });
    expect(sanitizeShellLocation("/", "")).toEqual({ kind: "redirect", path: SHELL_HOME_PATH });
  });
});
