/**
 * agent-models-config 生成器单测（agent-models-config-v1 task 4.2）。
 *
 * 用户原始需求 [2026-09-30]：「将 zcode 标准作为 agent-models-config 配置标准。」
 *
 * 正交意图：
 *   [1] 求值法则：五层规则顺序覆盖、overlay 精确语义（undefined 继承 / null 清空
 *       子对象 / 值替换）、匹配口径（modelMatch 忽略大小写、apiTypeMatch 敏感、
 *       baseUrl 规范化全串）。
 *   [2] 条目构建：enabled:false 保留标注、tier params 逐档求值与 kind 标注、
 *       paramName 哨兵恒等提取（不确定省略）、account provider 映射。
 *   [3] 失败面：上游结构漂移 / access 不可映射 / provider 数量跌破下限 → 抛错。
 * 妥协声明：无。
 */
import { describe, expect, it } from "vitest";
import {
  AgentModelsConfigSchema,
  AgentModelsOverlaySchema,
} from "../src/shared/contracts/agent-models.js";
import {
  buildModelEntry,
  extract,
  extractParamName,
  evaluateTierParams,
  matches,
  normalizeBaseUrl,
  overlayModelConfig,
  overlayValue,
  resolveModelConfig,
  type OverlayRule,
} from "../scripts/extract-agent-models.sh.ts";

describe("overlay semantics (ZCode ConfigOverlay)", () => {
  it("inherits undefined, clears on null child, replaces leaves", () => {
    expect(overlayValue(1, undefined)).toBe(1);
    expect(overlayValue(1, 2)).toBe(2);
    const base = {
      properties: {
        contextWindow: 1000,
        inputFormat: { supportsText: true, supportsImage: true },
        supportsToolCall: true,
      },
      optionSpecs: { reasoningLevel: { values: ["low"], map: '{"a": 1}' } },
    };
    // null 子对象清空整个 inputFormat。
    expect(
      overlayModelConfig(base, { properties: { inputFormat: null } }).properties?.inputFormat,
    ).toBeNull();
    // undefined 继承旧值；值替换。
    const merged = overlayModelConfig(base, {
      properties: { contextWindow: 2000, supportsToolCall: false },
    });
    expect(merged.properties?.contextWindow).toBe(2000);
    expect(merged.properties?.inputFormat).toEqual({ supportsText: true, supportsImage: true });
    expect(merged.properties?.supportsToolCall).toBe(false);
    expect(merged.optionSpecs).toEqual(base.optionSpecs);
  });

  it("matches anchored regex with modelMatch case-insensitive, apiType sensitive", () => {
    expect(matches("glm-5\\.3", "GLM-5.3", true)).toBe(true);
    expect(matches("glm-5\\.3", "GLM-5.3")).toBe(false);
    expect(matches("openai-.*", "openai-chat-completions")).toBe(true);
    // baseUrl 规范化：尾斜杠/host 大小写不改变命中。
    expect(
      matches(
        "https://api\\.z\\.ai/api/anthropic",
        normalizeBaseUrl("https://API.z.ai/api/anthropic///")!,
      ),
    ).toBe(true);
  });
});

describe("resolveModelConfig (five-layer ordered overlay)", () => {
  const rules: OverlayRule[] = [
    { type: "model", modelMatch: "glm-.*", config: { properties: { contextWindow: 1000 } } },
    {
      type: "model-api",
      modelMatch: "GLM-5\\.3",
      apiTypeMatch: "anthropic-.*",
      config: { properties: { contextWindow: 2000, supportsToolCall: true } },
    },
    {
      type: "provider-site",
      modelMatch: ".*",
      apiTypeMatch: "openai-chat-completions",
      baseUrlMatch: "https://mirror\\.example\\.com/v1/?",
      config: { properties: { contextWindow: 3000 } },
    },
    { type: "template-model", templateId: "t-api", modelId: "GLM-5.3", config: { enabled: false } },
    { type: "provider-model", providerId: "p1", modelId: "M1", config: { enabled: true } },
  ];

  it("overlays in layer order with match gating", () => {
    // model 层（忽略大小写命中）→ model-api 层覆盖 contextWindow。
    const cfg = resolveModelConfig(rules, {
      templateId: "t-api",
      modelId: "GLM-5.3",
      apiType: "anthropic-messages",
      baseUrl: "https://api.z.ai/api/anthropic",
    });
    expect(cfg.properties?.contextWindow).toBe(2000);
    expect(cfg.properties?.supportsToolCall).toBe(true);
    // template-model 精确规则叠加 enabled。
    expect(cfg.enabled).toBe(false);
  });

  it("site rule only matches normalized baseUrl on the same apiType", () => {
    const hit = resolveModelConfig(rules, {
      modelId: "GLM-5.3",
      apiType: "openai-chat-completions",
      baseUrl: "https://mirror.example.com/v1",
    });
    expect(hit.properties?.contextWindow).toBe(3000);
    // anthropic 协议下 site 规则不命中——值停留在 model-api 层的 2000。
    const miss = resolveModelConfig(rules, {
      modelId: "GLM-5.3",
      apiType: "anthropic-messages",
      baseUrl: "https://mirror.example.com/v1",
    });
    expect(miss.properties?.contextWindow).toBe(2000);
  });

  it("provider-model exact rule hits only its provider", () => {
    expect(resolveModelConfig(rules, { providerId: "p1", modelId: "M1" }).enabled).toBe(true);
    expect(resolveModelConfig(rules, { providerId: "p2", modelId: "M1" }).enabled).toBeUndefined();
  });
});

describe("tier params and paramName extraction", () => {
  it("evaluates params per tier and marks toggle kinds", () => {
    const entry = buildModelEntry("M", {
      enabled: true,
      optionSpecs: {
        reasoningLevel: {
          values: ["disabled", "low", "max"],
          map: 'reasoningLevel == "disabled" ? {"thinking": {"type": "disabled"}} : {"thinking": {"type": "adaptive"}, "effort": reasoningLevel}',
        },
      },
    });
    const tiers = entry.options?.reasoning?.tiers ?? [];
    expect(tiers.map((t) => t.id)).toEqual(["disabled", "low", "max"]);
    expect(tiers[0]?.kind).toBe("toggle");
    expect(tiers[1]?.kind).toBe("effort");
    expect(tiers[0]?.params).toEqual({ thinking: { type: "disabled" } });
    expect(tiers[2]?.params).toEqual({ thinking: { type: "adaptive" }, effort: "max" });
  });

  it("omits params when map missing or unevaluable (never fabricates)", () => {
    expect(evaluateTierParams(undefined, "low")).toBeUndefined();
    expect(evaluateTierParams('{"a": unknown}', "low")).toBeUndefined();
    const entry = buildModelEntry("M", {
      optionSpecs: { reasoningLevel: { values: ["low"] } },
    });
    expect(entry.options?.reasoning?.tiers[0]).toEqual({ id: "low", kind: "effort" });
  });

  it("extracts paramName by sentinel identity; omits otherwise", () => {
    expect(extractParamName('{"max_tokens": maxOutputTokens}')).toBe("max_tokens");
    expect(extractParamName("{'max_completion_tokens': maxOutputTokens}")).toBe(
      "max_completion_tokens",
    );
    expect(extractParamName(undefined)).toBeUndefined();
    // 非恒等映射（变换了值）= 线映射未知，省略。
    expect(extractParamName('{"max_tokens": maxOutputTokens + 1}')).toBeUndefined();
    expect(extractParamName('{"a": 1, "b": maxOutputTokens}')).toBeUndefined();
  });

  it("keeps enabled:false annotated and drops null-ish to default", () => {
    expect(buildModelEntry("M", { enabled: false }).enabled).toBe(false);
    expect(buildModelEntry("M", {}).enabled).toBeUndefined();
  });
});

describe("extract (fixture release)", () => {
  const release = {
    schemaVersion: 1,
    revision: 7,
    config: {
      providerConfigRules: {
        templateRules: [
          {
            templateId: "t-api",
            templateNameMap: { "zh-CN": "测试 API", "en-US": "Test API", "": "" },
            config: {
              api: { type: "anthropic-messages", baseUrl: "https://t.example.com/api" },
              access: { type: "zhipu-coding-plan-api-key" },
              builtinModelIds: ["M1", "M-OFF"],
            },
          },
        ],
        providerRules: [
          {
            providerId: "account:t-plan",
            providerName: "T Plan",
            config: {
              group: "zai-family",
              api: {
                type: "anthropic-messages",
                baseUrl: "https://t.example.com/api",
                headers: { "x-test": "yes" },
              },
              access: { type: "zhipu-account", accountType: "zai", mode: "start-plan" },
              builtinModelIds: ["M1"],
              visibility: "hidden",
            },
          },
        ],
      },
      modelConfigRules: {
        modelRules: [
          {
            modelMatch: "m.*",
            config: {
              properties: { contextWindow: 1000 },
              optionSpecs: {
                reasoningLevel: { values: ["low"], map: '{"effort": reasoningLevel}' },
              },
            },
          },
        ],
        modelApiRules: [],
        providerSiteRules: [],
        templateModelRules: [
          {
            templateId: "t-api",
            modelId: "M2",
            config: { properties: { supportsToolCall: true } },
          },
          { templateId: "t-api", modelId: "M-OFF", config: { enabled: false } },
        ],
        builtinProviderModelRules: [
          {
            providerId: "account:t-plan",
            modelId: "M1",
            config: { properties: { contextWindow: 5000 } },
          },
          // B3：模板 provider 的标准 id = templateId，provider-model 精确规则须命中。
          { providerId: "t-api", modelId: "M2", config: { properties: { contextWindow: 777 } } },
        ],
      },
    },
  };

  it("builds a schema-valid standard catalog from the fixture", () => {
    const { config, providerCount, modelCount } = extract(release);
    expect(providerCount).toBe(2);
    // t-api：builtin 2 + templateModelRules 增量 1（M2）；account 1。
    expect(modelCount).toBe(4);
    expect(config.revision).toBe(7);
    expect(config.sources[0]).toMatchObject({ id: "zcode-registry", upstreamRevision: 7 });
    // N2：溯源恒为 canonical 上游 URL（本地 fixture 重跑不污染 provenance）。
    expect(config.sources[0]!.url).toMatch(
      /^https:\/\/raw\.githubusercontent\.com\/zai-org\/ZCode\//,
    );
    const parsed = AgentModelsConfigSchema.safeParse(config);
    // safeParse 返回克隆；深相等即可（shape 完整往返）。
    expect(parsed.success ? parsed.data : parsed.error.message).toEqual(config);

    const tApi = config.providers.find((p) => p.id === "t-api")!;
    expect(tApi.vendor).toBeUndefined();
    expect(tApi.names).toEqual({ "zh-CN": "测试 API", "en-US": "Test API" });
    expect(tApi.access.type).toBe("plan-api-key");
    expect(tApi.api).toEqual({
      protocol: "anthropic-messages",
      baseUrl: "https://t.example.com/api",
    });
    // model 层忽略大小写命中 m.*（M1 大写）；tier params 已逐档求值。
    const m1 = tApi.models.find((m) => m.id === "M1")!;
    expect(m1.properties?.contextWindow).toBe(1000);
    expect(m1.options?.reasoning?.tiers).toEqual([
      { id: "low", kind: "effort", params: { effort: "low" } },
    ]);
    // enabled:false 保留标注（生成物不滤）。
    expect(tApi.models.find((m) => m.id === "M-OFF")?.enabled).toBe(false);
    // templateModelRules 增量模型进清单。
    expect(tApi.models.map((m) => m.id)).toEqual(["M1", "M-OFF", "M2"]);

    const account = config.providers.find((p) => p.id === "account:t-plan")!;
    expect(account.access).toEqual({ type: "account", vendor: "zai", plan: "start-plan" });
    expect(account.visibility).toBe("hidden");
    // B7：account provider 的 api.headers 与 template 同投影。
    expect(account.api).toEqual({
      protocol: "anthropic-messages",
      baseUrl: "https://t.example.com/api",
      headers: { "x-test": "yes" },
    });
    // provider-model 精确规则覆盖 model 层 contextWindow。
    expect(account.models[0]?.properties?.contextWindow).toBe(5000);
    // B3：template 侧 provider-model 规则按 templateId 身份命中（覆盖 model 层 1000）。
    expect(tApi.models.find((m) => m.id === "M2")?.properties?.contextWindow).toBe(777);
  });

  it("fails loudly on structure drift and unmappable access", () => {
    expect(() => extract({ nope: true })).toThrow(/结构不符合预期/);
    // access.type 枚举域解析期收窄：未知形态在 zod 层拒绝（旧「不可映射」分支退役）。
    const badAccess = structuredClone(release);
    badAccess.config.providerConfigRules.templateRules[0].config.access.type = "oauth";
    expect(() => extract(badAccess)).toThrow(/结构不符合预期/);
    const missingBase = structuredClone(release);
    delete missingBase.config.providerConfigRules.templateRules[0].config.api.baseUrl;
    expect(() => extract(missingBase)).toThrow(/缺 api\.baseUrl/);
  });

  it("skips empty-model providers with warning; all-empty is drift", () => {
    const sparse = structuredClone(release);
    sparse.config.providerConfigRules.templateRules[0].config.builtinModelIds = [];
    sparse.config.modelConfigRules.templateModelRules = [];
    const result = extract(sparse);
    expect(result.config.providers.map((p) => p.id)).toEqual(["account:t-plan"]);
    expect(result.warnings).toEqual([expect.stringContaining("t-api 模型清单为空")]);

    const none = structuredClone(sparse);
    none.config.providerConfigRules.providerRules[0].config.builtinModelIds = [];
    expect(() => extract(none)).toThrow(/未提取到任何 provider/);
  });

  it("rejects envelope drift: wrong schemaVersion / missing revision / missing rule arrays (B4)", () => {
    const v2 = structuredClone(release);
    v2.schemaVersion = 2;
    expect(() => extract(v2)).toThrow(/结构不符合预期/);
    const noRevision = structuredClone(release);
    delete noRevision.revision;
    expect(() => extract(noRevision)).toThrow(/结构不符合预期/);
    const noRules = structuredClone(release);
    delete noRules.config.modelConfigRules;
    expect(() => extract(noRules)).toThrow(/结构不符合预期/);
    const partialRules = structuredClone(release);
    delete partialRules.config.modelConfigRules.providerSiteRules;
    expect(() => extract(partialRules)).toThrow(/结构不符合预期/);
  });

  it("rejects unknown keys at every upstream level (strict 收窄, B4 残留)", () => {
    const extraEnvelope = structuredClone(release);
    (extraEnvelope as Record<string, unknown>).futureField = true;
    expect(() => extract(extraEnvelope)).toThrow(/结构不符合预期/);
    const extraRuleKey = structuredClone(release);
    (extraRuleKey.config.modelConfigRules.modelRules[0]! as Record<string, unknown>).futureKey = 1;
    expect(() => extract(extraRuleKey)).toThrow(/结构不符合预期/);
    const extraConfigKey = structuredClone(release);
    (
      extraConfigKey.config.modelConfigRules.modelRules[0]!.config! as Record<string, unknown>
    ).futureLeaf = 1;
    expect(() => extract(extraConfigKey)).toThrow(/结构不符合预期/);
    const extraTemplateKey = structuredClone(release);
    (
      extraTemplateKey.config.providerConfigRules.templateRules[0]!.config! as Record<
        string,
        unknown
      >
    ).futureKey = 1;
    expect(() => extract(extraTemplateKey)).toThrow(/结构不符合预期/);
  });

  it("requires apiTypeMatch on modelApiRules; provider-site may omit it (B10)", () => {
    const missingApiType = structuredClone(release);
    missingApiType.config.modelConfigRules.modelApiRules = [
      { modelMatch: ".*", config: { properties: { contextWindow: 1 } } },
    ];
    expect(() => extract(missingApiType)).toThrow(/结构不符合预期/);
    // provider-site 省略 apiTypeMatch = 不限协议（上游 optional 语义保留）。
    const siteWithoutApiType = structuredClone(release);
    siteWithoutApiType.config.modelConfigRules.providerSiteRules = [
      {
        modelMatch: "m1",
        baseUrlMatch: "https://t\.example\.com/api",
        config: { properties: { contextWindow: 4321 } },
      },
    ];
    const tApi = extract(siteWithoutApiType).config.providers.find((p) => p.id === "t-api")!;
    expect(tApi.models.find((m) => m.id === "M1")?.properties?.contextWindow).toBe(4321);
  });

  it("rejects empty match pattern (upstream min(1), B5 残留)", () => {
    const emptyPattern = structuredClone(release);
    emptyPattern.config.modelConfigRules.modelRules[0]!.modelMatch = "";
    expect(() => extract(emptyPattern)).toThrow(/结构不符合预期/);
  });

  it("projects account vendor from access.accountType and rejects group mismatch (B9)", () => {
    const { config } = extract(release);
    const account = config.providers.find((p) => p.id === "account:t-plan")!;
    expect(account.vendor).toBe("zai");
    const mismatch = structuredClone(release);
    mismatch.config.providerConfigRules.providerRules[0]!.config!.access.accountType = "bigmodel";
    expect(() => extract(mismatch)).toThrow(/group（zai-family）与 accountType（bigmodel）不一致/);
  });

  it("rejects invalid rule regex and missing rule config at parse (B5)", () => {
    const badPattern = structuredClone(release);
    badPattern.config.modelConfigRules.modelRules.push({
      modelMatch: "(",
      config: { properties: { contextWindow: 1 } },
    });
    expect(() => extract(badPattern)).toThrow(/结构不符合预期/);
    const missingConfig = structuredClone(release);
    missingConfig.config.modelConfigRules.modelRules.push({ modelMatch: "x.*" });
    expect(() => extract(missingConfig)).toThrow(/结构不符合预期/);
    // matches 不再吞编译异常：非法 pattern 直接抛出，而非静默不命中。
    expect(() => matches("(", "x")).toThrow();
  });

  it("rejects duplicate provider ids and dedupes repeated builtin model ids (B6)", () => {
    const dup = structuredClone(release);
    dup.config.providerConfigRules.templateRules.push(
      structuredClone(dup.config.providerConfigRules.templateRules[0]),
    );
    expect(() => extract(dup)).toThrow(/provider id 重复/);
    // 空 provider 也不得绕过重复判定。
    const dupEmpty = structuredClone(dup);
    dupEmpty.config.providerConfigRules.templateRules[0].config.builtinModelIds = [];
    dupEmpty.config.modelConfigRules.templateModelRules = [];
    expect(() => extract(dupEmpty)).toThrow(/provider id 重复/);

    // 上游 uniqueInOrder 语义：重复 builtin id 保序去重，不算漂移。
    const repeatIds = structuredClone(release);
    repeatIds.config.providerConfigRules.templateRules[0].config.builtinModelIds = [
      "M1",
      "M1",
      "M-OFF",
    ];
    const tApi = extract(repeatIds).config.providers.find((p) => p.id === "t-api")!;
    expect(tApi.models.map((m) => m.id)).toEqual(["M1", "M-OFF", "M2"]);
  });
});

describe("standard schema uniqueness and overlay nullability (B1/B6)", () => {
  it("AgentModelsConfigSchema rejects duplicate provider and model ids", () => {
    const base = AgentModelsConfigSchema.parse({
      schemaVersion: 1,
      revision: 1,
      sources: [{ id: "manual" }],
      providers: [
        {
          id: "p1",
          access: { type: "api-key" },
          api: { protocol: "anthropic-messages", baseUrl: "https://x.example.com" },
          models: [{ id: "m1" }],
        },
      ],
    });
    const dupProvider = structuredClone(base);
    dupProvider.providers.push(structuredClone(base.providers[0]!));
    expect(AgentModelsConfigSchema.safeParse(dupProvider).success).toBe(false);
    const dupModel = structuredClone(base);
    dupModel.providers[0]!.models.push(structuredClone(base.providers[0]!.models[0]!));
    expect(AgentModelsConfigSchema.safeParse(dupModel).success).toBe(false);
    expect(AgentModelsConfigSchema.safeParse(base).success).toBe(true);
  });

  it("overlay schema expresses null clearing at field and property-leaf level (标准 §7)", () => {
    const overlay = {
      schemaVersion: 1,
      overlay: true,
      providers: [
        {
          id: "zai-api",
          names: null,
          api: null,
          access: null,
          models: [
            { id: "GLM-5.3", enabled: null, properties: null, options: null },
            { id: "GLM-5.3-Flash", properties: { contextWindow: null, supportsToolCall: null } },
          ],
        },
      ],
    };
    expect(AgentModelsOverlaySchema.safeParse(overlay).success).toBe(true);
    // 错误类型仍拒绝。
    expect(
      AgentModelsOverlaySchema.safeParse({
        schemaVersion: 1,
        overlay: true,
        providers: [{ id: "x", api: 123 }],
      }).success,
    ).toBe(false);
  });
});
