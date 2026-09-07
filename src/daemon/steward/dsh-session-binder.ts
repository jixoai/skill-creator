/**
 * Skill Steward run ↔ DSH session 绑定服务（openspec dsh-webui-composition task 2.1 step 3）。
 *
 * 用户原始需求 [2026-09-06]（tasks 2.1）：「Skill Steward run 绑定 DSH session id 与
 * Manager run id；实时 stream 只做展示，durable audit 仍由 Manager 保存。」
 * 事实源：dsh-session SessionStore/Session（append 事件语法实测自 dsh-agent-loop）、
 * dsh-workspace workspaceRegistry（resolveByPath/create + attachSession 的 cwd 对齐）、
 * dsh-llm createUserMessage/createAssistantMessage 工厂。
 *
 * 正交意图：
 *   [1] 绑定面：Manager run 在官方组合内建立 DSH session（workspace 归属 + cwd 对齐），
 *       session 事件只承载展示（title + 单轮 turn 叙述）；durable 事实仍写 Manager
 *       audit-store，DSH 侧不落任何审批/变更真相。
 *   [2] 生命周期投影：run 完成/失败各有一条终态事件路径（turn/end reason 语义对齐
 *       agent-loop：completed / error）。
 *   [3] tool round 投影（task 2.2）：Manager 域工具调用以 tool/call + tool/result
 *       事件进入官方 transcript，callId 即 Manager SkillToolCall.id（关联键）；
 *       纯投影——不注册工具、不建立执行入口，重复投影按 callId 幂等跳过。
 *   [4] 可选宿主：host 未启动时返回 typed HOST_UNAVAILABLE，pipeline 不因缺宿主失败。
 * 妥协声明：跨 cordis 服务访问按结构化 unknown 收窄（宿主服务形状无公开 TS 面）。
 */
import fs from "node:fs/promises";
import {
  createAssistantMessage,
  createToolResultMessage,
  createUserMessage,
} from "@deepseek-ai/dsh-llm";
import {
  type SkillStewardRunResult,
  type SkillToolCall,
} from "../../shared/contracts/skill-steward.js";
import type { Context } from "@deepseek-ai/cordis";
import type { DshStreamCollector } from "./dsh-settings.js";

/** 绑定失败（闭合 union；缺宿主不是错误路径）。 */
export type StewardSessionBindingFailure =
  | { kind: "HOST_UNAVAILABLE" }
  | { kind: "SERVICE_MISSING"; service: string }
  | { kind: "WORKSPACE_ATTACH_FAILED"; message: string };

/** openBoundSession 输入。 */
export interface StewardSessionOpenInput {
  /** Manager run id（绑定键；进入 title 与 user turn 文本）。 */
  runId: string;
  /** daemon Workspace 目录（realpath 对齐 DSH workspace record 与 session cwd）。 */
  workspaceDir: string;
  /** DSH workspace 标题（缺省用目录名）。 */
  workspaceTitle?: string;
  /** steward 任务叙述（user turn 文本）。 */
  taskText: string;
}

/** 终态叙述输入。 */
export interface StewardSessionCompleteInput {
  /** openBoundSession 返回的 DSH session id。 */
  dshSessionId: string;
  /** run 终态摘要（assistant turn 文本）。 */
  summary: Pick<
    SkillStewardRunResult,
    "terminal" | "acceptedResponses" | "droppedLateResponses" | "toolCalls"
  > & { proposals: number };
  /** 失败原因（存在时 turn/end 走 error reason）。 */
  failureMessage?: string;
}

/** DSH Session 的最小结构面（append 返回含 seq 的事件记录）。 */
interface DshSessionLike {
  id: string;
  append(
    type: string,
    data: unknown,
    opts?: { surfaceOp?: "append"; sourceEventSeqs?: number[] },
  ): { seq: number };
}

/** DSH workspace 实体的最小结构面。 */
interface DshWorkspaceLike {
  attachSession(sessionId: string): Promise<unknown>;
}

/** cordis ctx 上两个服务的最小结构面。 */
interface DshHostSessionSurface {
  sessions: {
    create(id?: string, options?: { meta?: { cwd?: string } }): DshSessionLike;
    get(id: string): DshSessionLike | undefined;
  };
  workspaceRegistry: {
    resolveByPath(path: string): Promise<DshWorkspaceLike | undefined>;
    create(path: string, title: string): Promise<DshWorkspaceLike>;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** 把 cordis ctx 收窄为 sessions/workspaceRegistry 结构面；缺失返回 typed 失败。 */
function narrowHostSurface(ctx: unknown): DshHostSessionSurface | StewardSessionBindingFailure {
  if (!isRecord(ctx)) return { kind: "HOST_UNAVAILABLE" };
  const { sessions, workspaceRegistry } = ctx as Record<string, unknown>;
  if (
    !isRecord(sessions) ||
    typeof sessions.create !== "function" ||
    typeof sessions.get !== "function"
  ) {
    return { kind: "SERVICE_MISSING", service: "sessions" };
  }
  if (
    !isRecord(workspaceRegistry) ||
    typeof workspaceRegistry.resolveByPath !== "function" ||
    typeof workspaceRegistry.create !== "function"
  ) {
    return { kind: "SERVICE_MISSING", service: "workspaceRegistry" };
  }
  return {
    sessions: sessions as unknown as DshHostSessionSurface["sessions"],
    workspaceRegistry: workspaceRegistry as unknown as DshHostSessionSurface["workspaceRegistry"],
  };
}

export interface DshSessionBinderOptions {
  /** 宿主提供者（懒求值：daemon 未拥有 host 时返回 null）。 */
  /**
   * 宿主访问器（2.3 起为 headless 内核形态；只消费 ctx——web host 与 kernel
   * 句柄结构兼容）。未挂载返回 null → typed HOST_UNAVAILABLE。
   */
  host: () => { ctx: Context } | null;
  /**
   * 4.2：帧收集器工厂（dsh.settings 环形缓冲）。提供时，绑定会话的 turn/tool
   * 事件同步进入脱敏 stream 投影（dsh.sessions.streams 的生产数据源）；
   * 收集器失败只丢帧，不影响绑定主链。
   */
  createCollector?: (runId: string, sessionId: string) => Promise<DshStreamCollector>;
}

/** 创建绑定服务。 */
export function createDshSessionBinder(options: DshSessionBinderOptions) {
  const collectors = new Map<string, Promise<DshStreamCollector | null>>();
  const collectorFor = (runId: string, sessionId: string): Promise<DshStreamCollector | null> => {
    if (!options.createCollector) return Promise.resolve(null);
    let collector = collectors.get(sessionId);
    if (!collector) {
      collector = options.createCollector(runId, sessionId).catch(() => null);
      collectors.set(sessionId, collector);
    }
    return collector;
  };
  /** 已投影的 tool call id（per session；重连/重渲染幂等，不重复投影）。 */
  const recordedToolCallIds = new Map<string, Set<string>>();

  /** 打开一个绑定 run 的 DSH session（workspace 归属 + title + 单 turn user 侧）。 */
  async function openBoundSession(
    input: StewardSessionOpenInput,
  ): Promise<
    { ok: true; dshSessionId: string } | { ok: false; failure: StewardSessionBindingFailure }
  > {
    const host = options.host();
    if (!host) return { ok: false, failure: { kind: "HOST_UNAVAILABLE" } };
    const surface = narrowHostSurface(host.ctx);
    if ("kind" in surface) return { ok: false, failure: surface };

    const canonical = await fs.realpath(input.workspaceDir);
    const workspace =
      (await surface.workspaceRegistry.resolveByPath(canonical)) ??
      (await surface.workspaceRegistry.create(
        canonical,
        input.workspaceTitle ?? canonical.split("/").pop() ?? canonical,
      ));

    const session = surface.sessions.create(undefined, { meta: { cwd: canonical } });
    try {
      await workspace.attachSession(session.id);
    } catch (error) {
      return {
        ok: false,
        failure: {
          kind: "WORKSPACE_ATTACH_FAILED",
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }

    session.append("session/title", {
      title: `Steward ${input.runId}`,
      messageSeqs: [],
      source: { kind: "user" },
    });
    session.append("turn/start", { turn: 1 });
    session.append("step/start", { turn: 1, step: 1 });
    session.append(
      "user/message",
      createUserMessage({
        source: { kind: "user" },
        content: [{ type: "text", text: input.taskText }],
      }),
      { surfaceOp: "append" },
    );
    void collectorFor(input.runId, session.id).then((collector) => {
      collector?.onTurnStart(input.taskText);
    });
    return { ok: true, dshSessionId: session.id };
  }

  /** 投影 run 终态（assistant turn + step/turn 收束；error 路径携带失败原因）。 */
  function completeBoundSession(
    input: StewardSessionCompleteInput,
  ): { ok: true } | { ok: false; failure: StewardSessionBindingFailure } {
    const host = options.host();
    if (!host) return { ok: false, failure: { kind: "HOST_UNAVAILABLE" } };
    const surface = narrowHostSurface(host.ctx);
    if ("kind" in surface) return { ok: false, failure: surface };
    const session = surface.sessions.get(input.dshSessionId);
    if (!session) {
      return {
        ok: false,
        failure: { kind: "SERVICE_MISSING", service: `session:${input.dshSessionId}` },
      };
    }

    const lines = [
      `Steward run 终态：${input.summary.terminal}`,
      `responses: ${input.summary.acceptedResponses} accepted / ${input.summary.droppedLateResponses} dropped late`,
      `tool calls: ${input.summary.toolCalls}`,
      `proposals: ${input.summary.proposals}`,
    ];
    if (input.failureMessage) lines.push(`failure: ${input.failureMessage}`);
    session.append(
      "assistant/message",
      {
        turn: 1,
        step: 1,
        message: createAssistantMessage({
          content: [{ type: "text", text: lines.join("\n") }],
          source: { provider: "skill-creator-steward", model: "steward-pipeline" },
        }),
      },
      { surfaceOp: "append" },
    );
    session.append("step/end", { turn: 1, step: 1 });
    session.append("turn/end", {
      turn: 1,
      reason: input.failureMessage
        ? { kind: "error", error: { message: input.failureMessage, code: "STEWARD_RUN" } }
        : { kind: "completed" },
    });
    return { ok: true };
  }

  /**
   * 投影 Manager 域工具调用轮（task 2.2）：每个 SkillToolCall 一对
   * tool/call + tool/result 事件，callId = Manager 调用 id（关联键）。
   * 事件语法实测对齐 dsh-agent-loop（result 经 sourceEventSeqs 引用 call 事件）。
   * 纯展示投影：这里不执行任何工具；同一 callId 重复投影幂等跳过
   * （重连/重渲染不得产生第二份事件，更不得重新执行）。
   */
  function recordToolRounds(
    dshSessionId: string,
    calls: readonly SkillToolCall[],
  ): { ok: true; projected: number } | { ok: false; failure: StewardSessionBindingFailure } {
    const host = options.host();
    if (!host) return { ok: false, failure: { kind: "HOST_UNAVAILABLE" } };
    const surface = narrowHostSurface(host.ctx);
    if ("kind" in surface) return { ok: false, failure: surface };
    const session = surface.sessions.get(dshSessionId);
    if (!session) {
      return {
        ok: false,
        failure: { kind: "SERVICE_MISSING", service: `session:${dshSessionId}` },
      };
    }

    let projected = 0;
    for (const call of calls) {
      let seen = recordedToolCallIds.get(dshSessionId);
      if (!seen) {
        seen = new Set<string>();
        recordedToolCallIds.set(dshSessionId, seen);
      }
      if (seen.has(call.id)) continue;
      // 官方契约：tool/call 的 arguments 是「原始 JSON 字符串」（ui-chat 投影
      // argsRaw = arguments 后 JSON.parse；对象值会使官方 transcript 渲染器
      // deriveSummary/firstLine 崩溃——4.1 浏览器取证实测）。
      const callSeq = session.append("tool/call", {
        turn: 1,
        step: 1,
        callId: call.id,
        name: call.tool,
        arguments: JSON.stringify(call.input ?? {}),
      }).seq;
      const isError = call.result.kind !== "ok";
      session.append(
        "tool/result",
        {
          turn: 1,
          step: 1,
          // 跨体系关联键：Manager SkillToolCall.id 直接充当 DSH 展示 callId
          // （brand 是零成本编译标记；运行时就是同一字符串）。
          message: createToolResultMessage({
            callId: call.id as unknown as Parameters<typeof createToolResultMessage>[0]["callId"],
            content: [{ type: "text", text: summarizeToolResult(call) }],
            isError,
          }),
          ...(isError && call.result.kind === "failed"
            ? { error: { code: call.result.code, message: call.result.message } }
            : {}),
        },
        { surfaceOp: "append", sourceEventSeqs: [callSeq] },
      );
      seen.add(call.id);
      projected += 1;
      // 4.2：同一投影同步进 stream 帧（幂等性由上方 seen 集合保证；失败只丢帧）。
      void collectorFor(call.runId, dshSessionId).then((collector) => {
        collector?.onToolCall(call);
      });
    }
    return { ok: true, projected };
  }

  return { openBoundSession, completeBoundSession, recordToolRounds };
}

/** 工具结果的一行摘要（transcript 折叠行文案；完整事实在 Manager audit）。 */
function summarizeToolResult(call: SkillToolCall): string {
  switch (call.result.kind) {
    case "ok":
      return `ok (${call.tool})`;
    case "denied":
      return `denied (${call.tool}): ${call.result.reason} — ${call.result.requestedOperation}`;
    case "failed":
      return `failed (${call.tool}): ${call.result.code} — ${call.result.message}`;
  }
}

/** 绑定服务实例接口。 */
export type DshSessionBinder = ReturnType<typeof createDshSessionBinder>;
