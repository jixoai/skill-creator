/**
 * 内核 agent 会话服务（dsh-kernel-rebase task 2.2）。
 *
 * 用户原始需求 [2026-09-08]：「在现有 skill creator 的基础上。去实现一个 Agent
 * 的产品。」——面板会话的进程内消费面：list/create/prompt/cancel/stream 都经
 * 内核 ctx.agents / ctx.sessions / session-event firehose 投影，不自研 loop。
 *
 * 正交意图：
 *   [1] 会话生命周期：create 走官方 agents.create（产品 preset + 按模式的工具面
 *       收窄 setup）；prompt 经 followup；cancel 经 agent.cancel；list 从 sessions
 *       store 投影摘要。
 *   [2] 脱敏 stream 环形投影：订阅 session/event firehose，把 turn/status/
 *       message 事件映射为 DshSessionStreamFrame（payload 过 redactDshPayload）；
 *       全部被消费事件类型的 data 先过 Zod safeParse，畸形丢弃 + 有界诊断
 *       （2026-09-12 codex R2：六类 tool/message 事件补齐收窄）。
 *   [3] 跨重启持久：帧 write-through 到转录存储（sessions/YYYY/MM/DD/<id>），
 *       含 assistant-reasoning 终帧（Thinking 与正文同序 durable，回放等价
 *       live）；重启后 list/stream 由转录回放，prompt 经内核 agents.resume 续聊。
 *   [4] 可选宿主：内核未挂载时 typed UNAVAILABLE（DomainError），不静默空面。
 *   [5] 模式生命周期（add-agent-settings-modes）：create/revive 按转录 meta 的
 *       mode 组合 setup；setMode = meta 原子改写 + live 句柄有界释放 + mode-changed
 *       帧，下一次 prompt 以新模式复活（历史归内核 session log）。
 * 妥协声明：跨 cordis 服务访问按结构化 unknown 收窄（宿主服务形状无公开 TS 面，
 * 与 dsh-session-binder 同法则）；LLM 历史事实归内核 session log，本层转录只是
 * 面板投影。R14-C 清理是薄委托面（cleanup/liveStatusOf/disposeLiveSession 转发
 * session-cleanup.ts，逻辑不在本文件生长——意图数已满）。
 */
import { randomUUID } from "node:crypto";
import type { Context } from "@deepseek-ai/cordis";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { z } from "zod";
import {
  redactDshPayload,
  type DshAgentMode,
  type DshSessionStreamFrame,
} from "../../shared/contracts/dsh-runtime.js";
import type {
  AgentQueueItem,
  AgentSessionStatus,
  AgentSessionSummary,
  AgentSessionsCleanupInput,
  AgentSessionsCleanupResult,
} from "../../shared/contracts/agent.js";
import { DomainError } from "../domain-error.js";
import { isTextualFileName } from "../agent-files.js";
import { AGENT_MODE_ROLES, agentRoleToolName } from "../../shared/contracts/agent-roles.js";
import type { DshKernelHandle } from "./dsh-kernel.js";
import { KERNEL_AGENT_TOOL_ALLOWLIST } from "./dsh-kernel.js";
import { applyAgentMode } from "./agent-modes.js";
import { registerProductPromptSections } from "./product-prompt.js";
import { runSessionCleanup } from "./session-cleanup.js";
import { projectInbox, rebuildEditedMessage, type InboxLike } from "./agent-queue.js";
import { summaryOfMeta, type SessionTranscripts } from "./session-transcripts.js";

/** 内核句柄访问器（daemon boot 后注入；未挂载返回 null）。 */
export type KernelAccessor = () => DshKernelHandle | null;

/** 服务依赖（settings 供 model/preset 读取——创建会话时应用 agentOptions）。 */
export interface AgentSessionsDeps {
  kernel: KernelAccessor;
  /** 读取当前 model 选择（provider/model/reasoningEffort → AgentOptions）。 */
  modelSelection: () => Promise<{ provider: string; model: string; reasoningEffort?: string }>;
  /** 读取新会话默认模式（settings.defaultMode）。 */
  defaultMode: () => Promise<DshAgentMode>;
  /**
   * 模型容量事实（codex R7 B1：maxOutputTokens 决定自动压缩时机）：
   * contextWindow - maxOutputTokens = 保留输出空间后的 in-token 阈值。
   * 缺省（未接线/模型未配置）= 自动压缩关闭，不猜测。
   */
  modelLimits?: (
    provider: string,
    model: string,
  ) => Promise<{ contextWindow?: number; maxOutputTokens?: number } | null>;
  /** 帧缓冲上限（缺省 200）。 */
  retention?: number;
  /** 面板转录存储（跨重启回放与续聊定位）。 */
  transcripts: SessionTranscripts;
  /**
   * `@` file 引用展开（C1）：守卫链在 agent-files（单一事实源）；注入解耦
   * kernel/ 对 daemon 根模块的运行时依赖（测试可替换）。
   */
  expandFileReferences?: (references: Array<{ kind: "file"; path: string }>) => Promise<string[]>;
}

/** 内核 Agent/Session 的最小结构面（unknown 收窄）。 */
interface AgentLike {
  id: string;
  status: string;
  session: {
    id: string;
    header: { cwd?: string; createdAt?: number | string };
  };
  followup(message: unknown): void;
  /** W4 steer（next-step 转向）；内核 Agent 面存在——类型面可选防降级组合。 */
  steer?(message: unknown): void;
  cancel(cause: unknown, options?: unknown): void;
  /** C2：内核 ReactLoopInbox 面（queue 行级操作）；unknown 收窄后交 agent-queue。 */
  inbox?: unknown;
}

interface AgentsServiceLike {
  create(options: {
    sessionId: string;
    meta?: { cwd?: string; agentPreset?: string };
    agentOptions?: { provider?: string; model?: string; reasoningEffort?: string };
    setup?: (agentCtx: Context) => void | Promise<void>;
  }): Promise<{ agent: AgentLike; dispose(): Promise<void> }>;
  /** 内核持久会话复活（LLM 历史由内核 session log 重建）。 */
  resume(options: {
    resumeSessionId: string;
    agentOptions?: { provider?: string; model?: string; reasoningEffort?: string };
    setup?: (agentCtx: Context) => void | Promise<void>;
  }): Promise<{ agent: AgentLike; dispose(): Promise<void> }>;
}

interface SessionsServiceLike {
  list(): Array<{
    id: string;
    header: {
      cwd?: string;
      createdAt?: number | string;
      /** 子代理会话标记（dsh-subagent childSessionMeta）：面板列表过滤依据。 */
      origin?: string;
      parentSession?: string;
    };
  }>;
  get(id: string): unknown;
}

/** session/event firehose 的最小事件形状。 */
interface SessionEventLike {
  seq: number;
  type: string;
  data: unknown;
}

/**
 * firehose 载荷的入口 schema 家族（2026-09-12 codex 阻塞 3 + R2 阻塞 1：
 * event.data 是内核来的外部输入，必须 unknown→safeParse，禁止 TS cast 直读——
 * 所有被消费的事件类型都有对应 schema，无消费面的事件除外）。assistant/chunk
 * 覆盖 text/reasoning/tool-call delta 三种分片形状（tool-call-delta = type/id/
 * name/argumentsDelta）；todo/write 是 {content,status} 全量快照；其余六类
 * （turn/end、session/title、user/message、assistant/message、tool/call、
 * tool/result）见下方各自 schema。失败丢弃该事件并记有界诊断——畸形载荷不进
 * 缓冲、不落转录、不打断帧序列。
 */
export const AgentChunkEventSchema = z.object({
  chunk: z.object({
    type: z.string().min(1),
    text: z.string().optional(),
    id: z.string().optional(),
    name: z.string().optional(),
    argumentsDelta: z.string().optional(),
  }),
});

export const TodoWriteEventSchema = z.object({
  todos: z.array(
    z.object({
      content: z.string(),
      status: z.string().min(1),
    }),
  ),
});

/**
 * firehose 其余被消费事件的入口 schema（2026-09-12 codex R2 阻塞 1：六类
 * tool/message 事件同样 unknown→safeParse，禁止 Record cast 直读）。形状按
 * dsh-session SessionEventMap 实测契约最小化：直接读取的键类型严格（缺失
 * 可选、存在必合型），未消费键 passthrough（整体仍要进 redactDshPayload）；
 * 畸形即整事件丢弃 + 有界诊断。turn/start（不读 data）与 agent/status
 * （data 只整体过 redactDshPayload，无字段读取）无消费面，不需要 schema。
 */

/** 消息 source 的消费面：kind（user/model/tool 判别）与 callId（tool/result 回填名）。 */
const MessageSourceSchema = z
  .object({
    kind: z.string().optional(),
    callId: z.string().optional(),
  })
  .passthrough();

/**
 * 消息 content 块的最小消费面：type 是 merge-extensible 判别串（text/
 * reasoning/image/file/tool-call/tool-result + 插件扩展），故不枚举；text/
 * name 被 textOf/reasoningOf/attachmentsOf 读取，存在即必须 string。未消费
 * 字段（attachment ref、id、arguments…）passthrough 给脱敏 payload。
 */
const MessageBlockSchema = z
  .object({
    type: z.string().min(1),
    text: z.string().optional(),
    name: z.string().optional(),
  })
  .passthrough();

/** 消息外壳：source + content 块数组（user/assistant 消息共用；content 契约必在且非空——空消息事件按畸形丢弃）。 */
const MessageShapeSchema = z
  .object({
    source: MessageSourceSchema.optional(),
    content: z.array(MessageBlockSchema).min(1),
  })
  .passthrough();

/**
 * {message: M} 信封解包：M 为对象则取 M，否则 data 即 message（user/message
 * 实测形状是后者，assistant/message 实测形状是前者；与原 `data.message ?? data`
 * 解析序等价——nullish/非对象 message 回退 data 本身）。
 */
function messageEnvelopeOf(raw: unknown): unknown {
  if (typeof raw === "object" && raw !== null && "message" in raw) {
    const wrapped = raw.message;
    if (typeof wrapped === "object" && wrapped !== null) return wrapped;
  }
  return raw;
}

/**
 * user/message 与 assistant/message 共用事件形状（当前契约一致：信封 + source
 * + content 块）。assistant 的 usage 在信封顶层（TokenUsage 白名单数值），
 * 由分支读原始 data 投影，不经本 schema 约束。
 */
export const MessageEventSchema = z.preprocess(messageEnvelopeOf, MessageShapeSchema);

/** turn/end：reason.kind 投影为帧 text；整体 data passthrough 进脱敏 payload。 */
export const TurnEndEventSchema = z
  .object({
    reason: z.object({ kind: z.string().optional() }).passthrough().optional(),
  })
  .passthrough();

/** session/title：title 存在即必须 string；缺失/空白由分支静默丢弃（不产帧）。 */
export const SessionTitleEventSchema = z
  .object({
    title: z.string().optional(),
  })
  .passthrough();

/**
 * tool/call：dsh-session 契约三键必填——callId、name 非空串，arguments 为模型
 * 产出的原始 JSON 字符串（未解析）。缺失任一即畸形丢弃（不产帧不消耗 seq）。
 */
export const ToolCallEventSchema = z
  .object({
    callId: z.string().min(1),
    name: z.string().min(1),
    arguments: z.string(),
  })
  .passthrough();

/**
 * tool/result：dsh-llm `ToolResultMessage` 精确契约——`source.kind` 字面量
 * 'tool' 且 callId 必填（回填工具名的关联键），content 是单个 `type:'tool-result'`
 * 块的 tuple（块 type 字面量锁死），块内 toolCallId 必填、content 为含至少一个
 * 非空 text part 的块数组（消费面只读 text；纯 image/未知块 = 无可消费内容）。
 * 空 message/空数组/空块/错误 discriminant 全部按畸形丢弃（codex R4/R5）。
 */
export const ToolResultEventSchema = z.object({
  message: z
    .object({
      source: z.object({ kind: z.literal("tool"), callId: z.string().min(1) }).passthrough(),
      content: z.tuple([
        z
          .object({
            type: z.literal("tool-result"),
            toolCallId: z.string().min(1),
            content: z
              .array(
                z
                  .object({
                    type: z.string().min(1),
                    text: z.string().optional(),
                  })
                  .passthrough(),
              )
              .min(1)
              .refine(
                (parts) =>
                  parts.some(
                    (part) =>
                      part.type === "text" && typeof part.text === "string" && part.text.length > 0,
                  ),
                { message: "tool-result block needs a consumable text part" },
              ),
          })
          .passthrough(),
      ]),
    })
    .passthrough(),
});

/** turn/start：消费面不读 data；非对象载荷按畸形丢弃（record 门）。 */
export const TurnStartEventSchema = z.record(z.string(), z.unknown());

/** agent/status：data 整体进脱敏投影；非对象载荷按畸形丢弃（record 门）。 */
export const AgentStatusEventSchema = z.record(z.string(), z.unknown());

/**
 * subagent/catalog（父会话持有的子代理目录事件；官方 shape 见 dsh-subagent
 * establishCatalogChild）：childId/mode 必有，label 可缺省（one-shot）。
 */
export const SubagentCatalogEventSchema = z.object({
  childId: z.string().min(1),
  childCreatedAt: z.number().optional(),
  mode: z.enum(["one-shot", "continuable"]),
  label: z.string().optional(),
});

/** assistant/message 顶层 usage 的数值白名单信封（usage 存在则必须为对象）。 */
const UsageEnvelopeSchema = z
  .object({ usage: z.record(z.string(), z.unknown()).optional() })
  .passthrough();

/** 诊断日志的整行硬上限（绝不打印全 payload）。 */
const DROPPED_EVENT_LOG_MAX = 200;

/** 畸形事件的丢弃诊断：整行截断 ≤200ch（与 session-transcripts 的 console 前缀约定一致）。 */
function logDroppedEvent(sessionId: string, type: string, data: unknown): void {
  let detail: string;
  try {
    const serialized = JSON.stringify(data);
    detail = serialized === undefined ? String(data) : serialized;
  } catch {
    detail = String(data);
  }
  let line = `[agent-sessions] dropped malformed ${type} event for ${sessionId}: ${detail}`;
  if (line.length > DROPPED_EVENT_LOG_MAX) {
    line = `${line.slice(0, DROPPED_EVENT_LOG_MAX - 1)}…`;
  }
  console.warn(line);
}

/** 待答问题的 live 记录（answerer Promise 由 agent.session.answer resolve）。 */
interface PendingApproval {
  requestSeq: number;
  resolve: (answer: {
    answers: Array<{ id: string; selected: string[]; custom?: string }>;
  }) => void;
}

/** 会话的 live 面板记录（frames ring + live agent 引用）。 */
interface LivePanelSession {
  agent: AgentLike;
  dispose(): Promise<void>;
  frames: DshSessionStreamFrame[];
  /** 进程内单调帧序（1 起：stream 游词语义 afterSeq = 已消费最大 seq，初始 0
   *  即从头读全部——0 基首帧会被 `seq > afterSeq` 永久丢弃）。 */
  frameSeq: number;
  title: string;
  /** 会话模式（setup 固化；切换即释放句柄）。 */
  mode: DshAgentMode;
  /** 按 requestSeq 索引的待答问题（ask_user_question waterfall）。 */
  pending: Map<number, PendingApproval>;
  /** tool/call 的 callId → 工具名（tool/result 事件不带名，按 callId 回填）。 */
  toolNames: Map<string, string>;
  /** assistant/chunk text-delta 的合并缓冲（120ms 窗口一帧，避免逐 token 落盘）。 */
  deltaBuffer: string[];
  /** assistant/chunk reasoning-delta 的合并缓冲（thinking 流，同窗口）。 */
  reasoningBuffer: string[];
  /** assistant/chunk tool-call-delta 的分 call 合并缓冲（键 = callId ?? name）。 */
  toolArgBuffers: Map<string, { name?: string; parts: string[] }>;
  /** 上次 delta 帧冲刷时刻（ms）。 */
  deltaAt: number;
  /** 最近一次 assistant usage 快照（inputTokens 驱动自动压缩阈值判断）。 */
  lastUsage?: Record<string, number>;
}

const DEFAULT_RETENTION = 200;
/** prompt 长度硬上限（与 RPC 契约 AgentSessionPromptInputSchema 一致）。 */
const PROMPT_MAX_CHARS = 20_000;
/** 流式增量帧的合并窗口：窗口内的 text-delta 合成一帧。 */
const DELTA_FLUSH_MS = 120;

/** 构造 agent 会话服务；内核未挂载时所有面返回 typed UNAVAILABLE。 */
export function createAgentSessionsService(deps: AgentSessionsDeps) {
  const retention = deps.retention ?? DEFAULT_RETENTION;
  const live = new Map<string, LivePanelSession>();
  /** 清理处置中标记（R15：门内 reviveSession 被拒）。 */
  const disposingIds = new Set<string>();
  /**
   * 已清理墓碑（R15 终验 P1-2 终闭）：transcript 被 cleanup 删除的会话在**本
   * 进程生命周期内**永久拒绝复活——瞬态门（disposingIds）会在清理完成后解除，
   * 无法覆盖「恢复链仍在飞行、清理已完成」的交错；墓碑补齐该窗口。软上限
   * 5000 FIFO 防无界（超出后最早的墓碑让位——复活将走转录缺失的 NOT_FOUND
   * 常规路径，语义等价）。
   */
  const cleanedTombstones = new Set<string>();
  const tombstoneOrder: string[] = [];
  const TOMBSTONE_SOFT_CAP = 5000;

  function tombstoneCleaned(sessionId: string): void {
    if (cleanedTombstones.has(sessionId)) return;
    cleanedTombstones.add(sessionId);
    tombstoneOrder.push(sessionId);
    if (tombstoneOrder.length > TOMBSTONE_SOFT_CAP) {
      const evicted = tombstoneOrder.shift();
      if (evicted !== undefined) cleanedTombstones.delete(evicted);
    }
  }
  let firehoseBound = false;

  function requireKernel(): DshKernelHandle {
    const kernel = deps.kernel();
    if (!kernel) {
      throw new DomainError("UNAVAILABLE", "agent kernel is not mounted");
    }
    return kernel;
  }

  function agentsService(ctx: Context): AgentsServiceLike {
    const service = (ctx as Context & { agents?: unknown }).agents;
    if (!service) throw new DomainError("UNAVAILABLE", "kernel ctx.agents service missing");
    return service as AgentsServiceLike;
  }

  function sessionsService(ctx: Context): SessionsServiceLike {
    const service = (ctx as Context & { sessions?: unknown }).sessions;
    if (!service) throw new DomainError("UNAVAILABLE", "kernel ctx.sessions service missing");
    return service as SessionsServiceLike;
  }

  /** 订阅 session/event firehose → 帧投影（内核生命周期内绑定一次）。 */
  function bindFirehose(kernel: DshKernelHandle): void {
    if (firehoseBound) return;
    firehoseBound = true;
    (
      kernel.ctx as unknown as {
        on: (
          event: "session/event",
          listener: (session: { id: string }, event: SessionEventLike) => void,
        ) => () => void;
      }
    ).on("session/event", (session, event) => {
      const entry = live.get(session.id);
      if (!entry) return;
      // 流式增量：assistant/chunk（text-delta / reasoning-delta / tool-call-delta）
      // 各进合并缓冲，按时间窗成帧；其余事件先冲刷缓冲，保证增量帧先于收尾帧落序。
      // data 先过 AgentChunkEventSchema safeParse：畸形丢弃 + 有界诊断（codex 阻塞 3）。
      if (event.type === "assistant/chunk") {
        const checked = AgentChunkEventSchema.safeParse(event.data);
        if (!checked.success) {
          logDroppedEvent(session.id, event.type, event.data);
          return;
        }
        const chunk = checked.data.chunk;
        if (
          typeof chunk.text === "string" &&
          chunk.text.length > 0 &&
          (chunk.type === "text-delta" || chunk.type === "reasoning-delta")
        ) {
          const buffer = chunk.type === "text-delta" ? entry.deltaBuffer : entry.reasoningBuffer;
          buffer.push(chunk.text);
          if (Date.now() - entry.deltaAt >= DELTA_FLUSH_MS) flushDeltas(entry);
          return;
        }
        // 工具参数流式分片（§4.1）：按 callId（缺省 name，再缺省丢弃——无法关联）
        // 分桶缓冲；终帧 tool/call 事件前的非 chunk 事件会先冲刷保证落序。
        if (chunk.type === "tool-call-delta" && typeof chunk.argumentsDelta === "string") {
          const key =
            typeof chunk.id === "string" && chunk.id.length > 0
              ? chunk.id
              : typeof chunk.name === "string" && chunk.name.length > 0
                ? chunk.name
                : undefined;
          if (key !== undefined) {
            const bucket = entry.toolArgBuffers.get(key) ?? { parts: [] };
            if (bucket.name === undefined && typeof chunk.name === "string") {
              bucket.name = chunk.name;
            }
            bucket.parts.push(chunk.argumentsDelta);
            entry.toolArgBuffers.set(key, bucket);
          }
          if (Date.now() - entry.deltaAt >= DELTA_FLUSH_MS) flushDeltas(entry);
        }
        return;
      }
      flushDeltas(entry);
      // projectEvent 返回有序帧列表（assistant/message 一步可产 reasoning + text
      // 两帧）；每帧统一走 push + retention trim + 转录 append 提交，reasoning
      // 终帧由此获得 durable 持久化与 retention 约束（codex R2 阻塞 2）。
      const frames = projectEvent(entry, event);
      commitFrames(entry, frames);
      // 自动压缩（codex R7 B1）：turn 结束后按 inputTokens + maxOutputTokens ≥
      // contextWindow 判定，触发内核 /compact 并落 auto-compact 标记帧。
      if (frames.some((frame) => frame.kind === "turn-end")) {
        void maybeAutoCompact(entry);
      }
    });
  }

  /** 帧提交单点：push + retention trim + 转录 append（best-effort）。 */
  function commitFrames(entry: LivePanelSession, frames: readonly DshSessionStreamFrame[]): void {
    for (const frame of frames) {
      entry.frames.push(frame);
      if (entry.frames.length > retention) {
        entry.frames.splice(0, entry.frames.length - retention);
      }
      deps.transcripts.append(entry.agent.session.id, frame);
    }
  }

  /**
   * 自动压缩（codex R7 B1）：用户语义「最大输出 Token 决定自动压缩的时机」。
   * 阈值 = contextWindow - maxOutputTokens（两值齐备才启用，缺一不猜）；
   * inputTokens ≥ 阈值 → 先落 auto-compact 标记帧（UI 居中注记 + 回放留痕），
   * 再经内核 commands.execute("/compact") 执行（与 slash 路径同源）。
   * 触发时机为 turn-end 之后（不与 running 转录竞争）；失败有界日志不重试。
   * 模型取当前活动选择（settings.model）——会话存续期间热切模型按新配置判定。
   */
  async function maybeAutoCompact(entry: LivePanelSession): Promise<void> {
    if (deps.modelLimits === undefined) return;
    const inputTokens = entry.lastUsage?.inputTokens;
    if (inputTokens === undefined) return;
    try {
      const selection = await deps.modelSelection();
      const limits = await deps.modelLimits(selection.provider, selection.model);
      if (limits === undefined || limits === null) return;
      const { contextWindow, maxOutputTokens } = limits;
      if (contextWindow === undefined || maxOutputTokens === undefined) return;
      if (inputTokens < contextWindow - maxOutputTokens) return;
      const note = `Auto-compact — ${inputTokens} in + ${maxOutputTokens} output reserve ≥ ${contextWindow} window`;
      commitFrames(entry, [
        {
          at: new Date().toISOString(),
          runId: entry.agent.session.id,
          sessionId: entry.agent.session.id,
          seq: entry.frameSeq++,
          kind: "auto-compact",
          text: note,
        },
      ]);
      const commands = (
        requireKernel().ctx as Context & {
          commands?: {
            execute: (
              agent: unknown,
              line: string,
              attachments: readonly unknown[],
              signal: AbortSignal,
            ) => Promise<unknown>;
          };
        }
      ).commands;
      if (commands === undefined) return;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30_000);
      try {
        await commands.execute(entry.agent, "/compact", [], controller.signal);
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.warn(
        `[agent-sessions] auto-compact failed for ${entry.agent.session.id}: ${detail.slice(0, 120)}`,
      );
    }
  }

  /**
   * 冲刷增量缓冲为帧（reasoning 先于 text——同一步内思考在前；text 先于工具参数
   * ——工具调用在正文之后）；live 环 + 转录同序落盘。
   */
  function flushDeltas(entry: LivePanelSession): void {
    if (
      entry.deltaBuffer.length === 0 &&
      entry.reasoningBuffer.length === 0 &&
      entry.toolArgBuffers.size === 0
    ) {
      return;
    }
    entry.deltaAt = Date.now();
    const emit = (frame: DshSessionStreamFrame): void => {
      entry.frames.push(frame);
      if (entry.frames.length > retention) {
        entry.frames.splice(0, entry.frames.length - retention);
      }
      deps.transcripts.append(entry.agent.session.id, frame);
    };
    if (entry.reasoningBuffer.length > 0) {
      emit({
        at: new Date().toISOString(),
        runId: entry.agent.session.id,
        sessionId: entry.agent.session.id,
        seq: entry.frameSeq++,
        kind: "assistant-reasoning-delta",
        text: entry.reasoningBuffer.join(""),
      });
      entry.reasoningBuffer = [];
    }
    if (entry.deltaBuffer.length > 0) {
      emit({
        at: new Date().toISOString(),
        runId: entry.agent.session.id,
        sessionId: entry.agent.session.id,
        seq: entry.frameSeq++,
        kind: "assistant-delta",
        text: entry.deltaBuffer.join(""),
      });
      entry.deltaBuffer = [];
    }
    if (entry.toolArgBuffers.size > 0) {
      for (const [callKey, bucket] of entry.toolArgBuffers) {
        emit({
          at: new Date().toISOString(),
          runId: entry.agent.session.id,
          sessionId: entry.agent.session.id,
          seq: entry.frameSeq++,
          kind: "tool-args-delta",
          text: bucket.parts.join(""),
          ...(bucket.name ? { toolName: bucket.name } : {}),
          toolCallId: callKey,
        });
      }
      entry.toolArgBuffers.clear();
    }
  }

  /**
   * 单事件 → 有序帧列表投影（空数组 = 丢弃；未知事件类型/合法但无内容的载荷
   * 都投影为空；payload 脱敏）。每个被消费的事件类型在分支入口 safeParse，
   * 畸形走 ≤200ch 有界诊断（codex R2 阻塞 1）。
   */
  function projectEvent(entry: LivePanelSession, event: SessionEventLike): DshSessionStreamFrame[] {
    const base = {
      at: new Date().toISOString(),
      runId: entry.agent.session.id,
      sessionId: entry.agent.session.id,
    };
    // data 保持原始 event.data（不归一化）：缺失/非对象载荷必须被各分支的
    // record/schema 门拒绝——`?? {}` 会把 undefined 伪装成合法空对象绕过门
    // （codex R4 阻塞 2）。
    const data: unknown = event.data;
    switch (event.type) {
      case "turn/start": {
        const checked = TurnStartEventSchema.safeParse(data);
        if (!checked.success) {
          logDroppedEvent(entry.agent.session.id, event.type, data);
          return [];
        }
        return [{ ...base, seq: entry.frameSeq++, kind: "turn-start" }];
      }
      case "turn/end": {
        const checked = TurnEndEventSchema.safeParse(data);
        if (!checked.success) {
          logDroppedEvent(entry.agent.session.id, event.type, data);
          return [];
        }
        const reason = checked.data.reason?.kind;
        return [
          {
            ...base,
            seq: entry.frameSeq++,
            kind: "turn-end",
            text: reason,
            payload: redactDshPayload(checked.data),
          },
        ];
      }
      case "todo/write": {
        // todo/write 是全量快照（latest wins）：payload 先过 TodoWriteEventSchema
        // safeParse（畸形丢弃 + 有界诊断），投影 todos 数组，UI 渲染 checklist。
        const checked = TodoWriteEventSchema.safeParse(data);
        if (!checked.success) {
          logDroppedEvent(entry.agent.session.id, event.type, data);
          return [];
        }
        const cleaned = checked.data.todos.map((todo) => ({
          content: todo.content,
          status:
            todo.status === "completed" || todo.status === "in_progress"
              ? todo.status
              : ("pending" as const),
        }));
        return [
          {
            ...base,
            seq: entry.frameSeq++,
            kind: "todo-snapshot",
            payload: redactDshPayload({ todos: cleaned }),
          },
        ];
      }
      case "session/title": {
        // 内核 session-title 行（dsh-base 自带，首 prompt 后经辅助 LLM 生成、失败
        // 回退首词截断）投出的标题：更新 live title + 转录 meta，并以帧驱动面板
        // 会话列表即时改名（重启后的标题回放走转录 meta）。
        const checked = SessionTitleEventSchema.safeParse(data);
        if (!checked.success) {
          logDroppedEvent(entry.agent.session.id, event.type, data);
          return [];
        }
        const title = checked.data.title?.trim() ?? "";
        if (title.length === 0) return [];
        entry.title = title;
        deps.transcripts.updateTitle(entry.agent.session.id, title);
        return [{ ...base, seq: entry.frameSeq++, kind: "session-title", text: title }];
      }
      case "agent/status": {
        const checked = AgentStatusEventSchema.safeParse(data);
        if (!checked.success) {
          logDroppedEvent(entry.agent.session.id, event.type, data);
          return [];
        }
        return [
          {
            ...base,
            seq: entry.frameSeq++,
            kind: "status",
            payload: redactDshPayload(checked.data),
          },
        ];
      }
      case "subagent/catalog": {
        // 角色 spawn 的可见性帧（dsh-alpha-native-subagents）：父会话持有的目录
        // 事件投影 childId/mode/label；子代理内部转录不入父轨（可经 transcripts
        // 探视），settlement 以 subagent-settled 用户消息回流（user-text 帧）。
        const checked = SubagentCatalogEventSchema.safeParse(data);
        if (!checked.success) {
          logDroppedEvent(entry.agent.session.id, event.type, data);
          return [];
        }
        return [
          {
            ...base,
            seq: entry.frameSeq++,
            kind: "subagent",
            text: checked.data.label ?? checked.data.childId,
            payload: redactDshPayload({
              childId: checked.data.childId,
              mode: checked.data.mode,
              ...(checked.data.label !== undefined ? { label: checked.data.label } : {}),
            }),
          },
        ];
      }
      case "user/message": {
        // 事件形状实测（2026-09-08 内核日志）：真实人类输入 data 即 message 且
        // data.source.kind === "user"；内核注入（system-reminder、runtime context）
        // 无 user source，不进对话流。user 帧是切换会话后从帧缓冲重建消息列表的
        // 唯一用户消息来源——丢弃会让切换后的转录缺失全部用户输入。
        const checked = MessageEventSchema.safeParse(data);
        if (!checked.success) {
          logDroppedEvent(entry.agent.session.id, event.type, data);
          return [];
        }
        const message = checked.data;
        if (message.source?.kind !== "user") return [];
        const text = textOf(message);
        if (text === undefined || text.length === 0) return [];
        // 附件回显元数据（§4.2）：从 content 的 image/file 块派生 kind+名字，不回
        // 传字节；切换会话/重连的回放路径据此重建附件行（乐观预览仍优先）。
        const attachments = attachmentsOf(message);
        return [
          {
            ...base,
            seq: entry.frameSeq++,
            kind: "user-text",
            text,
            ...(attachments.length > 0 ? { payload: redactDshPayload({ attachments }) } : {}),
          },
        ];
      }
      case "assistant/message": {
        // 事件形状实测（2026-09-08 真实会话）：{turn, step, message:{content:[...]}}。
        // reasoning 块（thinking）先投影为折叠终帧，再投正文——一步内思考在前；
        // 两帧都经监听器统一提交路径落转录（durable Thinking，R2 阻塞 2）。
        const checked = MessageEventSchema.safeParse(data);
        if (!checked.success) {
          logDroppedEvent(entry.agent.session.id, event.type, data);
          return [];
        }
        const message = checked.data;
        const reasoning = reasoningOf(message);
        const text = textOf(message);
        // assistant 至少要有可消费的 reasoning 或 text（契约：事件即已组装的消息；
        // 空消息按畸形丢弃，不消耗 seq）。reasoning-only 步骤不产空 text 帧
        //（usage 白名单挂到 reasoning 帧避免丢失）。
        const usage = usageSnapshotOf(data);
        if (usage !== undefined) entry.lastUsage = usage;
        if (reasoning === undefined && (text === undefined || text.length === 0)) {
          return [];
        }
        const frames: DshSessionStreamFrame[] = [];
        if (reasoning !== undefined) {
          frames.push({
            ...base,
            seq: entry.frameSeq++,
            kind: "assistant-reasoning",
            text: reasoning,
            ...(text === undefined || text.length === 0
              ? {
                  payload: {
                    source: redactDshPayload(message.source),
                    usage,
                  },
                }
              : {}),
          });
        }
        if (text !== undefined && text.length > 0) {
          frames.push({
            ...base,
            seq: entry.frameSeq++,
            kind: "assistant-text",
            text,
            payload: {
              source: redactDshPayload(message.source),
              // usage 在事件 data 顶层；token 计数不是凭据——键名误中脱敏 token 模式
              // 会把数值打成 [redacted]，故白名单提取（2026-09-12 PM 证据轮实测）。
              usage,
            },
          });
        }
        return frames;
      }
      case "tool/call": {
        const checked = ToolCallEventSchema.safeParse(data);
        if (!checked.success) {
          logDroppedEvent(entry.agent.session.id, event.type, data);
          return [];
        }
        // arguments 是模型产出的原始 JSON 字符串（契约必填）：尽力解析为对象供
        // 脱敏投影，解析失败保持原文。
        let parsedArgs: unknown = checked.data.arguments;
        try {
          parsedArgs = JSON.parse(checked.data.arguments);
        } catch {
          parsedArgs = checked.data.arguments;
        }
        const callName = checked.data.name;
        const callId = checked.data.callId;
        entry.toolNames.set(callId, callName);
        // toolCallId（§4.1）：call+result 合并行的关联键；参数流增量已在此帧前
        // 冲刷（非 chunk 事件先 flush），store 以完整参数收敛 argsText。
        return [
          {
            ...base,
            seq: entry.frameSeq++,
            kind: "tool-call",
            toolName: callName,
            toolCallId: callId,
            payload: redactDshPayload(parsedArgs),
          },
        ];
      }
      case "tool/result": {
        // 契约形状：{turn, step, message:{source:{kind:'tool', callId},
        // content:[{type:'tool-result', toolCallId, content:[{type:'text', text}]}]}}。
        const checked = ToolResultEventSchema.safeParse(data);
        if (!checked.success) {
          logDroppedEvent(entry.agent.session.id, event.type, data);
          return [];
        }
        const message = checked.data.message;
        const block = message.content[0];
        let text: string | undefined;
        for (const part of block.content) {
          if (part.type === "text") {
            text = part.text;
            break;
          }
        }
        const resultCallId = message.source.callId;
        const resolvedName = entry.toolNames.get(resultCallId);
        return [
          {
            ...base,
            seq: entry.frameSeq++,
            kind: "tool-result",
            toolName: resolvedName,
            toolCallId: resultCallId,
            text,
            payload: redactDshPayload(text !== undefined ? safeJsonParse(text) : data),
          },
        ];
      }
      default:
        return [];
    }
  }

  /**
   * 面板 answerer：claim 本会话的 user-questions/request（不 next 委派——面板是
   * 唯一人类面），问题以 approval-request 帧下发，Promise 由 answer() resolve。
   */
  function registerPanelAnswerer(entry: LivePanelSession): void {
    (
      entry.agent as unknown as {
        ctx: {
          on: (
            event: "user-questions/request",
            listener: (
              request: { questions?: unknown },
              next: () => Promise<unknown>,
            ) => Promise<{ answers: Array<{ id: string; selected: string[]; custom?: string }> }>,
          ) => () => void;
        };
      }
    ).ctx.on("user-questions/request", async (request) => {
      // requestSeq 即帧 seq（answer 的幂等键）：必须自增分配，否则后续事件帧复用
      // 同一 seq，转录回放出现重复序。
      const requestSeq = entry.frameSeq++;
      entry.frames.push({
        at: new Date().toISOString(),
        runId: entry.agent.session.id,
        sessionId: entry.agent.session.id,
        seq: requestSeq,
        kind: "approval-request",
        payload: redactDshPayload({ questions: request.questions ?? [] }),
      });
      return await new Promise<{
        answers: Array<{ id: string; selected: string[]; custom?: string }>;
      }>((resolve) => {
        entry.pending.set(requestSeq, { requestSeq, resolve });
      });
    });
  }

  /**
   * 复活持久会话：内核 agents.resume 重建 agent（LLM 历史来自内核 session log），
   * 环以转录末尾 seed（seq 连续），新帧继续追加到同一转录目录。
   * setup 按转录 meta 的 mode 组合（专有 section + 工具 guard）。
   * R15（codex R14 P1-2）：清理处置中的会话拒绝复活——dispose 与删除转录之间
   * 的 await 间隙不得被 prompt 走 revive 抢回（否则"已运行但历史被删"）。
   */
  async function reviveSession(sessionId: string): Promise<LivePanelSession> {
    const kernel = requireKernel();
    if (disposingIds.has(sessionId)) {
      throw new DomainError("NOT_FOUND", `agent session is being cleaned up: ${sessionId}`);
    }
    if (cleanedTombstones.has(sessionId)) {
      throw new DomainError("NOT_FOUND", `agent session was cleaned up: ${sessionId}`);
    }
    const meta = deps.transcripts.listAll().find((item) => item.sessionId === sessionId);
    if (meta === undefined) {
      throw new DomainError("NOT_FOUND", `agent session not found: ${sessionId}`);
    }
    const agents = agentsService(kernel.ctx);
    const model = await deps.modelSelection();
    let handle: Awaited<ReturnType<AgentsServiceLike["resume"]>>;
    try {
      handle = await agents.resume({
        resumeSessionId: sessionId,
        agentOptions: {
          provider: model.provider,
          model: model.model,
          ...(model.reasoningEffort ? { reasoningEffort: model.reasoningEffort } : {}),
        },
        setup: setupFor(meta.mode),
      });
    } catch (error) {
      throw new DomainError(
        "NOT_FOUND",
        `agent session not resumable: ${sessionId} (${error instanceof Error ? error.message : String(error)})`,
      );
    }
    const diskFrames = deps.transcripts.readFrames(sessionId);
    // R15 终验 P1-2：恢复链的 await 间隙（modelSelection/resume/readFrames）可能
    // 与清理门交错——清理已删转录时，这里在 live.set 前做**二次准入检查**：门内
    // id 的恢复就地释放句柄并按 NOT_FOUND 拒绝，绝不复活已清理会话。
    if (
      disposingIds.has(sessionId) ||
      cleanedTombstones.has(sessionId) ||
      !deps.transcripts.listAll().some((item) => item.sessionId === sessionId)
    ) {
      await handle.dispose().catch(() => undefined);
      throw new DomainError("NOT_FOUND", `agent session is being cleaned up: ${sessionId}`);
    }
    const seeded = diskFrames.slice(-retention);
    const entry: LivePanelSession = {
      agent: handle.agent,
      dispose: handle.dispose,
      frames: seeded,
      frameSeq: (seeded.at(-1)?.seq ?? 0) + 1,
      title: meta.title,
      mode: meta.mode,
      pending: new Map(),
      toolNames: new Map(),
      deltaBuffer: [],
      reasoningBuffer: [],
      toolArgBuffers: new Map(),
      deltaAt: Date.now(),
    };
    registerPanelAnswerer(entry);
    live.set(sessionId, entry);
    return entry;
  }

  /** JSON 文本安全解析（失败原样返回字符串）。 */
  function safeJsonParse(text: string): unknown {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  /** session 引用摘要的帧数/字符双上限（C1：有界上下文注入）。 */
  const SESSION_DIGEST_MAX_FRAMES = 30;
  const SESSION_DIGEST_MAX_CHARS = 24_000;

  /**
   * `@` session 引用摘要（C1）：转录帧流只取 user-text / assistant-text（思考、
   * 工具与审批不进引用），末尾 N 条、总字符 ≤24k；role 前缀行。被引会话缺失
   * （无 meta 且无帧）= typed NOT_FOUND——用户引用了已删目标，失败可见可修。
   */
  function sessionReferenceDigest(sessionId: string): string {
    const meta = deps.transcripts.listAll().find((item) => item.sessionId === sessionId);
    const frames = deps.transcripts.readFrames(sessionId);
    if (meta === undefined && frames.length === 0) {
      throw new DomainError("NOT_FOUND", `referenced session not found: ${sessionId}`);
    }
    const lines: string[] = [];
    let total = 0;
    for (let i = frames.length - 1; i >= 0 && lines.length < SESSION_DIGEST_MAX_FRAMES; i -= 1) {
      const frame = frames[i];
      const role =
        frame.kind === "user-text" ? "user" : frame.kind === "assistant-text" ? "assistant" : null;
      if (role === null || typeof frame.text !== "string" || frame.text.length === 0) continue;
      const line = `${role}: ${frame.text}`;
      if (total + line.length > SESSION_DIGEST_MAX_CHARS && lines.length > 0) break;
      lines.unshift(line.slice(0, SESSION_DIGEST_MAX_CHARS));
      total += line.length;
    }
    const title = meta?.title !== undefined && meta.title.length > 0 ? ` "${meta.title}"` : "";
    return `[reference: earlier session${title} (${sessionId})]\n${lines.join("\n")}`;
  }

  /** 引用展开（C1）：file 走注入的 agent-files 守卫链；session 走本层转录摘要。 */
  async function expandReferences(
    references: Array<{ kind: "file"; path: string } | { kind: "session"; sessionId: string }>,
  ): Promise<string[]> {
    const blocks: string[] = [];
    for (const reference of references) {
      if (reference.kind === "file") {
        if (deps.expandFileReferences === undefined) {
          throw new DomainError(
            "UNAVAILABLE",
            "file references require the agent-files service (not wired)",
          );
        }
        blocks.push(...(await deps.expandFileReferences([reference])));
      } else {
        blocks.push(sessionReferenceDigest(reference.sessionId));
      }
    }
    return blocks;
  }

  /** 消息 content blocks 的 text 拼接（unknown 收窄）。 */
  function textOf(message: unknown): string | undefined {
    const content = (message as { content?: unknown } | null | undefined)?.content;
    if (!Array.isArray(content)) return undefined;
    const parts: string[] = [];
    for (const block of content) {
      if (
        typeof block === "object" &&
        block !== null &&
        (block as { type?: unknown }).type === "text" &&
        typeof (block as { text?: unknown }).text === "string"
      ) {
        parts.push((block as { text: string }).text);
      }
    }
    return parts.length > 0 ? parts.join("\n") : undefined;
  }

  /**
   * 消息 content blocks 的附件元数据投影（§4.2）：image/file 块 → {kind, name?}。
   * 名字尽力提取（块直书 name，或 durable ref 对象上的 name）；不携带字节。
   */
  function attachmentsOf(message: unknown): Array<{ kind: "image" | "file"; name?: string }> {
    const content = (message as { content?: unknown } | null | undefined)?.content;
    if (!Array.isArray(content)) return [];
    const out: Array<{ kind: "image" | "file"; name?: string }> = [];
    for (const block of content) {
      if (typeof block !== "object" || block === null) continue;
      const type = (block as { type?: unknown }).type;
      if (type !== "image" && type !== "file") continue;
      const nameSources = [
        (block as { name?: unknown }).name,
        ((block as { attachment?: { name?: unknown } }).attachment ?? {}) as { name?: unknown },
        ((block as { ref?: { name?: unknown } }).ref ?? {}) as { name?: unknown },
      ];
      const name = nameSources.find(
        (candidate) => typeof candidate === "string" && candidate.length > 0,
      );
      out.push(name === undefined ? { kind: type } : { kind: type, name: name as string });
    }
    return out;
  }

  /** 文本类文件判定（mime 未知时按扩展名；≤512KiB 上限由契约保证）——清单单一
   * 事实源在 agent-files（prompt 内联与 `@` 引用共用）。 */
  const isTextualFile = isTextualFileName;

  /** assistant/message 事件顶层 usage 的数值白名单投影（非数值丢弃；信封经 safeParse，无 cast）。 */
  function usageSnapshotOf(data: unknown): Record<string, number> | undefined {
    const checked = UsageEnvelopeSchema.safeParse(data);
    if (!checked.success) return undefined;
    const usage = checked.data.usage;
    if (usage === undefined) return undefined;
    const out: Record<string, number> = {};
    for (const key of [
      "inputTokens",
      "outputTokens",
      "totalTokens",
      "cacheReadTokens",
      "cacheWriteTokens",
    ]) {
      const value = usage[key];
      if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }

  /** 消息 content blocks 的 reasoning（thinking）拼接；无 reasoning 块返回 undefined。 */
  function reasoningOf(message: unknown): string | undefined {
    const content = (message as { content?: unknown } | null | undefined)?.content;
    if (!Array.isArray(content)) return undefined;
    const parts: string[] = [];
    for (const block of content) {
      if (
        typeof block === "object" &&
        block !== null &&
        (block as { type?: unknown }).type === "reasoning" &&
        typeof (block as { text?: unknown }).text === "string"
      ) {
        parts.push((block as { text: string }).text);
      }
    }
    return parts.length > 0 ? parts.join("\n") : undefined;
  }

  function statusOf(entry: LivePanelSession | undefined): AgentSessionStatus {
    if (!entry) return "disposed";
    return entry.agent.status === "running" ? "running" : "idle";
  }

  /** live 面板状态（R14-C 清理消费；无 live 句柄 = persisted）。 */
  function liveStatusOf(sessionId: string): "running" | "live" | "persisted" {
    const entry = live.get(sessionId);
    if (!entry) return "persisted";
    return entry.agent.status === "running" ? "running" : "live";
  }

  /** 释放并移除非 running 的 live 条目（与 setMode 的释放块同法则；幂等）。 */
  async function disposeLiveSession(sessionId: string): Promise<void> {
    const entry = live.get(sessionId);
    if (!entry) return;
    for (const pending of entry.pending.values()) pending.resolve({ answers: [] });
    entry.pending.clear();
    live.delete(sessionId);
    await entry.dispose();
  }

  /**
   * 清理门（R15 codex R14 P1-2）：标记处置中 → 执行 fn（释放 + 删转录全程在门
   * 内）→ 移除标记（finally 不泄漏）。期间 reviveSession 对该 id 抛 NOT_FOUND，
   * 消除「dispose 与删除之间的 await 间隙被 prompt 复活」的交错。
   */
  async function runUnderCleanupGate(sessionId: string, fn: () => Promise<void>): Promise<void> {
    disposingIds.add(sessionId);
    try {
      await fn();
    } finally {
      disposingIds.delete(sessionId);
    }
  }

  /** 会话模式 → agent setup（全局工具收窄 + 模式 section/guard + 基础最佳实践）。 */
  function setupFor(mode: DshAgentMode): (agentCtx: Context) => void {
    return (agentCtx) => {
      applyProductToolSurface(agentCtx, mode);
      applyAgentMode(agentCtx, mode);
      registerProductPromptSections(
        agentCtx as unknown as Parameters<typeof registerProductPromptSections>[0],
      );
    };
  }

  /** createdAt 统一投影 ISO 字符串（内核 header 携带 epoch 毫秒）。 */
  function isoCreatedAt(header: { createdAt?: number | string }): string {
    const raw = header.createdAt;
    if (typeof raw === "number") return new Date(raw).toISOString();
    if (typeof raw === "string" && raw.length > 0) return raw;
    return new Date().toISOString();
  }

  function summaryOf(entry: LivePanelSession): AgentSessionSummary {
    return {
      sessionId: entry.agent.session.id,
      title: entry.title,
      status: statusOf(entry),
      cwd: entry.agent.session.header.cwd ?? process.cwd(),
      createdAt: isoCreatedAt(entry.agent.session.header),
      mode: entry.mode,
    };
  }

  return {
    /** 内核挂载后调用（daemon index 在 boot 成功后注入）。 */
    attach(kernel: DshKernelHandle): void {
      bindFirehose(kernel);
    },
    /** live 面板状态（R14-C 清理消费；内核无关）。 */
    liveStatusOf(sessionId: string): "running" | "live" | "persisted" {
      return liveStatusOf(sessionId);
    },
    /** 释放并移除非 running 的 live 条目（R14-C 清理消费；幂等）。 */
    async disposeLiveSession(sessionId: string): Promise<void> {
      await disposeLiveSession(sessionId);
    },
    /** 清理门（R15 codex P1-2）：fn 全程阻断该 id 的 reviveSession。 */
    async runUnderCleanupGate(sessionId: string, fn: () => Promise<void>): Promise<void> {
      await runUnderCleanupGate(sessionId, fn);
    },
    /** 墓碑（R15 终验 P1-2 终闭）：transcript 删除成功后永久拒绝复活。 */
    markCleaned(sessionId: string): void {
      tombstoneCleaned(sessionId);
    },
    /**
     * 清理面板会话转录（R14-C）：委托 session-cleanup.ts——只动产品转录层
     * （sessions/YYYY/MM/DD）与 live 句柄，绝不触碰 $DSH_HOME 内核会话日志；
     * 内核未挂载也可用（转录层独立于内核）。
     */
    async cleanup(input: AgentSessionsCleanupInput): Promise<AgentSessionsCleanupResult> {
      return runSessionCleanup(
        {
          transcripts: deps.transcripts,
          control: {
            liveStatusOf,
            disposeLiveSession,
            runUnderCleanupGate,
            markCleaned: tombstoneCleaned,
          },
        },
        input,
      );
    },
    /** 会话摘要列表（转录存储优先；内核 sessions store 补充非面板会话可见性）。 */
    list(): AgentSessionSummary[] {
      const kernel = requireKernel();
      const sessions = sessionsService(kernel.ctx);
      const summaries: AgentSessionSummary[] = [];
      const known = new Set<string>();
      for (const meta of deps.transcripts.listAll()) {
        known.add(meta.sessionId);
        const entry = live.get(meta.sessionId);
        const summary = entry ? summaryOf(entry) : summaryOfMeta(meta);
        summaries.push({ ...summary, hasTranscript: true });
      }
      for (const session of sessions.list()) {
        if (known.has(session.id)) continue;
        // 子代理会话不入面板列表（dsh-alpha-native-subagents：origin==='subagent'
        // 的 children 经父轨 subagent 帧可见，独立列出只会污染索引）。
        if (session.header.origin === "subagent") continue;
        const entry = live.get(session.id);
        if (entry) {
          summaries.push(summaryOf(entry));
          continue;
        }
        // 非 agent 驱动的 session（steward 绑定等）以 disposed 形态列出即可见性；
        // 无面板转录即无模式事实，投影 free（无收窄）。
        summaries.push({
          sessionId: session.id,
          title: "",
          status: "disposed",
          cwd: session.header.cwd ?? process.cwd(),
          createdAt: isoCreatedAt(session.header),
          mode: "free",
          hasTranscript: false,
        });
      }
      return summaries;
    },
    /** 创建产品会话（产品 preset + 按模式的工具面收窄 setup；可选首 prompt）。 */
    async create(input: {
      cwd?: string;
      prompt?: string;
      mode?: DshAgentMode;
    }): Promise<AgentSessionSummary> {
      const kernel = requireKernel();
      const agents = agentsService(kernel.ctx);
      const sessionId = `agent-${randomUUID()}`;
      const mode = input.mode ?? (await deps.defaultMode());
      const model = await deps.modelSelection();
      const handle = await agents.create({
        sessionId,
        meta: {
          cwd: input.cwd ?? process.cwd(),
          agentPreset: "skill-creator",
        },
        agentOptions: {
          provider: model.provider,
          model: model.model,
          ...(model.reasoningEffort ? { reasoningEffort: model.reasoningEffort } : {}),
        },
        setup: setupFor(mode),
      });
      if (input.prompt && input.prompt.length > PROMPT_MAX_CHARS) {
        throw new DomainError(
          "INVALID_OPERATION",
          `prompt too long: ${input.prompt.length} chars (max ${PROMPT_MAX_CHARS})`,
        );
      }
      const entry: LivePanelSession = {
        agent: handle.agent,
        dispose: handle.dispose,
        frames: [],
        frameSeq: 1,
        title: "",
        mode,
        pending: new Map(),
        toolNames: new Map(),
        deltaBuffer: [],
        reasoningBuffer: [],
        toolArgBuffers: new Map(),
        deltaAt: Date.now(),
      };
      registerPanelAnswerer(entry);
      live.set(sessionId, entry);
      deps.transcripts.recordStart({
        sessionId,
        title: "",
        createdAt: new Date().toISOString(),
        cwd: input.cwd ?? process.cwd(),
        mode,
      });
      if (input.prompt) {
        handle.agent.followup(
          createUserMessage({
            source: { kind: "user" },
            content: [{ type: "text", text: input.prompt }],
          }),
        );
      }
      return summaryOf(entry);
    },
    /** 驱动一轮用户输入（长度硬上限与 RPC 契约一致——外部输入 runtime 收窄）。
     * 非live但有转录的会话先经内核 agents.resume 复活（跨 daemon 重启续聊）。
     * C1：references 由 daemon 展开（file 读盘 / session 转录摘要）为
     * [reference: …] 文本块，注入内核 content——与文件附件内联同构；目标缺失
     * typed NOT_FOUND 整体拒绝，不静默降级。 */
    async prompt(
      sessionId: string,
      text: string,
      images: Array<{ mediaType: string; data: string; name?: string }> = [],
      files: Array<{ name: string; data: string }> = [],
      mode: "queue" | "steer" = "queue",
      references: Array<
        { kind: "file"; path: string } | { kind: "session"; sessionId: string }
      > = [],
    ): Promise<void> {
      if (text.length > PROMPT_MAX_CHARS) {
        throw new DomainError(
          "INVALID_OPERATION",
          `prompt too long: ${text.length} chars (max ${PROMPT_MAX_CHARS})`,
        );
      }
      // 引用展开先于 live/revive 与 slash 分流（纯 daemon 面，不触内核）：
      // 目标缺失在会话复活前失败；携带引用的 "/xxx" 是普通消息，不被命令分流吞。
      const referenceBlocks = references.length > 0 ? await expandReferences(references) : [];
      let entry = live.get(sessionId);
      if (!entry) {
        entry = await reviveSession(sessionId);
      }
      // slash 命令分流（差距-2 2026-09-12）："/compact" 等经内核 ctx.commands
      // 执行（不进 LLM）；非命令（execute 返回 undefined）回落普通消息。
      if (
        text.startsWith("/") &&
        images.length === 0 &&
        files.length === 0 &&
        references.length === 0
      ) {
        const commands = (
          requireKernel().ctx as Context & {
            commands?: {
              execute: (
                agent: unknown,
                line: string,
                attachments: readonly unknown[],
                signal: AbortSignal,
              ) => Promise<unknown>;
            };
          }
        ).commands;
        if (commands) {
          const executed = await commands.execute(
            entry.agent,
            text,
            [],
            new AbortController().signal,
          );
          if (executed !== undefined) return;
        }
      }
      // 多模态（迭代四 2026-09-11）：wire 图片经内核 attachment 准入升格 durable
      // ref（校验解码字节/大小），消息 content = 文本块 + image 块。attachments
      // 服务缺席时 typed INVALID_OPERATION——绝不静默丢图。
      const content: Array<Record<string, unknown>> = [{ type: "text", text }];
      // 文本类文件直接内联为文本块（无服务依赖）：受限工具面（无 read 工具）下
      // 模型无法消费 durable ref（2026-09-12 实测模型反问文件路径）；二进制走 ref。
      const restFiles = files.filter((file) => {
        if (!isTextualFile(file.name)) return true;
        const decoded = Buffer.from(file.data, "base64").toString("utf8");
        content.push({
          type: "text",
          text: `[file: ${file.name}]\n${decoded.slice(0, 200_000)}`,
        });
        return false;
      });
      // C1 引用块：正文/文件内联之后（模型视角 = 消息尾部的上下文载荷）。
      for (const block of referenceBlocks) {
        content.push({ type: "text", text: block });
      }
      if (images.length > 0 || restFiles.length > 0) {
        const kernel = requireKernel();
        const attachments = (
          kernel.ctx as Context & {
            attachments?: {
              admitPromptContent: (
                parts: ReadonlyArray<Record<string, unknown>>,
              ) => Promise<ReadonlyArray<Record<string, unknown>>>;
            };
          }
        ).attachments;
        if (!attachments) {
          throw new DomainError(
            "INVALID_OPERATION",
            "image attachments require the kernel attachment service (not mounted)",
          );
        }
        const admitted = await attachments.admitPromptContent(
          images.map((image) => ({
            type: "image",
            mediaType: image.mediaType,
            data: image.data,
            ...(image.name ? { name: image.name } : {}),
          })),
        );
        content.push(...admitted.map((part) => ({ ...(part as object) })));
        // 文件附件：base64 → durable ref（大小/编码由 attachment 层校验）。
        const admitFile = (
          attachments as {
            admitEncodedFile?: (input: { data: string; name?: string }) => Promise<unknown>;
          }
        ).admitEncodedFile;
        if (!admitFile && restFiles.length > 0) {
          throw new DomainError(
            "INVALID_OPERATION",
            "file attachments require the kernel attachment service (not mounted)",
          );
        }
        for (const file of restFiles) {
          const ref = await admitFile!.call(attachments, { data: file.data, name: file.name });
          content.push({ type: "file", attachment: ref });
        }
      }
      // W4（官方 submission-policy）：queue = followup（next-turn，inbox 排队）；
      // steer = next-step（内核 loop 的 steer 语义——下一步骤边界转向当前轮）。
      const message = createUserMessage({
        source: { kind: "user" },
        content: content as never,
      });
      if (mode === "steer" && typeof entry.agent.steer === "function") {
        entry.agent.steer(message);
      } else {
        entry.agent.followup(message);
      }
    },
    /** 取消当前活动（幂等；无活动为 no-op）。W4：keepInbox——排队消息在停止后
     *  存活并按 FIFO 续跑（官方 Stop 语义；内核缺省会清 inbox）。 */
    cancel(sessionId: string): void {
      const entry = live.get(sessionId);
      if (!entry) throw new DomainError("NOT_FOUND", `agent session not found: ${sessionId}`);
      entry.agent.cancel("user", { keepInbox: true });
    },
    /**
     * 切换会话模式（add-agent-settings-modes）：meta 持久化 + live 句柄有界释放 +
     * mode-changed 帧落盘；下一次 prompt 经 agents.resume 以新模式 setup 复活
     * （LLM 历史由内核 session log 保留）。running 会话拒绝切换。
     */
    async setMode(sessionId: string, mode: DshAgentMode): Promise<AgentSessionSummary> {
      const meta = deps.transcripts.listAll().find((item) => item.sessionId === sessionId);
      const entry = live.get(sessionId);
      if (meta === undefined && !entry) {
        throw new DomainError("NOT_FOUND", `agent session not found: ${sessionId}`);
      }
      if (entry && statusOf(entry) === "running") {
        throw new DomainError(
          "INVALID_OPERATION",
          `agent session ${sessionId} is running; switch modes after the current turn ends`,
        );
      }
      const from = entry?.mode ?? meta?.mode ?? "free";
      const summary: AgentSessionSummary = {
        sessionId,
        title: entry?.title ?? meta?.title ?? "",
        status: "disposed",
        cwd: entry?.agent.session.header.cwd ?? meta?.cwd ?? process.cwd(),
        createdAt: entry
          ? isoCreatedAt(entry.agent.session.header)
          : (meta?.createdAt ?? new Date().toISOString()),
        mode,
      };
      // 同模式切换是 no-op：不持久化、不产生 mode-changed 帧（live 态保持现状）。
      if (from === mode) {
        return entry ? { ...summary, status: statusOf(entry) } : summary;
      }
      deps.transcripts.updateMode(sessionId, mode);
      let seq: number;
      if (entry) {
        seq = entry.frameSeq++;
        await disposeLiveSession(sessionId);
      } else {
        seq = (deps.transcripts.readFrames(sessionId).at(-1)?.seq ?? 0) + 1;
      }
      const frame: DshSessionStreamFrame = {
        at: new Date().toISOString(),
        runId: sessionId,
        sessionId,
        seq,
        kind: "mode-changed",
        payload: redactDshPayload({ from, to: mode }),
      };
      deps.transcripts.append(sessionId, frame);
      return summary;
    },
    /**
     * C2 queue 面薄委托（逻辑在 agent-queue）：非 live 会话返回空 items——
     * 重启后未复活的挂起队列不可操作（记录边界，不伪装）。live 会话无 inbox
     * 面（内核面缺失）同样空 items。
     */
    queueList(sessionId: string): { items: AgentQueueItem[] } {
      const entry = live.get(sessionId);
      if (!entry || entry.agent.inbox === undefined) return { items: [] };
      return { items: projectInbox(entry.agent.inbox as InboxLike).map(({ item }) => item) };
    },
    /**
     * C2 queue 行级操作：edit=replace（新文本 + 原附件块）；remove=remove；
     * steer=next-turn → next-step（仅 running）。messageId 已被消费（轮次已
     * 开始）typed NOT_FOUND——竞态可见；目标不在 next-turn 时 steer 拒绝。
     */
    queueUpdate(
      sessionId: string,
      input: { messageId: string; action: "edit" | "remove" | "steer"; text?: string },
    ): void {
      const entry = live.get(sessionId);
      if (!entry) {
        throw new DomainError("NOT_FOUND", `agent session not found: ${sessionId}`);
      }
      if (entry.agent.inbox === undefined) {
        throw new DomainError("UNAVAILABLE", "agent kernel inbox surface missing");
      }
      const inbox = entry.agent.inbox as InboxLike;
      if (input.action === "remove") {
        if (!inbox.remove(input.messageId)) {
          throw new DomainError("NOT_FOUND", `queued message no longer pending: ${input.messageId}`);
        }
        return;
      }
      if (input.action === "edit") {
        const found = projectInbox(inbox).find(({ item }) => item.messageId === input.messageId);
        if (found === undefined) {
          throw new DomainError("NOT_FOUND", `queued message no longer pending: ${input.messageId}`);
        }
        inbox.replace(input.messageId, rebuildEditedMessage(found.parsed, input.text ?? ""));
        return;
      }
      // steer：next-turn → next-step；仅 running（idle 无步骤边界语义）。
      if (statusOf(entry) !== "running") {
        throw new DomainError(
          "INVALID_OPERATION",
          "steer needs a running turn; the session is idle",
        );
      }
      const queued = projectInbox(inbox).find(
        ({ item }) => item.messageId === input.messageId && item.target === "next-turn",
      );
      if (queued === undefined) {
        throw new DomainError(
          "INVALID_OPERATION",
          `message is not a queued next-turn item: ${input.messageId}`,
        );
      }
      if (!inbox.remove(input.messageId)) {
        throw new DomainError("NOT_FOUND", `queued message no longer pending: ${input.messageId}`);
      }
      inbox.append("next-step", queued.original);
    },
    /** 增量帧读取（afterSeq 游标 + limit 窗口）；非 live 会话由转录回放。 */
    stream(
      sessionId: string,
      afterSeq: number,
      limit: number,
    ): { frames: DshSessionStreamFrame[]; status: AgentSessionStatus } {
      const entry = live.get(sessionId);
      if (entry) {
        const frames = entry.frames.filter((frame) => frame.seq > afterSeq).slice(0, limit);
        return { frames, status: statusOf(entry) };
      }
      const meta = deps.transcripts.listAll().find((item) => item.sessionId === sessionId);
      if (meta === undefined) {
        throw new DomainError("NOT_FOUND", `agent session not found: ${sessionId}`);
      }
      const frames = deps.transcripts
        .readFrames(sessionId)
        .filter((frame) => frame.seq > afterSeq)
        .slice(0, limit);
      return { frames, status: "disposed" };
    },
    /** 回答一个待答请求（幂等：未知/已解决的 requestSeq 返回 false）。 */
    answer(
      sessionId: string,
      requestSeq: number,
      answers: Array<{ id: string; selected: string[]; custom?: string }>,
    ): boolean {
      const entry = live.get(sessionId);
      if (!entry) throw new DomainError("NOT_FOUND", `agent session not found: ${sessionId}`);
      const pending = entry.pending.get(requestSeq);
      if (!pending) return false;
      entry.pending.delete(requestSeq);
      const resolvedFrame: DshSessionStreamFrame = {
        at: new Date().toISOString(),
        runId: sessionId,
        sessionId,
        seq: entry.frameSeq++,
        kind: "approval-resolved",
        payload: redactDshPayload({ answers }),
      };
      entry.frames.push(resolvedFrame);
      deps.transcripts.append(sessionId, resolvedFrame);
      pending.resolve({ answers });
      return true;
    },
    /** 有界销毁（daemon stop 时逐个回收 agent；待答请求以空答案释放）。 */
    async dispose(): Promise<void> {
      // 先有界 drain continuable 子代理（官方 API；不留 orphan——与 ACP 池同
      // 法则），再回收父 agent。drain 失败不阻塞父回收（allSettled 语义）。
      const kernel = deps.kernel();
      const drain = (
        kernel?.ctx as
          | {
              subagents?: {
                drainContinuableDescendants?: (parents: readonly string[]) => Promise<unknown>;
              };
            }
          | undefined
      )?.subagents?.drainContinuableDescendants;
      if (drain && live.size > 0) {
        await Promise.resolve(drain([...live.keys()])).catch(() => undefined);
      }
      for (const entry of live.values()) {
        for (const pending of entry.pending.values()) {
          pending.resolve({ answers: [] });
        }
        entry.pending.clear();
      }
      await Promise.allSettled([...live.values()].map((entry) => entry.dispose()));
      live.clear();
    },
  };
}

export type AgentSessionsService = ReturnType<typeof createAgentSessionsService>;

/**
 * 产品会话的工具面收窄（design D1）：restrict 把继承的全局工具面收窄到显式
 * allowlist（preset 的 scoped 注册——ask_user_question——不受影响；MCP capability
 * 工具在 task 4.1b 后同为可见注册）。restrict 的 allow 必须全部是已注册全局名，
 * 未知名会 fail——因此按内核全局表动态过滤。
 */
function applyProductToolSurface(agentCtx: Context, mode: DshAgentMode): void {
  const tools = (
    agentCtx as Context & {
      tools?: {
        schemas?: () => Array<{ name?: string }>;
        restrict?: (filter: { deny: string[] }) => () => void;
        guard?: (guard: (exec: { name?: string }) => string | undefined) => () => void;
      };
    }
  ).tools;
  if (!tools?.restrict) return;
  const globalNames = (tools.schemas?.() ?? [])
    .map((schema) => schema?.name)
    .filter((name): name is string => typeof name === "string");
  const deny = productToolDenyList(globalNames, mode);
  if (deny.length > 0) tools.restrict({ deny });
}

/**
 * 模式感知的全局工具 deny 名单（导出供单测）：显式 allowlist 与 mcp capability
 * 工具（mcp__skill-creator__*）永远保留；原生 bash 只在开放模式（free/Open）
 * 放行，专注模式拒绝；角色工具（role_*）按 AGENT_MODE_ROLES 的模式暴露矩阵
 * 放行（free 全放）。
 */
export function productToolDenyList(globalNames: readonly string[], mode: DshAgentMode): string[] {
  const nativeAllowed =
    mode === "free" ? [...KERNEL_AGENT_TOOL_ALLOWLIST, "bash"] : KERNEL_AGENT_TOOL_ALLOWLIST;
  const modeRoles = AGENT_MODE_ROLES[mode];
  const roleAllowed = modeRoles.map(agentRoleToolName);
  return globalNames.filter(
    (name) =>
      !nativeAllowed.includes(name) &&
      !roleAllowed.includes(name) &&
      !name.startsWith("mcp__skill-creator__"),
  );
}
