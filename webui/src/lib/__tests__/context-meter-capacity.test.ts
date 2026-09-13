/**
 * ContextMeter 真实分母派生单测（2026-09-12 PM 修复 1）。
 *
 * 用户原始需求 [2026-09-12]（PM 审计）：「ContextMeter（14px SVG 环：
 * lastUsage.inputTokens / contextWindow）的分母不能永远是 128k 常量」——
 * 从 agentRuntimeConfig.view 的 settings.model → modelRoutes 按 provider/model
 * 命中 contextWindow；不命中回退 131072 并在容量行标注 assumed 128k。
 *
 * 正交意图：
 *   [1] 命中：provider+model 双匹配返回路由声明的 contextWindow。
 *   [2] 回退：view 缺失 / provider 不在路由 / model 不在路由 / 路由模型无
 *       contextWindow → null（调用方回退假值并标注）。
 */
import { describe, expect, it, vi } from "vitest";

// ContextMeter 实例脚本 import 的 agent store 经 connection → rpc-client →
// sveltekit 虚拟模块 $app/navigation；被测 helper 在 module 侧且只读 view 形状，
// 以 connection 替身隔断（agent-panel.test.ts 同法）。
vi.mock("../stores/connection.svelte", () => ({
  getConnectionGeneration: () => 0,
  getRpc: () => null,
  requireRpc: () => {
    throw new Error("not connected");
  },
}));

import type { DshStewardSettingsView } from "$shared/contracts/dsh-runtime.js";
import { contextWindowOfView } from "../components/agent/ContextMeter.svelte";

function view(overrides?: Partial<DshStewardSettingsView["settings"]>): DshStewardSettingsView {
  return {
    settings: {
      configVersion: 1,
      revision: 0,
      model: { provider: "zai", model: "glm-5.3" },
      preset: "live",
      permissions: { approvalPolicy: "ask" },
      session: { streamRetention: 200, streamProjection: "enabled", sessionCleanupDays: 30 },
      defaultMode: "free",
      modelRoutes: [
        {
          provider: "zai",
          baseURL: "https://api.z.ai/api/coding/paas/v4",
          models: [
            { id: "glm-5.3", contextWindow: 204800 },
            { id: "glm-5.3-flash" }, // 路由模型未声明窗口。
          ],
        },
      ],
      ...overrides,
    },
    providers: [],
  };
}

describe("contextWindowOfView (PM 修复 1)", () => {
  it("resolves the window when provider and model both match a route", () => {
    expect(contextWindowOfView(view())).toBe(204800);
  });

  it("returns null when the view is missing", () => {
    expect(contextWindowOfView(null)).toBeNull();
  });

  it("returns null when the provider has no route (dangling model)", () => {
    expect(contextWindowOfView(view({ model: { provider: "nope", model: "x" } }))).toBeNull();
    expect(contextWindowOfView(view({ modelRoutes: [] }))).toBeNull();
  });

  it("returns null when the model id misses or the route omits contextWindow", () => {
    expect(
      contextWindowOfView(view({ model: { provider: "zai", model: "unknown-model" } })),
    ).toBeNull();
    // glm-5.3-flash 在路由内但未声明窗口：不得伪造，返回 null 由 UI 回退标注。
    expect(
      contextWindowOfView(view({ model: { provider: "zai", model: "glm-5.3-flash" } })),
    ).toBeNull();
  });
});
