/**
 * 模型目录投影单测（agent-models-config-v1：数据源 = 标准生成物）。
 *
 * 用户原始需求 [2026-09-30]：「将 zcode 标准作为 agent-models-config 配置标准。」
 *
 * 正交意图：
 *   [1] 数据源真实性：目录来自 agent-models.generated.ts（provider = 标准 id
 *       口径），重点 provider 在列且形状完整、重点置顶。
 *   [2] 投影法则：协议名单点映射、inputTypes 由标准 input 旗标派生、effort
 *       档剔 toggle、能力字段透传不伪造、enabled:false 与 account 型过滤、
 *       icon 回退序、sourceRevision 出口。
 * 妥协声明：无。
 */
import { describe, expect, it } from "vitest";
import {
  createModelCatalogService,
  listModelProviders,
  projectProvider,
  resolveProviderIcon,
} from "../src/daemon/model-catalog.js";
import type { AgentModelProviderEntry } from "../src/shared/contracts/agent-models.js";

describe("model provider catalog", () => {
  it("projects the agent-models-config registry with complete shapes", () => {
    const providers = listModelProviders();
    expect(providers.length).toBeGreaterThanOrEqual(20);
    for (const entry of providers) {
      expect(entry.provider).toMatch(/^[a-z0-9:-]+$/);
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.baseURL).toMatch(/^https?:\/\//);
      // api 三值枚举（标准协议名映射后的本仓口径）。
      expect(["anthropic-messages", "openai-completions", "openai-responses"]).toContain(entry.api);
      expect(entry.models.length).toBeGreaterThan(0);
      // icon：本仓 dataURL 或 models.dev 外链或 null（字母回退）。
      if (entry.icon !== null) {
        expect(entry.icon).toMatch(
          /^(data:image\/svg\+xml;base64,|https:\/\/models\.dev\/logos\/)/,
        );
      }
      for (const model of entry.models) {
        expect(model.inputTypes.length).toBeGreaterThan(0);
        expect(new Set(model.inputTypes).size).toBe(model.inputTypes.length);
      }
    }
  });

  it("covers the pinned providers and pins them first", () => {
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
    expect(ids[0]).toBe("zai-api");
    // 未置顶尾部按 provider 字母序（opencode-* 先于 openrouter）。
    const tail = ids.slice(13);
    expect([...tail].sort((a, b) => a.localeCompare(b))).toEqual(tail);
  });

  it("filters account-type providers and disabled models (product apiKey surface)", () => {
    const ids = listModelProviders().map((entry) => entry.provider);
    expect(ids.some((id) => id.startsWith("account:"))).toBe(false);
    // 生成物中 enabled:false 的 GLM-5-Turbo 不进产品目录。
    const zai = listModelProviders().find((entry) => entry.provider === "zai-api")!;
    expect(zai.models.find((model) => model.id === "GLM-5-Turbo")).toBeUndefined();
  });

  it("maps protocol names and brand labels from the standard registry", () => {
    const providers = listModelProviders();
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

  it("projects full runtime capabilities with per-provider divergence", () => {
    const zai = listModelProviders().find((entry) => entry.provider === "zai-api")!;
    const glm = zai.models.find((model) => model.id === "GLM-5.3")!;
    expect(glm.contextWindow).toBe(1_000_000);
    // 标准 input 旗标全量派生（zai-api 线声明 text/image/video）。
    expect(glm.inputTypes).toEqual(["text", "image", "video"]);
    expect(glm.image).toBe(true);
    expect(glm.maxOutputTokens).toBe(128_000);
    expect(glm.effortTiers).toEqual(["low", "high", "max"]);
    expect(glm.supportsReasoningEffort).toBe(true);
    expect(glm.supportsToolCall).toBe(true);
    expect(glm.supportsJsonSchemaOutput).toBe(false);
    // 同一模型在 openai 端点上：无视觉、无 web 档位变化——能力分化透传。
    const standard = listModelProviders().find((entry) => entry.provider === "zai-standard-api")!;
    const glmStandard = standard.models.find((model) => model.id === "GLM-5.3")!;
    expect(glmStandard.image).toBe(false);
    expect(glmStandard.inputTypes).toEqual(["text"]);
    expect(glmStandard.maxOutputTokens).toBe(128_000);
  });

  it("never fabricates undeclared capabilities", () => {
    for (const entry of listModelProviders()) {
      for (const model of entry.models) {
        if (model.effortTiers !== undefined) {
          expect(model.effortTiers).not.toContain("disabled");
          expect(model.effortTiers).not.toContain("enabled");
          expect(new Set(model.effortTiers).size).toBe(model.effortTiers.length);
        }
        if (model.supportsReasoningEffort === undefined) {
          expect(model.effortTiers).toBeUndefined();
        }
      }
    }
  });

  it("falls back through PROVIDER_ICONS → logoUrl → null", () => {
    // 真实数据：刷新脚本按生成物 logoUrl slug 抓取——provider 全量命中仓内
    // dataURL，图标面运行时零网络。
    for (const entry of listModelProviders()) {
      expect(entry.icon).toMatch(/^data:image\/svg\+xml;base64,/);
    }
    // 单元级回退序（注入假 icons 表）。
    const icons = { "zai-api": "data:image/svg+xml;base64,AAA" };
    expect(resolveProviderIcon("zai-api", "https://x/l.svg", icons)).toBe(
      "data:image/svg+xml;base64,AAA",
    );
    expect(resolveProviderIcon("deepseek", "https://x/d.svg", icons)).toBe("https://x/d.svg");
    expect(resolveProviderIcon("nope", undefined, icons)).toBeNull();
  });

  it("projects synthetic standard entries without fabrication", () => {
    const provider: AgentModelProviderEntry = {
      id: "t-api",
      access: { type: "api-key" },
      api: { protocol: "openai-chat-completions", baseUrl: "https://t.example.com/v1" },
      models: [
        {
          id: "m1",
          // 无 properties/options 声明 → 不伪造任何能力。
        },
        { id: "m-off", enabled: false },
      ],
    };
    const entry = projectProvider(provider);
    expect(entry).not.toBeNull();
    expect(entry!.label).toBe("t-api");
    expect(entry!.api).toBe("openai-completions");
    expect(entry!.models).toEqual([{ id: "m1", image: false, inputTypes: ["text"] }]);
    // account 型与不可路由协议 → null。
    expect(
      projectProvider({
        ...provider,
        access: { type: "account", vendor: "zai", plan: "off-peak" },
      }),
    ).toBeNull();
    expect(
      projectProvider({ ...provider, api: { ...provider.api, protocol: "future-protocol" } }),
    ).toBeNull();
  });

  it("exposes sourceRevision from the generated envelope", () => {
    const service = createModelCatalogService();
    expect(service.sourceRevision()).toBeGreaterThan(0);
    expect(service.list()).toEqual(listModelProviders());
  });
});
