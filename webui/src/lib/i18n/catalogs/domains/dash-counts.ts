/**
 * 用户原始需求 [2026-10-05]（2.3 复评 Owner 裁决「少即是多」）：
 * 「Global 首页同屏四个互不相干的数字……看不出到底有多少技能、这个屏在显示多少」。
 * 正交意图：
 *   [1] ε 线计数收敛域词典（skills 屏 header 主显总量 + 窗口式表达；en/zh 成对）。
 */
export const dashCountsEn = {
  /** header 计数：可见行数 < workspace 总量（筛选/分页/检索窗口）时的窗口式表达。 */
  "skillsScreen.showingOf": "Showing {visible} of {total} skills",
  /** header 计数：全部可见时的总量主显（单数）。 */
  "skillsScreen.totalCountOne": "{count} skill",
  /** header 计数：全部可见时的总量主显（恒复数，同 dashboard.snapshotCounts 口径）。 */
  "skillsScreen.totalCount": "{count} skills",
} as const;

export const dashCountsZh: Record<keyof typeof dashCountsEn, string> = {
  "skillsScreen.showingOf": "显示 {visible} / 共 {total} 个技能",
  "skillsScreen.totalCountOne": "{count} 个技能",
  "skillsScreen.totalCount": "{count} 个技能",
};
