/**
 * 用户原始需求 [2026-07-21]：「窗口推荐尺寸……改进成最小推荐尺寸。」
 * 修订 [2026-10-05]（workspace-page-polish θ8，Owner：「窗口目前太小，适当放大」）：
 * daemon 默认窗口尺寸上调（960×680 → 1280×800），并钉死「默认 ≥ 各路由最小
 * 推荐」不变量——默认小于路由最小会导致每次进入路由都被 ensureMinimumWindowSize
 * 顶大（启动即错尺寸）。
 * 正交意图：
 *   [1] 证明路由尺寸仅补足不足维度，不缩小操作者已有窗口。
 *   [2] 证明缺失或失败的原生 bridge 不影响浏览器运行。
 *   [3] 证明 daemon 默认窗口覆盖全部路由最小推荐尺寸。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureMinimumWindowSize } from "../webui/src/lib/window-size.ts";
import {
  CREATOR_MINIMUM_WINDOW_SIZE,
  HOME_MINIMUM_WINDOW_SIZE,
} from "../webui/src/lib/window-size.ts";
import { WINDOW_HEIGHT, WINDOW_WIDTH } from "../src/shared/index.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("daemon default window size (workspace-page-polish θ8)", () => {
  it("defaults to 1280×800 and covers every route minimum recommendation", () => {
    // 默认窗口必须不低于任何路由的最小推荐（Creator 1100×760 为最大项）——
    // 否则启动首屏即触发补足式 resize。
    expect(WINDOW_WIDTH).toBe(1280);
    expect(WINDOW_HEIGHT).toBe(800);
    expect(WINDOW_WIDTH).toBeGreaterThanOrEqual(HOME_MINIMUM_WINDOW_SIZE.width);
    expect(WINDOW_HEIGHT).toBeGreaterThanOrEqual(HOME_MINIMUM_WINDOW_SIZE.height);
    expect(WINDOW_WIDTH).toBeGreaterThanOrEqual(CREATOR_MINIMUM_WINDOW_SIZE.width);
    expect(WINDOW_HEIGHT).toBeGreaterThanOrEqual(CREATOR_MINIMUM_WINDOW_SIZE.height);
  });
});

describe("minimum native window size", () => {
  it("does not resize a window already larger than the route recommendation", async () => {
    const getBounds = vi.fn(async () => ({ x: 20, y: 20, width: 1280, height: 900 }));
    const resizeTo = vi.fn(async () => {});
    vi.stubGlobal("navigator", { opentrayWindow: { getBounds, resizeTo } });

    await ensureMinimumWindowSize({ width: 1100, height: 760 });

    expect(getBounds).toHaveBeenCalledOnce();
    expect(resizeTo).not.toHaveBeenCalled();
  });

  it("only expands the dimensions below the minimum and preserves larger user dimensions", async () => {
    const getBounds = vi.fn(async () => ({ x: 20, y: 20, width: 1000, height: 900 }));
    const resizeTo = vi.fn(async () => {});
    vi.stubGlobal("navigator", { opentrayWindow: { getBounds, resizeTo } });

    await ensureMinimumWindowSize({ width: 1100, height: 760 });

    expect(resizeTo).toHaveBeenCalledExactlyOnceWith(1100, 900);
  });

  it("silently skips non-native and unreadable window bridges", async () => {
    vi.stubGlobal("navigator", { opentrayWindow: { resizeTo: vi.fn(async () => {}) } });
    await expect(ensureMinimumWindowSize({ width: 1100, height: 760 })).resolves.toBeUndefined();

    const getBounds = vi.fn(async () => {
      throw new Error("native bounds unavailable");
    });
    const resizeTo = vi.fn(async () => {});
    vi.stubGlobal("navigator", { opentrayWindow: { getBounds, resizeTo } });
    await expect(ensureMinimumWindowSize({ width: 1100, height: 760 })).resolves.toBeUndefined();
    expect(resizeTo).not.toHaveBeenCalled();
  });
});
