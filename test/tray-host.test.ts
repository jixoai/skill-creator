/**
 * 用户原始需求 [2026-07-18]：「全面升级 skill-creator-v2 对于 opentray 的适配」。
 * 正交意图：
 *   [1] 证明原生 isVisible()/visibleChange 是可见性真相，菜单据此切换 Show/Hide。
 *   [2] 证明 retained session 用 toVisible()/close() 复用，操作串行化不反转 stale 状态。
 *   [3] 证明 blur 触发的自动隐藏由页面动画完成后 completeAutoClose 收口。
 *   [4] 证明 quit 与 destroy 释放原生资源，偏好变更驱动自动隐藏重算。
 */
import { EventEmitter } from "node:events";
import type { TrayEventByType } from "opentray";
import { describe, expect, it, vi } from "vitest";
import { PreferencesStore } from "../src/daemon/preferences-store.js";
import { TrayHost } from "../src/daemon/tray-host.js";
import { MENU_OPEN_ID, MENU_QUIT_ID } from "../src/shared/index.js";
import { setHomeOverride } from "../src/shared/paths.js";

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
  setHomeOverride(createIsolatedHome());
  const store = new PreferencesStore();
  let menuHandler: ((event: TrayEventByType<"menuClick">) => void) | null = null;
  const detach = vi.fn();
  const setMenu = vi.fn(async () => {});
  const destroyTray = vi.fn(async () => {});
  const onQuit = vi.fn(() => {});
  const onPinFrame = vi.fn();
  const window = new MockWindow();
  window.visible = initialVisible;
  const host = new TrayHost(
    store,
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
      onPinFrame,
      onQuit,
    },
  );
  return {
    store,
    host,
    window,
    onQuit,
    onPinFrame,
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
  it("reveals the retained window via toVisible() and projects shown pin frame", async () => {
    const fixture = createFixture(false);
    await fixture.host.show();
    await vi.waitFor(() => expect(fixture.window.toVisible).toHaveBeenCalledOnce());
    // revealRetainedWindow 的 setStyle(opacity) 与 setStyle(keepOnTop) 都被调用。
    expect(fixture.window.setStyle).toHaveBeenCalledWith({ opacity: 0.1 });
    expect(fixture.window.setStyle).toHaveBeenCalledWith({ keepOnTop: true });
    // visibleChange 把可见性真相投影到 pin frame。
    await vi.waitFor(() =>
      expect(fixture.onPinFrame).toHaveBeenCalledWith(
        expect.objectContaining({ visibility: "shown" }),
      ),
    );
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

  it("blur requests page-owned auto-close; completeAutoClose hides only while authorized", async () => {
    const fixture = createFixture(true);
    // 触发 blur（window.listen 的 blur handler 由 wireUp 注册）。
    const blurHandler = fixture.window.listen.mock.calls.find(
      ([event]) => event === "blur",
    )?.[1] as ((e: { payload: unknown }) => void) | undefined;
    expect(blurHandler).toBeDefined();
    blurHandler!({ payload: undefined });
    await vi.waitFor(() =>
      expect(fixture.onPinFrame).toHaveBeenCalledWith(
        expect.objectContaining({ exitRequested: true }),
      ),
    );
    // 页面动画完成后回调 completeAutoClose → close()。
    await fixture.host.completeAutoClose();
    expect(fixture.window.close).toHaveBeenCalledOnce();
  });

  it("keep-onTop preference true cancels a pending auto-close", async () => {
    const fixture = createFixture(true);
    const blurHandler = fixture.window.listen.mock.calls.find(
      ([event]) => event === "blur",
    )?.[1] as ((e: { payload: unknown }) => void) | undefined;
    blurHandler!({ payload: undefined });
    await vi.waitFor(() =>
      expect(fixture.onPinFrame).toHaveBeenCalledWith(
        expect.objectContaining({ exitRequested: true }),
      ),
    );
    fixture.store.setPreferences({ keepOnTop: true });
    await vi.waitFor(() =>
      expect(fixture.onPinFrame).toHaveBeenCalledWith(
        expect.objectContaining({ exitRequested: false }),
      ),
    );
    await fixture.host.completeAutoClose();
    expect(fixture.window.close).not.toHaveBeenCalled();
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

function createIsolatedHome(): string {
  // tray-host 测试不读写偏好文件，但 PreferencesStore 构造会尝试加载；
  // 用一个稳定的不存在路径即可（加载失败会 fallback 到默认）。
  return `/tmp/skill-creator-tray-host-test-${process.pid}`;
}
