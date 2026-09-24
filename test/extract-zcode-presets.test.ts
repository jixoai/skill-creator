/**
 * ZCode Registry 预设提取脚本单测（settings-panel-zcode-source task 1.1）。
 *
 * 用户原始需求 [2026-09-25]（Owner 裁决）：「参考 shufa-server……使用它那套数据
 * 结构和 zcode 源更新脚本。」
 *
 * 正交意图：
 *   [1] 规则引擎语义（fixture 驱动纯逻辑）：有序叠加（undefined 继承/其余替换）、
 *       四类规则的匹配门（model 大小写不敏感 / model-api 协议门 / provider-site
 *       规范化 baseUrl 门 / template-model 精确覆盖）、URL 规范化。
 *   [2] 提取投影：zh-CN 品牌名优先、协议三值映射、iconUrl slug 表、模型清单
 *       去重保序、efforts null 清空、失败面（缺 baseUrl/协议不可映射/空清单/
 *       结构不符）抛错。
 *   [3] 生成物快照：真实 zcode-presets.ts 非空 + 头部 revision 行存在（重跑换新
 *       不受具体数字束缚）。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  API_NAME_MAP,
  LOGO_SLUGS,
  extract,
  matches,
  normalizeBaseUrl,
  overlayValue,
  resolveModelLeaves,
} from "../scripts/extract-zcode-presets.sh.js";

/** 最小可用 release fixture（两模板 + 四类规则各一条，覆盖叠加与门控路径）。 */
function releaseFixture(): unknown {
  return {
    revision: 7,
    config: {
      providerConfigRules: {
        templateRules: [
          {
            templateId: "t-cn",
            templateNameMap: { "zh-CN": "中文名", "en-US": "EN Name" },
            config: {
              api: { type: "openai-chat-completions", baseUrl: "https://api.t.cn/v1/" },
              builtinModelIds: ["m1", "m2"],
            },
          },
          {
            templateId: "deepseek",
            templateNameMap: { "en-US": "DeepSeek Fixture" },
            config: {
              api: { type: "anthropic-messages", baseUrl: "https://api.t.org" },
              builtinModelIds: ["a1"],
            },
          },
        ],
      },
      modelConfigRules: {
        modelRules: [
          { modelMatch: "m.*", config: { properties: { contextWindow: 1000 } } },
          // 大小写不敏感命中同一模型，后到覆盖。
          { modelMatch: "M1", config: { properties: { contextWindow: 2000 } } },
        ],
        modelApiRules: [
          {
            modelMatch: "m1",
            apiTypeMatch: "openai-chat-completions",
            config: { properties: { inputFormat: { supportsImage: true } } },
          },
          // 协议门不命中（模板 api 是 openai-chat-completions）。
          {
            modelMatch: "m1",
            apiTypeMatch: "anthropic-messages",
            config: { properties: { contextWindow: 999999 } },
          },
        ],
        providerSiteRules: [
          {
            modelMatch: "m2",
            apiTypeMatch: "openai-chat-completions",
            // baseUrl 尾斜杠规范化后命中。
            baseUrlMatch: "https://api\\.t\\.cn/v1",
            config: { optionSpecs: { reasoningLevel: { values: ["low", "max"] } } },
          },
          {
            modelMatch: "a1",
            apiTypeMatch: "anthropic-messages",
            baseUrlMatch: "https://other\\.example\\.com",
            config: { properties: { contextWindow: 888888 } },
          },
        ],
        templateModelRules: [
          {
            templateId: "t-cn",
            modelId: "m1",
            // 模板精确规则最后叠加：contextWindow 覆盖 + reasoningLevel null 清空。
            config: {
              properties: { contextWindow: 3000 },
              optionSpecs: { reasoningLevel: { values: null } },
            },
          },
          // 增量模型（不在 builtin 清单）追加；无叶子声明。
          { templateId: "t-cn", modelId: "m3", config: { enabled: true } },
        ],
      },
    },
  };
}

describe("overlay semantics", () => {
  it("inherits on undefined and replaces otherwise (null clears)", () => {
    expect(overlayValue(5, undefined)).toBe(5);
    expect(overlayValue(5, 7)).toBe(7);
    expect(overlayValue([1], null)).toBeNull();
  });

  it("anchors regex patterns to the full string", () => {
    expect(matches("m.1", "mx1")).toBe(true);
    expect(matches("m.1", "mx12")).toBe(false);
    expect(matches("M1", "m1", true)).toBe(true);
    expect(matches("M1", "m1")).toBe(false);
    expect(matches("[invalid", "x")).toBe(false); // 坏正则不抛
  });

  it("normalizes base urls by stripping trailing slashes but keeping query/hash", () => {
    expect(normalizeBaseUrl("https://x.com/v1/")).toBe("https://x.com/v1");
    expect(normalizeBaseUrl("https://x.com/v1/?a=b")).toBe("https://x.com/v1?a=b");
    expect(normalizeBaseUrl("https://x.com/v1/#frag")).toBe("https://x.com/v1#frag");
    expect(normalizeBaseUrl("not-a-url")).toBeUndefined();
  });
});

describe("resolveModelLeaves rule engine ordering", () => {
  it("evaluates the typed rule union directly in model → model-api → provider-site → template order", () => {
    const leaves = resolveModelLeaves(
      [
        { type: "model", modelMatch: "gpt-x", config: { properties: { contextWindow: 100 } } },
        {
          type: "model-api",
          modelMatch: "gpt-x",
          apiTypeMatch: "openai-responses",
          config: { properties: { contextWindow: 200 } },
        },
        {
          type: "provider-site",
          modelMatch: "gpt-x",
          baseUrlMatch: "https://api\\.openai\\.com/v1",
          config: { properties: { contextWindow: 300 } },
        },
        {
          type: "template-model",
          templateId: "t",
          modelId: "gpt-x",
          config: { properties: { contextWindow: 400 } },
        },
      ],
      {
        templateId: "t",
        modelId: "gpt-x",
        apiType: "openai-responses",
        baseUrl: "https://api.openai.com/v1",
      },
    );
    expect(leaves.contextWindow).toBe(400); // 后到先得，模板精确规则终结
  });

  it("skips provider-site rules when the base url cannot be normalized", () => {
    const leaves = resolveModelLeaves(
      [
        {
          type: "provider-site",
          modelMatch: "m",
          baseUrlMatch: "https://x",
          config: { properties: { contextWindow: 1 } },
        },
      ],
      { templateId: "t", modelId: "m", apiType: "openai-responses", baseUrl: "not-a-url" },
    );
    expect(leaves.contextWindow).toBeUndefined();
  });

  const leaves = extract(releaseFixture());
  const tCn = leaves.presets.find((preset) => preset.provider === "t-cn")!;

  it("applies model rules case-insensitively with later rules winning", () => {
    // m.* → 1000；M1（i 标志）→ 2000；无更高优先级来源的 m2 停在 1000。
    const m2 = tCn.models.find((model) => model.id === "m2")!;
    expect(m2.contextWindow).toBe(1000);
  });

  it("gates model-api rules on the api type", () => {
    // m1：openai 规则给 supportsImage；anthropic 规则的 999999 不生效。
    const m1 = tCn.models.find((model) => model.id === "m1")!;
    expect(m1.inputTypes).toEqual(["text", "image"]);
    expect(m1.contextWindow).toBe(3000); // template-model 最终覆盖
  });

  it("clears reasoning values via a later null overlay", () => {
    const m1 = tCn.models.find((model) => model.id === "m1")!;
    expect("efforts" in m1).toBe(false);
  });

  it("gates provider-site rules on the normalized base url", () => {
    // m2 经尾斜杠规范化命中 → efforts 落地；a1 的 baseUrl 不命中 → 无 contextWindow。
    const m2 = tCn.models.find((model) => model.id === "m2")!;
    expect(m2.efforts).toEqual(["low", "max"]);
    const deepseek = leaves.presets.find((preset) => preset.provider === "deepseek")!;
    expect("contextWindow" in deepseek.models[0]!).toBe(false);
  });
});

describe("extract projection", () => {
  it("prefers zh-CN brand names and maps the three protocols", () => {
    const { presets } = extract(releaseFixture());
    const tCn = presets.find((preset) => preset.provider === "t-cn")!;
    expect(tCn.name).toBe("中文名");
    expect(tCn.api).toBe("openai-completions"); // openai-chat-completions → 本仓名
    expect(tCn.baseURL).toBe("https://api.t.cn/v1/");
    const ds = presets.find((preset) => preset.provider === "deepseek")!;
    expect(ds.name).toBe("DeepSeek Fixture"); // 无 zh-CN 回退 en-US
    expect(ds.api).toBe("anthropic-messages"); // 同名直传
  });

  it("emits iconUrl only for slugged template ids", () => {
    const { presets } = extract(releaseFixture());
    expect(presets.find((preset) => preset.provider === "deepseek")!.iconUrl).toBe(
      `https://models.dev/logos/${LOGO_SLUGS["deepseek"]}.svg`,
    );
    expect("iconUrl" in presets.find((preset) => preset.provider === "t-cn")!).toBe(false);
  });

  it("unions builtin ids with template rules, deduped and order-preserving", () => {
    const { presets, modelCount } = extract(releaseFixture());
    const tCn = presets.find((preset) => preset.provider === "t-cn")!;
    // builtin 在前；templateModelRules 的 m1 不重复、m3 追加在后。
    expect(tCn.models.map((model) => model.id)).toEqual(["m1", "m2", "m3"]);
    expect(modelCount).toBe(4); // t-cn 3 + deepseek 1
  });

  it("passes the revision through", () => {
    expect(extract(releaseFixture()).revision).toBe(7);
    // 空 release（结构合法但无模板）也拒绝——codegen 失败优于空目录。
    expect(() => extract({})).toThrow(/未提取到任何模板/);
  });

  it("throws on unusable templates instead of emitting partial catalogs", () => {
    const base = releaseFixture() as {
      config: { providerConfigRules: { templateRules: unknown[] } };
    };
    const withTemplate = (template: unknown) => ({
      ...base,
      config: {
        ...base.config,
        providerConfigRules: { templateRules: [template] },
        modelConfigRules: {},
      },
    });
    // 协议不可映射。
    expect(() =>
      extract(
        withTemplate({
          templateId: "t",
          config: {
            api: { type: "google-generative-ai", baseUrl: "https://x" },
            builtinModelIds: ["m"],
          },
        }),
      ),
    ).toThrow(/协议不可映射/);
    // 缺 baseUrl。
    expect(() =>
      extract(withTemplate({ templateId: "t", config: { api: { type: "openai-responses" } } })),
    ).toThrow(/缺 baseUrl/);
    // 模型清单为空。
    expect(() =>
      extract(
        withTemplate({
          templateId: "t",
          config: { api: { type: "openai-responses", baseUrl: "https://x" } },
        }),
      ),
    ).toThrow(/模型清单为空/);
    // 上游结构不符 zod 收窄（模板缺 templateId）。
    expect(() =>
      extract({
        config: { providerConfigRules: { templateRules: [{ nope: 1 }] } },
      }),
    ).toThrow(/结构不符合预期/);
  });

  it("keeps the api name map and slug table aligned with shufa semantics", () => {
    expect(API_NAME_MAP).toEqual({
      "anthropic-messages": "anthropic-messages",
      "openai-chat-completions": "openai-completions",
      "openai-responses": "openai-responses",
    });
    // zcode 模板全集在对照表内（上游 revision 30 的 20 个 templateId）。
    for (const id of [
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
      "openrouter",
      "opencode-go-chat",
      "opencode-go-messages",
      "opencode-go-responses",
      "opencode-zen-responses",
      "opencode-zen-messages",
      "opencode-zen-chat",
    ]) {
      expect(LOGO_SLUGS[id], `missing slug for ${id}`).toBeTruthy();
    }
  });
});

describe("generated preset artifact snapshot", () => {
  it("ships a non-empty preset registry with populated models", async () => {
    const { zcodePresets } = await import("../src/daemon/zcode-presets.js");
    expect(zcodePresets.length).toBeGreaterThanOrEqual(20);
    for (const preset of zcodePresets) {
      expect(preset.provider).toMatch(/^[a-z0-9-]+$/);
      expect(preset.models.length).toBeGreaterThan(0);
      for (const model of preset.models) {
        expect(model.id.length).toBeGreaterThan(0);
        expect(model.inputTypes).toContain("text");
      }
    }
  });

  it("carries the upstream revision line in the generated header", () => {
    const generatedPath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "../src/daemon/zcode-presets.ts",
    );
    const text = readFileSync(generatedPath, "utf8");
    expect(text).toMatch(/上游 revision \d+/);
    expect(text).toContain("生成文件，勿手改");
  });
});
