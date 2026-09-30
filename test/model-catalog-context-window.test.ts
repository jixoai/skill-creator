/**
 * 模型目录 contextWindow/maxOutputTokens 透传单测（2026-09-12 PM 修复 1；
 * settings-panel-zcode-source 2026-09-25 换 zcode 源；agent-models-config-v1
 * 2026-09-30 标准化重锚——能力字段全量透传）。
 *
 * 用户原始需求 [2026-09-12]（PM 审计）：「ContextMeter 分母是硬编码 128k 常量」
 * ——catalog 投影透传目录数据的 contextWindow（zai-api GLM-5.3 = 1000000 锚点），
 * 契约层保留可选字段，供 UI 按路由命中取真实分母。
 *
 * 正交意图：
 *   [1] 契约：ModelProviderCatalogEntrySchema.models[].contextWindow /
 *       maxOutputTokens 为可选正整数；非法值拒绝。
 *   [2] 投影：标准生成物的 contextWindow / maxOutputTokens 进入投影；缺省目录
 *       字段时省略（不伪造）。
 * 妥协声明：无。
 */
import { describe, expect, it } from "vitest";
import { ModelProviderCatalogEntrySchema } from "../src/shared/contracts/dsh-runtime.js";
import { listModelProviders } from "../src/daemon/model-catalog.js";

describe("ModelProviderCatalogEntrySchema contextWindow field (PM 修复 1)", () => {
  const baseEntry = {
    provider: "zai-api",
    label: "Z.ai Coding Plan",
    api: "anthropic-messages",
    baseURL: "https://api.z.ai/api/anthropic",
    icon: null,
    models: [{ id: "GLM-5.3", image: true, contextWindow: 1000000 }],
  };

  it("accepts a positive integer contextWindow", () => {
    const parsed = ModelProviderCatalogEntrySchema.safeParse(baseEntry);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.models[0]!.contextWindow).toBe(1000000);
  });

  it("keeps contextWindow optional", () => {
    const parsed = ModelProviderCatalogEntrySchema.safeParse({
      ...baseEntry,
      models: [{ id: "GLM-5.3", image: true }],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.models[0]!.contextWindow).toBeUndefined();
  });

  it("rejects non-positive and non-integer context windows", () => {
    for (const contextWindow of [0, -131072, 204800.5, "204800"]) {
      const parsed = ModelProviderCatalogEntrySchema.safeParse({
        ...baseEntry,
        models: [{ id: "GLM-5.3", image: true, contextWindow }],
      });
      expect(parsed.success).toBe(false);
    }
  });
});

describe("catalog projection passes standard registry contextWindow through", () => {
  it("carries zai-api GLM-5.3's registry window (1,000,000 at upstream revision 30)", () => {
    const zai = listModelProviders().find((entry) => entry.provider === "zai-api");
    expect(zai).toBeDefined();
    const model = zai!.models.find((entry) => entry.id === "GLM-5.3");
    expect(model).toBeDefined();
    expect(model!.contextWindow).toBe(1_000_000);
  });

  it("only emits positive integers when present", () => {
    for (const entry of listModelProviders()) {
      for (const model of entry.models) {
        for (const field of [model.contextWindow, model.maxOutputTokens] as const) {
          if (field !== undefined) {
            expect(Number.isInteger(field)).toBe(true);
            expect(field).toBeGreaterThan(0);
          }
        }
      }
    }
  });
});

describe("catalog rich model fields (agent-models-config source)", () => {
  it("projects inputTypes / effortTiers / maxOutputTokens from the standard registry", () => {
    const zai = listModelProviders().find((entry) => entry.provider === "zai-api")!;
    const glm = zai.models.find((model) => model.id === "GLM-5.3")!;
    // rev 30 注册表实测：inputTypes text/image/video（anthropic 端点全量模态）；
    // efforts low/high/max（真实档位，无开关型档混入）；maxOutputTokens 128000。
    expect(glm.inputTypes).toEqual(["text", "image", "video"]);
    expect(glm.effortTiers).toEqual(expect.arrayContaining(["high", "max"]));
    expect(glm.maxOutputTokens).toBe(128_000);
  });

  it("keeps effortTiers free of switch values and deduplicated", () => {
    for (const entry of listModelProviders()) {
      for (const model of entry.models) {
        if (model.effortTiers !== undefined) {
          expect(model.effortTiers).not.toContain("disabled");
          expect(model.effortTiers).not.toContain("enabled");
          expect(new Set(model.effortTiers).size).toBe(model.effortTiers.length);
        }
      }
    }
  });
});
