/**
 * 原始需求 [2026-07-18]：「全面升级 skill-creator-v2 对于 opentray 的适配」。
 * 正交意图：[1] 固化原生窗口与页面进入动画共用的 seed opacity。
 *
 * 原生窗口 boot 与页面 enter 动画都从这个 seed 起步，避免 restore 时闪一下
 * 1.0 而与页面投影在第一帧打架。
 */
export const WINDOW_ENTER_SEED_OPACITY = 0.1;
