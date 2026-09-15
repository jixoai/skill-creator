// @vitest-environment jsdom
/**
 * QueueDock 组件渲染测试（W4 → composer-references-queue-actions C2）。
 *
 * C2 起队列真相迁内核 inbox：内核行携带行级操作（编辑/移除/插话），
 * 乐观 outbox 项仅作 prompt 在途过渡（无操作面）；文本全等去重。
 * 走查 P1 裁决（W4，沿用）：长行 truncate + dock 宽度受卡片约束。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const submission = vi.hoisted(() => {
  const state = { items: [] as Array<{ id: number; text: string }> };
  return {
    queuedOutbox: state,
    __setItems: (items: Array<{ id: number; text: string }>) => {
      state.items = items;
    },
  };
});
const agentStore = vi.hoisted(() => ({
  agentQueue: { items: [] as Array<{ messageId: string; target: string; text: string; attachments: number }> },
  agentSession: { status: "idle" as string },
  updateAgentQueueItem: vi.fn(),
}));

vi.mock("$lib/stores/agent-submission.svelte", () => submission);
vi.mock("$lib/stores/agent.svelte", () => agentStore);

const queueStore = await import("$lib/stores/agent-submission.svelte");
const setOptimistic = (
  queueStore as unknown as { __setItems: (items: Array<{ id: number; text: string }>) => void }
).__setItems;
import QueueDock from "$lib/components/agent/QueueDock.svelte";
import { flushSync, mount, unmount } from "./svelte-client";

function setKernel(
  items: Array<{ messageId: string; target?: string; text: string; attachments?: number }>,
): void {
  agentStore.agentQueue.items = items.map((item) => ({
    messageId: item.messageId,
    target: item.target ?? "next-turn",
    text: item.text,
    attachments: item.attachments ?? 0,
  }));
}

function mountDock() {
  const target = document.createElement("div");
  document.body.appendChild(target);
  const instance = mount(QueueDock, { target });
  flushSync();
  return {
    dock: () => document.querySelector<HTMLElement>('[aria-label="Queued messages"]'),
    row: () => document.querySelector<HTMLElement>('[aria-label="Queued messages"] li'),
    editButton: () =>
      document.querySelector<HTMLButtonElement>('[aria-label="Edit queued message"]:not(input)'),
    steerButton: () => document.querySelector<HTMLButtonElement>('[aria-label="Steer with this message"]'),
    removeButton: () =>
      document.querySelector<HTMLButtonElement>('[aria-label="Remove queued message"]'),
    editInput: () => document.querySelector<HTMLInputElement>('[aria-label="Edit queued message"]'),
    cleanup: () => {
      unmount(instance);
      target.remove();
    },
  };
}

beforeEach(() => {
  document.body.innerHTML = "";
  setOptimistic([]);
  setKernel([]);
  agentStore.agentSession.status = "idle";
  agentStore.updateAgentQueueItem.mockReset().mockResolvedValue({ updated: true });
});

describe("QueueDock rendering (W4 + C2)", () => {
  it("hides entirely when both kernel queue and outbox are empty", () => {
    const ctx = mountDock();
    expect(ctx.dock()).toBeNull();
    ctx.cleanup();
  });

  it("renders kernel rows with actions and optimistic rows without", () => {
    setKernel([{ messageId: "m1", text: "kernel queued" }]);
    setOptimistic([{ id: 1, text: "still sending" }]);
    const ctx = mountDock();
    const dock = ctx.dock();
    expect(dock?.textContent).toContain("Queued");
    expect(dock?.textContent).toContain("2");
    const rows = [...dock!.querySelectorAll("li")];
    expect(rows).toHaveLength(2);
    // 内核行（首行）有操作三键；乐观行只有 sending… 标记。
    expect(rows[0].querySelector('[aria-label="Edit queued message"]')).not.toBeNull();
    expect(rows[0].querySelector('[aria-label="Remove queued message"]')).not.toBeNull();
    expect(rows[1].textContent).toContain("still sending");
    expect(rows[1].querySelector("button")).toBeNull();
    ctx.cleanup();
  });

  it("dedupes optimistic rows whose text already reached the kernel queue", () => {
    setKernel([{ messageId: "m1", text: "same text" }]);
    setOptimistic([{ id: 1, text: "same text" }]);
    const ctx = mountDock();
    expect(ctx.dock()?.querySelectorAll("li")).toHaveLength(1);
    ctx.cleanup();
  });

  it("truncates overlong rows and keeps the dock width bounded", () => {
    setKernel([
      {
        messageId: "m1",
        text: "After the essay finishes, please carefully list fifteen tropical fruits with one-line descriptions each, then summarize the whole thing in a paragraph — a deliberately long queued message that must truncate inside the dock strip.",
      },
    ]);
    const ctx = mountDock();
    // 截断契约（C2 行结构：li > span.truncate 承载文本）。
    const textSpan = ctx.row()?.querySelector<HTMLElement>("span.truncate");
    expect(textSpan?.classList.contains("truncate")).toBe(true);
    expect(ctx.dock()?.classList.contains("shrink-0")).toBe(true);
    ctx.cleanup();
  });

  it("shows attachment counts and the steer badge for next-step items", () => {
    setKernel([
      { messageId: "m1", text: "with files", attachments: 2 },
      { messageId: "m2", target: "next-step", text: "already steering" },
    ]);
    const ctx = mountDock();
    const dock = ctx.dock();
    expect(dock?.textContent).toContain("+2");
    expect(dock?.querySelector('[data-queue-target="next-step"]')?.textContent).toContain("steer");
    ctx.cleanup();
  });
});

describe("QueueDock row actions (C2)", () => {
  it("edits inline: pencil → input → Enter saves via updateAgentQueueItem", async () => {
    setKernel([{ messageId: "m1", text: "original" }]);
    const ctx = mountDock();
    ctx.editButton()!.click();
    await vi.waitFor(() => expect(ctx.editInput()).not.toBeNull());
    const input = ctx.editInput()!;
    input.value = "edited text";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
    await vi.waitFor(() =>
      expect(agentStore.updateAgentQueueItem).toHaveBeenCalledWith({
        messageId: "m1",
        action: "edit",
        text: "edited text",
      }),
    );
    ctx.cleanup();
  });

  it("removes via the row remove button", async () => {
    setKernel([{ messageId: "m1", text: "bye" }]);
    const ctx = mountDock();
    ctx.removeButton()!.click();
    await vi.waitFor(() =>
      expect(agentStore.updateAgentQueueItem).toHaveBeenCalledWith({
        messageId: "m1",
        action: "remove",
      }),
    );
    ctx.cleanup();
  });

  it("disables steer while idle and enables it for a running next-turn item", async () => {
    setKernel([{ messageId: "m1", target: "next-turn", text: "redirect me" }]);
    const ctx = mountDock();
    expect(ctx.steerButton()!.disabled).toBe(true);
    ctx.cleanup();
    agentStore.agentSession.status = "running";
    const ctx2 = mountDock();
    expect(ctx2.steerButton()!.disabled).toBe(false);
    ctx2.steerButton()!.click();
    await vi.waitFor(() =>
      expect(agentStore.updateAgentQueueItem).toHaveBeenCalledWith({
        messageId: "m1",
        action: "steer",
      }),
    );
    ctx2.cleanup();
  });

  it("collapses and expands via the header button", async () => {
    setKernel([{ messageId: "m1", text: "queued row" }]);
    const ctx = mountDock();
    const header = document.querySelector<HTMLButtonElement>(
      '[aria-label="Queued messages"] button',
    );
    header!.click();
    await vi.waitFor(() => expect(header!.getAttribute("aria-expanded")).toBe("false"));
    await vi.waitFor(() => expect(ctx.row()).toBeNull());
    header!.click();
    await vi.waitFor(() => expect(ctx.row()).not.toBeNull());
    ctx.cleanup();
  });
});
