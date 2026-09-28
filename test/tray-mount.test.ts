/**
 * 用户原始需求 [2026-07-21]：「placement直接居中就行，不用跟随tray。」
 * 修订 [2026-09-28]（windows-window-identity-overlay）：追加 createWebviewWindow
 * 参数钉——windowControlsOverlay 恒 true（win32 原生框+自定义顶栏双标题栏回归钉）。
 * 正交意图：
 *   [1] 证明 appMode 窗口只在启动时执行一次 screen-center placement。
 *   [2] 证明居中只依赖 screen authority，不读取 tray bounds。
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

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

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { mountTray } from "../src/daemon/tray-host.js";
import { WINDOW_HEIGHT, WINDOW_WIDTH } from "../src/shared/index.js";
import { setHomeOverride } from "../src/shared/paths.js";

// mountTray/TrayHost 的 log() 落默认 home 的 daemon.log；隔离到临时 home，
// 测试零外泄（Windows 实机轮发现的日志污染）。
const isolatedHome = fs.mkdtempSync(path.join(os.tmpdir(), "skill-creator-tray-test-home-"));
setHomeOverride(isolatedHome);
afterAll(() => {
  setHomeOverride(null);
  fs.rmSync(isolatedHome, { recursive: true, force: true });
});

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
    // windows-window-identity-overlay：统一自定义标题栏——overlay 无条件开启
    //（win32 AppWindow ExtendsContentIntoTitlebar / macOS NSWindow overlay），
    // 平台分支回潮（win32 关 overlay 走原生框）即双标题栏回归。
    expect(tray.createWebviewWindow).toHaveBeenCalledWith(
      expect.objectContaining({ windowControlsOverlay: true }),
    );
    await mounted.host.destroy();
  });

  it("degrades to a non-overlay window when the overlay show fails (win32 WinAppSDK bootstrap absent)", async () => {
    const overlayPanel = {
      close: vi.fn(async () => {}),
      destroy: vi.fn(async () => {}),
      isVisible: vi.fn(async () => true),
      listen: vi.fn(() => () => {}),
      show: vi.fn(async () => {
        throw new Error(
          "Microsoft.WindowsAppRuntime.Bootstrap.dll could not be loaded (os error 126)",
        );
      }),
      toVisible: vi.fn(async () => {}),
    };
    const degradedPanel = {
      close: vi.fn(async () => {}),
      destroy: vi.fn(async () => {}),
      isVisible: vi.fn(async () => true),
      listen: vi.fn(() => () => {}),
      show: vi.fn(async () => {}),
      toVisible: vi.fn(async () => {}),
    };
    const tray = {
      createWebviewWindow: vi.fn(() => overlayPanel),
      destroy: vi.fn(async () => {}),
      getScreenDetails: vi.fn(async () => ({ currentScreen: null, screens: [] })),
      onMenuClick: vi.fn(() => () => {}),
      setMenu: vi.fn(async () => {}),
    };
    nativeMocks.createTray.mockResolvedValue({
      destroy: vi.fn(async () => {}),
      extend: vi.fn(() => tray),
    });
    // 第二次 createWebviewWindow 返回降级 panel。
    tray.createWebviewWindow.mockImplementationOnce(() => overlayPanel);
    tray.createWebviewWindow.mockImplementation(() => degradedPanel);

    const mounted = await mountTray({
      url: "http://127.0.0.1:4173/#token=test",
      packageVersion: "test",
      onQuit: async () => {},
    });

    // overlay 失败绝不能 headless：降级 panel 挂载、首 panel 已销毁、
    // 第二次创建显式关 overlay。
    expect(mounted.result.window).toBe(degradedPanel);
    expect(mounted.result.tray).toBe(tray);
    expect(overlayPanel.destroy).toHaveBeenCalledTimes(1);
    expect(tray.createWebviewWindow).toHaveBeenCalledTimes(2);
    expect(tray.createWebviewWindow).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ windowControlsOverlay: false }),
    );
    await mounted.host.destroy();
  });
});
