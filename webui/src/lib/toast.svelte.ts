/**
 * 原始需求 [2026-07-14]：「目的是以人为本，要让小白到各行各业到专业工程师用起来都舒心」。
 * 正交意图：
 * 1. 维护全局轻量 toast 队列。
 * 2. 支持可撤销 action 与自动消失。
 */
interface Toast {
  id: string;
  message: string;
  action?: { label: string; run: () => void };
  /** 生命周期键：同 key 新 toast 取代旧 toast（如同一 run 的 queued→cancelled）。 */
  key?: string;
}

/** 全局 toast 队列。 */
export const toasts = $state<Toast[]>([]);

/**
 * 显示一个 toast。可选带一个 action（如"撤销"）；可选 lifecycle key——
 * 同 key 播报取代仍在屏上的旧 toast，不让同一实体的过期状态堆叠。
 */
export function showToast(
  message: string,
  action?: { label: string; run: () => void },
  key?: string,
): void {
  if (key !== undefined) {
    for (let i = toasts.length - 1; i >= 0; i--) {
      if (toasts[i].key === key) toasts.splice(i, 1);
    }
  }
  const id = globalThis.crypto.randomUUID();
  toasts.push({ id, message, action, key });
  // 自动消失（有 action 时延迟更久）。
  const ttl = action ? 8000 : 3500;
  setTimeout(() => dismissToast(id), ttl);
}

/** 从全局队列移除指定 toast。 */
export function dismissToast(id: string): void {
  const idx = toasts.findIndex((t) => t.id === id);
  if (idx >= 0) toasts.splice(idx, 1);
}
