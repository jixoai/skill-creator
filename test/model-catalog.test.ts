/**
 * 模型目录投影单测（settings-panel-zcode-source：数据源换 zcode Registry）。
 *
 * 用户原始需求 [2026-09-25]（Owner 裁决）：「不再依赖 models.dev……使用 shufa-server
 * 那套数据结构和 zcode 源更新脚本。」
 *
 * 正交意图：
 *   [1] 数据源真实性：目录来自 zcode-presets 生成物（provider = zcode templateId
 *       口径），重点 provider 在列且形状完整、重点置顶。
 *   [2] 投影法则：baseURL 非空、协议三值映射、image 与 inputTypes 一致、efforts
 *       剔开关型档、supportsReasoningEffort 不伪造、icon 回退序。
 */
import { describe, expect, it } from "vitest";
import {
  listModelProviders,
  projectPreset,
  resolveProviderIcon,
} from "../src/daemon/model-catalog.js";

describe("model provider catalog", () => {
  it("projects the zcode preset registry with complete shapes", () => {
    const providers = listModelProviders();
    expect(providers.length).toBeGreaterThanOrEqual(20);
    for (const entry of providers) {
      expect(entry.provider).toMatch(/^[a-z0-9-]+$/);
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.baseURL).toMatch(/^https?:\/\//);
      // api 三值枚举（ZCode 协议映射后的本仓口径）。
      expect(["anthropic-messages", "openai-completions", "openai-responses"]).toContain(entry.api);
      expect(entry.models.length).toBeGreaterThan(0);
      // icon：本仓 dataURL 或 models.dev 外链或 null（字母回退）。
      if (entry.icon !== null) {
        expect(entry.icon).toMatch(
          /^(data:image\/svg\+xml;base64,|https:\/\/models\.dev\/logos\/)/,
        );
      }
    }
  });

  it("covers the pinned providers from the zcode registry", () => {
    const ids = listModelProviders().map((entry) => entry.provider);
    for (const expected of [
      "zai-api",
      "zai-standard-api",
      "bigmodel-api",
      "bigmodel-standard-api",
      "moonshot-kimi",
      "minimax",
      "deepseek",
      "qwen-alibaba-model-studio-cn",
      "qwen-alibaba-model-studio-intl",
      "xiaomi-mimo",
      "openai",
      "anthropic",
      "xai",
    ]) {
      expect(ids).toContain(expected);
    }
  });

  it("pins known providers first in zcode templateId order", () => {
    const ids = listModelProviders().map((entry) => entry.provider);
    expect(ids[0]).toBe("zai-api");
    // 未置顶尾部按 provider 字母序（opencode-* 先于 openrouter）。
    const tail = ids.slice(13);
    expect([...tail].sort((a, b) => a.localeCompare(b))).toEqual(tail);
  });

  it("maps protocol names and brand labels from presets", () => {
    const providers = listModelProviders();
    // 协议映射：上游 openai-chat-completions → 本仓 openai-completions。
    expect(providers.find((p) => p.provider === "zai-api")?.api).toBe("anthropic-messages");
    expect(providers.find((p) => p.provider === "zai-standard-api")?.api).toBe(
      "openai-completions",
    );
    expect(providers.find((p) => p.provider === "openai")?.api).toBe("openai-responses");
    // label = 生成物品牌名（zh-CN 优先）。
    expect(providers.find((p) => p.provider === "qwen-alibaba-model-studio-cn")?.label).toBe(
      "阿里云百炼（中国）",
    );
  });

  it("passes contextWindow through and marks vision models from inputTypes", () => {
    const zai = listModelProviders().find((entry) => entry.provider === "zai-api");
    expect(zai).toBeDefined();
    const glm = zai!.models.find((model) => model.id === "GLM-5.3");
    expect(glm).toBeDefined();
    expect(glm!.contextWindow).toBe(1_000_000);
    expect(glm!.inputTypes).toEqual(["text", "image"]);
    expect(glm!.image).toBe(true);
    // 同名模型在 openai-completions 端点上无视觉声明（provider-site 规则差异）。
    const standard = listModelProviders().find((entry) => entry.provider === "zai-standard-api");
    const glmStandard = standard!.models.find((model) => model.id === "GLM-5.3");
    expect(glmStandard!.image).toBe(false);
  });

  it("strips switch-style effort tiers and keeps real ones", () => {
    const zai = listModelProviders().find((entry) => entry.provider === "zai-api")!;
    // GLM-5.3：真实档位 low/high/max 全保留。
    const glm = zai.models.find((model) => model.id === "GLM-5.3")!;
    expect(glm.effortTiers).toEqual(["low", "high", "max"]);
    expect(glm.supportsReasoningEffort).toBe(true);
    // GLM-5-Turbo：只有 disabled/enabled 开关档 → 声明了 effort 但无真实档位。
    const turbo = zai.models.find((model) => model.id === "GLM-5-Turbo")!;
    expect(turbo.effortTiers).toBeUndefined();
    expect(turbo.supportsReasoningEffort).toBe(false);
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

  it("falls back through PROVIDER_ICONS → preset iconUrl → null", () => {
    // 真实数据：zcode templateId 不在本仓 pi-ai 口径的 PROVIDER_ICONS 键里 → 外链。
    expect(listModelProviders().find((p) => p.provider === "zai-api")?.icon).toBe(
      "https://models.dev/logos/zai.svg",
    );
    // 单元级回退序（注入假 icons 表）。
    const icons = { "zai-api": "data:image/svg+xml;base64,AAA" };
    expect(resolveProviderIcon("zai-api", "https://x/l.svg", icons)).toBe(
      "data:image/svg+xml;base64,AAA",
    );
    expect(resolveProviderIcon("deepseek", "https://x/d.svg", icons)).toBe("https://x/d.svg");
    expect(resolveProviderIcon("nope", undefined, icons)).toBeNull();
  });

  it("projects synthetic presets without fabricating missing declarations", () => {
    // efforts 缺省 → supportsReasoningEffort/effortTiers 均不伪造；maxOutputTokens
    // 不投影（预设形状无此字段——契约 optional）。
    const entry = projectPreset({
      provider: "t-api",
      name: "",
      baseURL: "https://t.example.com/v1",
      api: "openai-completions",
      models: [{ id: "m1", inputTypes: ["text"] }],
    });
    expect(entry.label).toBe("t-api"); // 空品牌名回退 templateId
    const model = entry.models[0]!;
    expect(model.supportsReasoningEffort).toBeUndefined();
    expect(model.effortTiers).toBeUndefined();
    expect(model.maxOutputTokens).toBeUndefined();
    expect(model.image).toBe(false);
  });
});
