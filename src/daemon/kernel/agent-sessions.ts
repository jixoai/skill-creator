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
 *       message 事件映射为 DshSessionStreamFrame（payload 过 redactDshPayload）。
 *   [3] 跨重启持久：帧 write-through 到转录存储（sessions/YYYY/MM/DD/<id>）；
 *       重启后 list/stream 由转录回放，prompt 经内核 agents.resume 续聊。
 *   [4] 可选宿主：内核未挂载时 typed UNAVAILABLE（DomainError），不静默空面。
 *   [5] 模式生命周期（add-agent-settings-modes）：create/revive 按转录 meta 的
 *       mode 组合 setup；setMode = meta 原子改写 + live 句柄有界释放 + mode-changed
 *       帧，下一次 prompt 以新模式复活（历史归内核 session log）。
 * 妥协声明：跨 cordis 服务访问按结构化 unknown 收窄（宿主服务形状无公开 TS 面，
 * 与 dsh-session-binder 同法则）；LLM 历史事实归内核 session log，本层转录只是
 * 面板投影。
 */
import { randomUUID } from "node:crypto";
import type { Context } from "@deepseek-ai/cordis";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import {
  redactDshPayload,
  type DshAgentMode,
  type DshSessionStreamFrame,
} from "../../shared/contracts/dsh-runtime.js";
import type { AgentSessionStatus, AgentSessionSummary } from "../../shared/contracts/agent.js";
import { DomainError } from "../domain-error.js";
import type { DshKernelHandle } from "./dsh-kernel.js";
import { KERNEL_AGENT_TOOL_ALLOWLIST } from "./dsh-kernel.js";
import { applyAgentMode } from "./agent-modes.js";
import { registerProductPromptSections } from "./product-prompt.js";
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
  /** 帧缓冲上限（缺省 200）。 */
  retention?: number;
  /** 面板转录存储（跨重启回放与续聊定位）。 */
  transcripts: SessionTranscripts;
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
  cancel(cause: unknown, options?: unknown): void;
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
    header: { cwd?: string; createdAt?: number | string };
  }>;
  get(id: string): unknown;
}

/** session/event firehose 的最小事件形状。 */
interface SessionEventLike {
  seq: number;
  type: string;
  data: unknown;
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
  /** 上次 delta 帧冲刷时刻（ms）。 */
  deltaAt: number;
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
      // 流式增量：assistant/chunk（text-delta / reasoning-delta）各进合并缓冲，
      // 按时间窗成帧；其余事件先冲刷缓冲，保证增量帧先于收尾帧落序。
      if (event.type === "assistant/chunk") {
        const chunk = (event.data as { chunk?: { type?: string; text?: string } } | undefined)
          ?.chunk;
        if (
          typeof chunk?.text === "string" &&
          chunk.text.length > 0 &&
          (chunk.type === "text-delta" || chunk.type === "reasoning-delta")
        ) {
          const buffer = chunk.type === "text-delta" ? entry.deltaBuffer : entry.reasoningBuffer;
          buffer.push(chunk.text);
          if (Date.now() - entry.deltaAt >= DELTA_FLUSH_MS) flushDeltas(entry);
        }
        return;
      }
      flushDeltas(entry);
      const frame = projectEvent(entry, event);
      if (!frame) return;
      entry.frames.push(frame);
      if (entry.frames.length > retention) {
        entry.frames.splice(0, entry.frames.length - retention);
      }
      // write-through：转录落盘 best-effort（失败由存储层记日志，不打断 live）。
      deps.transcripts.append(session.id, frame);
    });
  }

  /**
   * 冲刷增量缓冲为帧（reasoning 先于 text——同一步内思考在前）；live 环 +
   * 转录同序落盘。
   */
  function flushDeltas(entry: LivePanelSession): void {
    if (entry.deltaBuffer.length === 0 && entry.reasoningBuffer.length === 0) return;
    entry.deltaAt = Date.now();
    const emit = (kind: "assistant-delta" | "assistant-reasoning-delta", text: string): void => {
      const frame: DshSessionStreamFrame = {
        at: new Date().toISOString(),
        runId: entry.agent.session.id,
        sessionId: entry.agent.session.id,
        seq: entry.frameSeq++,
        kind,
        text,
      };
      entry.frames.push(frame);
      if (entry.frames.length > retention) {
        entry.frames.splice(0, entry.frames.length - retention);
      }
      deps.transcripts.append(entry.agent.session.id, frame);
    };
    if (entry.reasoningBuffer.length > 0) {
      emit("assistant-reasoning-delta", entry.reasoningBuffer.join(""));
      entry.reasoningBuffer = [];
    }
    if (entry.deltaBuffer.length > 0) {
      emit("assistant-delta", entry.deltaBuffer.join(""));
      entry.deltaBuffer = [];
    }
  }

  /** 单事件 → 帧投影（未知事件类型返回 null 丢弃；payload 脱敏）。 */
  function projectEvent(
    entry: LivePanelSession,
    event: SessionEventLike,
  ): DshSessionStreamFrame | null {
    const base = {
      at: new Date().toISOString(),
      runId: entry.agent.session.id,
      sessionId: entry.agent.session.id,
    };
    const data = (event.data ?? {}) as Record<string, unknown>;
    switch (event.type) {
      case "turn/start":
        return { ...base, seq: entry.frameSeq++, kind: "turn-start" };
      case "turn/end": {
        const reason = (data as { reason?: { kind?: string } }).reason?.kind;
        return {
          ...base,
          seq: entry.frameSeq++,
          kind: "turn-end",
          text: typeof reason === "string" ? reason : undefined,
          payload: redactDshPayload(data),
        };
      }
      case "session/title": {
        // 内核 session-title 行（dsh-base 自带，首 prompt 后经辅助 LLM 生成、失败
        // 回退首词截断）投出的标题：更新 live title + 转录 meta，并以帧驱动面板
        // 会话列表即时改名（重启后的标题回放走转录 meta）。
        const title =
          typeof (data as { title?: unknown }).title === "string"
            ? (data as { title: string }).title.trim()
            : "";
        if (title.length === 0) return null;
        entry.title = title;
        deps.transcripts.updateTitle(entry.agent.session.id, title);
        return { ...base, seq: entry.frameSeq++, kind: "session-title", text: title };
      }
      case "agent/status":
        return { ...base, seq: entry.frameSeq++, kind: "status", payload: redactDshPayload(data) };
      case "user/message": {
        // 事件形状实测（2026-09-08 内核日志）：真实人类输入 data 即 message 且
        // data.source.kind === "user"；内核注入（system-reminder、runtime context）
        // 无 user source，不进对话流。user 帧是切换会话后从帧缓冲重建消息列表的
        // 唯一用户消息来源——丢弃会让切换后的转录缺失全部用户输入。
        const message = (data as { message?: unknown }).message ?? data;
        const source = (message as { source?: { kind?: unknown } } | undefined)?.source;
        if (source?.kind !== "user") return null;
        const text = textOf(message);
        if (text === undefined || text.length === 0) return null;
        return {
          ...base,
          seq: entry.frameSeq++,
          kind: "user-text",
          text,
        };
      }
      case "assistant/message": {
        // 事件形状实测（2026-09-08 真实会话）：{turn, step, message:{content:[...]}}。
        // reasoning 块（thinking）先投影为折叠终帧，再投正文——一步内思考在前。
        const message = (data as { message?: unknown }).message ?? data;
        const reasoning = reasoningOf(message);
        if (reasoning !== undefined) {
          entry.frames.push({
            ...base,
            seq: entry.frameSeq++,
            kind: "assistant-reasoning",
            text: reasoning,
          });
        }
        const text = textOf(message);
        return {
          ...base,
          seq: entry.frameSeq++,
          kind: "assistant-text",
          text,
          payload: redactDshPayload({
            source: (message as { source?: unknown }).source,
            usage: (message as { usage?: unknown }).usage,
          }),
        };
      }
      case "tool/call": {
        const args =
          (data as { arguments?: unknown }).arguments ?? (data as { args?: unknown }).args;
        let parsedArgs: unknown = args;
        if (typeof args === "string") {
          try {
            parsedArgs = JSON.parse(args);
          } catch {
            parsedArgs = args;
          }
        }
        const callName = typeof data.name === "string" ? data.name : undefined;
        const callId = typeof data.callId === "string" ? data.callId : undefined;
        if (callId && callName) entry.toolNames.set(callId, callName);
        return {
          ...base,
          seq: entry.frameSeq++,
          kind: "tool-call",
          toolName: callName,
          payload: redactDshPayload(parsedArgs),
        };
      }
      case "tool/result": {
        // 实测形状：{turn, step, message:{source:{callId}, content:[{type:'tool-result',
        // toolCallId, content:[{type:'text', text:'<json>'}]}]}}——callId 两处皆可回填名。
        const message = (data as { message?: unknown }).message;
        const blocks = (message as { content?: unknown[] } | undefined)?.content;
        let text: string | undefined;
        let resultCallId: string | undefined;
        if (Array.isArray(blocks)) {
          for (const block of blocks) {
            if (
              resultCallId === undefined &&
              typeof (block as { toolCallId?: unknown }).toolCallId === "string"
            ) {
              resultCallId = (block as { toolCallId: string }).toolCallId;
            }
            const inner = (block as { content?: unknown[] }).content;
            if (Array.isArray(inner)) {
              for (const part of inner) {
                if ((part as { type?: string }).type === "text") {
                  text = (part as { text?: string }).text;
                  break;
                }
              }
            }
            if (text !== undefined) break;
          }
        }
        if (resultCallId === undefined) {
          const sourceCallId = (message as { source?: { callId?: unknown } } | undefined)?.source
            ?.callId;
          if (typeof sourceCallId === "string") resultCallId = sourceCallId;
        }
        const resolvedName =
          resultCallId !== undefined ? entry.toolNames.get(resultCallId) : undefined;
        return {
          ...base,
          seq: entry.frameSeq++,
          kind: "tool-result",
          toolName: resolvedName,
          text,
          payload: redactDshPayload(text !== undefined ? safeJsonParse(text) : data),
        };
      }
      default:
        return null;
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
   */
  async function reviveSession(sessionId: string): Promise<LivePanelSession> {
    const kernel = requireKernel();
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
    /** 会话摘要列表（转录存储优先；内核 sessions store 补充非面板会话可见性）。 */
    list(): AgentSessionSummary[] {
      const kernel = requireKernel();
      const sessions = sessionsService(kernel.ctx);
      const summaries: AgentSessionSummary[] = [];
      const known = new Set<string>();
      for (const meta of deps.transcripts.listAll()) {
        known.add(meta.sessionId);
        const entry = live.get(meta.sessionId);
        summaries.push(entry ? summaryOf(entry) : summaryOfMeta(meta));
      }
      for (const session of sessions.list()) {
        if (known.has(session.id)) continue;
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
     * 非live但有转录的会话先经内核 agents.resume 复活（跨 daemon 重启续聊）。 */
    async prompt(
      sessionId: string,
      text: string,
      images: Array<{ mediaType: string; data: string; name?: string }> = [],
    ): Promise<void> {
      if (text.length > PROMPT_MAX_CHARS) {
        throw new DomainError(
          "INVALID_OPERATION",
          `prompt too long: ${text.length} chars (max ${PROMPT_MAX_CHARS})`,
        );
      }
      let entry = live.get(sessionId);
      if (!entry) {
        entry = await reviveSession(sessionId);
      }
      // 多模态（迭代四 2026-09-11）：wire 图片经内核 attachment 准入升格 durable
      // ref（校验解码字节/大小），消息 content = 文本块 + image 块。attachments
      // 服务缺席时 typed INVALID_OPERATION——绝不静默丢图。
      const content: Array<Record<string, unknown>> = [{ type: "text", text }];
      if (images.length > 0) {
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
      }
      entry.agent.followup(
        createUserMessage({
          source: { kind: "user" },
          content: content as never,
        }),
      );
    },
    /** 取消当前活动（幂等；无活动为 no-op）。 */
    cancel(sessionId: string): void {
      const entry = live.get(sessionId);
      if (!entry) throw new DomainError("NOT_FOUND", `agent session not found: ${sessionId}`);
      entry.agent.cancel("user");
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
        for (const pending of entry.pending.values()) pending.resolve({ answers: [] });
        entry.pending.clear();
        live.delete(sessionId);
        await entry.dispose();
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
 * 放行，专注模式拒绝。
 */
export function productToolDenyList(globalNames: readonly string[], mode: DshAgentMode): string[] {
  const nativeAllowed =
    mode === "free" ? [...KERNEL_AGENT_TOOL_ALLOWLIST, "bash"] : KERNEL_AGENT_TOOL_ALLOWLIST;
  return globalNames.filter(
    (name) => !nativeAllowed.includes(name) && !name.startsWith("mcp__skill-creator__"),
  );
}
