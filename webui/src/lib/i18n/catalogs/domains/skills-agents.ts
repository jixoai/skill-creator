/**
 * 用户原始需求 [2026-10-06]（skills-tabs-redesign 批 4，design Δ5 路径 1）：
 * 「诊断行紧凑化（只用现有投影字段）+ 搜索过滤 + 可写|只读分组头 + 计数 +
 * 搜索空态」——Agents Tab 规模化增域词典（en/zh 成对，base 不动）。
 * 正交意图：
 *   [1] agents-screen 高密度诊断行的搜索/分组/空态文案域；
 *       insights 动作文案随本域自持（脱离 skills-workspace 域的批间耦合）。
 */
export const skillsAgentsEn = {
  /** 搜索框 placeholder（visible）与 aria-label 分键（同 skills-screen 惯例）。 */
  "agentsScreen.searchPlaceholder": "Filter providers by name or path",
  /** 搜索框 aria-label。 */
  "agentsScreen.searchAria": "Filter providers",
  /** 清除搜索（输入框内 × 与空态按钮共用）。 */
  "agentsScreen.clearSearch": "Clear filter",
  /** 搜索无命中空态（携带当前 query 原文）。 */
  "agentsScreen.searchEmpty": "No providers match \u201c{query}\u201d",
  /** 搜索激活时的窗口式计数（真实过滤口径，非伪造聚合）。 */
  "agentsScreen.showingOf": "Showing {visible} of {total} providers",
  /** 可写组 sticky 分组头。 */
  "agentsScreen.groupWritable": "Writable",
  /** 只读组 sticky 分组头。 */
  "agentsScreen.groupReadonly": "Read-only",
  /** 行尾 Insights 入口（视觉文案 + aria-label/title 共用；与行主体独立操作）。 */
  "agentsScreen.insightsAction": "Analysis & proposals",
  /** 行尾技能数读屏标签（ICU 单复数；视觉仅数字）。 */
  "agentsScreen.skillsCountAria": "{count, plural, =1 {# skill} other {# skills}}",
} as const;

export const skillsAgentsZh: Record<keyof typeof skillsAgentsEn, string> = {
  "agentsScreen.searchPlaceholder": "按名称或路径筛选 provider",
  "agentsScreen.searchAria": "筛选 provider",
  "agentsScreen.clearSearch": "清除筛选",
  "agentsScreen.searchEmpty": "没有匹配「{query}」的 provider",
  "agentsScreen.showingOf": "显示 {visible} / 共 {total} 个 provider",
  "agentsScreen.groupWritable": "可写",
  "agentsScreen.groupReadonly": "只读",
  "agentsScreen.insightsAction": "分析与建议",
  "agentsScreen.skillsCountAria": "{count} 个技能",
};
