/**
 * 用户原始需求 [2026-07-14]：「opentray 的一些适配没做好，好好学习 pnpm-pub」。
 * 正交意图：
 * 1. 证明所有 Open 入口幂等恢复同一个窗口，而不是切换隐藏状态。
 * 2. 证明关键 show 失败可诊断，样式失败只做 best-effort。
 */
import type { TrayEventByType } from "opentray";
import { describe, expect, it, vi } from "vitest";
import { TrayHost } from "../src/daemon/tray-host.js";
import { MENU_OPEN_ID, MENU_QUIT_ID } from "../src/shared/index.js";

describe("TrayHost open semantics", () => {
  it("uses every primary action to show the same window", async () => {
    const fixture = createFixture();
    fixture.host.install();

    fixture.click(MENU_OPEN_ID);
    fixture.click(MENU_OPEN_ID);

    await vi.waitFor(() => expect(fixture.show).toHaveBeenCalledTimes(2));
    expect(fixture.setStyle).toHaveBeenCalledWith({ opacity: 0.92 });
    expect(fixture.setStyle).toHaveBeenCalledWith({ keepOnTop: true });
  });

  it("surfaces show failures while tolerating optional style failures", async () => {
    const fixture = createFixture();
    fixture.setStyle.mockRejectedValue(new Error("style unavailable"));
    await expect(fixture.host.show()).resolves.toBeUndefined();

    fixture.show.mockRejectedValueOnce(new Error("native window unavailable"));
    await expect(fixture.host.show()).rejects.toThrow("native window unavailable");
  });

  it("delegates quit and releases native resources", async () => {
    const fixture = createFixture();
    fixture.host.install();

    fixture.click(MENU_QUIT_ID);
    await vi.waitFor(() => expect(fixture.onQuit).toHaveBeenCalledOnce());
    await fixture.host.destroy();

    expect(fixture.detach).toHaveBeenCalledOnce();
    expect(fixture.destroyWindow).toHaveBeenCalledOnce();
    expect(fixture.destroyTray).toHaveBeenCalledOnce();
  });
});

function createFixture() {
  let menuHandler: ((event: TrayEventByType<"menuClick">) => void) | null = null;
  const detach = vi.fn();
  const destroyTray = vi.fn(async () => {});
  const destroyWindow = vi.fn(async () => {});
  const setStyle = vi.fn(async (_style: unknown) => {});
  const show = vi.fn(async () => {});
  const onQuit = vi.fn(async () => {});
  const host = new TrayHost(
    {
      tray: {
        destroy: destroyTray,
        onMenuClick(handler) {
          menuHandler = handler;
          return detach;
        },
      },
      window: { destroy: destroyWindow, setStyle, show },
    },
    { onQuit },
  );

  return {
    host,
    show,
    setStyle,
    onQuit,
    detach,
    destroyTray,
    destroyWindow,
    click(itemId: number): void {
      if (!menuHandler) throw new Error("TrayHost menu handler is not installed.");
      menuHandler({ type: "menuClick", appId: "test", trayId: "test", itemId });
    },
  };
}
