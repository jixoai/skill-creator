/**
 * 全局设置面 UI 状态（add-agent-settings-modes 迭代：设置升格为全局面）。
 *
 * 用户原始需求 [2026-09-09]：「设置面板不是挂在聊天面板里面的。设置面板应该
 * 是全局的……它的入口应该在左侧导航栏的左下角。」
 *
 * 正交意图：
 *   [1] 全局开合与当前分区（跨 App/tab 存活；入口 = 侧栏底部齿轮）。
 */
export type SettingsSectionId = "general" | "model" | "agent";

export const settingsUi = $state({
  open: false,
  section: "general" as SettingsSectionId,
});

/** 打开设置面（可选定位分区）。 */
export function openSettings(section: SettingsSectionId = "general"): void {
  settingsUi.section = section;
  settingsUi.open = true;
}
