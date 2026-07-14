/**
 * 原始需求 [2026-07-14]：「opentray 的一些适配没做好，好好学习 pnpm-pub」。
 * 正交意图：
 * 1. 为工作台与 Creator 定义稳定原生窗口尺寸。
 * 2. 按路由请求 resize，并去重相同尺寸。
 */

const bridge = () => navigator.opentrayWindow ?? navigator.opentray?.window ?? undefined;

/** 原生窗口的逻辑像素尺寸。 */
export interface WindowSize {
  width: number;
  height: number;
}

/** Workspace 与 Repository 的默认窗口尺寸。 */
export const HOME_WINDOW_SIZE: WindowSize = { width: 960, height: 680 };
/** Creator 编辑面的默认窗口尺寸。 */
export const CREATOR_WINDOW_SIZE: WindowSize = { width: 1100, height: 760 };

let lastRequested: WindowSize | null = null;

/** 在原生宿主中幂等请求窗口尺寸；普通浏览器中静默跳过。 */
export async function resizeWindow(size: WindowSize): Promise<void> {
  const ot = bridge();
  if (!ot?.resizeTo) return;
  if (lastRequested?.width === size.width && lastRequested?.height === size.height) return;
  try {
    await ot.resizeTo(size.width, size.height);
    lastRequested = { ...size };
  } catch {
    /* resize is a nicety — never fatal */
  }
}
