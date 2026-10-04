/**
 * 原始需求 [2026-07-14]：「目的是以人为本，要让小白到各行各业到专业工程师用起来都舒心」。
 * 修订 [2026-10-05]（Owner 裁决，webui-i18n-bilingual task 4.5 δ 线）：
 * 「客观留存这个错误，是调试的关键，但是可以辅助一些 i18n 的比较宽泛的翻译」
 * ——错误 toast 走 error 变体：渲染层叠加宽泛人话提示，原文永不丢弃。
 * 正交意图：
 * 1. 维护全局轻量 toast 队列（信息 toast 与错误 toast 同一队列）。
 * 2. 支持可撤销 action 与自动消失（错误 toast 停留更久，原文需要阅读时间）。
 * 3. error 变体只做标记：分类与翻译发生在渲染层（toast-container），本模块
 *    不消费错误文本。
 */
interface Toast {
  id: string;
  message: string;
  action?: { label: string; run: () => void };
  /** 生命周期键：同 key 新 toast 取代旧 toast（如同一 run 的 queued→cancelled）。 */
  key?: string;
  /** 错误变体：渲染层叠加宽泛分类提示 + 原文次行。 */
  error?: boolean;
}

/** 全局 toast 队列。 */
export const toasts = $state<Toast[]>([]);

/** 入队实现：key 取代语义 + TTL（错误与带 action 的停留更久）。 */
function pushToast(
  message: string,
  options: { error?: boolean; action?: Toast["action"]; key?: string } = {},
): void {
  const { error, action, key } = options;
  if (key !== undefined) {
    for (let i = toasts.length - 1; i >= 0; i--) {
      if (toasts[i].key === key) toasts.splice(i, 1);
    }
  }
  const id = globalThis.crypto.randomUUID();
  toasts.push({ id, message, action, key, error: error ? true : undefined });
  // 自动消失（有 action 或错误原文时延迟更久）。
  const ttl = action || error ? 8000 : 3500;
  setTimeout(() => dismissToast(id), ttl);
}

/**
 * 显示一个 toast。可选带一个 action（如"撤销"）；可选 lifecycle key——
 * 同 key 播报取代仍在屏上的旧 toast，不让同一实体的过期状态堆叠。
 */
export function showToast(
  message: string,
  action?: { label: string; run: () => void },
  key?: string,
): void {
  pushToast(message, { action, key });
}

/**
 * 显示一个错误 toast：渲染层按错误家族叠加宽泛人话提示为主文案，
 * 原文保留在次行与 title（调试关键，永不丢弃；未匹配家族 = 只显示原文）。
 */
export function showErrorToast(
  message: string,
  action?: { label: string; run: () => void },
  key?: string,
): void {
  pushToast(message, { error: true, action, key });
}

/** 从全局队列移除指定 toast。 */
export function dismissToast(id: string): void {
  const idx = toasts.findIndex((t) => t.id === id);
  if (idx >= 0) toasts.splice(idx, 1);
}
