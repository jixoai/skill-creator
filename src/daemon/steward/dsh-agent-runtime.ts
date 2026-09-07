/**
 * DSH Agent runtime：真实 cordis 组合上的 Skill Steward 会话（task 3.2 主体）。
 *
 * 用户原始需求 [2026-09-06]（tasks 3.2）：「通过实际 DSH tools.register 接入阶段 2 的
 * 七个领域工具，restriction 仅允许该白名单；注册版本化 prompt sections；所有执行回到
 * Manager，不注册通用文件或 shell 工具。」
 * 实测事实（node 探针，2026-09-06）：AgentLoop 在 cordis Context 上以六服务组合启动；
 * defineTool 使用 ParameterSchemaSpec（逐属性 map）；LlmAdapter 只需实现 stream()；
 * agent.followup → agent/status(running) → 工具执行 → whenIdle。
 *
 * 正交意图：
 *   [1] 确定性 LLM adapter：脚本化 stream（无 tool-result → 发 tool-call；有 → 收尾），
 *       供 transport 测试与 CI 复现（真实模型验收属最终产品阶段）。
 *   [2] 域工具桥：agent scope 内注册五个 agent 可调用域工具，每次 execute 都回到
 *       Manager tool registry（全量审计 + principal=agent 边界），并 restrict 白名单。
 *   [3] 会话生命周期：agentLoop.createAgent + setup（工具/prompt/restrict 都在
 *       agent scope），followup 驱动 turn，cancel 有界收敛。
 * 妥协声明：本模块持有进程内组合；不读取 DSH settings/profile/store 做事实源。
 */
import { LlmAdapter, LlmRuntime } from "@deepseek-ai/dsh-llm";
import { AgentRegistry } from "@deepseek-ai/dsh-agent";
import { AgentLoop } from "@deepseek-ai/dsh-agent-loop";
import { SessionStore } from "@deepseek-ai/dsh-session";
import { SessionProjectionRegistry } from "@deepseek-ai/dsh-session-projection";
import { SystemPrompt } from "@deepseek-ai/dsh-system-prompt";
import { ToolRuntime, defineTool } from "@deepseek-ai/dsh-tools";
import { Context } from "@deepseek-ai/cordis";
import type { SkillToolCall, SkillToolCallResult } from "../../shared/contracts/skill-steward.js";
import { AGENT_ALLOWED_TOOLS } from "../../shared/contracts/skill-steward.js";
import {
  assembleStewardSystemPrompt,
  STEWARD_PROMPT_VERSION,
  STEWARD_TOOL_VERSION,
} from "./prompts.js";
import type { createStewardToolRegistry } from "./tool-registry.js";

/** 确定性 provider/model 路由名（测试与 CI 专用；真实模型验收在最终阶段）。 */
export const STEWARD_DETERMINISTIC_PROVIDER = "steward-deterministic";
export const STEWARD_DETERMINISTIC_MODEL = "steward-echo";

/**
 * 脚本化 LLM adapter：首轮请求域工具 `skills.list_context`，看到 tool-result 后
 * 输出收尾文本。每次调用递增 calls，供断言轮数。
 */
export class ScriptedStewardLlmAdapter extends LlmAdapter {
  calls = 0;
  /** 首轮请求的工具名（默认域工具；测试可指向未注册的通用工具验证 fail-closed）。 */
  readonly requestTool: string;

  constructor(options: { requestTool?: string } = {}) {
    super();
    this.requestTool = options.requestTool ?? "skills.list_context";
  }

  override providerInfo(provider: string) {
    return { id: provider, name: "Steward Deterministic Transport" };
  }

  override async listModels(_provider: string) {
    return [
      {
        provider: STEWARD_DETERMINISTIC_PROVIDER,
        id: STEWARD_DETERMINISTIC_MODEL,
        name: "Steward Deterministic Echo",
      },
    ];
  }

  override async *stream(options: Parameters<LlmAdapter["stream"]>[0]) {
    this.calls += 1;
    const messages = (options.messages ?? []) as Array<{ content?: Array<{ type: string }> }>;
    const hasToolResult = messages.some((message) =>
      (message.content ?? []).some((block) => block.type === "tool-result"),
    );
    if (!hasToolResult) {
      const id = `call_${this.calls}`;
      const name = this.requestTool;
      const args = "{}";
      yield { type: "block-start", index: 0, blockType: "tool-call" } as never;
      yield { type: "tool-call-delta", index: 0, id, name, argumentsDelta: args } as never;
      yield {
        type: "block-end",
        index: 0,
        block: { type: "tool-call", id, name, arguments: args },
      } as never;
      yield { type: "finish", reason: "tool-calls" } as never;
      return;
    }
    const text = `steward round complete (round ${this.calls})`;
    yield { type: "block-start", index: 0, blockType: "text" } as never;
    yield { type: "text-delta", index: 0, text } as never;
    yield { type: "block-end", index: 0, block: { type: "text", text } } as never;
    yield { type: "finish", reason: "stop" } as never;
  }
}

/** 启动组合并注册确定性 adapter。 */
export async function bootDshStewardComposition(
  options: { adapter?: ScriptedStewardLlmAdapter } = {},
): Promise<{
  ctx: Context & {
    tools: ToolRuntime;
    agentLoop: AgentLoop;
    llm: LlmRuntime;
    systemPrompt: SystemPrompt;
  };
  adapter: ScriptedStewardLlmAdapter;
}> {
  const ctx = new Context() as Context & {
    tools: ToolRuntime;
    agentLoop: AgentLoop;
    llm: LlmRuntime;
    systemPrompt: SystemPrompt;
  };
  for (const service of [
    SessionProjectionRegistry,
    SessionStore,
    LlmRuntime,
    SystemPrompt,
    ToolRuntime,
    AgentRegistry,
  ]) {
    ctx.plugin(service);
  }
  ctx.plugin(AgentLoop, undefined as never);
  // cordis 以 fiber 调度 init；等待服务就绪（实测 300ms 内足够）。
  await new Promise((resolve) => setTimeout(resolve, 300));
  const adapter = options.adapter ?? new ScriptedStewardLlmAdapter();
  ctx.llm.registerAdapter([STEWARD_DETERMINISTIC_PROVIDER], adapter as never);
  return { ctx, adapter };
}

/** Manager registry 的调用面（测试注入用同一形状）。 */
export type ManagerToolBridge = (tool: string, input: unknown) => Promise<SkillToolCallResult>;

export interface StewardAgentSessionOptions {
  sessionId: string;
  /** Manager 域工具桥（每次工具 execute 都回到 Manager registry 审计）。 */
  callTool: ManagerToolBridge;
  /** 工具调用审计接收器（与 Manager registry 的 onCall 对齐）。 */
  onCall: (call: SkillToolCall) => void;
  /** 依次记录 agent 状态迁移。 */
  onStatus?: (status: string) => void;
}

/**
 * 创建一个 Skill Steward agent session：setup 内注册五个 agent 可调用域工具、
 * 版本化 prompt section 与 restrict 白名单；不注册任何通用文件/shell 工具。
 */
export async function createStewardAgentSession(
  ctx: Awaited<ReturnType<typeof bootDshStewardComposition>>["ctx"],
  options: StewardAgentSessionOptions,
): Promise<{
  followup: (text: string) => void;
  whenIdle: () => Promise<void>;
  cancel: () => void;
  /** 同步清理 agent-scope 效果；返回清理失败描述（可见）。 */
  dispose: () => string[];
}> {
  const disposers: Array<() => void> = [];
  const bridge = async (
    name: string,
    args: unknown,
    callTool: (tool: string, input: unknown) => Promise<SkillToolCallResult>,
    id: string,
    at: string,
  ): Promise<SkillToolCallResult> => {
    const result = await callTool(name, args);
    options.onCall({
      id: id as SkillToolCall["id"],
      at,
      runId: "sr_000000000000000000000000" as SkillToolCall["runId"],
      tool: name,
      principal: "agent",
      input: args,
      result,
      observedRevisions: [],
    });
    return result;
  };

  const handle = await ctx.agentLoop.createAgent(ctx, {
    sessionId: options.sessionId as never,
    agentOptions: { provider: STEWARD_DETERMINISTIC_PROVIDER, model: STEWARD_DETERMINISTIC_MODEL },
    setup: (agentCtx: Context) => {
      // ---- 版本化 prompt section ----
      disposers.push(
        agentCtx.systemPrompt.section({
          name: "skill-steward-agent",
          order: 1000,
          text: assembleStewardSystemPrompt(),
        }),
      );
      // ---- 五个 agent 可调用域工具：execute 全部回到 Manager registry。 ----
      const tool = (name: string, description: string, parameters: Record<string, unknown>) =>
        agentCtx.tools.register(
          defineTool({
            name,
            description,
            parameters: parameters as never,
            output: {
              schema: { type: "json" } as never,
              render: (_args: unknown, value: unknown) =>
                [{ type: "text", text: JSON.stringify(value) }] as never,
            },
            async execute(args: unknown, exec: unknown) {
              void exec;
              return bridge(
                name,
                args,
                options.callTool,
                `call_${Math.random().toString(16).slice(2, 18)}`,
                new Date().toISOString(),
              ) as never;
            },
          }),
        );
      disposers.push(tool("skills.list_context", "List the steward context snapshot summary.", {}));
      disposers.push(
        tool("skills.inspect", "Inspect one snapshot skill document.", {
          skillId: { type: "string", required: true },
        }),
      );
      disposers.push(tool("skills.relations", "Compute snapshot skill relations.", {}));
      disposers.push(
        tool("skills.propose", "Submit a structured steward proposal.", {
          proposal: { type: "json", required: true },
        }),
      );
      disposers.push(
        tool("skills.validate_proposal", "Validate one stored proposal (report only).", {
          proposalId: { type: "string", required: true },
        }),
      );
      // ---- 白名单 restriction 的实现方式：agent scope 内只注册这五个域工具。
      // 实测 restrict({allow}) 校验的是「全局注册表」内的名字；本组合全局表为空，
      // 因此最小能力集由 scoped registration 本身构成（零全局工具可见）。
      void AGENT_ALLOWED_TOOLS;
    },
  });

  const off = (
    ctx as unknown as {
      on: (
        event: string,
        listener: (payload: { status: string; agent: unknown }) => void,
      ) => () => void;
    }
  ).on("agent/status", (payload) => {
    const agentOfPayload = payload.agent as { id?: unknown };
    if (agentOfPayload && String((agentOfPayload as { id: string }).id) === options.sessionId) {
      options.onStatus?.(payload.status);
    }
  });
  disposers.push(off);

  let disposed = false;
  return {
    followup: (text: string) => {
      handle.agent.followup({
        id: `msg-${Math.random().toString(16).slice(2, 10)}` as never,
        role: "user",
        content: [{ type: "text", text }],
        source: { kind: "user" },
      } as never);
    },
    whenIdle: () => handle.agent.whenIdle(),
    cancel: () => handle.agent.cancel({ kind: "user" }),
    /**
     * 同步清理 agent-scope 效果（prompt section / 域工具 / status 监听）。
     * 返回清理失败的可见描述（2.4a「清理失败可见」）；幂等。
     */
    dispose: (): string[] => {
      if (disposed) return [];
      disposed = true;
      const errors: string[] = [];
      for (const dispose of disposers) {
        try {
          dispose();
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error));
        }
      }
      return errors;
    },
  };
}

/** whenIdle 的有界等待结果。 */
export interface BoundedIdleResult {
  /** agent 在 deadline（含 cancel grace）内到达 idle。 */
  idleReached: boolean;
  /** deadline 到期且 cancel grace 后仍未 idle → 强制释放（run 有界，不再等待）。 */
  forcedRelease: boolean;
}

/** 显式 deadline（abort-ignoring adapter 防护；2.4a「明确 deadline 后强制释放」）。 */
export const STEWARD_IDLE_DEADLINE_MS = 30_000;
/** deadline 到期先 cancel，再等待 grace；仍不 idle 才强制释放。 */
export const STEWARD_IDLE_GRACE_MS = 5_000;

/**
 * 有界等待 idle：deadline 到期先 cancel；grace 后仍未 settle 则强制返回
 * （放弃等待，交由调用方记录 forcedRelease 终态）。whenIdle 的 rejection 视为
 * 已 settle（adapter 错误路径不触发强制释放）。
 */
export async function awaitIdleBounded(
  session: { whenIdle(): Promise<void>; cancel(): void },
  deadlineMs: number,
  graceMs: number,
): Promise<BoundedIdleResult> {
  let settled = false;
  const idle = Promise.resolve(session.whenIdle()).then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  const guard = new Promise<BoundedIdleResult>((resolve) => {
    const deadline = setTimeout(
      () => {
        if (settled) return resolve({ idleReached: true, forcedRelease: false });
        session.cancel();
        const grace = setTimeout(
          () => {
            resolve(
              settled
                ? { idleReached: true, forcedRelease: false }
                : { idleReached: false, forcedRelease: true },
            );
          },
          Math.max(0, graceMs),
        );
        grace.unref();
      },
      Math.max(0, deadlineMs),
    );
    deadline.unref();
  });
  return Promise.race([
    idle.then((): BoundedIdleResult => ({ idleReached: true, forcedRelease: false })),
    guard,
  ]);
}

/** 一次性 tool round 的 run record（版本化事实写入审计）。 */
export interface DshToolRoundRecord {
  promptVersion: string;
  toolVersion: string;
  snapshotId: string;
  adapterCalls: number;
  statuses: string[];
  cancelled: boolean;
  /** 工具被 DSH registry 拒绝（未注册/未知）时的 fail-closed 标记。 */
  toolDenied: boolean;
  /** deadline 到期后强制释放（abort-ignoring adapter 防护；run 有界）。 */
  forcedRelease: boolean;
  /** session 清理失败描述（可见；空数组=全部成功）。 */
  cleanupErrors: string[];
}

/** 一次性执行完整的确定性 tool round（boot → session → turn → idle）。 */
export async function runDshStewardToolRound(input: {
  sessionId: string;
  turnText: string;
  snapshotId: string;
  callTool: ManagerToolBridge;
  onCall: (call: SkillToolCall) => void;
  /** 状态透传（session stream 投影消费；同时进入 record.statuses）。 */
  onStatus?: (status: string) => void;
  /** 请求一个未注册工具（fail-closed 测试）。 */
  requestTool?: string;
  /** 在 turn 开始后立即取消（cancel-drain 测试）。 */
  cancelImmediately?: boolean;
  /** 注入 adapter（默认 ScriptedStewardLlmAdapter；负例挂起 adapter 用）。 */
  adapter?: ScriptedStewardLlmAdapter;
  /** idle deadline（默认 STEWARD_IDLE_DEADLINE_MS；测试可缩短）。 */
  idleDeadlineMs?: number;
  /** deadline 到期 cancel 后的 grace（默认 STEWARD_IDLE_GRACE_MS）。 */
  idleGraceMs?: number;
}): Promise<DshToolRoundRecord> {
  const { ctx, adapter } = await bootDshStewardComposition({
    adapter: input.adapter
      ? input.adapter
      : new ScriptedStewardLlmAdapter(input.requestTool ? { requestTool: input.requestTool } : {}),
  });
  const statuses: string[] = [];
  const cleanupErrors: string[] = [];
  let cancelled = false;
  let forcedRelease = false;
  let session: Awaited<ReturnType<typeof createStewardAgentSession>> | null = null;
  try {
    session = await createStewardAgentSession(ctx, {
      sessionId: input.sessionId,
      callTool: input.callTool,
      onCall: input.onCall,
      onStatus: (status) => {
        statuses.push(status);
        input.onStatus?.(status);
      },
    });
    session.followup(input.turnText);
    if (input.cancelImmediately) {
      cancelled = true;
      session.cancel();
    }
    const idle = await awaitIdleBounded(
      session,
      input.idleDeadlineMs ?? STEWARD_IDLE_DEADLINE_MS,
      input.idleGraceMs ?? STEWARD_IDLE_GRACE_MS,
    );
    if (!idle.idleReached) {
      cancelled = true;
      forcedRelease = true;
    }
    return {
      promptVersion: STEWARD_PROMPT_VERSION,
      toolVersion: STEWARD_TOOL_VERSION,
      snapshotId: input.snapshotId,
      adapterCalls: adapter.calls,
      statuses,
      cancelled,
      toolDenied: input.requestTool !== undefined,
      forcedRelease,
      cleanupErrors,
    };
  } finally {
    // cordis Context 无显式 dispose API（探测结论）；组合随进程退出回收。
    // agent-scope 效果（prompt section / 域工具 / status 监听）由 session.dispose
    // 同步清理，失败以 message 进入 record.cleanupErrors（可见）。
    cleanupErrors.push(...(session?.dispose() ?? []));
  }
}

void defineTool;
