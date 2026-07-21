/**
 * 用户原始需求 [2026-07-21]：「窗口推荐尺寸……改进成最小推荐尺寸。」
 * 正交意图：
 *   [1] 证明路由尺寸仅补足不足维度，不缩小操作者已有窗口。
 *   [2] 证明缺失或失败的原生 bridge 不影响浏览器运行。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureMinimumWindowSize } from "../webui/src/lib/window-size.ts";

afterEach(() => {
  vi.unstubAllGlobals();
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
