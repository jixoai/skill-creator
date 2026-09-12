/**
 * 模型目录 contextWindow 透传单测（2026-09-12 PM 修复 1 / codex 提及）。
 *
 * 用户原始需求 [2026-09-12]（PM 审计）：「ContextMeter 分母是硬编码 128k 常量」
 * ——catalog 投影透传 pi-ai 目录的 contextWindow（zai 实测 204800），契约层
 * 增加可选字段，供 UI 按路由命中取真实分母。
 *
 * 正交意图：
 *   [1] 契约：ModelProviderCatalogEntrySchema.models[].contextWindow 为可选
 *       正整数；非法值拒绝。
 *   [2] 投影：pi-ai 目录数据里的 contextWindow 进入投影（zai glm-5.3 = 204800
 *       实测锚点）；缺省目录字段时省略（不伪造）。
 */
import { describe, expect, it } from "vitest";
import { ModelProviderCatalogEntrySchema } from "../src/shared/contracts/dsh-runtime.js";
import { listModelProviders } from "../src/daemon/model-catalog.js";

describe("ModelProviderCatalogEntrySchema contextWindow field (PM 修复 1)", () => {
  const baseEntry = {
    provider: "zai",
    label: "Z.ai",
    api: "openai-completions",
    baseURL: "https://api.z.ai/api/coding/paas/v4",
    icon: null,
    models: [{ id: "glm-5.3", image: true, contextWindow: 204800 }],
  };

  it("accepts a positive integer contextWindow", () => {
    const parsed = ModelProviderCatalogEntrySchema.safeParse(baseEntry);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.models[0]!.contextWindow).toBe(204800);
  });

  it("keeps contextWindow optional", () => {
    const parsed = ModelProviderCatalogEntrySchema.safeParse({
      ...baseEntry,
      models: [{ id: "glm-5.3", image: true }],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.models[0]!.contextWindow).toBeUndefined();
  });

  it("rejects non-positive and non-integer context windows", () => {
    for (const contextWindow of [0, -131072, 204800.5, "204800"]) {
      const parsed = ModelProviderCatalogEntrySchema.safeParse({
        ...baseEntry,
        models: [{ id: "glm-5.3", image: true, contextWindow }],
      });
      expect(parsed.success).toBe(false);
    }
  });
});

describe("catalog projection passes pi-ai contextWindow through (PM 修复 1)", () => {
  it("carries zai glm-5.3's catalog window (1,000,000 in the locked pi-ai data)", () => {
    // 注：任务简报的 204800 是 glm-4.7 的目录值；当前锁定包内 glm-5.3 为
    // 1000000（2026-09-12 直接读 dist/providers/data/zai.json 实证）。锚定
    // 真实目录数据而非简报数字。
    const zai = listModelProviders().find((entry) => entry.provider === "zai");
    expect(zai).toBeDefined();
    const model = zai!.models.find((entry) => entry.id === "glm-5.3");
    expect(model).toBeDefined();
    expect(model!.contextWindow).toBe(1_000_000);
  });

  it("only emits positive integers when present", () => {
    for (const entry of listModelProviders()) {
      for (const model of entry.models) {
        if (model.contextWindow !== undefined) {
          expect(Number.isInteger(model.contextWindow)).toBe(true);
          expect(model.contextWindow).toBeGreaterThan(0);
        }
      }
    }
  });
});
