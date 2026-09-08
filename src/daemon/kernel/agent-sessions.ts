/**
 * 内核 agent 会话服务（dsh-kernel-rebase task 2.2）。
 *
 * 用户原始需求 [2026-09-08]：「在现有 skill creator 的基础上。去实现一个 Agent
 * 的产品。」——面板会话的进程内消费面：list/create/prompt/cancel/stream 都经
 * 内核 ctx.agents / ctx.sessions / session-event firehose 投影，不自研 loop。
 *
 * 正交意图：
 *   [1] 会话生命周期：create 走官方 agents.create（产品 preset + 工具面收窄
 *       setup）；prompt 经 followup；cancel 经 agent.cancel；list 从 sessions
 *       store 投影摘要。
 *   [2] 脱敏 stream 环形投影：订阅 session/event firehose，把 turn/status/
 *       message 事件映射为 DshSessionStreamFrame（payload 过 redactDshPayload；
 *       durable 回放归 session log）。
 *   [3] 可选宿主：内核未挂载时 typed UNAVAILABLE（DomainError），不静默空面。
 * 妥协声明：跨 cordis 服务访问按结构化 unknown 收窄（宿主服务形状无公开 TS 面，
 * 与 dsh-session-binder 同法则）；frames 只驻内存。
 */
import { randomUUID } from "node:crypto";
import type { Context } from "@deepseek-ai/cordis";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import {
  redactDshPayload,
  type DshSessionStreamFrame,
} from "../../shared/contracts/dsh-runtime.js";
import type { AgentSessionStatus, AgentSessionSummary } from "../../shared/contracts/agent.js";
import { DomainError } from "../domain-error.js";
import type { DshKernelHandle } from "./dsh-kernel.js";
import { KERNEL_AGENT_TOOL_ALLOWLIST } from "./dsh-kernel.js";
import { registerProductPromptSections } from "./product-prompt.js";

/** 内核句柄访问器（daemon boot 后注入；未挂载返回 null）。 */
export type KernelAccessor = () => DshKernelHandle | null;

/** 服务依赖（settings 供 model/preset 读取——创建会话时应用 agentOptions）。 */
export interface AgentSessionsDeps {
  kernel: KernelAccessor;
  /** 读取当前 model 选择（provider/model/reasoningEffort → AgentOptions）。 */
  modelSelection: () => Promise<{ provider: string; model: string; reasoningEffort?: string }>;
  /** 帧缓冲上限（缺省 200）。 */
  retention?: number;
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
  /** 进程内单调帧序（区别于 session event seq——投影视角排序）。 */
  frameSeq: number;
  title: string;
  /** 按 requestSeq 索引的待答问题（ask_user_question waterfall）。 */
  pending: Map<number, PendingApproval>;
  /** tool/call 的 callId → 工具名（tool/result 事件不带名，按 callId 回填）。 */
  toolNames: Map<string, string>;
}

const DEFAULT_RETENTION = 200;
/** prompt 长度硬上限（与 RPC 契约 AgentSessionPromptInputSchema 一致）。 */
const PROMPT_MAX_CHARS = 20_000;

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
      const frame = projectEvent(entry, event);
      if (!frame) return;
      entry.frames.push(frame);
      if (entry.frames.length > retention) {
        entry.frames.splice(0, entry.frames.length - retention);
      }
    });
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
      case "agent/status":
        return { ...base, seq: entry.frameSeq++, kind: "status", payload: redactDshPayload(data) };
      case "user/message":
        // 面板已乐观追加用户输入；inject/context 注入（system-reminder、runtime
        // context）不是模型输出，不进对话流。
        return null;
      case "assistant/message": {
        // 事件形状实测（2026-09-08 真实会话）：{turn, step, message:{content:[...]}}。
        const message = (data as { message?: unknown }).message ?? data;
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
      const requestSeq = entry.frameSeq;
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

  function statusOf(entry: LivePanelSession | undefined): AgentSessionStatus {
    if (!entry) return "disposed";
    return entry.agent.status === "running" ? "running" : "idle";
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
    };
  }

  return {
    /** 内核挂载后调用（daemon index 在 boot 成功后注入）。 */
    attach(kernel: DshKernelHandle): void {
      bindFirehose(kernel);
    },
    /** 会话摘要列表（live 优先；内核未挂载 → typed UNAVAILABLE）。 */
    list(): AgentSessionSummary[] {
      const kernel = requireKernel();
      const sessions = sessionsService(kernel.ctx);
      const summaries: AgentSessionSummary[] = [];
      for (const session of sessions.list()) {
        const entry = live.get(session.id);
        if (entry) {
          summaries.push(summaryOf(entry));
          continue;
        }
        // 非 agent 驱动的 session（steward 绑定等）以 disposed 形态列出即可见性。
        summaries.push({
          sessionId: session.id,
          title: "",
          status: "disposed",
          cwd: session.header.cwd ?? process.cwd(),
          createdAt: isoCreatedAt(session.header),
        });
      }
      return summaries;
    },
    /** 创建产品会话（产品 preset + 工具面收窄 setup；可选首 prompt）。 */
    async create(input: { cwd?: string; prompt?: string }): Promise<AgentSessionSummary> {
      const kernel = requireKernel();
      const agents = agentsService(kernel.ctx);
      const sessionId = `agent-${randomUUID()}`;
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
        setup: (agentCtx) => {
          applyProductToolSurface(agentCtx);
          registerProductPromptSections(
            agentCtx as unknown as Parameters<typeof registerProductPromptSections>[0],
          );
        },
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
        frameSeq: 0,
        title: "",
        pending: new Map(),
        toolNames: new Map(),
      };
      registerPanelAnswerer(entry);
      live.set(sessionId, entry);
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
    /** 驱动一轮用户输入（长度硬上限与 RPC 契约一致——外部输入 runtime 收窄）。 */
    prompt(sessionId: string, text: string): void {
      const entry = live.get(sessionId);
      if (!entry) throw new DomainError("NOT_FOUND", `agent session not found: ${sessionId}`);
      if (text.length > PROMPT_MAX_CHARS) {
        throw new DomainError(
          "INVALID_OPERATION",
          `prompt too long: ${text.length} chars (max ${PROMPT_MAX_CHARS})`,
        );
      }
      entry.agent.followup(
        createUserMessage({
          source: { kind: "user" },
          content: [{ type: "text", text }],
        }),
      );
    },
    /** 取消当前活动（幂等；无活动为 no-op）。 */
    cancel(sessionId: string): void {
      const entry = live.get(sessionId);
      if (!entry) throw new DomainError("NOT_FOUND", `agent session not found: ${sessionId}`);
      entry.agent.cancel("user");
    },
    /** 增量帧读取（afterSeq 游标 + limit 窗口）。 */
    stream(
      sessionId: string,
      afterSeq: number,
      limit: number,
    ): { frames: DshSessionStreamFrame[]; status: AgentSessionStatus } {
      const entry = live.get(sessionId);
      if (!entry) {
        throw new DomainError("NOT_FOUND", `agent session not found: ${sessionId}`);
      }
      const frames = entry.frames.filter((frame) => frame.seq > afterSeq).slice(0, limit);
      return { frames, status: statusOf(entry) };
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
      entry.frames.push({
        at: new Date().toISOString(),
        runId: sessionId,
        sessionId,
        seq: entry.frameSeq++,
        kind: "approval-resolved",
        payload: redactDshPayload({ answers }),
      });
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
function applyProductToolSurface(agentCtx: Context): void {
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
  // deny 式收窄（allow 式要求名单全部已注册，与 mcp 工具的异步注册竞争）：
  // 显式 allowlist 与 mcp capability 工具（mcp__skill-creator__*）保留，其余
  // global 工具全部 deny；晚注册的 mcp 工具不在此刻的 deny 集，继承可见。
  const deny = globalNames.filter(
    (name) =>
      !KERNEL_AGENT_TOOL_ALLOWLIST.includes(name) && !name.startsWith("mcp__skill-creator__"),
  );
  if (deny.length > 0) tools.restrict({ deny });
}
