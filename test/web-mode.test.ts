/**
 * 用户原始需求 [2026-07-27]：「引入 --web 参数，在 Linux 默认为 true……菜单改成打开浏览器链接」。
 * 正交意图：
 *   [1] 证明 web 模式判定矩阵（显式 flag + 平台默认）。
 *   [2] 证明 mountWebTray 只挂纯 tray（不 import ext-webview），返回 window=null。
 *   [3] 证明 web 模式 TrayHost 主菜单项点击打开浏览器，不走 toggle。
 */
import type { TrayEventByType } from "opentray";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TrayHost, mountTray } from "../src/daemon/tray-host.js";
import { MENU_OPEN_ID, MENU_QUIT_ID } from "../src/shared/index.js";
import { isWebMode, parseWebModeFlag, webModeFromEnv } from "../src/shared/web-mode.js";

// 顶层 mock（vitest hoisting 要求）：web 模式绝不能 import ext-webview。
const nativeMocks = vi.hoisted(() => ({
  createTray: vi.fn(),
  extWebviewImported: false,
}));

vi.mock("opentray", () => ({ createTray: nativeMocks.createTray }));
vi.mock("@opentray/ext-webview", () => {
  // 标记 ext-webview 被 import；web 模式测试断言它保持 false。
  nativeMocks.extWebviewImported = true;
  return { WebviewExt: {}, WebviewPlacementKit: class {} };
});

describe("web-mode flag resolution", () => {
  it("explicit --web / --no-web overrides platform default", () => {
    expect(isWebMode(true, "linux")).toBe(true);
    expect(isWebMode(true, "darwin")).toBe(true);
    expect(isWebMode(false, "linux")).toBe(false);
    expect(isWebMode(false, "darwin")).toBe(false);
  });

  it("defaults to web mode on Linux (ext-webview has no Linux native)", () => {
    expect(isWebMode(undefined, "linux")).toBe(true);
  });

  it("defaults to windowed mode on macOS / Windows", () => {
    expect(isWebMode(undefined, "darwin")).toBe(false);
    expect(isWebMode(undefined, "win32")).toBe(false);
  });

  it("parseWebModeFlag reads --web / --no-web from argv", () => {
    expect(parseWebModeFlag(["start", "--web"])).toBe(true);
    expect(parseWebModeFlag(["start", "--no-web"])).toBe(false);
    expect(parseWebModeFlag(["start"])).toBe(undefined);
  });

  it("webModeFromEnv reads SKILL_CREATOR_WEB with platform fallback", () => {
    expect(webModeFromEnv({ SKILL_CREATOR_WEB: "1" }, "darwin")).toBe(true);
    expect(webModeFromEnv({ SKILL_CREATOR_WEB: "0" }, "linux")).toBe(false);
    expect(webModeFromEnv({}, "linux")).toBe(true);
    expect(webModeFromEnv({}, "darwin")).toBe(false);
  });
});

describe("mountWebTray", () => {
  beforeEach(() => {
    nativeMocks.createTray.mockReset();
    nativeMocks.extWebviewImported = false;
  });

  it("mounts a pure tray without importing @opentray/ext-webview", async () => {
    const baseTray = {
      destroy: vi.fn(async () => {}),
      onMenuClick: vi.fn(() => () => {}),
      setMenu: vi.fn(async () => {}),
    };
    nativeMocks.createTray.mockResolvedValue(baseTray);

    const onOpenInBrowser = vi.fn(async () => {});
    const mounted = await mountTray({
      url: "http://127.0.0.1:4173/#token=test",
      packageVersion: "test",
      web: true,
      onOpenInBrowser,
      onQuit: async () => {},
    });

    // web 模式：tray 挂载，window 为 null，未触发 ext-webview import。
    expect(mounted.result.tray).toBe(baseTray);
    expect(mounted.result.window).toBeNull();
    expect(nativeMocks.extWebviewImported).toBe(false);
    await mounted.host.destroy();
  });
});

describe("TrayHost web-mode semantics", () => {
  function createWebFixture() {
    let menuHandler: ((event: TrayEventByType<"menuClick">) => void) | null = null;
    const onOpenInBrowser = vi.fn(async () => {});
    const onQuit = vi.fn(() => {});
    const host = new TrayHost(
      {
        destroy: vi.fn(async () => {}),
        onMenuClick(handler) {
          menuHandler = handler;
          return () => {};
        },
        setMenu: vi.fn(async () => {}),
      },
      null, // web 模式无窗口
      {
        mode: "web",
        webLabel: "Open in Browser",
        openItemId: MENU_OPEN_ID,
        quitItemId: MENU_QUIT_ID,
        initialVisible: false,
        onOpenInBrowser,
        onQuit,
      },
    );
    return {
      host,
      onOpenInBrowser,
      onQuit,
      click(itemId: number): void {
        if (!menuHandler) throw new Error("TrayHost menu handler is not installed.");
        menuHandler({ type: "menuClick", appId: "test", trayId: "test", itemId });
      },
    };
  }

  it("primary menu item opens the browser instead of toggling a window", async () => {
    const fixture = createWebFixture();
    fixture.click(MENU_OPEN_ID);
    await vi.waitFor(() => expect(fixture.onOpenInBrowser).toHaveBeenCalledOnce());
  });

  it("show() redirects to browser open in web mode", async () => {
    const fixture = createWebFixture();
    await fixture.host.show();
    expect(fixture.onOpenInBrowser).toHaveBeenCalledOnce();
  });

  it("quit menu item still delegates to onQuit", async () => {
    const fixture = createWebFixture();
    fixture.click(MENU_QUIT_ID);
    await vi.waitFor(() => expect(fixture.onQuit).toHaveBeenCalledOnce());
  });
});
