/**
 * 本地 provider presets store（redesign-model-tabs-and-agent-panel S1）。
 *
 * 用户原始需求 [2026-09-12]：「『另存为预设』：tab 内容页提供 Save as preset，
 * 把当前 route 的值包写入本地 presets……NewTab 画廊多一个『Your presets』分组，
 * 卡片可删除。本地 presets 是纯 UI 概念，不进 daemon。」
 *
 * 正交意图：
 *   [1] localStorage 读写（key = skill-creator.providerPresets.v1，design §1.2）：
 *       集合读取，zod safeParse 逐条校验——坏 blob 投影为空、损坏条目丢弃，
 *       不迁移不修复也不在读取时写回。
 *   [2] 内存投影（$state list）：save 按 provider 名去重替换（同名 = 更新），
 *       delete 按名移除；变更即持久化。
 * 妥协声明：localStorage 作用域即设计意图（个人开发者预设、不跨设备，design §7），
 * 不入 daemon 持久层；自定义 provider 的运行时身份是持久化 route 本身。
 */
import { z } from "zod";

/** 本地 presets 的 localStorage key。 */
export const PROVIDER_PRESETS_STORAGE_KEY = "skill-creator.providerPresets.v1";

/** 本地预设（= 预填的 ModelRoute 值包；字段集见 design §1.2）。 */
export const ProviderPresetSchema = z.object({
  /** 路由名预填（NewTab form 的 Route name 初值；同名保存 = 替换）。 */
  provider: z.string().min(1),
  /** 画廊显示名。 */
  label: z.string().min(1),
  api: z.string().min(1).optional(),
  baseURL: z.string().min(1),
  models: z.array(z.string().min(1)).min(1),
  icon: z.string().min(1).optional(),
});
/** 本地 provider 预设。 */
export type LocalProviderPreset = z.infer<typeof ProviderPresetSchema>;

/** 本地 presets 内存投影（module 级，跨设置面开合存活）。 */
export const providerPresets = $state({ list: [] as LocalProviderPreset[] });

function readStoredPresets(): LocalProviderPreset[] {
  if (typeof localStorage === "undefined") return [];
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(PROVIDER_PRESETS_STORAGE_KEY);
  } catch {
    return [];
  }
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const valid: LocalProviderPreset[] = [];
  for (const item of parsed) {
    const result = ProviderPresetSchema.safeParse(item);
    if (result.success) valid.push(result.data);
  }
  return valid;
}

function persist(next: LocalProviderPreset[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(PROVIDER_PRESETS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // 写入失败（隐私模式/配额）：内存投影已更新，下次保存重试。
  }
}

/** 从 localStorage 加载（损坏条目静默丢弃）；返回加载结果。 */
export function loadProviderPresets(): LocalProviderPreset[] {
  providerPresets.list = readStoredPresets();
  return providerPresets.list;
}

/** 保存/更新预设（同名 provider 替换，新条目置顶）。 */
export function saveProviderPreset(preset: LocalProviderPreset): void {
  const next = [
    preset,
    ...providerPresets.list.filter((item) => item.provider !== preset.provider),
  ];
  providerPresets.list = next;
  persist(next);
}

/** 按路由名删除预设。 */
export function deleteProviderPreset(provider: string): void {
  const next = providerPresets.list.filter((item) => item.provider !== provider);
  providerPresets.list = next;
  persist(next);
}
