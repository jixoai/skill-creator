/**
 * 全局设置面导航（settings-panel-zcode-source：Settings 页面化）。
 *
 * 用户原始需求 [2026-09-09]：「设置面板不是挂在聊天面板里面的。设置面板应该
 * 是全局的……它的入口应该在左侧导航栏的左下角。」
 * 用户原始需求 [2026-09-25]（Owner 裁决）：「目前的 settings 是一个 Dialog，
 * 放弃 Dialog，改成标准的页面面板。」
 *
 * 正交意图：
 *   [1] 设置分区导航：分区枚举单源（manifest 的 zod 收窄与页面共用）；
 *       openSettings = 导航到 /settings/:section（URL 即分区状态，可刷新恢复；
 *       store 不再持有 Dialog 开合态）。
 */
import { goById } from "$lib/shell";

/** 设置分区 id（= /settings/:section 路由参数域）。 */
export const SETTINGS_SECTION_IDS = ["general", "model", "agent", "sessions"] as const;
export type SettingsSectionId = (typeof SETTINGS_SECTION_IDS)[number];

/** 打开设置面（导航到对应分区；缺省 General）。 */
export function openSettings(section: SettingsSectionId = "general"): void {
  goById("settings.section", { section });
}
