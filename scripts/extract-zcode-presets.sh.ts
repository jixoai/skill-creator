/**
 * ZCode Registry 预设提取脚本（settings-panel-zcode-source task 1.1）。
 *
 * 用户原始需求 [2026-09-25]（Owner 裁决）：「不再依赖 models.dev……请参考
 * shufa-server……使用它那套数据结构和 zcode 源更新脚本，我们自己这套 models.dev
 * 已经可以完全放弃。」
 *
 * 提取语义与 shufa-server daemon/scripts/extract-zcode-presets.mjs 逐条对齐：
 *   provider = templateId（作路由 provider 标识，天然区分 zai-api/zai-standard-api）
 *   name     = templateNameMap["zh-CN"] ?? en-US ?? templateId（zh-CN 品牌名优先）
 *   baseURL  = api.baseUrl；api = 协议名映射（openai-chat-completions → 本仓
 *              openai-completions；其余两值两侧同名直传）
 *   iconUrl  = models.dev logo（templateId → slug 对照表，缺失则不产 iconUrl 键）
 *   模型清单 = builtinModelIds ∪ templateModelRules（去重保序，builtin 在前），
 *              富字段按 ZCode 规则引擎有序叠加静态求值：modelRules → modelApiRules
 *              → providerSiteRules → templateModelRules（后到覆盖；叠加语义 =
 *              undefined 继承旧值 / 其余含 null 替换），取 contextWindow /
 *              supportsImage / reasoningLevel.values / maxOutputTokens.max。
 *   account:* providerRules 与 builtinProviderModelRules（providerId 精确的账号
 *   登录体系）不提取——产品路由只支持 apiKey。
 *
 * 正交意图：
 *   [1] 一次提取：zcode-builtin.json（RAW_URL 或本地路径参数）→ src/daemon/
 *       zcode-presets.ts 生成物（自持 ModelPreset 类型，避免 contracts 依赖生成物；
 *       重跑 = 生成文件整体换新，无逐条 source 标识）。
 *   [2] 可测纯逻辑：上游 JSON 经 zod 收窄；extract / 规则叠加求值函数以可导入
 *       形式暴露（test/extract-zcode-presets.test.ts fixture 驱动），main 仅在
 *       直接执行时运行（import.meta.url === argv[1]，Bun/Node 通用判主）。
 *
 * 用法：bun scripts/extract-zcode-presets.sh.ts [zcode-builtin.json 路径]
 *   缺省从 GitHub raw main 分支拉取最新；建议随上游 revision 升级时重跑。
 * 上游：https://github.com/zai-org/ZCode（Apache-2.0）config/provider/zcode-builtin.json
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";

const RAW_URL =
  "https://raw.githubusercontent.com/zai-org/ZCode/main/config/provider/zcode-builtin.json";
const OUT_FILE = new URL("../src/daemon/zcode-presets.ts", import.meta.url);

/** 协议名映射：ZCode 三型 → 本仓 ROUTE_APIS（仅 chat-completions 不同名）。 */
export const API_NAME_MAP: Readonly<Record<string, string>> = {
  "anthropic-messages": "anthropic-messages",
  "openai-chat-completions": "openai-completions",
  "openai-responses": "openai-responses",
};

/** templateId → models.dev logo slug（逐一经 models.dev api.json 核对存在）。 */
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

// ---------------------------------------------------------------- 上游结构收窄（zod）

/** 规则 config 里本项目用得上的叶子（形状与 zcode-builtin.json 对齐）。 */
const RuleConfigSchema = z.looseObject({
  properties: z
    .looseObject({
      contextWindow: z.number().optional(),
      inputFormat: z.looseObject({ supportsImage: z.boolean().optional() }).optional(),
    })
    .optional(),
  optionSpecs: z
    .looseObject({
      reasoningLevel: z.looseObject({ values: z.array(z.string()).nullish() }).optional(),
      maxOutputTokens: z.looseObject({ max: z.number().optional() }).optional(),
    })
    .optional(),
});

const ModelRuleSchema = z.looseObject({
  modelMatch: z.string(),
  config: RuleConfigSchema.optional(),
});
const ModelApiRuleSchema = z.looseObject({
  modelMatch: z.string(),
  apiTypeMatch: z.string().optional(),
  config: RuleConfigSchema.optional(),
});
const ProviderSiteRuleSchema = z.looseObject({
  modelMatch: z.string(),
  apiTypeMatch: z.string().optional(),
  baseUrlMatch: z.string(),
  config: RuleConfigSchema.optional(),
});
const TemplateModelRuleSchema = z.looseObject({
  templateId: z.string(),
  modelId: z.string(),
  config: RuleConfigSchema.optional(),
});

const TemplateSchema = z.looseObject({
  templateId: z.string(),
  templateNameMap: z.record(z.string(), z.string()).optional(),
  config: z
    .looseObject({
      api: z.looseObject({ type: z.string(), baseUrl: z.string().optional() }).optional(),
      builtinModelIds: z.array(z.string()).optional(),
    })
    .optional(),
});

const ReleaseSchema = z.looseObject({
  revision: z.number().optional(),
  config: z
    .looseObject({
      providerConfigRules: z.looseObject({ templateRules: z.array(TemplateSchema) }).optional(),
      modelConfigRules: z
        .looseObject({
          modelRules: z.array(ModelRuleSchema).optional(),
          modelApiRules: z.array(ModelApiRuleSchema).optional(),
          providerSiteRules: z.array(ProviderSiteRuleSchema).optional(),
          templateModelRules: z.array(TemplateModelRuleSchema).optional(),
        })
        .optional(),
    })
    .optional(),
});

type RuleConfig = z.infer<typeof RuleConfigSchema>;
type Release = z.infer<typeof ReleaseSchema>;

/** 有序叠加的规则平铺形态（type 为打平标记；叠加顺序 = 数组先后）。 */
export type OverlayRule =
  | { type: "model"; modelMatch: string; config?: RuleConfig }
  | {
      type: "model-api";
      modelMatch: string;
      apiTypeMatch?: string;
      config?: RuleConfig;
    }
  | {
      type: "provider-site";
      modelMatch: string;
      apiTypeMatch?: string;
      baseUrlMatch: string;
      config?: RuleConfig;
    }
  | { type: "template-model"; templateId: string; modelId: string; config?: RuleConfig };

/** 规则引擎求值出的模型叶子（undefined = 上游未声明）。 */
export interface ModelLeaves {
  contextWindow: number | undefined;
  supportsImage: boolean | undefined;
  reasoningValues: string[] | null | undefined;
  maxOutputTokens: number | undefined;
}

// ---------------------------------------------------------------- 规则叠加求值（纯函数）

/** ZCode overlayValue 语义的叶子版：undefined=继承旧值，其余（含 null 清空）替换。 */
export function overlayValue<T>(prev: T, next: T | undefined): T {
  return next === undefined ? prev : next;
}

/** 把一条规则 config 的可提取叶子叠加进 acc（形状与 zcode-builtin.json 对齐）。 */
export function overlayRuleLeaves(acc: ModelLeaves, config: RuleConfig | undefined): ModelLeaves {
  if (!config) return acc;
  const props = config.properties ?? {};
  acc.contextWindow = overlayValue(acc.contextWindow, props.contextWindow);
  acc.supportsImage = overlayValue(acc.supportsImage, props.inputFormat?.supportsImage);
  const values = config.optionSpecs?.reasoningLevel?.values;
  if (values !== undefined) acc.reasoningValues = overlayValue(acc.reasoningValues, values);
  const max = config.optionSpecs?.maxOutputTokens?.max;
  if (max !== undefined) acc.maxOutputTokens = overlayValue(acc.maxOutputTokens, max);
  return acc;
}

/** ZCode matchesRule：pattern 锚定全串正则。 */
export function matches(pattern: string, value: string, ignoreCase = false): boolean {
  try {
    return new RegExp(`^(?:${pattern})$`, ignoreCase ? "i" : undefined).test(value);
  } catch {
    return false;
  }
}

/** URL 规范化（ZCode normalizeBaseURLForRuleMatch 语义：去尾斜杠，保留 path/query）。 */
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

/**
 * 按模板上下文对单模型求值全部通用规则 + 模板精确规则
 * （顺序与 ZCode ModelConfigRules.composeEffective 的 builtin 序一致，后到先得）。
 * provider-model / manual-provider-model：providerId 精确（account:* 体系），不适用模板提取。
 */
export function resolveModelLeaves(
  rules: readonly OverlayRule[],
  ctx: { templateId: string; modelId: string; apiType?: string; baseUrl?: string },
): ModelLeaves {
  const acc: ModelLeaves = {
    contextWindow: undefined,
    supportsImage: undefined,
    reasoningValues: undefined,
    maxOutputTokens: undefined,
  };
  const normalizedBase = ctx.baseUrl == null ? undefined : normalizeBaseUrl(ctx.baseUrl);
  for (const rule of rules) {
    if (rule.type === "model") {
      if (matches(rule.modelMatch, ctx.modelId, true)) overlayRuleLeaves(acc, rule.config);
    } else if (rule.type === "model-api") {
      if (
        matches(rule.modelMatch, ctx.modelId) &&
        (rule.apiTypeMatch === undefined ||
          (ctx.apiType != null && matches(rule.apiTypeMatch, ctx.apiType)))
      )
        overlayRuleLeaves(acc, rule.config);
    } else if (rule.type === "provider-site") {
      if (
        matches(rule.modelMatch, ctx.modelId) &&
        (rule.apiTypeMatch === undefined
          ? true
          : ctx.apiType != null && matches(rule.apiTypeMatch, ctx.apiType)) &&
        normalizedBase !== undefined &&
        matches(rule.baseUrlMatch, normalizedBase)
      )
        overlayRuleLeaves(acc, rule.config);
    } else if (rule.type === "template-model") {
      if (rule.templateId === ctx.templateId && rule.modelId === ctx.modelId)
        overlayRuleLeaves(acc, rule.config);
    }
  }
  return acc;
}

// ---------------------------------------------------------------- 主流程

/** 提取产物（脚本侧构建形态；生成文件里是 readonly 投影）。 */
export interface ExtractResult {
  readonly presets: ReadonlyArray<{
    provider: string;
    name: string;
    baseURL: string;
    api: string;
    iconUrl?: string;
    models: ReadonlyArray<{
      id: string;
      contextWindow?: number;
      inputTypes: string[];
      efforts?: string[];
    }>;
  }>;
  readonly modelCount: number;
  readonly revision: number | undefined;
}

/**
 * 从 zcode-builtin.json release 提取 provider 预设（语义见文件头）。
 * 结构不符 zod 收窄、模板缺 baseUrl/协议不可映射、模型清单为空时抛错——
 * codegen 失败优于生成残缺目录。
 */
export function extract(release: unknown): ExtractResult {
  const parsed = ReleaseSchema.safeParse(release);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(
      `zcode-builtin.json 结构不符合预期：${issue?.path.join(".") ?? "<root>"} ${issue?.message ?? ""}`,
    );
  }
  const config = parsed.data.config ?? {};
  const templates = config.providerConfigRules?.templateRules ?? [];
  const modelRules = config.modelConfigRules ?? {};

  // 规则平铺成带 type 的有序列表（叠加顺序 = 各数组先后）。
  const orderedRules: OverlayRule[] = [
    ...(modelRules.modelRules ?? []).map((r) => ({ ...r, type: "model" }) as OverlayRule),
    ...(modelRules.modelApiRules ?? []).map((r) => ({ ...r, type: "model-api" }) as OverlayRule),
    ...(modelRules.providerSiteRules ?? []).map(
      (r) => ({ ...r, type: "provider-site" }) as OverlayRule,
    ),
    ...(modelRules.templateModelRules ?? []).map(
      (r) => ({ ...r, type: "template-model" }) as OverlayRule,
    ),
  ];

  const presets: ExtractResult["presets"][number][] = [];
  let modelCount = 0;
  for (const template of templates) {
    const templateId = template.templateId;
    const cfg = template.config ?? {};
    const api = cfg.api;
    const mappedApi = api !== undefined ? API_NAME_MAP[api.type] : undefined;
    if (api === undefined || api.baseUrl === undefined || mappedApi === undefined) {
      throw new Error(
        `模板 ${templateId} 缺 baseUrl 或协议不可映射：${api?.type ?? "<无 api 段>"}`,
      );
    }
    const names = template.templateNameMap ?? {};
    const preset = {
      provider: templateId,
      name: names["zh-CN"] ?? names["en-US"] ?? templateId,
      baseURL: api.baseUrl,
      api: mappedApi,
      ...(LOGO_SLUGS[templateId]
        ? { iconUrl: `https://models.dev/logos/${LOGO_SLUGS[templateId]}.svg` }
        : {}),
      models: [] as ExtractResult["presets"][number]["models"][number][],
    };

    // 模型清单：builtinModelIds 保序在前，templateModelRules 的增量补后（去重保序）。
    const ids = [...(cfg.builtinModelIds ?? [])];
    for (const rule of modelRules.templateModelRules ?? []) {
      if (rule.templateId === templateId && !ids.includes(rule.modelId)) ids.push(rule.modelId);
    }
    for (const modelId of ids) {
      const leaves = resolveModelLeaves(orderedRules, {
        templateId,
        modelId,
        apiType: api.type,
        baseUrl: api.baseUrl,
      });
      preset.models.push({
        id: modelId,
        ...(leaves.contextWindow !== undefined ? { contextWindow: leaves.contextWindow } : {}),
        inputTypes: leaves.supportsImage === true ? ["text", "image"] : ["text"],
        ...(leaves.reasoningValues !== undefined && leaves.reasoningValues !== null
          ? { efforts: [...leaves.reasoningValues] }
          : {}),
      });
    }
    if (preset.models.length === 0) {
      throw new Error(`模板 ${templateId} 模型清单为空`);
    }
    modelCount += preset.models.length;
    presets.push(preset);
  }
  if (presets.length === 0) {
    throw new Error("zcode-builtin.json 未提取到任何模板（上游结构变化？）");
  }
  return { presets, modelCount, revision: parsed.data.revision };
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
  const { presets, modelCount, revision } = extract(release);
  const generatedAt = new Date().toISOString().slice(0, 10);
  const safeOrigin = origin.replace(/[\r\n`*]/g, "");

  const body = `/**
 * ZCode Registry 预设（生成文件，勿手改）——由 scripts/extract-zcode-presets.sh.ts
 * 从 zai-org/ZCode 的 zcode-builtin.json 静态提取（语义对齐 shufa-server 同名脚本）。
 * 重跑：bun scripts/extract-zcode-presets.sh.ts [本地 json 路径]（缺省拉 GitHub raw
 * main）；生成后执行 pnpm exec vp fmt --write src/daemon/zcode-presets.ts。
 * 上游 Apache-2.0；数据源：${safeOrigin}
 * 上游 revision ${revision ?? "unknown"}；${presets.length} 模板 / ${modelCount} 模型；生成于 ${generatedAt}。
 * 语义备注：模型 efforts = ZCode reasoningLevel 档位（含 disabled/enabled 这类开关型
 * 档，目录投影时剔除）；account:* 账号型 provider 不在内（产品路由仅支持 apiKey）；
 * maxOutputTokens.max 参与规则求值但不入产物（对齐 shufa ModelPreset 形状）。
 * 数据结构：ModelPreset{provider,name,baseURL,api,iconUrl?,models[{id,contextWindow?,
 * inputTypes,efforts?}]}——provider = zcode templateId；name = zh-CN 品牌名优先；
 * api 已映射本仓协议名（openai-chat-completions → openai-completions）；iconUrl 为
 * models.dev logo 外链（目录 icon 回退序：本仓 PROVIDER_ICONS → iconUrl → 字母头像）。
 */

/** 单个 provider 模板预设的模型条目（提取产物形状；与 shufa-server 对齐）。 */
export interface ModelPresetModel {
  readonly id: string;
  readonly contextWindow?: number;
  readonly inputTypes: ReadonlyArray<string>;
  readonly efforts?: ReadonlyArray<string>;
}

/** 单个 provider 模板预设（提取产物形状；与 shufa-server ModelPreset 对齐）。 */
export interface ModelPreset {
  readonly provider: string;
  readonly name: string;
  readonly baseURL: string;
  readonly api: string;
  readonly iconUrl?: string;
  readonly models: ReadonlyArray<ModelPresetModel>;
}

export const ZCODE_PRESET_SOURCE_URL = ${JSON.stringify(origin)};

export const zcodePresets: ReadonlyArray<ModelPreset> = ${JSON.stringify(presets, null, 2)};
`;

  const outPath = fileURLToPath(OUT_FILE);
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, body, "utf8");
  process.stdout.write(
    `已生成 ${path.relative(process.cwd(), outPath)}：${presets.length} 模板 / ${modelCount} 模型（revision ${revision ?? "unknown"}）\n`,
  );
}

// 判主（Bun/Node 通用）：直接执行才跑 main；被测试 import 时不产生副作用。
const invokedDirectly = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
