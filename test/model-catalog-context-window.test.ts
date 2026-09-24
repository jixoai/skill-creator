/**
 * 模型目录 contextWindow 透传单测（2026-09-12 PM 修复 1 / codex 提及；
 * settings-panel-zcode-source 2026-09-25 换 zcode Registry 源后重锚）。
 *
 * 用户原始需求 [2026-09-12]（PM 审计）：「ContextMeter 分母是硬编码 128k 常量」
 * ——catalog 投影透传目录数据的 contextWindow（zai-api GLM-5.3 = 1000000 锚点），
 * 契约层保留可选字段，供 UI 按路由命中取真实分母。
 *
 * 正交意图：
 *   [1] 契约：ModelProviderCatalogEntrySchema.models[].contextWindow 为可选
 *       正整数；非法值拒绝。
 *   [2] 投影：zcode 预设生成物里的 contextWindow 进入投影；缺省目录字段时
 *       省略（不伪造）；maxOutputTokens 不投影（预设形状无此字段）。
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

describe("catalog projection passes zcode preset contextWindow through", () => {
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
        if (model.contextWindow !== undefined) {
          expect(Number.isInteger(model.contextWindow)).toBe(true);
          expect(model.contextWindow).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe("catalog rich model fields (zcode source)", () => {
  it("projects inputTypes / effortTiers from the zcode presets", () => {
    const zai = listModelProviders().find((entry) => entry.provider === "zai-api")!;
    const glm = zai.models.find((model) => model.id === "GLM-5.3")!;
    // zcode 注册表实测：inputTypes [text, image]（anthropic 端点视觉开）；
    // efforts low/high/max（真实档位，无开关型档混入）。
    expect(glm.inputTypes).toEqual(["text", "image"]);
    expect(glm.effortTiers).toEqual(expect.arrayContaining(["high", "max"]));
  });

  it("does not project maxOutputTokens (preset shape lacks the field)", () => {
    // shufa 对齐的 ModelPreset 不产 maxOutputTokens（规则引擎参与求值但不入产物）；
    // 契约字段保持 optional，全集必须为 undefined 而非伪造。
    for (const entry of listModelProviders()) {
      for (const model of entry.models) {
        expect(model.maxOutputTokens).toBeUndefined();
      }
    }
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
