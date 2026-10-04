/**
 * 右栏布局常量与纯计算（skills-agent-page-zcode-parity task 3.3）。
 *
 * 用户原始需求 [2026-10-04]（design §3）：「用比例默认值配合 min/max 约束；关闭
 * 保留展开尺寸；为 separator 添加键盘和 ARIA；自动 reveal active tab」。
 *
 * ZCode 引用对照（/tmp/ia-redesign/zcode-src/packages/ui/src/，commit 29628c9）：
 *   - 默认 45% / tab 溢出判定：app-shell/sidePaneLayout.ts:1（SIDE_PANE_DEFAULT_
 *     EXPANDED_RATIO=0.45；tab 最小宽 60px、间距 4px、容差 1px——逐位移植）。
 *   - 面板 min 240px / max 65%：app-shell/animatedSidePanePanelModel.ts:52
 *     （resolveAnimatedSidePanePanelLayout：minSize "240px"、maxSize "65%"）。
 *   - active tab 自动滚入可视区：app-shell/AnimatedSidePanePanel.tsx:638-679
 *     （左右溢出 → scrollBy；此处抽成可测的纯函数）。
 *   - 键盘 resize（Arrow ±16px / Home / End 基准）：app-shell/WorkspaceShellLayout.tsx:677
 *     （sidebar 键盘步进 16px 的同一约定；本模块提供右栏等价纯计算，容器接线
 *     需求见 change 报告——separator 属 SkillsAgentPage，归编排/Codex 批）。
 *
 * 正交意图：
 *   [1] tab 条溢出判定（add 按钮预算还原假想布局，避免 ResizeObserver 反馈环）。
 *   [2] 比例尺寸记忆（默认 0.45、上限 0.65、240px 下限；DevicePrefs 持久消费）。
 *   [3] 自动 reveal 滚动量计算（左右溢出 → 有符号 scrollBy）。
 * 妥协声明：无（纯函数；DOM 侧由组件 action 消费）。
 */

/** ZCode sidePaneLayout.ts:2——side pane 默认展开比例 45%。 */
export const SIDE_PANE_DEFAULT_EXPANDED_RATIO = 0.45;

/** ZCode animatedSidePanePanelModel.ts:56——maxSize "65%"。 */
export const SIDE_PANE_MAX_RATIO = 0.65;

/** ZCode animatedSidePanePanelModel.ts:55——minSize "240px"。 */
export const SIDE_PANE_MIN_WIDTH_PX = 240;

/**
 * 空态图标 rail 宽（Owner 裁决 4b，2026-10-05）：无活动 tab 时侧栏收敛为
 * ~48px 竖排图标条——旁路 240px 下限与比例记忆（rail 不可拖宽；空态由
 * 「有无 tab」事实派生，不新增 DevicePrefs 字段）。
 */
export const SIDE_PANE_RAIL_WIDTH_PX = 48;

/** ZCode sidePaneLayout.ts:4-6——tab 收缩下限/间距/溢出容差。 */
export const SIDE_PANE_TAB_MIN_WIDTH_PX = 60;
export const SIDE_PANE_TAB_GAP_PX = 4;
const SIDE_PANE_TAB_OVERFLOW_TOLERANCE_PX = 1;

/** 键盘 resize 步进（WorkspaceShellLayout sidebar 键盘步进同一约定：16px）。 */
export const SIDE_PANE_KEYBOARD_STEP_PX = 16;

/**
 * tab 条溢出判定（ZCode resolveSidePaneTabsOverflow 逐位移植）。
 *
 * add 按钮未溢出时位于 tabs 末尾跟随收缩，溢出后固定右侧——直接读 content 宽会
 * 形成 ResizeObserver 反馈环；这里还原「add 按钮在末尾」的假想布局，用稳定的
 * 最小宽度预算判定（tabCount×60 + gaps + add 按钮预算 vs viewport ±1px）。
 */
export function resolveSidePaneTabsOverflow({
  addButtonInside,
  addButtonWidth,
  tabCount,
  viewportWidth,
}: {
  addButtonInside: boolean;
  addButtonWidth: number;
  tabCount: number;
  viewportWidth: number;
}): boolean {
  const tabsWidth =
    tabCount * SIDE_PANE_TAB_MIN_WIDTH_PX + Math.max(0, tabCount - 1) * SIDE_PANE_TAB_GAP_PX;
  const addButtonGap = tabCount > 0 ? SIDE_PANE_TAB_GAP_PX : 0;
  const viewportWidthWithAddButtonInside = viewportWidth + (addButtonInside ? 0 : addButtonWidth);
  const contentWidthWithAddButtonInside = tabsWidth + addButtonGap + addButtonWidth;
  return (
    contentWidthWithAddButtonInside >
    viewportWidthWithAddButtonInside + SIDE_PANE_TAB_OVERFLOW_TOLERANCE_PX
  );
}

/** 容器宽有效（>0 且有限）才可解析比例。 */
export function isUsableSidePaneContainerWidth(containerWidthPx: number): boolean {
  return Number.isFinite(containerWidthPx) && containerWidthPx > 0;
}

/**
 * 比例下限：240px 折算进当前容器。窄容器上可能超过 65% 上限——像素下限优先
 * （ZCode react-resizable-panels 语义：min "240px" 压过 max "65%"）。
 */
export function minSidePaneRatio(containerWidthPx: number): number {
  if (!isUsableSidePaneContainerWidth(containerWidthPx)) return SIDE_PANE_DEFAULT_EXPANDED_RATIO;
  return SIDE_PANE_MIN_WIDTH_PX / containerWidthPx;
}

/** 比例钳制：非有限数回默认 0.45；下限 240px 折算，上限 65%（窄容器下限占位）。 */
export function clampSidePaneRatio(ratio: number, containerWidthPx: number): number {
  if (!Number.isFinite(ratio)) return SIDE_PANE_DEFAULT_EXPANDED_RATIO;
  if (!isUsableSidePaneContainerWidth(containerWidthPx)) {
    return Math.min(Math.max(ratio, 0), SIDE_PANE_MAX_RATIO);
  }
  const lower = minSidePaneRatio(containerWidthPx);
  const upper = Math.max(SIDE_PANE_MAX_RATIO, lower);
  return Math.min(Math.max(ratio, lower), upper);
}

/** 比例 → 像素宽（钳制后换算）。 */
export function sidePaneWidthFromRatio(ratio: number, containerWidthPx: number): number {
  if (!isUsableSidePaneContainerWidth(containerWidthPx)) return 0;
  return Math.round(clampSidePaneRatio(ratio, containerWidthPx) * containerWidthPx);
}

/** 像素宽 → 比例（钳制后换算；记忆面用）。 */
export function sidePaneRatioFromWidth(widthPx: number, containerWidthPx: number): number {
  if (!isUsableSidePaneContainerWidth(containerWidthPx)) return SIDE_PANE_DEFAULT_EXPANDED_RATIO;
  return clampSidePaneRatio(widthPx / containerWidthPx, containerWidthPx);
}

/**
 * 键盘/精确步进：deltaPx 为宽度变化量（右栏向左拖/ArrowLeft 增宽 → 正 delta）。
 * Home/End 语义 = 直接落到 min/max（容器分别传 ±Infinity delta 即可覆盖）。
 */
export function nudgeSidePaneRatio(
  ratio: number,
  deltaPx: number,
  containerWidthPx: number,
): number {
  if (!isUsableSidePaneContainerWidth(containerWidthPx)) return clampSidePaneRatio(ratio, 0);
  return clampSidePaneRatio(ratio + deltaPx / containerWidthPx, containerWidthPx);
}

/**
 * active tab 自动滚入可视区（ZCode AnimatedSidePanePanel.tsx:646-672 的纯计算）：
 * 左溢出（<0）→ 负向 scrollBy 精确对齐左缘；右溢出（>0）→ 正向对齐右缘；
 * 已可见 → null（不滚动）。
 */
export function resolvePanelTabRevealScroll(
  viewportLeft: number,
  viewportRight: number,
  tabLeft: number,
  tabRight: number,
): number | null {
  const leftOverflow = tabLeft - viewportLeft;
  const rightOverflow = tabRight - viewportRight;
  if (leftOverflow < 0) return leftOverflow;
  if (rightOverflow > 0) return rightOverflow;
  return null;
}
