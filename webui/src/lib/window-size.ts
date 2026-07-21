/**
 * 原始需求 [2026-07-14]：「opentray 的一些适配没做好，好好学习 pnpm-pub」。
 * 用户原始需求 [2026-07-21]：「窗口推荐尺寸……改进成最小推荐尺寸。」
 * 正交意图：
 * 1. 为工作台与 Creator 定义稳定的原生窗口最小推荐尺寸。
 * 2. 路由变化时仅扩展不足维度，保留操作者已有的更大窗口。
 */

const bridge = () => navigator.opentrayWindow ?? navigator.opentray?.window ?? undefined;

/** 原生窗口的逻辑像素尺寸。 */
export interface WindowSize {
  width: number;
  height: number;
}

/** Workspace 与 Repository 的最小推荐窗口尺寸。 */
export const HOME_MINIMUM_WINDOW_SIZE: WindowSize = { width: 960, height: 680 };
/** Creator 编辑面的最小推荐窗口尺寸。 */
export const CREATOR_MINIMUM_WINDOW_SIZE: WindowSize = { width: 1100, height: 760 };

/** 在原生宿主中确保窗口不小于路由推荐尺寸；普通浏览器中静默跳过。 */
export async function ensureMinimumWindowSize(minimum: WindowSize): Promise<void> {
  const ot = bridge();
  if (!ot?.resizeTo || !ot.getBounds) return;
  try {
    const current = await ot.getBounds();
    const width = Math.max(current.width, minimum.width);
    const height = Math.max(current.height, minimum.height);
    if (width === current.width && height === current.height) return;
    await ot.resizeTo(width, height);
  } catch {
    /* resize is a nicety — never fatal */
  }
}
