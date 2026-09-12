/**
 * Agent 面板共享格式化（redesign-model-tabs-and-agent-panel S2/S3）。
 *
 * 用户原始需求 [2026-09-12]：「usage 取自本轮 assistant-text 终帧 payload …
 * `↑ 1.2k · ↓ 340 · 8.4s`（tabular-nums 11px）」。
 *
 * 正交意图：
 *   [1] token 计数/时长的人类可读投影（TurnPills 与 ContextMeter 共用）。
 */
/** token 数：≥1000 折算一位小数 k。 */
export function formatTokens(count: number): string {
  if (!Number.isFinite(count)) return "0";
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
  return String(count);
}

/** 毫秒时长：<1s 毫秒直书；≥1s 秒一位小数（≥60s 保持秒计，面板语境免分秒换算）。 */
export function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "";
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}
