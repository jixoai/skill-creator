/**
 * 模型 provider 目录服务（agent-models-config v1：标准生成物纯投影）。
 *
 * 用户原始需求 [2026-09-30]：「将 zcode 标准作为 agent-models-config 配置标准。」
 * （承接 [2026-09-25] Owner 裁决「不再依赖 models.dev」——数据源从 6 字段预设
 * 提取升级为标准 v1 完整运行时能力标注。）
 *
 * 数据源 = src/daemon/agent-models.generated.ts（scripts/extract-agent-models.sh.ts
 * 从 zai-org/ZCode zcode-builtin.json 五层规则求值产出；标准
 * docs/standards/agent-models-config.md）。
 *
 * 正交意图：
 *   [1] 投影：AgentModelProviderEntry → ModelProviderCatalogEntry{provider = id，
 *       label = names（zh-CN 优先），api 经 API_NAME_MAP 单点映射（ZCode 协议名 →
 *       本仓路由口径），baseURL 直传，models[{id, image, inputTypes（标准 input
 *       旗标派生，缺省回退 text-only）, contextWindow, maxOutputTokens,
 *       supportsReasoningEffort/effortTiers（剔 toggle 档）, supportsToolCall,
 *       supportsJsonSchemaOutput}]}；能力字段缺省不伪造（标准 L2）。
 *       重点 provider（标准 id 口径）置顶，其余字母序。
 *   [2] 产品过滤：enabled === false 模型与 access.type === "account" 的订阅型
 *       provider 不进产品目录（apiKey 路由面是现状约束；标准生成物保留两者）。
 *   [3] 图标回退序：本仓 PROVIDER_ICONS 命中（dataURL）→ 生成物 logoUrl
 *       （models.dev 静态资产）→ null（UI 字母头像）。
 * 妥协声明：无。
 */
import type { AgentModelEntry, AgentModelProviderEntry } from "../shared/contracts/agent-models.js";
import type { ModelProviderCatalogEntry } from "../shared/contracts/dsh-runtime.js";
import { PROVIDER_ICONS } from "../shared/provider-icons.generated.js";
import { AGENT_MODELS_UPSTREAM_REVISION, agentModelsConfig } from "./agent-models.generated.js";

/** 重点 provider 置顶顺序（agent-models-config provider id 口径）。 */
const KNOWN_PROVIDER_ORDER: readonly string[] = [
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
];

/** 协议名映射：标准/ZCode 三型 → 本仓 ROUTE_APIS（仅 chat-completions 不同名）。 */
const API_NAME_MAP: Readonly<Record<string, string>> = {
  "anthropic-messages": "anthropic-messages",
  "openai-chat-completions": "openai-completions",
  "openai-responses": "openai-responses",
};

/** 输入模态产品域投影序（标准 input 旗标 → 契约 inputTypes）。 */
const INPUT_TYPE_ORDER = ["text", "image", "video", "pdf"] as const;

/** 目录 icon 回退序：本仓 PROVIDER_ICONS（dataURL）→ 生成物 logoUrl → null。 */
export function resolveProviderIcon(
  provider: string,
  logoUrl: string | undefined,
  icons: Readonly<Record<string, string>> = PROVIDER_ICONS,
): string | null {
  const known = icons[provider];
  if (known !== undefined && known.length > 0) return known;
  return logoUrl ?? null;
}

/** 单模型投影（能力字段缺省不伪造；effort 档 = tiers 剔 toggle 档）。 */
function projectModel(model: AgentModelEntry): ModelProviderCatalogEntry["models"][number] {
  // 输入模态未声明（unknown）时回退 ["text"] 是产品回退政策（标准 L2 允许消费方
  // 自决；text 是目录模型最低合理假设，UI 模态 chips 用户可改），非标准层伪造。
  const input = model.properties?.input;
  const inputTypes = input
    ? INPUT_TYPE_ORDER.filter((type) => input[type] === true)
    : ["text" as const];
  const tiers = model.options?.reasoning?.tiers ?? [];
  const effortTiers = [...new Set(tiers.filter((tier) => tier.kind !== "toggle").map((t) => t.id))];
  const maxOutputTokens = model.options?.maxOutputTokens?.max;
  return {
    id: model.id,
    image: input?.image === true,
    inputTypes,
    ...(model.properties?.contextWindow !== undefined
      ? { contextWindow: model.properties.contextWindow }
      : {}),
    ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
    ...(tiers.length > 0 ? { supportsReasoningEffort: effortTiers.length > 0 } : {}),
    ...(effortTiers.length > 0 ? { effortTiers } : {}),
    ...(model.properties?.supportsToolCall !== undefined
      ? { supportsToolCall: model.properties.supportsToolCall }
      : {}),
    ...(model.properties?.supportsJsonSchemaOutput !== undefined
      ? { supportsJsonSchemaOutput: model.properties.supportsJsonSchemaOutput }
      : {}),
  };
}

/** 单 provider 投影；产品不可路由（account 型 / 协议不可映射 / 无可选模型）返回 null。 */
export function projectProvider(
  provider: AgentModelProviderEntry,
): ModelProviderCatalogEntry | null {
  if (provider.access.type === "account") return null;
  const api = API_NAME_MAP[provider.api.protocol];
  if (api === undefined) return null;
  const models = provider.models.filter((model) => model.enabled !== false).map(projectModel);
  if (models.length === 0) return null;
  return {
    provider: provider.id,
    label: provider.names?.["zh-CN"] ?? provider.names?.["en-US"] ?? provider.id,
    api,
    baseURL: provider.api.baseUrl,
    icon: resolveProviderIcon(provider.id, provider.logoUrl),
    models,
  };
}

/** 全量 provider 目录（标准生成物纯投影；重点置顶，其余字母序）。 */
export function listModelProviders(): ModelProviderCatalogEntry[] {
  const rank = new Map(KNOWN_PROVIDER_ORDER.map((id, index) => [id, index]));
  return agentModelsConfig.providers
    .map(projectProvider)
    .filter((entry): entry is ModelProviderCatalogEntry => entry !== null)
    .sort((a, b) => {
      const ra = rank.get(a.provider) ?? Number.MAX_SAFE_INTEGER;
      const rb = rank.get(b.provider) ?? Number.MAX_SAFE_INTEGER;
      return ra !== rb ? ra - rb : a.provider.localeCompare(b.provider);
    });
}

/** 服务面（domain 装配用）。 */
export function createModelCatalogService() {
  return {
    /** 全量目录（生成物进程内常驻，纯计算无 IO）。 */
    list(): ModelProviderCatalogEntry[] {
      return listModelProviders();
    },
    /** 目录数据上游修订号（agent-models-config 信封 revision，provenance 出口）。 */
    sourceRevision(): number {
      return AGENT_MODELS_UPSTREAM_REVISION;
    },
  };
}

export type ModelCatalogService = ReturnType<typeof createModelCatalogService>;
