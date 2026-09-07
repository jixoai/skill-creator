/**
 * Agent 面板 store（dsh-kernel-rebase task 3.x）。
 *
 * 用户原始需求 [2026-09-08]：「我们可以简单理解成，我们在 skill creator 的右侧
 * 嵌入了一个聊天对话框。」——shell 级右栏 drawer 的会话/帧/审批/配置投影；
 * 跨 tab 存活（module-level 状态），断线可见与恢复。
 *
 * 正交意图：
 *   [1] 面板状态：open/当前会话/帧视图累积（latest-request-wins 代次门 +
 *       连接 owner generation；失效响应投影为无结果）。
 *   [2] 轮询生命周期：running 或有待答审批时 1.2s 轮询；idle 且无待答时停轮询
 *       （终态停轮询语义平移），prompt/answer/手动刷新重启。
 *   [3] 配置投影：model/preset/approval policy 的 load/patch（agent.settings.*）。
 * 妥协声明：面板不是 MCP client——会话经 agent.* RPC 消费内核（design D2）。
 */
import type { AgentSessionSummary } from "$shared/contracts/agent.js";
import type { DshSettingsUpdate } from "$shared/contracts/dsh-runtime.js";
import type { DshSessionStreamFrame } from "$shared/contracts/dsh-runtime.js";
import { getConnectionGeneration, requireRpc } from "./connection.svelte";
import { createRequestGenerationGate } from "./request-generation.js";

/** 待答审批的视图投影（approval-request 帧的 questions 载荷）。 */
export interface PanelApprovalQuestion {
  id: string;
  question: string;
  detail?: string;
  header?: string;
  multiSelect?: boolean;
  options?: Array<{ label: string; description?: string }>;
}

/** 面板视图项（帧流的结构化分组投影）。 */
export type PanelItem =
  | { kind: "turn"; seq: number; label: string }
  | { kind: "status"; seq: number; text: string }
  | { kind: "user"; seq: number; text: string }
  | { kind: "assistant"; seq: number; text: string }
  | { kind: "tool"; seq: number; toolName: string; phase: "call" | "result"; payload?: unknown }
  | {
      kind: "approval";
      seq: number;
      questions: PanelApprovalQuestion[];
      resolved: boolean;
    };

const sessionsGate = createRequestGenerationGate(getConnectionGeneration);
const createGate = createRequestGenerationGate(getConnectionGeneration);
const streamGate = createRequestGenerationGate(getConnectionGeneration);
const answerGate = createRequestGenerationGate(getConnectionGeneration);
const settingsGate = createRequestGenerationGate(getConnectionGeneration);
const updateSettingsGate = createRequestGenerationGate(getConnectionGeneration);

/** drawer 开合（跨 tab 存活）。 */
export const agentPanel = $state({ open: false });

/** 当前会话与帧视图（跨 tab 存活；切会话清空重载）。 */
export const agentSession = $state({
  sessionId: null as string | null,
  status: "idle" as AgentSessionSummary["status"],
  items: [] as PanelItem[],
  /** 最新帧 seq（轮询游标）。 */
  cursor: 0,
  sending: false,
  error: null as string | null,
});

/** 会话列表投影。 */
export const agentSessionsList = $state({
  loaded: false as boolean,
  loading: false,
  sessions: [] as AgentSessionSummary[],
  error: null as string | null,
});

/** 配置投影。 */
export const agentRuntimeConfig = $state({
  view: null as Awaited<ReturnType<typeof loadAgentSettings>>["view"] | null,
  loading: false,
  updating: false,
  error: null as string | null,
});

let pollTimer: ReturnType<typeof setTimeout> | null = null;
let pollSession: string | null = null;

/** 打开/关闭 drawer（打开时惰性加载会话列表）。 */
export function setAgentPanelOpen(open: boolean): void {
  agentPanel.open = open;
  if (open && !agentSessionsList.loaded && !agentSessionsList.loading) {
    void loadAgentSessions();
  }
  if (open && agentSession.sessionId) {
    void pollAgentStream();
  }
  if (!open) {
    stopPolling();
  }
}

/** 加载会话列表；结果交给调用方持有。 */
export async function loadAgentSessions(): Promise<void> {
  const request = sessionsGate.issue();
  agentSessionsList.loading = true;
  try {
    const result = await requireRpc().agent.sessions.list({});
    if (!request.isCurrent()) return;
    agentSessionsList.sessions = result.sessions;
    agentSessionsList.loaded = true;
    agentSessionsList.error = null;
  } catch (error) {
    if (!request.isCurrent()) return;
    agentSessionsList.error = error instanceof Error ? error.message : String(error);
  } finally {
    if (request.isCurrent()) agentSessionsList.loading = false;
  }
}

/** 新建会话（可选首 prompt）；成功后切换到该会话并开始轮询。 */
export async function createAgentSession(prompt?: string): Promise<void> {
  const request = createGate.issue();
  agentSession.sending = true;
  try {
    const result = await requireRpc().agent.session.create({ prompt });
    if (!request.isCurrent()) return;
    resetSessionView(result.session.sessionId, result.session.status);
    agentSessionsList.loaded = false;
    void loadAgentSessions();
    void pollAgentStream();
  } catch (error) {
    if (!request.isCurrent()) return;
    agentSession.error = error instanceof Error ? error.message : String(error);
  } finally {
    if (request.isCurrent()) agentSession.sending = false;
  }
}

/** 切换会话（重置视图并立即拉一轮）。 */
export function selectAgentSession(sessionId: string): void {
  if (agentSession.sessionId === sessionId) return;
  resetSessionView(sessionId, "idle");
  void pollAgentStream();
}

function resetSessionView(sessionId: string, status: AgentSessionSummary["status"]): void {
  agentSession.sessionId = sessionId;
  agentSession.status = status;
  agentSession.items = [];
  agentSession.cursor = 0;
  agentSession.error = null;
}

/** 发送一轮用户输入。 */
export async function sendAgentPrompt(text: string): Promise<void> {
  const sessionId = agentSession.sessionId;
  if (!sessionId || text.trim().length === 0) return;
  const request = streamGate.issue();
  agentSession.sending = true;
  // 乐观追加用户消息（失败时由错误状态覆盖）。
  agentSession.items.push({ kind: "user", seq: -Date.now(), text });
  try {
    await requireRpc().agent.session.prompt({ sessionId, text });
    if (!request.isCurrent()) return;
    agentSession.error = null;
  } catch (error) {
    if (!request.isCurrent()) return;
    agentSession.error = error instanceof Error ? error.message : String(error);
  } finally {
    if (request.isCurrent()) agentSession.sending = false;
  }
  void pollAgentStream();
}

/** 取消当前活动。 */
export async function cancelAgentSession(): Promise<void> {
  const sessionId = agentSession.sessionId;
  if (!sessionId) return;
  try {
    await requireRpc().agent.session.cancel({ sessionId });
  } catch (error) {
    agentSession.error = error instanceof Error ? error.message : String(error);
  }
  void pollAgentStream();
}

/** 回答一个待答审批请求。 */
export async function answerAgentApproval(
  requestSeq: number,
  answers: Array<{ id: string; selected: string[]; custom?: string }>,
): Promise<void> {
  const sessionId = agentSession.sessionId;
  if (!sessionId) return;
  const request = answerGate.issue();
  try {
    await requireRpc().agent.session.answer({ sessionId, requestSeq, answers });
    if (!request.isCurrent()) return;
    // 本地即时置 resolved（下一轮 stream 帧会带 approval-resolved 幂等补充）。
    for (const item of agentSession.items) {
      if (item.kind === "approval" && item.seq === requestSeq) item.resolved = true;
    }
  } catch (error) {
    if (!request.isCurrent()) return;
    agentSession.error = error instanceof Error ? error.message : String(error);
  }
  void pollAgentStream();
}

/** 拉取一轮增量帧；按终态决定是否继续轮询。 */
export async function pollAgentStream(): Promise<void> {
  const sessionId = agentSession.sessionId;
  if (!sessionId) return;
  const request = streamGate.issue();
  try {
    const result = await requireRpc().agent.session.stream({
      sessionId,
      afterSeq: agentSession.cursor,
      limit: 100,
    });
    if (!request.isCurrent()) return;
    if (agentSession.sessionId !== sessionId) return;
    agentSession.status = result.status;
    for (const frame of result.frames) {
      appendFrame(frame);
      agentSession.cursor = Math.max(agentSession.cursor, frame.seq);
    }
    agentSession.error = null;
  } catch (error) {
    if (!request.isCurrent()) return;
    agentSession.error = error instanceof Error ? error.message : String(error);
    stopPolling();
    return;
  }
  scheduleNextPoll();
}

function scheduleNextPoll(): void {
  stopPolling();
  const hasPendingApproval = agentSession.items.some(
    (item) => item.kind === "approval" && !item.resolved,
  );
  if (agentSession.status === "running" || hasPendingApproval) {
    pollSession = agentSession.sessionId;
    pollTimer = setTimeout(() => {
      void pollAgentStream();
    }, 1200);
  }
}

function stopPolling(): void {
  if (pollTimer !== null) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  pollSession = null;
}

/** 帧到视图项的追加（未知帧丢弃；user/message 乐观项去重交给 seq 游标天然边界）。 */
function appendFrame(frame: DshSessionStreamFrame): void {
  switch (frame.kind) {
    case "turn-start":
      agentSession.items.push({ kind: "turn", seq: frame.seq, label: "Turn" });
      break;
    case "status":
      agentSession.items.push({
        kind: "status",
        seq: frame.seq,
        text: JSON.stringify(frame.payload ?? {}),
      });
      break;
    case "assistant-text":
      if (typeof frame.text === "string" && frame.text.length > 0) {
        agentSession.items.push({ kind: "assistant", seq: frame.seq, text: frame.text });
      }
      break;
    case "tool-call":
      agentSession.items.push({
        kind: "tool",
        seq: frame.seq,
        toolName: frame.toolName ?? "tool",
        phase: "call",
        payload: frame.payload,
      });
      break;
    case "tool-result":
      agentSession.items.push({
        kind: "tool",
        seq: frame.seq,
        toolName: frame.toolName ?? "tool",
        phase: "result",
        payload: frame.payload,
      });
      break;
    case "turn-end": {
      agentSession.items.push({ kind: "turn", seq: frame.seq, label: "Turn end" });
      break;
    }
    case "approval-request": {
      const payload = frame.payload as { questions?: PanelApprovalQuestion[] } | undefined;
      agentSession.items.push({
        kind: "approval",
        seq: frame.seq,
        questions: Array.isArray(payload?.questions) ? payload!.questions! : [],
        resolved: false,
      });
      break;
    }
    case "approval-resolved":
      for (const item of agentSession.items) {
        if (item.kind === "approval") item.resolved = true;
      }
      break;
  }
  const cap = 500;
  if (agentSession.items.length > cap) {
    agentSession.items.splice(0, agentSession.items.length - cap);
  }
}

/** 加载配置投影（model/preset/permission + 凭据状态）。 */
export async function loadAgentSettings(): Promise<{
  view: import("$shared/contracts/dsh-runtime.js").DshStewardSettingsView | null;
  error: string | null;
}> {
  const request = settingsGate.issue();
  agentRuntimeConfig.loading = true;
  try {
    const result = await requireRpc().agent.settings.get({});
    if (!request.isCurrent()) return { view: null, error: null };
    agentRuntimeConfig.view = result;
    agentRuntimeConfig.error = null;
    return { view: result, error: null };
  } catch (error) {
    if (!request.isCurrent()) return { view: null, error: null };
    const message = error instanceof Error ? error.message : String(error);
    agentRuntimeConfig.error = message;
    return { view: null, error: message };
  } finally {
    if (request.isCurrent()) agentRuntimeConfig.loading = false;
  }
}

/** 应用配置补丁；类型化 rejected 原样返回给调用方投影。 */
export async function updateAgentSettings(
  patch: DshSettingsUpdate,
): Promise<
  | { outcome: "updated"; changed: boolean }
  | { outcome: "rejected"; code: string; detail: string }
  | { outcome: "error"; message: string }
  | null
> {
  const request = updateSettingsGate.issue();
  agentRuntimeConfig.updating = true;
  try {
    const result = await requireRpc().agent.settings.update(patch);
    if (!request.isCurrent()) return null;
    if (result.outcome === "updated") agentRuntimeConfig.view = result.view;
    return result;
  } catch (error) {
    if (!request.isCurrent()) return null;
    return { outcome: "error", message: error instanceof Error ? error.message : String(error) };
  } finally {
    if (request.isCurrent()) agentRuntimeConfig.updating = false;
  }
}

/** 断线清理（connection 层重连时调用可扩展；当前以代次门自然失效）。 */
export function resetAgentPanelConnection(): void {
  stopPolling();
}
