/**
 * 模型字段语义助手（R7 8.5/8.7 + R10 五项走查修订）。
 *
 * 用户原始需求 [2026-09-12]：「ModelName：自动生成（id 的可读化：
 * `glm-5.3-flash` → `GLM 5.3 Flash`）+ 可改」；「上下文窗口 / 最大输出 Token：
 * 文本输入，接受 `0.5M`/`253k`/纯数字（用 parseTokenShorthand 校验，失焦解析为
 * 数字回显规范化格式如 `131.1k`）」；「补全源 = 全部已知供应商的模型并集，
 * UI 侧 Set 去重、排序」；「可用 Effort：tags-input + 补全」（codex R7 B2
 * 纠偏 [2026-09-12]：「Effort 设置这里，不能硬编码」——候选改为用户自派生并集）。
 * 用户原始需求 [2026-09-12 R10]：「智谱的模型，@cf/zai-org/glm-5.3 这明显是
 * 无效的」（跨 provider 候选剔除命名空间 id，当前 provider 置顶）；「input/
 * output 类型 chips 选中样式 + 目录默认选中」；「maxOutputTokens 目录预填」；
 * 「Effort 按照 OpenAI/Anthropic/Gemini 的接口标准提供各种档位，然后默认提供
 * Low/High/Max 三档」（EFFORT_TIERS/DEFAULT_MODEL_EFFORTS 为用户裁定，非硬编码
 * 违例——B2 禁的是候选词表凭空捏造，本常量是接口标准 + 明示裁决）。
 *
 * 正交意图：
 *   [1] 可读名派生：readableModelName 把 model id 的 -/_ 分段标题化（纯字母
 *       短段全大写：glm→GLM、gpt→GPT；含数字/长段首字母大写：flash→Flash）。
 *   [2] token 简写往返：formatTokenCount 是 parseTokenShorthand（shared 契约）
 *       的显示侧逆变换（k=1024、M=1024²；一位小数、整值去尾零）。
 *   [3] 补全池投影（R10-1 净化）：catalogModelCandidates 以当前 provider 分流——
 *       当前 provider 的目录模型（含命名空间 id）置顶，其余供应商剔除命名空间
 *       id 后并入（手输仍允许任意 id）；首见条目携带目录富字段（R10-3/4/5 的
 *       预填与 effort 候选数据源）。
 *   [4] effort 档位语义（R10-5）：EFFORT_TIERS 标准档位 + DEFAULT_MODEL_EFFORTS
 *       默认三档（用户裁定）；effortCandidates = 标准档位 ∪ 目录 effortTiers
 *       （命中时）∪ 全部路由已配置并集；目录 compat 声明
 *       supportsReasoningEffort === false 时清空候选并给 hint（tags-input 仍
 *       自由输入）。
 */
import { parseTokenShorthand } from "$shared/contracts/dsh-runtime.js";
import type {
  DshModelInputType,
  DshModelRoute,
  ModelProviderCatalogEntry,
} from "$shared/contracts/dsh-runtime.js";

/**
 * model id → 展示名：`-`/`_` 分段；纯字母且 ≤3 字符的段全大写（glm/gpt），
 * 其余段首字母大写（flash→Flash、5.3 原样）；段间以空格连接。
 */
export function readableModelName(id: string): string {
  return id
    .split(/[-_]+/)
    .filter((token) => token.length > 0)
    .map((token) =>
      /^[a-z]{1,3}$/.test(token)
        ? token.toUpperCase()
        : token.slice(0, 1).toUpperCase() + token.slice(1),
    )
    .join(" ");
}

/**
 * token 数的规范化显示（parseTokenShorthand 的逆变换）：≥1M 整倍数用 `M`，
 * 其余用 `k` 且保留一位小数（128k、131.1k、0.5M）；<1024 原样数字。
 */
export function formatTokenCount(value: number): string {
  if (!Number.isSafeInteger(value) || value <= 0) return String(value);
  if (value % (1024 * 1024) === 0) return `${value / (1024 * 1024)}M`;
  if (value >= 1024) {
    const k = value / 1024;
    return `${Number.isInteger(k) ? k.toString() : k.toFixed(1)}k`;
  }
  return String(value);
}

/**
 * 命名空间 model id（R10-1）：含 `/` 或 `@` 的 id（`@cf/zai-org/glm-5.3`、
 * `openai/gpt-4o`）只在其宿主 provider 上有效——出现在其他 provider 的补全
 * 并集里即为无效候选（用户例：智谱路由不应列出 @cf/ 前缀模型）。
 */
export function isNamespaceModelId(id: string): boolean {
  return id.includes("/") || id.includes("@");
}

/** 补全池条目（catalog 模型的 browser-safe 投影）。 */
export interface ModelCandidate {
  id: string;
  name?: string;
  image: boolean;
  contextWindow?: number;
  /** 目录 compat 声明是否支持 reasoning effort（缺省未知；effort 候选门）。 */
  supportsReasoningEffort?: boolean;
  /** 目录输入模态（pi-ai input 数组过滤；R10-3 inputTypes 预填源）。 */
  inputTypes?: DshModelInputType[];
  /** 目录最大输出 token（pi-ai maxTokens；R10-4 预填源）。 */
  maxOutputTokens?: number;
  /** thinking 档位键（pi-ai thinkingLevelMap 键剔 off；R10-5 effort 候选源）。 */
  effortTiers?: string[];
}

/** catalog 模型条目 → 补全池投影（可选字段有则带、无则省略键，不伪造）。 */
function projectCandidate(model: ModelProviderCatalogEntry["models"][number]): ModelCandidate {
  return {
    id: model.id,
    ...(model.name !== undefined ? { name: model.name } : {}),
    image: model.image,
    ...(model.contextWindow !== undefined ? { contextWindow: model.contextWindow } : {}),
    ...(model.supportsReasoningEffort !== undefined
      ? { supportsReasoningEffort: model.supportsReasoningEffort }
      : {}),
    ...(model.inputTypes !== undefined ? { inputTypes: [...model.inputTypes] } : {}),
    ...(model.maxOutputTokens !== undefined ? { maxOutputTokens: model.maxOutputTokens } : {}),
    ...(model.effortTiers !== undefined ? { effortTiers: [...model.effortTiers] } : {}),
  };
}

const byId = (a: ModelCandidate, b: ModelCandidate): number =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/**
 * 模型补全池（R7 8.5 并集 + R10-1 净化/置顶）：
 * - 当前 provider（currentProvider，调用方负责编号 slug → base 归一）的目录模型
 *   置顶优先，含其命名空间 id（宿主 provider 上它们是有效 id）；
 * - 其余供应商剔除命名空间 id 后并入（跨 provider 的 `@cf/...`、`org/model`
 *   只在宿主上有效）；
 * - 两组各自按 id Set 去重 + 字典序排序；当前 provider 的同 id 条目覆盖其他
 *   供应商的净化条目（预填数据取宿主目录值）。手输仍允许任意 id。
 */
export function catalogModelCandidates(
  catalog: { providers: ModelProviderCatalogEntry[] } | null,
  currentProvider = "",
): ModelCandidate[] {
  const own = new Map<string, ModelCandidate>();
  const others = new Map<string, ModelCandidate>();
  for (const provider of catalog?.providers ?? []) {
    const isCurrent = provider.provider === currentProvider;
    for (const model of provider.models) {
      if (isCurrent) {
        if (!own.has(model.id)) own.set(model.id, projectCandidate(model));
        others.delete(model.id);
      } else if (!own.has(model.id) && !others.has(model.id)) {
        if (isNamespaceModelId(model.id)) continue;
        others.set(model.id, projectCandidate(model));
      }
    }
  }
  return [...own.values()].sort(byId).concat([...others.values()].sort(byId));
}

/**
 * 标准 effort 档位（R10-5 用户裁定 [2026-09-12]：「按照 OpenAI/Anthropic/Gemini
 * 的接口标准提供各种档位」）：OpenAI minimal/low/medium/high + xhigh +
 * Gemini/Claude 风格 max。作为补全基线词表，与目录 effortTiers、用户已配置
 * 并集融合，不单独构成硬编码候选全集。
 */
export const EFFORT_TIERS: readonly string[] = ["minimal", "low", "medium", "high", "xhigh", "max"];

/** 新增模型条目的默认 effort 三档（R10-5 用户指定 Low/High/Max）。 */
export const DEFAULT_MODEL_EFFORTS: readonly string[] = ["low", "high", "max"];

/** 目录声明不支持 reasoning effort 时的固定 hint（ModelListItem 展示）。 */
export const EFFORT_UNSUPPORTED_HINT =
  "Catalog marks this model as not supporting reasoning effort";

/** effortCandidates 的返回形状（候选 + 可选目录 hint）。 */
export interface EffortCandidatesResult {
  /** 补全候选（标准档位 ∪ 目录 effortTiers ∪ 路由并集，去重排序；空 = 无建议）。 */
  candidates: string[];
  /** 非 null = 目录声明该模型不支持 effort（候选清空，展示此 hint）。 */
  hint: string | null;
}

/**
 * 可用 Effort 补全候选（R7 B2 用户自派生 + R10-5 融合）：候选 =
 * EFFORT_TIERS（接口标准档位，用户裁定）∪ 目录 effortTiers（当前 id 命中目录
 * 条目时）∪ 全部路由（含草案）已配置 efforts 的并集，Set 去重 + 字典序排序。
 * 目录命中且 supportsReasoningEffort === false 时返回空候选 + hint；
 * tags-input 仍自由输入（hint 是提示不是阻断）。
 */
export function effortCandidates(
  allRouteModels: ReadonlyArray<{ efforts?: readonly string[] | undefined }>,
  catalogMatch:
    | {
        supportsReasoningEffort?: boolean;
        effortTiers?: readonly string[];
      }
    | null
    | undefined,
): EffortCandidatesResult {
  if (catalogMatch?.supportsReasoningEffort === false) {
    return { candidates: [], hint: EFFORT_UNSUPPORTED_HINT };
  }
  const union = new Set<string>(EFFORT_TIERS);
  for (const tier of catalogMatch?.effortTiers ?? []) {
    const trimmed = tier.trim();
    if (trimmed.length > 0) union.add(trimmed);
  }
  for (const model of allRouteModels) {
    for (const effort of model.efforts ?? []) {
      const trimmed = effort.trim();
      if (trimmed.length > 0) union.add(trimmed);
    }
  }
  return { candidates: [...union].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)), hint: null };
}

/**
 * 目录命中 → 新条目默认值（R10-3/4/5 预填钩子的 NewRouteTab 侧共用）：新建
 * 路由从目录/seed 预填模型时携带目录富字段（name/contextWindow/inputTypes/
 * maxOutputTokens），outputTypes 恒 ["text"]（pi-ai 无 output 数据，产品面恒
 * text），efforts 取默认三档。inputTypes 缺省时回退 image 旗标（目录投影里
 * image 由同一 input 数组派生，仅手造候选才会走到回退分支）。
 */
export function catalogEntryDefaults(
  model: ModelProviderCatalogEntry["models"][number],
): RouteModelEntry {
  return {
    id: model.id,
    ...(model.name !== undefined ? { name: model.name } : {}),
    ...(model.contextWindow !== undefined ? { contextWindow: model.contextWindow } : {}),
    ...(model.maxOutputTokens !== undefined ? { maxOutputTokens: model.maxOutputTokens } : {}),
    inputTypes: model.inputTypes ?? (model.image ? ["text", "image"] : ["text"]),
    outputTypes: ["text"],
    efforts: [...DEFAULT_MODEL_EFFORTS],
  };
}

/** 路由内单模型条目的简写类型（ModelListItem 的编辑对象）。 */
export type RouteModelEntry = DshModelRoute["models"][number];
