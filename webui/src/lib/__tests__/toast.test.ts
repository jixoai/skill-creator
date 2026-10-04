/**
 * 用户原始需求 [2026-10-04]：「evaluating 批评环 R2-3：同一 run 的 lifecycle toast
 * 不堆叠（queued 帧被终态帧取代）。」
 * 正交意图：
 * 1. 钉死 toast lifecycle key 的取代语义（同 key 新旧帧互斥、异 key 共存）。
 * 2. 钉死无 key 调用面不变（默认入队不取代）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// $state 语义在模块导入期生效（vitest 环境已配 svelte 编译——同目录先例）。
import { dismissToast, showToast, toasts } from "$lib/toast.svelte";

describe("toast lifecycle key（批评环 R2-3）", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // 清空队列（$state 数组原地 splice/dismiss）。
    for (const toast of [...toasts]) dismissToast(toast.id);
    expect(toasts).toHaveLength(0);
  });

  it("same-key toast replaces the still-visible predecessor", () => {
    showToast("Run queued for alpha-lint.", undefined, "eval-run-r1");
    expect(toasts).toHaveLength(1);
    expect(toasts[0]?.message).toBe("Run queued for alpha-lint.");

    showToast("Run cancelled.", undefined, "eval-run-r1");
    // 同 key 取代：终态帧是唯一在屏帧（过期 queued 帧不堆叠）。
    expect(toasts).toHaveLength(1);
    expect(toasts[0]?.message).toBe("Run cancelled.");
    expect(toasts[0]?.key).toBe("eval-run-r1");
  });

  it("different-key toasts coexist (unrelated lifecycles)", () => {
    showToast("Run queued for alpha-lint.", undefined, "eval-run-r1");
    showToast("Run queued for beta-lint.", undefined, "eval-run-r2");
    showToast("Run cancelled.", undefined, "eval-run-r1");
    expect(toasts).toHaveLength(2);
    expect(toasts.map((toast) => toast.key).sort()).toEqual(["eval-run-r1", "eval-run-r2"]);
  });

  it("keyless toasts keep queue semantics (no replacement)", () => {
    showToast("first");
    showToast("second");
    expect(toasts).toHaveLength(2);
  });
});
