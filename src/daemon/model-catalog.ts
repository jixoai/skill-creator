/**
 * 模型 provider 目录服务（settings-panel-zcode-source：数据源换 zcode Registry）。
 *
 * 用户原始需求 [2026-09-25]（Owner 裁决）：「不再依赖 models.dev……请参考
 * shufa-server……使用它那套数据结构和 zcode 源更新脚本，我们自己这套 models.dev
 * 已经可以完全放弃。」
 *
 * 数据源 = src/daemon/zcode-presets.ts（scripts/extract-zcode-presets.sh.ts 从
 * zai-org/ZCode zcode-builtin.json 静态提取的生成物，进程内常驻常量）——pi-ai 的
 * models.dev 镜像 fs resolve 链已删除，typed UNAVAILABLE 语义随之消失（同步纯投影）。
 *
 * 正交意图：
 *   [1] 投影：ModelPreset → ModelProviderCatalogEntry{provider = templateId,
 *       label = name（zh-CN 品牌名），api 直传（三值两侧同名），baseURL 直传，
 *       models[{id, image = inputTypes 含 image, contextWindow 直传,
 *       supportsReasoningEffort, inputTypes, effortTiers}]}；重点 provider
 *       （zcode templateId 口径）置顶，其余 provider 字母序。
 *       efforts 剔 disabled/enabled 开关型档后映射 effortTiers（全空则省略）；
 *       supportsReasoningEffort = 剩余真实档位非空（efforts 缺省不伪造）；
 *       maxOutputTokens 不投影（预设形状无此字段——对齐 shufa；契约 optional）。
 *   [2] 图标回退序：本仓 PROVIDER_ICONS 命中（dataURL）→ preset.iconUrl
 *       （models.dev logo 外链）→ null（UI 字母头像）。
 * 妥协声明：无。
 */
import type { ModelProviderCatalogEntry } from "../shared/contracts/dsh-runtime.js";
import { PROVIDER_ICONS } from "../shared/provider-icons.generated.js";
import type { ModelPreset, ModelPresetModel } from "./zcode-presets.js";
import { zcodePresets } from "./zcode-presets.js";

/** 重点 provider 置顶顺序（zcode templateId 口径；2026-09-25 换源裁决重排）。 */
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

/** reasoningLevel 档位中的开关型值（非真实思考档，effortTiers 剔除）。 */
const EFFORT_SWITCH_VALUES = new Set(["disabled", "enabled"]);

/** 输入模态产品域（预设只产 text/image；过滤防御未知上游值）。 */
const INPUT_TYPE_DOMAIN = new Set(["text", "image", "video", "pdf"]);

/** 目录 icon 回退序：本仓 PROVIDER_ICONS（dataURL）→ preset iconUrl → null。 */
export function resolveProviderIcon(
  provider: string,
  iconUrl: string | undefined,
  icons: Readonly<Record<string, string>> = PROVIDER_ICONS,
): string | null {
  const known = icons[provider];
  if (known !== undefined && known.length > 0) return known;
  return iconUrl ?? null;
}

/** 单模型投影（efforts 开关型档剔除；contextWindow/输入模态直传）。 */
function projectModel(model: ModelPresetModel): ModelProviderCatalogEntry["models"][number] {
  const efforts = model.efforts ?? [];
  const effortTiers = [...new Set(efforts.filter((tier) => !EFFORT_SWITCH_VALUES.has(tier)))];
  const inputTypes = [
    ...new Set(
      model.inputTypes.filter((type): type is "text" | "image" | "video" | "pdf" =>
        INPUT_TYPE_DOMAIN.has(type),
      ),
    ),
  ];
  return {
    id: model.id,
    image: model.inputTypes.includes("image"),
    ...(inputTypes.length > 0 ? { inputTypes } : {}),
    ...(model.contextWindow !== undefined ? { contextWindow: model.contextWindow } : {}),
    ...(efforts.length > 0 ? { supportsReasoningEffort: effortTiers.length > 0 } : {}),
    ...(effortTiers.length > 0 ? { effortTiers } : {}),
  };
}

/** 单预设投影（label = 品牌名，空名回退 templateId；icon 走回退序）。 */
export function projectPreset(preset: ModelPreset): ModelProviderCatalogEntry {
  return {
    provider: preset.provider,
    label: preset.name.length > 0 ? preset.name : preset.provider,
    api: preset.api,
    baseURL: preset.baseURL,
    icon: resolveProviderIcon(preset.provider, preset.iconUrl),
    models: preset.models.map(projectModel),
  };
}

/** 全量 provider 目录（zcode Registry 生成物的纯投影；重点置顶，其余字母序）。 */
export function listModelProviders(): ModelProviderCatalogEntry[] {
  const rank = new Map(KNOWN_PROVIDER_ORDER.map((id, index) => [id, index]));
  return zcodePresets.map(projectPreset).sort((a, b) => {
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
  };
}

export type ModelCatalogService = ReturnType<typeof createModelCatalogService>;
