/**
 * Composer 提交面（openspec composer-capability-parity W4）。
 *
 * 用户指示 [2026-09-15]：「……100% 复刻官方 webui 输入框能力的实现。」官方
 * submission-policy 语义：忙碌中（turn running）Enter 按持久偏好解析为 queue
 * （next-turn 排队）或 steer（next-step 转向）；Cmd/Ctrl+Enter 取反；排队消息
 * 有可见的 dock 面板。
 *
 * 正交意图：
 *   [1] 忙碌 Enter 偏好（localStorage 持久；/queue /steer 命令切换）。
 *   [2] 手势解析：plain Enter/主按钮 = 偏好；Cmd/Ctrl+Enter = 反向。
 *   [3] 排队发件箱（client 投影）：running 中以 queue 模式发出的消息，直至其
 *       durable user-text 帧到达（与乐观回声同一 retiring 语义）。
 *   [4] 草稿文本持久化：按轨 localStorage（文本面；附件不落盘——base64 体积
 *       与生命周期不属于浏览器存储），空轨装载时回灌。
 */

const BUSY_ENTER_KEY = "sc.composer.busyEnter";
const DRAFT_KEY_PREFIX = "sc.composer.draft.";

export type BusyEnterMode = "queue" | "steer";

/** 忙碌 Enter 偏好（持久；缺省 queue，官方同缺省）。 */
export function busyEnterPreference(): BusyEnterMode {
  try {
    const value = localStorage.getItem(BUSY_ENTER_KEY);
    return value === "steer" ? "steer" : "queue";
  } catch {
    return "queue";
  }
}

export function setBusyEnterPreference(mode: BusyEnterMode): void {
  try {
    localStorage.setItem(BUSY_ENTER_KEY, mode);
  } catch {
    // 存储不可用（隐私模式等）：偏好退化为会话内默认，不阻塞手势。
  }
}

/** 手势解析（官方 submission-policy）：accelerated（Cmd/Ctrl）取偏好反向。 */
export function resolveSubmitGesture(
  accelerated: boolean,
  preference: BusyEnterMode,
): BusyEnterMode {
  if (!accelerated) return preference;
  return preference === "queue" ? "steer" : "queue";
}

/** 排队发件箱（client 投影；$state 数组——QueueDock 消费）。 */
export interface QueuedSend {
  id: number;
  text: string;
}

export const queuedOutbox = $state({ items: [] as QueuedSend[] });

let queuedSeq = 0;

export function trackQueuedSend(text: string): void {
  queuedSeq += 1;
  queuedOutbox.items = [...queuedOutbox.items, { id: queuedSeq, text }];
}

/** durable user-text 帧到达即退队（同文本匹配；与乐观回声同 retiring 语义）。 */
export function retireQueuedSend(text: string): void {
  const index = queuedOutbox.items.findIndex((item) => item.text === text);
  if (index >= 0) {
    queuedOutbox.items = queuedOutbox.items.filter((_, i) => i !== index);
  }
}

/** 会话切换清空发件箱投影（队列真相在内核 inbox，投影随会话走）。 */
export function resetQueuedOutbox(): void {
  queuedOutbox.items = [];
}

/** 草稿文本持久化：按轨读写（文本面）。 */
export function persistDraftText(trackKey: string, text: string): void {
  try {
    if (text.length === 0) localStorage.removeItem(DRAFT_KEY_PREFIX + trackKey);
    else localStorage.setItem(DRAFT_KEY_PREFIX + trackKey, text);
  } catch {
    // 配额/隐私模式：持久化退化为会话内（内存轨仍在）。
  }
}

export function loadPersistedDraftText(trackKey: string): string {
  try {
    return localStorage.getItem(DRAFT_KEY_PREFIX + trackKey) ?? "";
  } catch {
    return "";
  }
}
