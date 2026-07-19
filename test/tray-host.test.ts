/**
 * 用户原始需求 [2026-07-19]：「移除目前关于窗口半透明、倒计时关闭的相关前后端代码。」
 * 正交意图：
 *   [1] 证明原生 isVisible()/visibleChange 是可见性真相，菜单据此切换 Show/Hide。
 *   [2] 证明 retained session 用 toVisible()/close() 复用，操作串行化不反转 stale 状态。
 *   [3] 证明 app mode 不接管 blur/focus，也不在显示时覆写原生窗口样式。
 *   [4] 证明 quit 与 destroy 释放原生资源。
 * 妥协声明：四项共享同一 TrayHost fixture 与原生窗口事件 seam；拆分会复制状态机装配并削弱行为断言。
 */
import { EventEmitter } from "node:events";
import type { TrayEventByType } from "opentray";
import { describe, expect, it, vi } from "vitest";
import { TrayHost } from "../src/daemon/tray-host.js";
import { MENU_OPEN_ID, MENU_QUIT_ID } from "../src/shared/index.js";

class MockWindow extends EventEmitter {
  toVisible = vi.fn(async () => {
    this.emitState(true);
  });
  close = vi.fn(async () => {
    this.emitState(false);
  });
  isVisible = vi.fn(async () => this.visible);
  setStyle = vi.fn(async () => {});
  destroy = vi.fn(async () => {});
  listen = vi.fn((event: string, handler: (e: { payload: unknown }) => void) => {
    if (event === "visibleChange") {
      this.on("visibleChange", (visible: boolean) => handler({ payload: { visible } }));
    }
    return () => {};
  });
  visible = false;
  emitState(visible: boolean): void {
    this.visible = visible;
    this.emit("visibleChange", visible);
  }
}

function createFixture(initialVisible = true) {
  let menuHandler: ((event: TrayEventByType<"menuClick">) => void) | null = null;
  const detach = vi.fn();
  const setMenu = vi.fn(async () => {});
  const destroyTray = vi.fn(async () => {});
  const onQuit = vi.fn(() => {});
  const window = new MockWindow();
  window.visible = initialVisible;
  const host = new TrayHost(
    {
      destroy: destroyTray,
      onMenuClick(handler) {
        menuHandler = handler;
        return detach;
      },
      setMenu,
    },
    window,
    {
      openItemId: MENU_OPEN_ID,
      quitItemId: MENU_QUIT_ID,
      initialVisible,
      onQuit,
    },
  );
  return {
    host,
    window,
    onQuit,
    detach,
    setMenu,
    destroyTray,
    click(itemId: number): void {
      if (!menuHandler) throw new Error("TrayHost menu handler is not installed.");
      menuHandler({ type: "menuClick", appId: "test", trayId: "test", itemId });
    },
  };
}

describe("TrayHost retained-session semantics", () => {
  it("reveals the retained app window without overriding native window style", async () => {
    const fixture = createFixture(false);
    await fixture.host.show();
    await vi.waitFor(() => expect(fixture.window.toVisible).toHaveBeenCalledOnce());
    expect(fixture.window.setStyle).not.toHaveBeenCalled();
  });

  it("leaves blur and focus lifecycle to the native app window", () => {
    const fixture = createFixture(true);
    expect(fixture.window.listen).toHaveBeenCalledWith("visibleChange", expect.any(Function));
    expect(fixture.window.listen).not.toHaveBeenCalledWith("blur", expect.any(Function));
    expect(fixture.window.listen).not.toHaveBeenCalledWith("focus", expect.any(Function));
  });

  it("toggles the menu label between Show and Hide with native visibility", async () => {
    const fixture = createFixture(false);
    // 初始 hidden → 菜单为 Show 文案。
    expect(fixture.setMenu).toHaveBeenLastCalledWith(
      expect.objectContaining({
        items: expect.arrayContaining([
          expect.objectContaining({ id: MENU_OPEN_ID, title: "Open Skill Creator" }),
        ]),
      }),
    );
    await fixture.host.show();
    await vi.waitFor(() =>
      expect(fixture.setMenu).toHaveBeenLastCalledWith(
        expect.objectContaining({
          items: expect.arrayContaining([
            expect.objectContaining({ id: MENU_OPEN_ID, title: "Hide window" }),
          ]),
        }),
      ),
    );
  });

  it("serializes rapid tray clicks so visibility never inverts stale state", async () => {
    const fixture = createFixture(false);
    // 让 toVisible 阻塞，连续 toggle 时后续操作必须排队，不得在第一帧前并发 toVisible。
    let releaseToVisible: () => void = () => {};
    fixture.window.toVisible.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseToVisible = resolve;
        }),
    );
    void fixture.host.toggle();
    // 让第一个 toggle 的 queryNativeVisibility + applyNativeVisibility 跑完。
    await vi.waitFor(() => expect(fixture.window.toVisible).toHaveBeenCalledTimes(1));
    // 此时第一个操作仍卡在 toVisible；再排队两个 toggle，它们不得并发再调 toVisible。
    void fixture.host.toggle();
    void fixture.host.toggle();
    // 让出微任务，确保排队的 run 有机会（错误地）执行——但被串行化挡住。
    await new Promise((resolve) => setImmediate(resolve));
    expect(fixture.window.toVisible).toHaveBeenCalledTimes(1);
    releaseToVisible();
    // 销毁会等待所有排队操作完成；把 toVisible 恢复成立即 resolve 以便 teardown。
    fixture.window.toVisible.mockImplementation(async () => {
      fixture.emitState(true);
    });
    await fixture.host.destroy();
  });

  it("delegates quit and releases native resources in destroy", async () => {
    const fixture = createFixture(false);
    fixture.click(MENU_QUIT_ID);
    await vi.waitFor(() => expect(fixture.onQuit).toHaveBeenCalledOnce());
    await fixture.host.destroy();
    expect(fixture.detach).toHaveBeenCalledOnce();
    expect(fixture.window.destroy).toHaveBeenCalledOnce();
    expect(fixture.destroyTray).toHaveBeenCalledOnce();
  });
});
