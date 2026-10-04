/**
 * 终端面板几何纯函数（skills-agent-page-zcode-parity 2.2）——ZCode 底部终端
 * 面板尺寸契约的 Svelte 移植：
 *   - 展开默认 ~30%（WorkspaceShellLayout.tsx:410 `expandedSize: "30%"`）
 *   - 最小 140px / 最大 50%（AnimatedTerminalPanel.tsx:103-109 ResizablePanel
 *     `minSize="140px" maxSize="50%"`）
 *
 * 用户原始需求 [2026-10-04]（design §2）：「对齐初始关闭、约 30% 展开与
 * 140px–50% 约束；关闭时记忆本次展开尺寸；添加 separator 键盘 resize 与
 * `CmdOrCtrl+J` shell action。」
 *
 * 正交意图：
 *   [1] 高度界：px clamp 到 [140, floor(basis×50%)]（basis = 分栏容器高，dock 以
 *       window.innerHeight 近似——全幅应用列 ≈ 视口高）。
 *   [2] 展开默认：round(basis×30%) 经 clamp。
 * 妥协声明：（a）键盘步进 16px + Home/End 取自 ZCode 同 shell 侧栏键盘 resize
 *   约定（WorkspaceShellLayout.tsx:1611 一族）；terminal 分隔条本身经
 *   react-resizable-panels 内建键盘支持，精确步长未在 checkout 内可考（包未
 *   安装），以侧栏 16px/Home/End 为同仓基准。（b）`CmdOrCtrl+J`（shortcutCommands
 *   .ts:72 toggleTerminal）的匹配与注册由容器批的
 *   apps/agent/agent-layout.ts matchAgentShellShortcut（"toggle-terminal"）承载
 *   ——本模块不持第二份绑定真相。
 */

/** 最小展开高度（ZCode AnimatedTerminalPanel minSize="140px"）。 */
export const TERMINAL_MIN_HEIGHT_PX = 140;
/** 最大展开比例（ZCode AnimatedTerminalPanel maxSize="50%"）。 */
export const TERMINAL_MAX_HEIGHT_RATIO = 0.5;
/** 展开默认比例（ZCode WorkspaceShellLayout expandedSize="30%"）。 */
export const TERMINAL_DEFAULT_HEIGHT_RATIO = 0.3;
/** 键盘 resize 步进（px；ZCode 侧栏键盘 resize 同值约定）。 */
export const TERMINAL_KEYBOARD_STEP_PX = 16;

/** basis 下允许的最大展开 px（140 下限保底——极矮视口不产生 min>max 的死区）。 */
export function terminalMaxHeightPx(basisHeight: number): number {
  return Math.max(TERMINAL_MIN_HEIGHT_PX, Math.floor(basisHeight * TERMINAL_MAX_HEIGHT_RATIO));
}

/** clamp 到 [140, max(basis)]（非法值回落 min）。 */
export function clampTerminalHeightPx(value: number, basisHeight: number): number {
  if (!Number.isFinite(value)) return TERMINAL_MIN_HEIGHT_PX;
  return Math.min(
    terminalMaxHeightPx(basisHeight),
    Math.max(TERMINAL_MIN_HEIGHT_PX, Math.round(value)),
  );
}

/** 展开默认高度：round(basis×30%) 经 clamp。 */
export function defaultTerminalHeightPx(basisHeight: number): number {
  return clampTerminalHeightPx(basisHeight * TERMINAL_DEFAULT_HEIGHT_RATIO, basisHeight);
}
