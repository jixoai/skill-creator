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
}

/** 全局 toast 队列。 */
export const toasts = $state<Toast[]>([]);

/** 显示一个 toast。可选带一个 action（如"撤销"）。 */
export function showToast(message: string, action?: { label: string; run: () => void }): void {
  const id = globalThis.crypto.randomUUID();
  toasts.push({ id, message, action });
  // 自动消失（有 action 时延迟更久）。
  const ttl = action ? 8000 : 3500;
  setTimeout(() => dismissToast(id), ttl);
}

/** 从全局队列移除指定 toast。 */
export function dismissToast(id: string): void {
  const idx = toasts.findIndex((t) => t.id === id);
  if (idx >= 0) toasts.splice(idx, 1);
}
