/**
 * agent-models-config v1 生成器（zcode-builtin.json → 标准目录生成物）。
 *
 * 用户原始需求 [2026-09-30]：「将 zcode 标准作为 agent-models-config 配置标准。」
 * 规范源：docs/standards/agent-models-config.md（§9 导入映射为 normative）。
 *
 * 提取语义（相对旧 6 字段预设提取的升级，全量对齐标准）：
 *   provider = templateId（产品×协议×endpoint 单元）+ account:* 订阅型
 *   providerRules（access.type = account + vendor + plan；entitled 运行时事实不落盘）
 *   模型清单 = builtinModelIds ∪ templateModelRules（去重保序）；account provider
 *   仅取自身 builtinModelIds
 *   富字段 = 五层规则有序叠加静态求值：modelRules → modelApiRules →
 *   providerSiteRules → templateModelRules → builtinProviderModelRules
 *   （overlay 精确语义 = ZCode ConfigOverlay：undefined 继承 / null 清空子对象 /
 *   值替换；modelMatch 忽略大小写、apiTypeMatch 大小写敏感、baseUrl 规范化后
 *   全串匹配）——取全部能力标注 + optionSpecs
 *   reasoningLevel → tiers：values 逐档求值 CEL map（scripts/lib/restricted-cel.ts，
 *   vendored Apache-2.0）得 params；disabled/enabled 档标 kind=toggle；求值失败
 *   的档省略 params（标准 L2：不伪造）
 *   maxOutputTokens.map → paramName：哨兵恒等提取（单键且值===哨兵），否则省略
 *   enabled === false → 条目保留并标注（标准 §9；产品投影层过滤）
 *
 * 正交意图：
 *   [1] 一次提取：上游 JSON（RAW_URL 或本地路径参数）→ src/daemon/
 *       agent-models.generated.ts（类型 = contracts/agent-models 推导；重跑 =
 *       生成文件整体换新）。
 *   [2] 可测纯逻辑：上游 zod 收窄、overlay/规则求值/档位求值函数以可导入形式
 *       暴露（test/extract-agent-models.test.ts fixture 驱动），main 仅在直接
 *       执行时运行（Bun/Node 通用判主）。
 * 妥协声明：无。
 *
 * 用法：bun scripts/extract-agent-models.sh.ts [zcode-builtin.json 路径]
 *   缺省从 GitHub raw main 分支拉取最新；建议随上游 revision 升级时重跑。
 * 上游：https://github.com/zai-org/ZCode（Apache-2.0）config/provider/zcode-builtin.json
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";
import {
  AgentModelsConfigSchema,
  type AgentModelsConfig,
  type AgentModelEntry,
} from "../src/shared/contracts/agent-models.js";
import { evaluateModelOptionMap } from "./lib/restricted-cel.js";

const RAW_URL =
  "https://raw.githubusercontent.com/zai-org/ZCode/main/config/provider/zcode-builtin.json";
const OUT_FILE = new URL("../src/daemon/agent-models.generated.ts", import.meta.url);

/** templateId/vendor → models.dev logo slug（logo 静态资产源，非目录数据源）。 */
export const LOGO_SLUGS: Readonly<Record<string, string>> = {
  "zai-api": "zai",
  "zai-standard-api": "zai",
  "bigmodel-api": "zhipuai",
  "bigmodel-standard-api": "zhipuai",
  "moonshot-kimi": "moonshotai",
  minimax: "minimax",
  deepseek: "deepseek",
  "qwen-alibaba-model-studio-cn": "alibaba-cn",
  "qwen-alibaba-model-studio-intl": "alibaba",
  "xiaomi-mimo": "xiaomi",
  openai: "openai",
  anthropic: "anthropic",
  xai: "xai",
  openrouter: "openrouter",
  "opencode-go-chat": "opencode-go",
  "opencode-go-messages": "opencode-go",
  "opencode-go-responses": "opencode-go",
  "opencode-zen-responses": "opencode",
  "opencode-zen-messages": "opencode",
  "opencode-zen-chat": "opencode",
};

/** account provider 的 vendor → logo slug（组内与家族 template 同源图标）。 */
const VENDOR_LOGO_SLUGS: Readonly<Record<string, string>> = {
  zai: "zai",
  bigmodel: "zhipuai",
};

/** templateId 前缀 → vendor（标准 D6：不维护全量厂商表）。 */
function vendorOfTemplateId(templateId: string): string | undefined {
  if (templateId.startsWith("zai-")) return "zai";
  if (templateId.startsWith("bigmodel-")) return "bigmodel";
  return undefined;
}

const GROUP_VENDOR: Readonly<Record<string, string>> = {
  "zai-family": "zai",
  "bigmodel-family": "bigmodel",
};

/** reasoning 档位中的开关型值（标准 kind=toggle；非语义强度档）。 */
export const TOGGLE_TIER_IDS = new Set(["disabled", "enabled"]);

/** provider 数量下限（上游结构漂移的粗粒度守门；低于即失败不生成）。 */
const MIN_PROVIDER_FLOOR = 15;

// ---------------------------------------------------------------- 上游结构收窄（zod，strict 等价）

// 上游 release/rule/config schema 全部 strict（zcode-builtin-release.ts 与
// rule-data-schema.ts）：未知键 = 结构漂移，解析期拒绝（B4 残留修复）。
const booleanish = z.boolean().nullish();

const LogoSchema = z.strictObject({ type: z.literal("builtin"), key: z.string().min(1) });

const ApiSchema = z.strictObject({
  // 协议开放（标准注册表；上游三值天然在域内），baseUrl 非空时必须合法 URL。
  type: z.string(),
  baseUrl: z.string().url().nullish(),
  headers: z.record(z.string(), z.string()).nullish(),
});

/** 模板 access = apiKeyAccessDataSchema 去 apiKey（上游 pick 语义）。 */
const TemplateAccessSchema = z.strictObject({
  type: z.enum(["api-key", "zhipu-coding-plan-api-key"]),
  apiKeyManagementUrl: z.string().url().nullish(),
});

/** account provider access = zhipuAccountAccessDataSchema（枚举域同上游）。 */
const AccountAccessSchema = z.strictObject({
  type: z.literal("zhipu-account"),
  accountType: z.enum(["zai", "bigmodel"]),
  mode: z.enum(["start-plan", "individual-coding-plan", "team-coding-plan", "off-peak"]),
  entitled: z.boolean().nullish(),
});

const RuleConfigSchema = z.strictObject({
  enabled: booleanish,
  properties: z
    .strictObject({
      contextWindow: z.number().nullish(),
      inputFormat: z
        .strictObject({
          supportsText: booleanish,
          supportsImage: booleanish,
          supportsVideo: booleanish,
          supportsAudio: booleanish,
          supportsPdf: booleanish,
        })
        .nullish(),
      outputFormat: z.strictObject({ supportsText: booleanish }).nullish(),
      supportsToolCall: booleanish,
      supportsJsonSchemaOutput: booleanish,
      supportsNativeWebSearch: booleanish,
      supportsMidConversationSystem: booleanish,
      requiresMfjsToolSchema: booleanish,
    })
    .nullish(),
  optionSpecs: z
    .strictObject({
      reasoningLevel: z
        .strictObject({ values: z.array(z.string()).nullish(), map: z.string().nullish() })
        .nullish(),
      maxOutputTokens: z
        .strictObject({ max: z.number().nullish(), map: z.string().nullish() })
        .nullish(),
    })
    .nullish(),
});

/** 上游 patternSchema 语义：非空 + 锚定全串可编译（解析期拒绝，B5 残留修复）。 */
const PatternSchema = z
  .string()
  .min(1)
  .refine((pattern) => {
    try {
      new RegExp(`^(?:${pattern})$`);
      return true;
    } catch {
      return false;
    }
  }, "无效匹配正则");

const ModelRuleSchema = z.strictObject({
  modelMatch: PatternSchema,
  // 上游规则 schema 的 config 必填（B5）：缺失 = 结构漂移，拒绝优于静默不命中。
  config: RuleConfigSchema,
});
// 上游 modelApiMatchConfigRuleSchema：apiTypeMatch 必填（B10）——缺字段不得按通配放行。
const ModelApiRuleSchema = ModelRuleSchema.extend({ apiTypeMatch: PatternSchema });
// 上游 providerSiteMatchConfigRuleSchema：仅 site 规则允许 apiTypeMatch 省略（=不限协议）。
const ProviderSiteRuleSchema = ModelRuleSchema.extend({
  apiTypeMatch: PatternSchema.optional(),
  baseUrlMatch: PatternSchema,
});
const TemplateModelRuleSchema = z.strictObject({
  templateId: z.string(),
  modelId: z.string(),
  config: RuleConfigSchema,
});
const ProviderModelRuleSchema = z.strictObject({
  providerId: z.string(),
  modelId: z.string(),
  config: RuleConfigSchema,
});

const TemplateSchema = z.strictObject({
  templateId: z.string(),
  templateNameMap: z.record(z.string(), z.string()).nullish(),
  config: z
    .strictObject({
      logo: LogoSchema.nullish(),
      api: ApiSchema.nullish(),
      access: TemplateAccessSchema.nullish(),
      builtinModelIds: z.array(z.string()).nullish(),
    })
    .nullish(),
});

const ProviderRuleSchema = z.strictObject({
  providerId: z.string(),
  providerName: z.string().nullish(),
  config: z
    .strictObject({
      // builtin providerRule 的 group 恒为家族值（上游 exclude standard-personal）。
      group: z.enum(["zai-family", "bigmodel-family"]),
      logo: LogoSchema.nullish(),
      api: ApiSchema.nullish(),
      access: AccountAccessSchema.nullish(),
      builtinModelIds: z.array(z.string()).nullish(),
      visibility: z.enum(["visible", "hidden"]).nullish(),
    })
    .nullish(),
});

// 上游 release 契约（zcode-builtin-release.ts）：literal schemaVersion + 安全整数
// revision + strict 信封 + 五规则数组齐全。任何漂移在解析期失败（B4）。
const ReleaseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  revision: z.number().int().nonnegative(),
  config: z.strictObject({
    providerConfigRules: z.strictObject({
      templateRules: z.array(TemplateSchema),
      providerRules: z.array(ProviderRuleSchema),
    }),
    modelConfigRules: z.strictObject({
      modelRules: z.array(ModelRuleSchema),
      modelApiRules: z.array(ModelApiRuleSchema),
      providerSiteRules: z.array(ProviderSiteRuleSchema),
      templateModelRules: z.array(TemplateModelRuleSchema),
      builtinProviderModelRules: z.array(ProviderModelRuleSchema),
    }),
  }),
});

type RuleConfig = z.infer<typeof RuleConfigSchema>;
type Release = z.infer<typeof ReleaseSchema>;
type Template = z.infer<typeof TemplateSchema>;
type ProviderRule = z.infer<typeof ProviderRuleSchema>;

// ---------------------------------------------------------------- overlay（ZCode ConfigOverlay 精确语义）

type Nullish<T> = T | null | undefined;
type InputFormatCfg = NonNullable<RuleConfig["properties"]>["inputFormat"];
type OutputFormatCfg = NonNullable<RuleConfig["properties"]>["outputFormat"];
type PropsCfg = NonNullable<RuleConfig["properties"]>;
type ReasoningCfg = NonNullable<NonNullable<RuleConfig["optionSpecs"]>["reasoningLevel"]>;
type MaxOutCfg = NonNullable<NonNullable<RuleConfig["optionSpecs"]>["maxOutputTokens"]>;
type OptionSpecsCfg = NonNullable<RuleConfig["optionSpecs"]>;

/** 叶子：undefined 继承，其余（含 null）替换。 */
export function overlayValue<T>(base: T | undefined, next: T | undefined): T | undefined {
  return next === undefined ? base : next;
}

/** 子对象：next undefined 继承；任一侧 null 即 null（清空）；否则递归合并。 */
function overlayConfig<T>(
  base: Nullish<T>,
  next: Nullish<T>,
  merge: (base: T, next: T) => T,
): Nullish<T> {
  if (next === undefined) return base;
  if (next === null || base === null || base === undefined) return next;
  return merge(base, next);
}

function overlayInputFormat(base: NonNullable<InputFormatCfg>, next: NonNullable<InputFormatCfg>) {
  return {
    supportsText: overlayValue(base.supportsText, next.supportsText),
    supportsImage: overlayValue(base.supportsImage, next.supportsImage),
    supportsVideo: overlayValue(base.supportsVideo, next.supportsVideo),
    supportsAudio: overlayValue(base.supportsAudio, next.supportsAudio),
    supportsPdf: overlayValue(base.supportsPdf, next.supportsPdf),
  };
}

function overlayProps(base: NonNullable<PropsCfg>, next: NonNullable<PropsCfg>) {
  return {
    contextWindow: overlayValue(base.contextWindow, next.contextWindow),
    inputFormat: overlayConfig(base.inputFormat, next.inputFormat, overlayInputFormat),
    outputFormat: overlayConfig(base.outputFormat, next.outputFormat, (b, n) => ({
      supportsText: overlayValue(b.supportsText, n.supportsText),
    })),
    supportsToolCall: overlayValue(base.supportsToolCall, next.supportsToolCall),
    supportsJsonSchemaOutput: overlayValue(
      base.supportsJsonSchemaOutput,
      next.supportsJsonSchemaOutput,
    ),
    supportsNativeWebSearch: overlayValue(
      base.supportsNativeWebSearch,
      next.supportsNativeWebSearch,
    ),
    supportsMidConversationSystem: overlayValue(
      base.supportsMidConversationSystem,
      next.supportsMidConversationSystem,
    ),
    requiresMfjsToolSchema: overlayValue(base.requiresMfjsToolSchema, next.requiresMfjsToolSchema),
  };
}

function overlayOptionSpecs(base: NonNullable<OptionSpecsCfg>, next: NonNullable<OptionSpecsCfg>) {
  return {
    reasoningLevel: overlayConfig(base.reasoningLevel, next.reasoningLevel, (b, n) => ({
      values: overlayValue(b.values, n.values),
      map: overlayValue(b.map, n.map),
    })),
    maxOutputTokens: overlayConfig(base.maxOutputTokens, next.maxOutputTokens, (b, n) => ({
      max: overlayValue(b.max, n.max),
      map: overlayValue(b.map, n.map),
    })),
  };
}

/** 规则 config 的整型叠加（模型身份与规则匹配不在其内）。 */
export function overlayModelConfig(base: RuleConfig, next: RuleConfig): RuleConfig {
  return {
    enabled: overlayValue(base.enabled, next.enabled),
    properties: overlayConfig(base.properties, next.properties, overlayProps),
    optionSpecs: overlayConfig(base.optionSpecs, next.optionSpecs, overlayOptionSpecs),
  };
}

// ---------------------------------------------------------------- 匹配（ZCode matchesRule 语义）

/** 锚定全串正则（modelMatch 忽略大小写——ZCode 推荐规则放宽口径）。pattern 已在解析期校验可编译，编译异常在此直接抛出（B5：不静默吞）。 */
export function matches(pattern: string, value: string, ignoreCase = false): boolean {
  return new RegExp(`^(?:${pattern})$`, ignoreCase ? "i" : undefined).test(value);
}

/** URL 规范化（ZCode normalizeBaseURLForRuleMatch：host/协议小写、去默认端口与尾斜杠，保留 path/query）。 */
export function normalizeBaseUrl(value: string): string | undefined {
  try {
    const parsed = new URL(value);
    const suffix = `${parsed.search}${parsed.hash}`;
    const serialized = parsed.toString();
    const endpoint = suffix.length === 0 ? serialized : serialized.slice(0, -suffix.length);
    return `${endpoint.replace(/\/+$/, "")}${suffix}`;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------- 五层规则求值

/** 规则平铺形态（type 为打平标记；叠加顺序 = 数组先后；config 与 model-api 的
 * apiTypeMatch 必填，与上游规则 schema 一致——B10）。 */
export type OverlayRule =
  | { type: "model"; modelMatch: string; config: RuleConfig }
  | { type: "model-api"; modelMatch: string; apiTypeMatch: string; config: RuleConfig }
  | {
      type: "provider-site";
      modelMatch: string;
      apiTypeMatch?: string;
      baseUrlMatch: string;
      config: RuleConfig;
    }
  | { type: "template-model"; templateId: string; modelId: string; config: RuleConfig }
  | { type: "provider-model"; providerId: string; modelId: string; config: RuleConfig };

export interface RuleContext {
  readonly providerId?: string;
  readonly templateId?: string;
  readonly modelId: string;
  readonly apiType?: string;
  readonly baseUrl?: string;
}

/** 按 ZCode ModelConfigRules.resolve 的顺序与匹配语义求值单模型完整配置。 */
export function resolveModelConfig(rules: readonly OverlayRule[], ctx: RuleContext): RuleConfig {
  let acc: RuleConfig = {};
  const normalizedBase = ctx.baseUrl == null ? undefined : normalizeBaseUrl(ctx.baseUrl);
  for (const rule of rules) {
    let hit = false;
    if (rule.type === "model") {
      hit = matches(rule.modelMatch, ctx.modelId, true);
    } else if (rule.type === "model-api") {
      hit =
        matches(rule.modelMatch, ctx.modelId, true) &&
        ctx.apiType != null &&
        matches(rule.apiTypeMatch, ctx.apiType);
    } else if (rule.type === "provider-site") {
      hit =
        matches(rule.modelMatch, ctx.modelId, true) &&
        (rule.apiTypeMatch === undefined
          ? true
          : ctx.apiType != null && matches(rule.apiTypeMatch, ctx.apiType)) &&
        normalizedBase !== undefined &&
        matches(rule.baseUrlMatch, normalizedBase);
    } else if (rule.type === "template-model") {
      hit = rule.templateId === ctx.templateId && rule.modelId === ctx.modelId;
    } else {
      hit = rule.providerId === ctx.providerId && rule.modelId === ctx.modelId;
    }
    if (hit) acc = overlayModelConfig(acc, rule.config);
  }
  return acc;
}

function flattenRules(
  modelRules: NonNullable<NonNullable<Release["config"]>["modelConfigRules"]>,
): OverlayRule[] {
  return [
    ...(modelRules.modelRules ?? []).map((r) => ({ ...r, type: "model" }) as OverlayRule),
    ...(modelRules.modelApiRules ?? []).map((r) => ({ ...r, type: "model-api" }) as OverlayRule),
    ...(modelRules.providerSiteRules ?? []).map(
      (r) => ({ ...r, type: "provider-site" }) as OverlayRule,
    ),
    ...(modelRules.templateModelRules ?? []).map(
      (r) => ({ ...r, type: "template-model" }) as OverlayRule,
    ),
    ...(modelRules.builtinProviderModelRules ?? []).map(
      (r) => ({ ...r, type: "provider-model" }) as OverlayRule,
    ),
  ];
}

// ---------------------------------------------------------------- 模型条目构建（CEL 逐档求值）

/** maxOutputTokens.map → paramName：哨兵恒等提取（单键且值 === 哨兵；否则省略）。 */
export function extractParamName(map: string | null | undefined): string | undefined {
  if (map == null) return undefined;
  const sentinel = 918_273;
  try {
    const result = evaluateModelOptionMap(map, "maxOutputTokens", sentinel);
    const keys = Object.keys(result);
    if (keys.length === 1 && result[keys[0]] === sentinel) return keys[0];
  } catch {
    // 求值失败 = 线映射未知，省略（标准 L2），不阻塞生成。
  }
  return undefined;
}

/** reasoningLevel.map × 档位值 → params；求值失败返回 undefined（省略不伪造）。 */
export function evaluateTierParams(
  map: string | null | undefined,
  tierId: string,
): Record<string, unknown> | undefined {
  if (map == null) return undefined;
  try {
    return evaluateModelOptionMap(map, "reasoningLevel", tierId) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function omitUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

/** 求值后的规则 config → 标准模型条目（enabled:false 保留标注）。 */
export function buildModelEntry(modelId: string, cfg: RuleConfig): AgentModelEntry {
  const props = cfg.properties ?? undefined;
  const inputFlags = (() => {
    const f = props?.inputFormat;
    if (f == null) return undefined;
    const flags = omitUndefined({
      text: f.supportsText ?? undefined,
      image: f.supportsImage ?? undefined,
      video: f.supportsVideo ?? undefined,
      audio: f.supportsAudio ?? undefined,
      pdf: f.supportsPdf ?? undefined,
    });
    return Object.keys(flags).length > 0 ? flags : undefined;
  })();
  const outputFlags = (() => {
    const f = props?.outputFormat;
    if (f?.supportsText == null) return undefined;
    return { text: f.supportsText };
  })();
  const properties =
    props == null
      ? undefined
      : omitUndefined({
          contextWindow: props.contextWindow ?? undefined,
          input: inputFlags,
          output: outputFlags,
          supportsToolCall: props.supportsToolCall ?? undefined,
          supportsJsonSchemaOutput: props.supportsJsonSchemaOutput ?? undefined,
          supportsNativeWebSearch: props.supportsNativeWebSearch ?? undefined,
          supportsMidConversationSystem: props.supportsMidConversationSystem ?? undefined,
          requiresMfjsToolSchema: props.requiresMfjsToolSchema ?? undefined,
        });

  const specs = cfg.optionSpecs ?? undefined;
  const reasoningValues = specs?.reasoningLevel?.values;
  const reasoning =
    reasoningValues != null && reasoningValues.length > 0
      ? {
          tiers: reasoningValues.map((tierId) =>
            omitUndefined({
              id: tierId,
              kind: TOGGLE_TIER_IDS.has(tierId) ? ("toggle" as const) : ("effort" as const),
              params: evaluateTierParams(specs?.reasoningLevel?.map, tierId),
            }),
          ),
        }
      : undefined;
  const maxOut = specs?.maxOutputTokens;
  const maxOutputTokens =
    maxOut?.max != null
      ? omitUndefined({
          max: maxOut.max,
          paramName: extractParamName(maxOut.map),
        })
      : undefined;
  const options =
    reasoning === undefined && maxOutputTokens === undefined
      ? undefined
      : omitUndefined({ reasoning, maxOutputTokens });

  return omitUndefined({
    id: modelId,
    enabled: cfg.enabled === false ? false : undefined,
    properties: properties && Object.keys(properties).length > 0 ? properties : undefined,
    options,
  }) as AgentModelEntry;
}

// ---------------------------------------------------------------- 主提取

export interface ExtractResult {
  readonly config: AgentModelsConfig;
  readonly providerCount: number;
  readonly modelCount: number;
  readonly warnings: readonly string[];
}

/**
 * 从 zcode-builtin.json release 提取标准目录（语义见文件头）。
 * 结构不符 zod 收窄、模板缺 baseUrl/access 不可映射、provider 数量跌破下限时
 * 抛错——codegen 失败优于生成残缺目录。
 */
export function extract(release: unknown): ExtractResult {
  const parsed = ReleaseSchema.safeParse(release);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(
      `zcode-builtin.json 结构不符合预期：${issue?.path.join(".") ?? "<root>"} ${issue?.message ?? ""}`,
    );
  }
  const config = parsed.data.config;
  const templates = config.providerConfigRules?.templateRules ?? [];
  const providerRules = config.providerConfigRules?.providerRules ?? [];
  const modelRules = config.modelConfigRules ?? {};
  const rules = flattenRules(modelRules);
  const warnings: string[] = [];

  type ProviderOut = AgentModelsConfig["providers"][number];
  const providers: ProviderOut[] = [];
  const seenIds = new Set<string>();
  let modelCount = 0;

  const pushProvider = (provider: ProviderOut): void => {
    // 唯一性先于空清单检查（B6）：空 provider 跳过也不得绕过重复 id 判定。
    if (seenIds.has(provider.id)) throw new Error(`provider id 重复：${provider.id}`);
    seenIds.add(provider.id);
    if (provider.models.length === 0) {
      warnings.push(`provider ${provider.id} 模型清单为空，跳过`);
      return;
    }
    modelCount += provider.models.length;
    providers.push(provider);
  };

  for (const template of templates) {
    const templateId = template.templateId;
    const api = template.config?.api;
    if (api == null || api.baseUrl == null) {
      throw new Error(`模板 ${templateId} 缺 api.baseUrl`);
    }
    const access = template.config?.access;
    if (access == null) {
      throw new Error(`模板 ${templateId} 缺 access`);
    }
    // access.type 枚举域已在解析期收窄（api-key | zhipu-coding-plan-api-key）。
    const accessType = access.type === "api-key" ? ("api-key" as const) : ("plan-api-key" as const);
    const names = Object.fromEntries(
      Object.entries(template.templateNameMap ?? {}).filter(([, name]) => name.length > 0),
    );
    const headers = api.headers && Object.keys(api.headers).length > 0 ? api.headers : undefined;

    // 上游 resolver 的 uniqueInOrder 语义：builtin 清单保序去重（重复非漂移）。
    const modelIds = [...new Set(template.config?.builtinModelIds ?? [])];
    for (const rule of modelRules.templateModelRules) {
      if (rule.templateId === templateId && !modelIds.includes(rule.modelId))
        modelIds.push(rule.modelId);
    }
    const models = modelIds.map((modelId) => {
      const cfg = resolveModelConfig(rules, {
        // 标准 provider id = templateId：provider-model 层按此身份命中（B3）。
        providerId: templateId,
        templateId,
        modelId,
        apiType: api.type,
        baseUrl: api.baseUrl ?? undefined,
      });
      return buildModelEntry(modelId, cfg);
    });

    pushProvider({
      id: templateId,
      ...(vendorOfTemplateId(templateId) ? { vendor: vendorOfTemplateId(templateId) } : {}),
      ...(Object.keys(names).length > 0 ? { names } : {}),
      ...(LOGO_SLUGS[templateId]
        ? { logoUrl: `https://models.dev/logos/${LOGO_SLUGS[templateId]}.svg` }
        : {}),
      access: {
        type: accessType,
        ...(access.apiKeyManagementUrl != null
          ? { apiKeyManagementUrl: access.apiKeyManagementUrl }
          : {}),
      },
      api: {
        protocol: api.type,
        baseUrl: api.baseUrl,
        ...(headers ? { headers } : {}),
      },
      models,
    });
  }

  for (const rule of providerRules) {
    const api = rule.config?.api;
    const access = rule.config?.access;
    if (api == null || api.baseUrl == null) {
      throw new Error(`provider ${rule.providerId} 缺 api.baseUrl`);
    }
    if (access == null) {
      // 订阅账号体系之外的 builtin providerRule 形态 = 上游结构演进，失败优于错映。
      throw new Error(`provider ${rule.providerId} 不是可映射的 zhipu-account 形态`);
    }
    // 标准 §9：account provider 的 vendor = access.accountType（B9）；
    // group 与 accountType 不一致 = 上游数据异常，拒绝而非择一。
    const vendor = access.accountType;
    const groupVendor = GROUP_VENDOR[rule.config?.group ?? ""];
    if (groupVendor !== vendor) {
      throw new Error(
        `provider ${rule.providerId} group（${rule.config?.group}）与 accountType（${vendor}）不一致`,
      );
    }

    // builtin 清单保序去重（上游 uniqueInOrder 语义）。
    const modelIds = [...new Set(rule.config?.builtinModelIds ?? [])];
    const models = modelIds.map((modelId) => {
      const cfg = resolveModelConfig(rules, {
        providerId: rule.providerId,
        modelId,
        apiType: api.type,
        baseUrl: api.baseUrl ?? undefined,
      });
      return buildModelEntry(modelId, cfg);
    });
    const headers = api.headers && Object.keys(api.headers).length > 0 ? api.headers : undefined;

    pushProvider({
      id: rule.providerId,
      vendor,
      ...(rule.providerName ? { names: { "en-US": rule.providerName } } : {}),
      ...(VENDOR_LOGO_SLUGS[vendor]
        ? { logoUrl: `https://models.dev/logos/${VENDOR_LOGO_SLUGS[vendor]}.svg` }
        : {}),
      ...(rule.config?.visibility === "hidden" ? { visibility: "hidden" as const } : {}),
      access: { type: "account", vendor, plan: access.mode },
      api: {
        protocol: api.type,
        baseUrl: api.baseUrl,
        ...(headers ? { headers } : {}),
      },
      models,
    });
  }

  if (providers.length === 0) {
    throw new Error("zcode-builtin.json 未提取到任何 provider（上游结构变化？）");
  }

  return {
    config: {
      schemaVersion: 1,
      revision: parsed.data.revision,
      generatedAt: new Date().toISOString(),
      sources: [
        {
          id: "zcode-registry",
          // 溯源恒为 canonical 上游（N2）：本地 fixture 重跑不污染入库 provenance。
          url: RAW_URL,
          upstreamRevision: parsed.data.revision,
          fetchedAt: new Date().toISOString(),
          license: "Apache-2.0",
        },
        { id: "models-dev", url: "https://models.dev/logos/" },
      ],
      providers,
    },
    providerCount: providers.length,
    modelCount,
    warnings,
  };
}

async function loadBuiltin(): Promise<{ raw: string; origin: string }> {
  const argFile = process.argv[2];
  if (argFile) {
    return { raw: await readFile(argFile, "utf8"), origin: `local:${argFile}` };
  }
  const response = await fetch(RAW_URL, { redirect: "follow" });
  if (!response.ok) throw new Error(`拉取 zcode-builtin.json 失败：HTTP ${response.status}`);
  return { raw: await response.text(), origin: RAW_URL };
}

async function main(): Promise<void> {
  const { raw, origin } = await loadBuiltin();
  const release: unknown = JSON.parse(raw);
  const { config, providerCount, modelCount, warnings } = extract(release);
  if (providerCount < MIN_PROVIDER_FLOOR) {
    throw new Error(
      `提取到的 provider 数量（${providerCount}）低于下限 ${MIN_PROVIDER_FLOOR}，上游结构变化？`,
    );
  }
  // 落盘前以标准 schema 全量复核（B4）：非法数值/URL/重复 id 在覆盖旧生成物前拦截。
  AgentModelsConfigSchema.parse(config);
  const generatedAt = new Date().toISOString().slice(0, 10);

  const body = `/**
 * agent-models-config v1 生成物（生成文件，勿手改）——由 scripts/extract-agent-models.sh.ts
 * 从 zai-org/ZCode 的 zcode-builtin.json 五层规则求值产出（标准
 * docs/standards/agent-models-config.md；替换旧 zcode-presets 6 字段提取）。
 * 重跑：bun scripts/extract-agent-models.sh.ts [本地 json 路径]（缺省拉 GitHub raw
 * main）；生成后执行 pnpm exec vp fmt --write src/daemon/agent-models.generated.ts。
 * 上游 Apache-2.0；canonical 数据源：${RAW_URL}
 * 上游 revision ${config.revision}；${providerCount} provider / ${modelCount} 模型；生成于 ${generatedAt}。
 * 语义备注：enabled:false 条目保留（产品投影层过滤）；account:* 订阅型 provider 在列
 * （产品 apiKey 路由面过滤，entitled 是运行时事实不落盘）；reasoning tiers[].params =
 * CEL map 逐档静态求值（求值失败的档省略 params）；paramName 哨兵恒等提取（不确定则
 * 省略）；logoUrl 为 models.dev 静态 logo 资产（图标回退序：本仓 PROVIDER_ICONS →
 * logoUrl → 字母头像）。
 */

import type { AgentModelsConfig } from "../shared/contracts/agent-models.js";

export const AGENT_MODELS_SOURCE_URL = ${JSON.stringify(RAW_URL)};

export const AGENT_MODELS_UPSTREAM_REVISION = ${config.revision};

export const AGENT_MODELS_GENERATED_AT = ${JSON.stringify(generatedAt)};

export const agentModelsConfig: AgentModelsConfig = ${JSON.stringify(config, null, 2)};
`;

  const outPath = fileURLToPath(OUT_FILE);
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, body, "utf8");
  process.stdout.write(
    `已生成 ${path.relative(process.cwd(), outPath)}：${providerCount} provider / ${modelCount} 模型（revision ${config.revision}；实际来源 ${origin}，入库溯源恒为 canonical URL）\n`,
  );
  for (const warning of warnings) process.stderr.write(`warning: ${warning}\n`);
}

// 判主（Bun/Node 通用）：直接执行才跑 main；被测试 import 时不产生副作用。
const invokedDirectly = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
