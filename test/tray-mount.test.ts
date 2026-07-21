/**
 * 用户原始需求 [2026-07-21]：「placement直接居中就行，不用跟随tray。」
 * 正交意图：
 *   [1] 证明 appMode 窗口只在启动时执行一次 screen-center placement。
 *   [2] 证明居中只依赖 screen authority，不读取 tray bounds。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const nativeMocks = vi.hoisted(() => {
  const placementDependencies: Array<{ screen: unknown }> = [];
  return {
    applyOnce: vi.fn(async () => {}),
    createTray: vi.fn(),
    placementDependencies,
  };
});

vi.mock("opentray", () => ({ createTray: nativeMocks.createTray }));
vi.mock("@opentray/ext-webview", () => {
  class WebviewPlacementKit {
    constructor(dependencies: { screen: unknown }) {
      nativeMocks.placementDependencies.push(dependencies);
    }

    async applyOnce(target: unknown, options: unknown): Promise<void> {
      await nativeMocks.applyOnce(target, options);
    }
  }

  return { WebviewExt: {}, WebviewPlacementKit };
});

import { mountTray } from "../src/daemon/tray-host.js";
import { WINDOW_HEIGHT, WINDOW_WIDTH } from "../src/shared/index.js";

beforeEach(() => {
  nativeMocks.applyOnce.mockClear();
  nativeMocks.createTray.mockReset();
  nativeMocks.placementDependencies.length = 0;
});

describe("tray mount placement", () => {
  it("centers once from screen authority without querying tray bounds", async () => {
    const panel = {
      close: vi.fn(async () => {}),
      destroy: vi.fn(async () => {}),
      isVisible: vi.fn(async () => true),
      listen: vi.fn(() => () => {}),
      show: vi.fn(async () => {}),
      toVisible: vi.fn(async () => {}),
    };
    const tray = {
      createWebviewWindow: vi.fn(() => panel),
      destroy: vi.fn(async () => {}),
      getScreenDetails: vi.fn(async () => ({ currentScreen: null, screens: [] })),
      onMenuClick: vi.fn(() => () => {}),
      setMenu: vi.fn(async () => {}),
    };
    nativeMocks.createTray.mockResolvedValue({
      destroy: vi.fn(async () => {}),
      extend: vi.fn(() => tray),
    });

    const mounted = await mountTray({
      url: "http://127.0.0.1:4173/#token=test",
      packageVersion: "test",
      onQuit: async () => {},
    });

    expect(mounted.result.window).toBe(panel);
    expect(nativeMocks.placementDependencies).toEqual([{ screen: tray }]);
    expect(nativeMocks.applyOnce).toHaveBeenCalledWith(panel, {
      placement: "screen-center",
      width: WINDOW_WIDTH,
      height: WINDOW_HEIGHT,
    });
    await mounted.host.destroy();
  });
});
