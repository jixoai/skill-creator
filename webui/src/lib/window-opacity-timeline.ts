/**
 * 原始需求 [2026-07-18]：「全面升级 skill-creator-v2 对于 opentray 的适配」。
 * 正交意图：[1] 固化页面拥有的退出/进入动画时间线与倒计时换算。
 *
 * 动画驱动权归页面：daemon 只投影 exitRequested/visibility，页面用 WAAPI 跑
 * 6 秒呼吸式淡出（5 秒倒计时 + 1 秒 settle），逐帧镜像 native opacity。
 */

/** 进入动画时长（毫秒）。 */
export const ENTER_DURATION_MS = 1_000;
/** 退出动画时长（毫秒）。 */
export const EXIT_DURATION_MS = 6_000;

export const IOS_ENTER_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";
export const BREATH_EASING = "cubic-bezier(0.37, 0, 0.63, 1)";
export const EXIT_SETTLE_EASING = "cubic-bezier(0.34, 1, 0.64, 1)";

interface OpacityAnchor {
  timeMs: number;
  opacity: number | null;
  easing?: string;
}

/** 退出动画的不透明度锚点（呼吸式：0→0.8→0.9→0.5→0.7→0）。 */
const EXIT_OPACITY_ANCHORS: readonly OpacityAnchor[] = [
  { timeMs: 0, opacity: null, easing: BREATH_EASING },
  { timeMs: 1_000, opacity: 0.8, easing: BREATH_EASING },
  { timeMs: 2_000, opacity: 0.9, easing: BREATH_EASING },
  { timeMs: 3_000, opacity: 0.5, easing: BREATH_EASING },
  { timeMs: 4_000, opacity: 0.7, easing: EXIT_SETTLE_EASING },
  { timeMs: EXIT_DURATION_MS, opacity: 0 },
];

export interface OpacityKeyframe {
  opacity: string;
  offset?: number;
  easing?: string;
  [key: string]: string | number | undefined;
}

/** 构造从 `fromOpacity` 起步的退出关键帧序列。 */
export function exitOpacityKeyframes(fromOpacity: number): Keyframe[] {
  return EXIT_OPACITY_ANCHORS.map((anchor) => ({
    opacity: String(anchor.opacity ?? fromOpacity),
    offset: anchor.timeMs / EXIT_DURATION_MS,
    ...("easing" in anchor && anchor.easing ? { easing: anchor.easing } : {}),
  }));
}

/** 从动画 currentTime（毫秒）换算剩余倒计时秒数（显示 5..0）。 */
export function countdownFromExitTime(currentTime: number): number {
  const remainingMs = Math.max(0, EXIT_DURATION_MS - currentTime);
  return Math.max(0, Math.ceil(remainingMs / 1_000) - 1);
}
