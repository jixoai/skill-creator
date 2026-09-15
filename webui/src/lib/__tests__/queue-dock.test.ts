// @vitest-environment jsdom
/**
 * QueueDock 组件渲染测试（openspec composer-capability-parity W4）。
 *
 * vision 走查 P1 裁决（几何争议 → 代码事实）：长行必须 truncate（ellipsis +
 * hidden）且 dock 宽度受卡片约束（不得横向溢出/与工具行碰撞）。P3：计数以
 * 有边框 chip 呈现（对比度）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("$lib/stores/agent-submission.svelte", () => {
  const state = { items: [] as Array<{ id: number; text: string }> };
  return {
    queuedOutbox: state,
    __setItems: (items: Array<{ id: number; text: string }>) => {
      state.items = items;
    },
  };
});

const submission = await import("$lib/stores/agent-submission.svelte");
const setItems = (
  submission as unknown as { __setItems: (items: Array<{ id: number; text: string }>) => void }
).__setItems;

import QueueDock from "$lib/components/agent/QueueDock.svelte";
import { flushSync, mount, unmount } from "./svelte-client";

function mountDock() {
  const target = document.createElement("div");
  document.body.appendChild(target);
  const instance = mount(QueueDock, { target });
  flushSync();
  return {
    dock: () => document.querySelector<HTMLElement>('[aria-label="Queued messages"]'),
    row: () => document.querySelector<HTMLElement>('[aria-label="Queued messages"] li'),
    cleanup: () => {
      unmount(instance);
      target.remove();
    },
  };
}

describe("QueueDock rendering (W4)", () => {
  beforeEach(() => setItems([]));

  it("hides entirely when the outbox is empty", () => {
    const ctx = mountDock();
    expect(ctx.dock()).toBeNull();
    ctx.cleanup();
  });

  it("renders header, count chip, and one row per queued send", () => {
    setItems([
      { id: 1, text: "list five fruits" },
      { id: 2, text: "name a color" },
    ]);
    const ctx = mountDock();
    const dock = ctx.dock();
    expect(dock?.textContent).toContain("Queued");
    expect(dock?.textContent).toContain("2");
    expect(dock?.querySelectorAll("li").length).toBe(2);
    expect(dock?.textContent).toContain("list five fruits");
    ctx.cleanup();
  });

  it("truncates overlong rows via the truncate utility and keeps the dock width bounded", () => {
    setItems([
      {
        id: 1,
        text: "After the essay finishes, please carefully list fifteen tropical fruits with one-line descriptions each, then summarize the whole thing in a paragraph — a deliberately long queued message that must truncate inside the dock strip.",
      },
    ]);
    const ctx = mountDock();
    const dock = ctx.dock();
    const row = ctx.row();
    expect(dock).not.toBeNull();
    expect(row).not.toBeNull();
    // 截断契约（jsdom 无 Tailwind 样式表 → 断言工具类而非 computed style）：
    // `truncate` = overflow:hidden + text-overflow:ellipsis + white-space:nowrap。
    expect(row!.classList.contains("truncate")).toBe(true);
    // dock 宽度受卡片列约束（flex 列布局子项），不得靠内容撑宽横向溢出。
    expect(dock!.classList.contains("shrink-0")).toBe(true);
    ctx.cleanup();
  });

  it("collapses and expands via the header button", async () => {
    setItems([{ id: 1, text: "queued row" }]);
    const ctx = mountDock();
    const header = document.querySelector<HTMLButtonElement>(
      '[aria-label="Queued messages"] button',
    );
    expect(header).not.toBeNull();
    expect(ctx.row()).not.toBeNull();
    header!.click();
    await vi.waitFor(() => expect(header!.getAttribute("aria-expanded")).toBe("false"));
    await vi.waitFor(() => expect(ctx.row()).toBeNull());
    header!.click();
    await vi.waitFor(() => expect(ctx.row()).not.toBeNull());
    ctx.cleanup();
  });
});
