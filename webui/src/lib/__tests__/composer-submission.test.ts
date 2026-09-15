// @vitest-environment jsdom
/**
 * Composer 提交面单测（openspec composer-capability-parity W4）。
 *
 * 用户指示 [2026-09-15]：「……100% 复刻官方 webui 输入框能力的实现。」官方
 * submission-policy/QueueDock 语义：忙碌 Enter 偏好（持久）、Cmd/Ctrl 取反、
 * 排队发件箱随 durable 帧退队。
 *
 * 正交意图：
 *   [1] 手势解析与偏好存取（localStorage）。
 *   [2] 发件箱生命周期：track → retire（durable/失败）→ reset。
 *   [3] 草稿文本持久化：换轨写、清轨清、空轨回灌。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  busyEnterPreference,
  loadPersistedDraftText,
  persistDraftText,
  queuedOutbox,
  resetQueuedOutbox,
  resolveSubmitGesture,
  retireQueuedSend,
  setBusyEnterPreference,
  trackQueuedSend,
} from "$lib/stores/agent-submission.svelte";

describe("busy-Enter preference (W4)", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("defaults to queue and round-trips steer", () => {
    expect(busyEnterPreference()).toBe("queue");
    setBusyEnterPreference("steer");
    expect(busyEnterPreference()).toBe("steer");
    setBusyEnterPreference("queue");
    expect(busyEnterPreference()).toBe("queue");
  });

  it("garbage storage falls back to queue", () => {
    localStorage.setItem("sc.composer.busyEnter", "nonsense");
    expect(busyEnterPreference()).toBe("queue");
  });

  it("plain gesture follows the preference; accelerated takes the opposite", () => {
    expect(resolveSubmitGesture(false, "queue")).toBe("queue");
    expect(resolveSubmitGesture(true, "queue")).toBe("steer");
    expect(resolveSubmitGesture(false, "steer")).toBe("steer");
    expect(resolveSubmitGesture(true, "steer")).toBe("queue");
  });
});

describe("queued outbox lifecycle (W4)", () => {
  beforeEach(() => resetQueuedOutbox());
  afterEach(() => resetQueuedOutbox());

  it("tracks sends FIFO and retires by text when the durable frame arrives", () => {
    trackQueuedSend("first message");
    trackQueuedSend("second message");
    expect(queuedOutbox.items.map((item) => item.text)).toEqual([
      "first message",
      "second message",
    ]);

    retireQueuedSend("first message");
    expect(queuedOutbox.items.map((item) => item.text)).toEqual(["second message"]);
  });

  it("retiring an unknown text is a no-op; duplicates retire one at a time", () => {
    trackQueuedSend("same");
    trackQueuedSend("same");
    retireQueuedSend("other");
    expect(queuedOutbox.items).toHaveLength(2);
    retireQueuedSend("same");
    expect(queuedOutbox.items).toHaveLength(1);
  });

  it("reset clears the projection (session switch)", () => {
    trackQueuedSend("x");
    resetQueuedOutbox();
    expect(queuedOutbox.items).toHaveLength(0);
  });
});

describe("draft text persistence (W4)", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("persists and loads per-track text; empty removes the key", () => {
    persistDraftText("agent-1", "hello draft");
    expect(loadPersistedDraftText("agent-1")).toBe("hello draft");
    expect(loadPersistedDraftText("agent-2")).toBe("");

    persistDraftText("agent-1", "");
    expect(loadPersistedDraftText("agent-1")).toBe("");
  });
});
