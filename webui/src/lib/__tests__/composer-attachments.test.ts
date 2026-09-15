// @vitest-environment jsdom
/**
 * Composer 附件整批准入单测（openspec composer-capability-parity W2）。
 *
 * 用户指示 [2026-09-15]：「……100% 复刻官方 webui 输入框能力的实现。」官方
 * imageLimits 语义：违反限额的批次整批拒绝（reason-keyed 单通知），零项入场。
 *
 * 正交意图：
 *   [1] 整批预检：tooMany / fileTooLarge / unsupportedType 全批拒绝。
 *   [2] 读入门控：attachmentReads.pending 在读入期间 >0、结束归零。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toastMock = vi.fn();
vi.mock("$lib/toast.svelte", () => ({ showToast: toastMock }));

const store = await import("$lib/stores/agent-composer.svelte");

function fakeFile(name: string, type: string, size: number): File {
  // File.size 由内容决定（构造 options 不接受 size）——真实分配目标字节数。
  return new File([new Uint8Array(size)], name, { type });
}

describe("attachment intake whole-batch refusal (W2)", () => {
  beforeEach(() => {
    store.resetAllComposerTracks();
    toastMock.mockClear();
  });
  afterEach(() => {
    store.resetAllComposerTracks();
  });

  it("refuses an over-count image batch whole and admits nothing", async () => {
    const five = [
      fakeFile("a.png", "image/png", 10),
      fakeFile("b.png", "image/png", 10),
      fakeFile("c.png", "image/png", 10),
      fakeFile("d.png", "image/png", 10),
      fakeFile("e.png", "image/png", 10),
    ];
    await store.addComposerImages(five);
    expect(store.agentComposer.images).toHaveLength(0);
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(String(toastMock.mock.calls[0]?.[0])).toMatch(/at most 4 images/i);
  });

  it("refuses the whole batch when one image is oversized", async () => {
    await store.addComposerImages([
      fakeFile("ok.png", "image/png", 100),
      fakeFile("big.png", "image/png", 5 * 1024 * 1024),
    ]);
    expect(store.agentComposer.images).toHaveLength(0);
    expect(String(toastMock.mock.calls[0]?.[0])).toContain("big.png");
  });

  it("refuses unsupported image types whole", async () => {
    await store.addComposerImages([
      fakeFile("ok.png", "image/png", 100),
      fakeFile("bad.tiff", "image/tiff", 100),
    ]);
    expect(store.agentComposer.images).toHaveLength(0);
    expect(String(toastMock.mock.calls[0]?.[0])).toContain("image/tiff");
  });

  it("accepts a valid batch atomically and tracks pending reads", async () => {
    expect(store.attachmentReads.pending).toBe(0);
    const pending = store.addComposerImages([
      fakeFile("a.png", "image/png", 10),
      fakeFile("b.jpg", "image/jpeg", 10),
    ]);
    // 读入进行中（FileReader 异步）：门控计数 ≥1。
    expect(store.attachmentReads.pending).toBeGreaterThan(0);
    await pending;
    expect(store.agentComposer.images).toHaveLength(2);
    expect(store.agentComposer.images[0]?.preview).toContain("data:image/png;base64,");
    expect(store.attachmentReads.pending).toBe(0);
    expect(toastMock).not.toHaveBeenCalled();
  });

  it("doc channel refuses over-count whole (existing rail counts)", async () => {
    store.agentComposer.files = [
      { name: "one.md", data: "eA==" },
      { name: "two.md", data: "eA==" },
    ];
    await store.addComposerDocs([fakeFile("three.md", "text/markdown", 10)]);
    expect(store.agentComposer.files).toHaveLength(2);
    expect(String(toastMock.mock.calls[0]?.[0])).toMatch(/at most 2 file attachments/i);
  });

  it("doc channel skips image files (caller-side split re-verified)", async () => {
    await store.addComposerDocs([fakeFile("img.png", "image/png", 10)]);
    expect(store.agentComposer.files).toHaveLength(0);
    expect(toastMock).not.toHaveBeenCalled();
  });

  it("picked path channels refuse over-count whole", () => {
    store.agentComposer.images = [];
    store.addPickedComposerImages([
      { path: "/a.png", name: "a.png" },
      { path: "/b.png", name: "b.png" },
      { path: "/c.png", name: "c.png" },
      { path: "/d.png", name: "d.png" },
      { path: "/e.png", name: "e.png" },
    ]);
    expect(store.agentComposer.images).toHaveLength(0);
    expect(String(toastMock.mock.calls[0]?.[0])).toMatch(/at most 4 images/i);
  });
});
