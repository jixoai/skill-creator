/**
 * 内核 ephemeral distill 会话面（skill-wiki-maintainer tasks 1.3a；design K/W）。
 *
 * 用户原始需求 [2026-09-25]（openspec change skill-wiki-maintainer design §4/K/W）：
 * 「distiller 会话不进面板列表与持久转录（一次性 ctx；原始输出只落 run 目录）；
 * 工具面 allowlist = mcp__skill-creator__wiki_list / wiki_read / wiki_scopes 三个
 * 完整 scoped 注册名的 closed union（编译期 + 运行时双重 fail-closed）；deny 一切
 * propose/apply。」
 *
 * 正交意图：
 *   [1] DistillReadonlyToolName closed union + 运行时双重 fail-closed 校验：闭集
 *       成员资格 + 与实际 MCP 注册名逐一比对；未知/未注册名创建即 typed 失败，
 *       绝不静默放行、绝不半可用 session。
 *   [2] 隔离 agent scope 创建：deny-all 基线（restrict allow keep-only——晚注册的
 *       全局工具同样默认不可见）+ complete system prompt section（调用方提示词即
 *       全部认知面）+ user-questions 空答案红线；不挂 preset、不注册
 *       agentSessions/transcripts（origin=subagent 让面板扫描跳过本会话）。
 *   [3] prompt 单轮驱动：session/event firehose 收集终文本，turn/end(completed)
 *       结算；deadline/signal → typed DISTILL_TIMEOUT / DISTILL_CANCELLED（设计 U：
 *       两码 kernel-local，不进 RPC/MCP 闭集）；prompt 失败路径自动释放（K 的
 *       stop/timeout/cancel 全路径 dispose 矩阵）。
 *   [4] dispose 有界强制释放：deadline 后内核侧 session 销毁（cancel 触发），
 *       Promise 有界返回；重复/并发调用共享同一次释放（幂等）。
 * 妥协声明：本模块自持 firehose 事件的两个最小 Zod 收窄面（turn/end 与
 *   assistant/message，与 agent-sessions 同名 schema 同一冻结契约 dsh-session
 *   SessionEventMap）——直接复用 agent-sessions 的导出会造成 dsh-kernel →
 *   agent-sessions 的运行时环（后者运行时依赖 dsh-kernel 的 allowlist 常量），
 *   kernel 底层模块不得向上引用面板服务层。
 */
import { randomUUID } from "node:crypto";
import type { Context } from "@deepseek-ai/cordis";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { scopeOf } from "@deepseek-ai/dsh-scope";
import { z } from "zod";

/**
 * 设计 K（r5 改写版）：三个完整 scoped 注册名的 closed union——唯一规范值。
 * 编译期收口（调用方无法拼出 mutation 工具名）+ 运行时 Set 复核（外部输入
 * 法则：typed 边界不豁免 runtime 收窄）。
 */
export const DISTILL_READONLY_TOOL_NAMES = [
  "mcp__skill-creator__wiki_list",
  "mcp__skill-creator__wiki_read",
  "mcp__skill-creator__wiki_scopes",
] as const satisfies readonly string[];

export type DistillReadonlyToolName = (typeof DISTILL_READONLY_TOOL_NAMES)[number];

const DISTILL_READONLY_TOOL_NAME_SET: ReadonlySet<string> = new Set(DISTILL_READONLY_TOOL_NAMES);

/**
 * kernel-local typed 失败码（daemon 内部闭集）。DISTILL_TIMEOUT / DISTILL_CANCELLED
 * 为设计 W/U 冻结的 prompt 结果码；其余五码是本面的创建/生命周期管线码
 * （DistillJobService 映射 run reason=kernel-unavailable 或按调用方误用处理）。
 * 全部不进 RpcErrorCode / MCP 错误闭集。
 */
export type EphemeralSessionErrorCode =
  | "DISTILL_TIMEOUT" // W：prompt deadline 超时（设计冻结）
  | "DISTILL_CANCELLED" // W：prompt signal 取消 / 会话已释放（设计冻结）
  | "DISTILL_BRIDGE_NOT_READY" // 创建：MCP 桥未组合或未在期限内就绪
  | "DISTILL_TOOL_UNREGISTERED" // 创建：闭集外 / 未注册工具名（运行时二次校验）
  | "DISTILL_KERNEL_CREATE_FAILED" // 创建：内核 agent scope 组合面缺失/失败
  | "DISTILL_TURN_FAILED" // prompt：turn 非 completed 收尾（failed/blocked…）
  | "DISTILL_PROMPT_BUSY"; // prompt：一次性会话已消耗 / 已有在飞 prompt

/**
 * kernel-local typed 失败（形状镜像 DomainError 的 `readonly code` 字段——daemon
 * 既有 typed error 风格；code 闭集是本模块私有的 kernel-local 码，不进共享
 * RpcErrorCode，故不复用 DomainError 类）。
 */
export class EphemeralSessionError extends Error {
  readonly code: EphemeralSessionErrorCode;

  constructor(code: EphemeralSessionErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "EphemeralSessionError";
    this.code = code;
  }
}

/** 设计 W 的 ephemeral 异步契约面（唯一规范源；K 块同步骨架已废止）。 */
export interface EphemeralSession {
  /** 单轮 prompt（无历史、无续写）；结果 = 模型最终文本（typed 失败上抛）。 */
  prompt(
    input: string,
    opts?: { signal?: AbortSignal; deadlineMs?: number },
  ): Promise<{
    text: string;
  }>;
  /** 实际可见工具名全集（断言面：allowlist 过滤后的注册名）。 */
  listTools(): readonly string[];
  /** 有界强制释放（超时后内核侧 session 销毁）；重复调用幂等。 */
  dispose(opts?: { deadlineMs?: number }): Promise<void>;
}

/** 模型路由（daemon 内部：DistillJobService 注入 settings 选择；缺省走内核默认）。 */
export interface EphemeralAgentOptions {
  provider?: string;
  model?: string;
  reasoningEffort?: string;
}

export interface CreateEphemeralSessionOptions {
  systemPrompt: string;
  /**
   * closed union（r4 P2-4：编译期 fail-closed——调用方无法拼出 mutation 工具名）。
   * 运行时二次校验：与实际 MCP 注册名逐一比对，未知/未注册名 → 创建即 typed
   * 失败，绝不静默放行或静默丢弃。
   */
  toolAllowlist: readonly DistillReadonlyToolName[];
  /** daemon 内部：agent 模型路由（透传 agents.create 的 agentOptions）。 */
  agentOptions?: EphemeralAgentOptions;
  /** daemon 内部测试 seam：MCP 桥就绪等待上限（默认 30s）。 */
  bridgeReadyTimeoutMs?: number;
}

/** 内核面 seam（dsh-kernel 装配注入；单测注入 fake——见 test/dsh-kernel-ephemeral）。 */
export interface EphemeralKernelSurface {
  ctx: Context;
  /** 全局工具表当前名字集合（无 scope = 全局视图；与 dsh-kernel.globalToolNames 同源）。 */
  globalToolNames(): string[];
  /** 内核是否组合了 dsh-mcp-client 桥（无桥 = scoped 名永不可见，立即失败不等待）。 */
  mcpBridgeConfigured: boolean;
}

/** 内核 Agent 的最小结构面（unknown 收窄；同 agent-sessions 法则）。 */
interface EphemeralAgentLike {
  id: string;
  status: string;
  session: { id: string };
  followup(message: unknown): void;
  cancel(cause: unknown, options?: unknown): void;
}

interface EphemeralAgentsServiceLike {
  create(options: {
    sessionId: string;
    meta?: { origin?: "subagent" };
    agentOptions?: EphemeralAgentOptions;
    setup?: (agentCtx: Context) => void | Promise<void>;
  }): Promise<{ agent: EphemeralAgentLike; dispose(): Promise<void> }>;
}

/** session/event firehose 的最小事件形状。 */
interface SessionEventLike {
  seq: number;
  type: string;
  data: unknown;
}

/** turn/end：reason.kind 投影结算分支（与 agent-sessions TurnEndEventSchema 同契约的最小消费面）。 */
const TurnEndDataSchema = z
  .object({
    reason: z.object({ kind: z.string().optional() }).passthrough().optional(),
  })
  .passthrough();

/**
 * {message: M} 信封解包：M 为对象则取 M，否则 data 即 message（user/message 实测
 * 形状是后者，assistant/message 实测形状是前者；与 agent-sessions 同一解析序）。
 */
function messageEnvelopeOf(raw: unknown): unknown {
  if (typeof raw === "object" && raw !== null && "message" in raw) {
    const wrapped = raw.message;
    if (typeof wrapped === "object" && wrapped !== null) return wrapped;
  }
  return raw;
}

/** assistant/message：content 块数组（消费面只读 text 块；畸形整事件丢弃）。 */
const AssistantMessageDataSchema = z.preprocess(
  messageEnvelopeOf,
  z
    .object({
      content: z
        .array(z.object({ type: z.string().optional(), text: z.string().optional() }).passthrough())
        .min(1),
    })
    .passthrough(),
);

function textOfMessage(content: ReadonlyArray<{ type?: string; text?: string }>): string {
  const parts: string[] = [];
  for (const block of content) {
    if (block.type === "text" && typeof block.text === "string" && block.text.length > 0) {
      parts.push(block.text);
    }
  }
  return parts.length > 0 ? parts.join("\n") : "";
}

const DEFAULT_BRIDGE_READY_TIMEOUT_MS = 30_000;
const BRIDGE_POLL_INTERVAL_MS = 250;
/** 设计 §4：kernel 调用有界——默认 120s。 */
const DEFAULT_PROMPT_DEADLINE_MS = 120_000;
const DEFAULT_DISPOSE_DEADLINE_MS = 5_000;
const EPHEMERAL_SYSTEM_PROMPT_SECTION_NAME = "ephemeral-distill-system-prompt";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** allowlist 的闭集运行时复核（去重；空集/闭集外 → 创建即 typed 失败）。 */
function validateAllowlist(input: readonly DistillReadonlyToolName[]): string[] {
  if (input.length === 0) {
    throw new EphemeralSessionError(
      "DISTILL_TOOL_UNREGISTERED",
      "toolAllowlist must not be empty: an empty readonly face has no kernel bridge target (fail closed at creation)",
    );
  }
  const names = [...new Set(input)];
  for (const name of names) {
    if (typeof name !== "string" || !DISTILL_READONLY_TOOL_NAME_SET.has(name)) {
      throw new EphemeralSessionError(
        "DISTILL_TOOL_UNREGISTERED",
        `not a DistillReadonlyToolName (closed union): ${String(name)}`,
      );
    }
  }
  return names;
}

/** MCP tool bridge ready 等待（W：内含于创建；未就绪 → 创建即 typed 失败）。 */
async function waitForBridge(
  surface: EphemeralKernelSurface,
  names: readonly string[],
  deadlineMs: number,
): Promise<void> {
  if (!surface.mcpBridgeConfigured) {
    throw new EphemeralSessionError(
      "DISTILL_BRIDGE_NOT_READY",
      "kernel composed without the skill-creator MCP bridge: readonly wiki tools can never register",
    );
  }
  const startedAt = Date.now();
  for (;;) {
    const registered = new Set(surface.globalToolNames());
    const missing = names.filter((name) => !registered.has(name));
    if (missing.length === 0) return;
    if (Date.now() - startedAt >= deadlineMs) {
      throw new EphemeralSessionError(
        "DISTILL_BRIDGE_NOT_READY",
        `MCP tool bridge not ready within ${deadlineMs}ms (missing: ${missing.join(", ")})`,
      );
    }
    await sleep(BRIDGE_POLL_INTERVAL_MS);
  }
}

/** 注册名逐一比对（K：与实际 MCP 注册名逐一比对；未注册名绝不静默丢弃）。 */
function assertRegistered(surface: EphemeralKernelSurface, names: readonly string[]): void {
  const registered = new Set(surface.globalToolNames());
  const missing = names.filter((name) => !registered.has(name));
  if (missing.length > 0) {
    throw new EphemeralSessionError(
      "DISTILL_TOOL_UNREGISTERED",
      `allowlist names absent from the live MCP registry: ${missing.join(", ")}`,
    );
  }
}

/**
 * 隔离 agent scope 组合（agents.create 的 setup 内执行；任何一步失败都会让创建
 * 整体回滚——内核保证 setup throw 不发布半配置会话）：
 * - tools.restrict({ allow })：keep-only 语义 = deny-all 基线 + allowlist 白名单
 *   （晚注册的全局工具不在 allow 内，同样默认不可见——fail-closed 时序）。
 * - systemPrompt.section({ complete: true })：调用方 systemPrompt 即完整系统提示
 *   （不挂 preset，无 persona/ask-user/产品最佳实践残留）。
 * - user-questions 红线：无人类面，一律结构化空答案（防挂起）。
 */
function composeIsolatedScope(
  agentCtx: Context,
  systemPrompt: string,
  allow: readonly string[],
): void {
  const tools = (
    agentCtx as Context & {
      tools?: {
        restrict?: (filter: { allow?: readonly string[]; deny?: readonly string[] }) => () => void;
        schemas?: (scope?: unknown) => Array<{ name?: string }>;
      };
    }
  ).tools;
  if (!tools || typeof tools.restrict !== "function" || typeof tools.schemas !== "function") {
    throw new EphemeralSessionError(
      "DISTILL_KERNEL_CREATE_FAILED",
      "kernel tool surface missing on the agent scope: cannot enforce the deny-all baseline",
    );
  }
  try {
    tools.restrict({ allow });
  } catch (error) {
    // restrict 的实名校验失败（未知名/空过滤）＝运行时二次校验的内核侧防线。
    throw new EphemeralSessionError(
      "DISTILL_TOOL_UNREGISTERED",
      `tool allowlist rejected by the kernel registry: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error },
    );
  }
  const systemPromptService = (
    agentCtx as Context & { systemPrompt?: { section(section: unknown): () => void } }
  ).systemPrompt;
  if (!systemPromptService || typeof systemPromptService.section !== "function") {
    throw new EphemeralSessionError(
      "DISTILL_KERNEL_CREATE_FAILED",
      "kernel system-prompt surface missing on the agent scope",
    );
  }
  systemPromptService.section({
    name: EPHEMERAL_SYSTEM_PROMPT_SECTION_NAME,
    order: 0,
    text: systemPrompt,
    complete: true,
  });
  const questionCtx = agentCtx as unknown as {
    on: (
      event: "user-questions/request",
      listener: () => Promise<{
        answers: Array<{ id: string; selected: string[]; custom?: string }>;
      }>,
    ) => () => void;
  };
  if (typeof questionCtx.on === "function") {
    questionCtx.on("user-questions/request", async () => ({ answers: [] }));
  }
}

/**
 * 创建一次性 ephemeral 会话（design W 契约）。创建即完成 bridge ready 等待与
 * allowlist 双重运行时校验；任何失败都在拿到 session 句柄之前以 typed 错误
 * 上抛（fail-closed，绝不半可用 session）。
 */
export async function createEphemeralSession(
  surface: EphemeralKernelSurface,
  options: CreateEphemeralSessionOptions,
): Promise<EphemeralSession> {
  const allow = validateAllowlist(options.toolAllowlist);
  await waitForBridge(
    surface,
    allow,
    options.bridgeReadyTimeoutMs ?? DEFAULT_BRIDGE_READY_TIMEOUT_MS,
  );
  assertRegistered(surface, allow);

  const agents = (surface.ctx as Context & { agents?: unknown }).agents as
    | EphemeralAgentsServiceLike
    | undefined;
  if (!agents || typeof agents.create !== "function") {
    throw new EphemeralSessionError(
      "DISTILL_KERNEL_CREATE_FAILED",
      "kernel ctx.agents service missing",
    );
  }
  const firehoseCtx = surface.ctx as unknown as {
    on: (
      event: "session/event",
      listener: (session: { id: string }, event: SessionEventLike) => void,
    ) => () => void;
  };
  if (typeof firehoseCtx.on !== "function") {
    throw new EphemeralSessionError(
      "DISTILL_KERNEL_CREATE_FAILED",
      "kernel session firehose missing",
    );
  }
  /** firehose 订阅（以内核 ctx 为 this 的方法调用；返回解绑器）。 */
  const attachFirehose = (
    listener: (session: { id: string }, event: SessionEventLike) => void,
  ): (() => void) => firehoseCtx.on("session/event", listener);

  const sessionId = `distill-${randomUUID()}`;
  let agentCtxRef: Context | undefined;
  let handle: Awaited<ReturnType<EphemeralAgentsServiceLike["create"]>>;
  try {
    handle = await agents.create({
      sessionId,
      // origin=subagent：agent-sessions 面板扫描按 origin 过滤列表面——一次性
      // distill 会话不进面板列表（design §4；接口层不注册 agentSessions/transcripts）。
      meta: { origin: "subagent" },
      ...(options.agentOptions ? { agentOptions: options.agentOptions } : {}),
      setup: (agentCtx) => {
        composeIsolatedScope(agentCtx, options.systemPrompt, allow);
        agentCtxRef = agentCtx;
      },
    });
  } catch (error) {
    if (error instanceof EphemeralSessionError) throw error;
    throw new EphemeralSessionError(
      "DISTILL_KERNEL_CREATE_FAILED",
      `kernel agent scope creation failed: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  const agent = handle.agent;

  /** 实际可见工具名全集（agent scope 的 schemas 视图；restrict 已在其中生效）。 */
  const scopedToolNames = (): readonly string[] => {
    if (agentCtxRef === undefined) return [];
    const tools = (
      agentCtxRef as Context & {
        tools?: { schemas?: (scope?: unknown) => Array<{ name?: string }> };
      }
    ).tools;
    const schemas = tools?.schemas?.(scopeOf(agentCtxRef)) ?? [];
    return schemas
      .map((schema) => schema?.name)
      .filter((name): name is string => typeof name === "string");
  };

  let released = false;
  let releasePromise: Promise<void> | undefined;
  /** 在飞 prompt 的外部终结面（dispose 调用；幂等守卫在 settle 内）。 */
  let abortInFlight: ((message: string) => void) | undefined;

  /** 有界强制释放（幂等：首调用固化 deadline，重复/并发共享同一次释放）。 */
  function dispose(opts?: { deadlineMs?: number }): Promise<void> {
    const deadlineMs = opts?.deadlineMs ?? DEFAULT_DISPOSE_DEADLINE_MS;
    if (releasePromise === undefined) {
      // 先同步占位（released 标记 + promise 槽）再进入 release 体：release 的
      // 同步前缀会经 abortInFlight → failTyped → dispose() 重入，幂等必须在
      // 重入可见之前成立（否则内核 handle 被释放两次）。
      released = true;
      releasePromise = Promise.resolve().then(() => release(deadlineMs));
    }
    return releasePromise;
  }

  async function release(deadlineMs: number): Promise<void> {
    released = true;
    abortInFlight?.("ephemeral session disposed");
    try {
      await new Promise<void>((resolveRelease) => {
        let force: ReturnType<typeof setTimeout> | undefined;
        const finish = (): void => {
          if (force !== undefined) clearTimeout(force);
          resolveRelease();
        };
        void handle.dispose().then(finish, (error: unknown) => {
          console.warn(
            `[ephemeral-session] kernel dispose failed for ${sessionId}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          finish();
        });
        force = setTimeout(() => {
          // 超时：内核侧 session 销毁（cancel 打断在飞轮次；handle.dispose 的
          // 后台回收继续，Promise 有界返回不悬挂调用方）。
          try {
            agent.cancel({ kind: "disposed" });
          } catch {
            // cancel 面缺失时只剩后台 dispose；不再有更强宿主侧手段。
          }
          finish();
        }, deadlineMs);
      });
    } finally {
      abortInFlight = undefined;
    }
  }

  let prompted = false;

  async function prompt(
    input: string,
    opts?: { signal?: AbortSignal; deadlineMs?: number },
  ): Promise<{ text: string }> {
    if (released) {
      throw new EphemeralSessionError("DISTILL_CANCELLED", "ephemeral session disposed");
    }
    if (prompted) {
      throw new EphemeralSessionError(
        "DISTILL_PROMPT_BUSY",
        "one-shot ephemeral session already prompted",
      );
    }
    const signal = opts?.signal;
    if (signal?.aborted) {
      prompted = true;
      throw new EphemeralSessionError("DISTILL_CANCELLED", "prompt signal already aborted");
    }
    prompted = true;
    const deadlineMs = opts?.deadlineMs ?? DEFAULT_PROMPT_DEADLINE_MS;

    return await new Promise<{ text: string }>((resolve, reject) => {
      let settled = false;
      let deadline: ReturnType<typeof setTimeout> | undefined;
      let onAbort: (() => void) | undefined;
      let detachFirehose: (() => void) | undefined;
      let lastText: string | undefined;

      const cleanup = (): void => {
        detachFirehose?.();
        if (deadline !== undefined) clearTimeout(deadline);
        if (signal !== undefined && onAbort !== undefined) {
          signal.removeEventListener("abort", onAbort);
        }
        abortInFlight = undefined;
      };
      /** 失败结算：typed 上抛 + K 矩阵的 timeout/cancel（及一切失败）路径自动释放。 */
      const failTyped = (code: EphemeralSessionErrorCode, message: string): void => {
        if (settled) return;
        settled = true;
        cleanup();
        void dispose().catch(() => undefined);
        reject(new EphemeralSessionError(code, message));
      };

      const listener = (session: { id: string }, event: SessionEventLike): void => {
        if (session.id !== sessionId) return;
        if (event.type === "assistant/message") {
          const checked = AssistantMessageDataSchema.safeParse(event.data);
          if (!checked.success) return; // 畸形载荷丢弃（终文本以最后合法消息为准）
          const text = textOfMessage(checked.data.content);
          if (text.length > 0) lastText = text;
          return;
        }
        if (event.type === "turn/end") {
          if (settled) return;
          settled = true;
          cleanup();
          const checked = TurnEndDataSchema.safeParse(event.data);
          const kind = checked.success ? (checked.data.reason?.kind ?? "completed") : "completed";
          if (kind === "completed") {
            resolve({ text: lastText ?? "" });
            return;
          }
          if (kind === "aborted" || kind === "interrupted") {
            void dispose().catch(() => undefined);
            reject(
              new EphemeralSessionError(
                "DISTILL_CANCELLED",
                `turn ended without completion: ${kind}`,
              ),
            );
            return;
          }
          void dispose().catch(() => undefined);
          reject(
            new EphemeralSessionError("DISTILL_TURN_FAILED", `turn ended with reason: ${kind}`),
          );
        }
      };
      detachFirehose = attachFirehose(listener);

      deadline = setTimeout(() => {
        try {
          agent.cancel({ kind: "hook", reason: "ephemeral-prompt-timeout" });
        } catch {
          // cancel 面缺失时 typed 超时仍须上抛（deadline 是 prompt 的硬边界）。
        }
        failTyped("DISTILL_TIMEOUT", `prompt deadline exceeded: ${deadlineMs}ms`);
      }, deadlineMs);

      onAbort = (): void => {
        try {
          agent.cancel({ kind: "user" });
        } catch {
          // 同上：typed 取消仍须上抛。
        }
        failTyped("DISTILL_CANCELLED", "prompt signal aborted");
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      abortInFlight = (message: string): void => {
        failTyped("DISTILL_CANCELLED", message);
      };

      agent.followup(
        createUserMessage({
          source: { kind: "user" },
          content: [{ type: "text", text: input }],
        }),
      );
    });
  }

  return {
    prompt,
    listTools: () => (released ? [] : scopedToolNames()),
    dispose,
  };
}
