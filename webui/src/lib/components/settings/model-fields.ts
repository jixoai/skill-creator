/**
 * 模型字段语义助手（R7 8.5/8.7：ModelListItem 字段派生与 token 简写往返）。
 *
 * 用户原始需求 [2026-09-12]：「ModelName：自动生成（id 的可读化：
 * `glm-5.3-flash` → `GLM 5.3 Flash`）+ 可改」；「上下文窗口 / 最大输出 Token：
 * 文本输入，接受 `0.5M`/`253k`/纯数字（用 parseTokenShorthand 校验，失焦解析为
 * 数字回显规范化格式如 `131.1k`）」；「补全源 = 全部已知供应商的模型并集，
 * UI 侧 Set 去重、排序」；「可用 Effort：tags-input + 补全」（codex R7 B2
 * 纠偏 [2026-09-12]：「Effort 设置这里，不能硬编码」——候选改为用户自派生并集）。
 *
 * 正交意图：
 *   [1] 可读名派生：readableModelName 把 model id 的 -/_ 分段标题化（纯字母
 *       短段全大写：glm→GLM、gpt→GPT；含数字/长段首字母大写：flash→Flash）。
 *   [2] token 简写往返：formatTokenCount 是 parseTokenShorthand（shared 契约）
 *       的显示侧逆变换（k=1024、M=1024²；一位小数、整值去尾零）。
 *   [3] 补全池投影：catalogModelCandidates 把目录全 provider 的模型并成
 *       Set 去重 + 排序的补全集（手输仍允许任意 id）。
 *   [4] effort 补全派生（codex R7 B2）：effortCandidates 以全部路由已配置
 *       efforts 的并集为候选（用户自派生，去硬编码）；目录 compat 声明
 *       supportsReasoningEffort === false 时清空候选并给 hint（tags-input
 *       仍自由输入）。
 */
import { parseTokenShorthand } from "$shared/contracts/dsh-runtime.js";
import type { DshModelRoute, ModelProviderCatalogEntry } from "$shared/contracts/dsh-runtime.js";

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

/** 补全池条目（catalog 模型的 browser-safe 投影）。 */
export interface ModelCandidate {
  id: string;
  name?: string;
  image: boolean;
  contextWindow?: number;
  /** 目录 compat 声明是否支持 reasoning effort（缺省未知；effort 候选门）。 */
  supportsReasoningEffort?: boolean;
}

/**
 * 全供应商模型并集（R7 8.5）：catalog providers[].models 按 id Set 去重 +
 * 字典序排序；首见条目保留 name/image/contextWindow/supportsReasoningEffort
 * （预填 + effort 候选门用）。
 */
export function catalogModelCandidates(
  catalog: { providers: ModelProviderCatalogEntry[] } | null,
): ModelCandidate[] {
  const byId = new Map<string, ModelCandidate>();
  for (const provider of catalog?.providers ?? []) {
    for (const model of provider.models) {
      if (!byId.has(model.id)) {
        byId.set(model.id, {
          id: model.id,
          ...(model.name !== undefined ? { name: model.name } : {}),
          image: model.image,
          ...(model.contextWindow !== undefined ? { contextWindow: model.contextWindow } : {}),
          ...(model.supportsReasoningEffort !== undefined
            ? { supportsReasoningEffort: model.supportsReasoningEffort }
            : {}),
        });
      }
    }
  }
  return [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** 目录声明不支持 reasoning effort 时的固定 hint（ModelListItem 展示）。 */
export const EFFORT_UNSUPPORTED_HINT =
  "Catalog marks this model as not supporting reasoning effort";

/** effortCandidates 的返回形状（候选 + 可选目录 hint）。 */
export interface EffortCandidatesResult {
  /** 补全候选（全部路由已配置 efforts 的并集，去重排序；空 = 无建议）。 */
  candidates: string[];
  /** 非 null = 目录声明该模型不支持 effort（候选清空，展示此 hint）。 */
  hint: string | null;
}

/**
 * 可用 Effort 补全候选（codex R7 B2：去硬编码）：候选 = 全部路由（含草案）
 * 已配置 efforts 的并集，Set 去重 + 字典序排序——数据源是用户自己的配置，
 * 不是内置词表。目录命中且 supportsReasoningEffort === false 时返回空候选
 * + hint；tags-input 仍自由输入（hint 是提示不是阻断）。
 */
export function effortCandidates(
  allRouteModels: ReadonlyArray<{ efforts?: readonly string[] | undefined }>,
  catalogMatch: { supportsReasoningEffort?: boolean } | null | undefined,
): EffortCandidatesResult {
  if (catalogMatch?.supportsReasoningEffort === false) {
    return { candidates: [], hint: EFFORT_UNSUPPORTED_HINT };
  }
  const union = new Set<string>();
  for (const model of allRouteModels) {
    for (const effort of model.efforts ?? []) {
      const trimmed = effort.trim();
      if (trimmed.length > 0) union.add(trimmed);
    }
  }
  return { candidates: [...union].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)), hint: null };
}

/** 路由内单模型条目的简写类型（ModelListItem 的编辑对象）。 */
export type RouteModelEntry = DshModelRoute["models"][number];
