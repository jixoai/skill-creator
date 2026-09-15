/**
 * 内核 inbox 队列操作（composer-references-queue-actions C2）。
 *
 * 用户指示 [2026-09-16]：「继续完善遗留工作。完成 1/2/3」——2 = QueueDock
 * 行级编辑/移除/插话。内核 ReactLoopInbox 原生面：nextTurn/nextStep 读面 +
 * replace(messageId)/remove(messageId)/append(target, message) 写面；官方
 * updateQueue 语义映射：edit=replace（仅文本，附件块保留）、remove=remove、
 * steer=next-turn 移除 + next-step 追加（仅 running）。
 *
 * 正交意图：
 *   [1] inbox 消息投影：unknown UserMessage → safeParse → {messageId, target,
 *       text, attachments}；畸形条目跳过（队列真相在内核，本层不修不报噪音）。
 *   [2] 编辑重建：新文本块 + 原非文本块（附件不丢），source 沿用原消息。
 * 妥协声明：无——纯函数 + 结构面，daemon 侧生命周期门在 agent-sessions（薄委托）。
 */
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { z } from "zod";
import type { AgentQueueItem } from "../../shared/contracts/agent.js";

/** 内核 ReactLoopInbox 的最小结构面（unknown 收窄后使用）。 */
export interface InboxLike {
  readonly nextTurn: readonly unknown[];
  readonly nextStep: readonly unknown[];
  replace(messageId: string, message: unknown): boolean;
  remove(messageId: string): boolean;
  append(target: "next-turn" | "next-step", message: unknown): void;
}

/** inbox UserMessage 的消费面 schema：id 必有；content 至少一块；source 透传。 */
const InboxMessageSchema = z
  .object({
    id: z.string().min(1),
    source: z.unknown().optional(),
    content: z
      .array(z.object({ type: z.string().min(1), text: z.string().optional() }).passthrough())
      .min(1),
  })
  .passthrough();

/** safeParse 收窄后的 inbox 消息。 */
export type InboxMessage = z.infer<typeof InboxMessageSchema>;

/** unknown → InboxMessage（畸形返回 null，调用方跳过）。 */
export function parseInboxMessage(raw: unknown): InboxMessage | null {
  const checked = InboxMessageSchema.safeParse(raw);
  return checked.success ? checked.data : null;
}

/** 消息 → 队列项投影（text = 文本块拼接；attachments = image/file 块计数）。 */
export function queueItemOf(message: InboxMessage, target: AgentQueueItem["target"]): AgentQueueItem {
  const texts: string[] = [];
  let attachments = 0;
  for (const block of message.content) {
    if (block.type === "text" && typeof block.text === "string" && block.text.length > 0) {
      texts.push(block.text);
    }
    if (block.type === "image" || block.type === "file") attachments += 1;
  }
  return { messageId: message.id, target, text: texts.join("\n"), attachments };
}

/** inbox 读面投影：next-step 先（转向优先可见），next-turn 随后；畸形跳过。 */
export interface InboxEntry {
  item: AgentQueueItem;
  /** safeParse 收窄副本（编辑重建的源）。 */
  parsed: InboxMessage;
  /** 内核原对象引用（steer 的 remove+append 再入列用）。 */
  original: unknown;
}

export function projectInbox(inbox: InboxLike): InboxEntry[] {
  const out: InboxEntry[] = [];
  for (const [target, list] of [
    ["next-step", inbox.nextStep],
    ["next-turn", inbox.nextTurn],
  ] as const) {
    for (const original of list) {
      const parsed = parseInboxMessage(original);
      if (parsed === null) continue;
      out.push({ item: queueItemOf(parsed, target), parsed, original });
    }
  }
  return out;
}

/**
 * 编辑重建（仅文本）：新 content = 新文本块 + 原非文本块（附件不丢）；source
 * 沿用原消息（非 user 源或缺省一律回 {kind:"user"}——队列消息的产品事实）。
 * createUserMessage 签发新 id——身份随编辑变化，队列刷新后以新 id 寻址。
 */
export function rebuildEditedMessage(original: InboxMessage, text: string): unknown {
  const nonText = original.content.filter((block) => block.type !== "text");
  const maybeSource = original.source;
  const source =
    typeof maybeSource === "object" &&
    maybeSource !== null &&
    (maybeSource as { kind?: unknown }).kind === "user"
      ? (maybeSource as { kind: "user" })
      : { kind: "user" as const };
  return createUserMessage({
    source,
    content: [{ type: "text", text }, ...nonText] as never,
  });
}
