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
import type {
  DshAgentMode,
  DshSettingsUpdate,
  DshSessionStreamFrame,
  DshStewardSettingsView,
} from "$shared/contracts/dsh-runtime.js";
import { getConnectionGeneration, getRpc, requireRpc } from "./connection.svelte";
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
  | { kind: "assistant"; seq: number; text: string; streaming: boolean }
  | { kind: "reasoning"; seq: number; text: string; streaming: boolean }
  | { kind: "tool"; seq: number; toolName: string; phase: "call" | "result"; payload?: unknown }
  | {
      kind: "approval";
      seq: number;
      questions: PanelApprovalQuestion[];
      resolved: boolean;
    }
  | { kind: "mode"; seq: number; from: DshAgentMode; to: DshAgentMode };

const sessionsGate = createRequestGenerationGate(getConnectionGeneration);
const createGate = createRequestGenerationGate(getConnectionGeneration);
const streamGate = createRequestGenerationGate(getConnectionGeneration);
// prompt 的失败必须可见：与轮询分门（共享 streamGate 时，紧随的新轮询会取代
// prompt 的代次资格，catch 分支被跳过——错误静默）。
const promptGate = createRequestGenerationGate(getConnectionGeneration);
const answerGate = createRequestGenerationGate(getConnectionGeneration);
const settingsGate = createRequestGenerationGate(getConnectionGeneration);
const updateSettingsGate = createRequestGenerationGate(getConnectionGeneration);
const setModeGate = createRequestGenerationGate(getConnectionGeneration);
const credentialGate = createRequestGenerationGate(getConnectionGeneration);

/** drawer 开合（跨 tab 存活）；seedPrompt 为首屏行动塞进 composer 的一次性种子。 */
export const agentPanel = $state({
  open: false,
  seedPrompt: null as string | null,
});

/** 当前会话与帧视图（跨 tab 存活；切会话清空重载）。 */
export const agentSession = $state({
  sessionId: null as string | null,
  status: "idle" as AgentSessionSummary["status"],
  /** 会话模式（setMode 成功或 mode-changed 帧到达时更新；无会话为 null）。 */
  mode: null as DshAgentMode | null,
  items: [] as PanelItem[],
  /** 最新帧 seq（轮询游标）。 */
  cursor: 0,
  sending: false,
  error: null as string | null,
  /** prompt 提交失败（独立于轮询错误：轮询成功不得清掉它，由下次成功提交清除）。 */
  promptError: null as string | null,
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
/**
 * 乐观 user 气泡的待回声队列（按会话失效）：发送时入队，同文本的 user-text 帧
 * 到达时出队并跳过（气泡已在视图）；prompt 失败或切换会话时清空对应项。
 */
let pendingUserEcho: string[] = [];

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

/** 会话列表在 WS 未就绪时的有界重试计数（打开面板早于连接完成的一次性竞态）。 */
let sessionListConnectRetries = 0;

/** 加载会话列表；结果交给调用方持有。 */
export async function loadAgentSessions(): Promise<void> {
  // 面板可能在 WS 握手完成前打开：requireRpc 会一次性失败且无人重试，表现为
  // daemon 重启后列表永远为空——未连接时短间隔有界重试。
  if (getRpc() === null) {
    if (sessionListConnectRetries >= 25) return;
    sessionListConnectRetries += 1;
    setTimeout(() => void loadAgentSessions(), 300);
    return;
  }
  sessionListConnectRetries = 0;
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
export async function createAgentSession(prompt?: string, mode?: DshAgentMode): Promise<void> {
  const request = createGate.issue();
  agentSession.sending = true;
  try {
    const result = await requireRpc().agent.session.create({
      ...(prompt ? { prompt } : {}),
      ...(mode ? { mode } : {}),
    });
    if (!request.isCurrent()) return;
    resetSessionView(result.session.sessionId, result.session.status, result.session.mode);
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

/**
 * 首屏快速行动：打开面板并以指定模式建会话；seedPrompt 在会话就绪后一次性
 * 填入 composer（不自动发送——用户保有最后一步）。
 */
export function startAgentAction(mode: DshAgentMode, seedPrompt?: string): void {
  agentPanel.open = true;
  agentPanel.seedPrompt = seedPrompt ?? null;
  void createAgentSession(undefined, mode);
}

/** 切换会话（重置视图并立即拉一轮）。 */
export function selectAgentSession(sessionId: string): void {
  if (agentSession.sessionId === sessionId) return;
  const summary = agentSessionsList.sessions.find((item) => item.sessionId === sessionId);
  resetSessionView(sessionId, "idle", summary?.mode ?? "free");
  void pollAgentStream();
}

function resetSessionView(
  sessionId: string,
  status: AgentSessionSummary["status"],
  mode: DshAgentMode,
): void {
  agentSession.sessionId = sessionId;
  agentSession.status = status;
  agentSession.mode = mode;
  agentSession.items = [];
  agentSession.cursor = 0;
  agentSession.error = null;
  pendingUserEcho = [];
}

/**
 * 切换当前会话模式（add-agent-settings-modes）：成功后本投影更新 + 会话列表
 * 刷新 + 立即拉帧（mode-changed 分隔行）；running 拒绝以错误面显示。
 */
export async function setAgentSessionMode(mode: DshAgentMode): Promise<boolean> {
  const sessionId = agentSession.sessionId;
  if (!sessionId || agentSession.mode === mode) return false;
  if (agentSession.status === "running") {
    agentSession.error = "Switch modes after the current turn ends.";
    return false;
  }
  const request = setModeGate.issue();
  try {
    const result = await requireRpc().agent.session.setMode({ sessionId, mode });
    if (!request.isCurrent()) return false;
    if (agentSession.sessionId !== sessionId) return false;
    agentSession.mode = result.session.mode;
    agentSession.status = result.session.status;
    agentSession.error = null;
    agentSessionsList.loaded = false;
    void loadAgentSessions();
    void pollAgentStream();
    return true;
  } catch (error) {
    if (!request.isCurrent()) return false;
    agentSession.error = error instanceof Error ? error.message : String(error);
    return false;
  }
}

/** 发送一轮用户输入。 */
export async function sendAgentPrompt(text: string): Promise<void> {
  const sessionId = agentSession.sessionId;
  if (!sessionId || text.trim().length === 0) return;
  const request = promptGate.issue();
  agentSession.sending = true;
  // 乐观追加用户消息（失败时由错误状态覆盖）；同文本 user-text 帧到达时出队去重。
  agentSession.items.push({ kind: "user", seq: -Date.now(), text });
  pendingUserEcho.push(text);
  try {
    await requireRpc().agent.session.prompt({ sessionId, text });
    if (!request.isCurrent()) return;
    agentSession.promptError = null;
  } catch (error) {
    if (!request.isCurrent()) return;
    agentSession.promptError = error instanceof Error ? error.message : String(error);
    // 该气泡不会有对应帧到达，出队避免吞掉后续同文本帧。
    const echoIndex = pendingUserEcho.indexOf(text);
    if (echoIndex >= 0) pendingUserEcho.splice(echoIndex, 1);
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
    // running 态用短间隔承接流式增量（assistant-delta 120ms 合并帧）；纯待答
    // 审批轮询保持 1.2s。
    const interval = agentSession.status === "running" ? 450 : 1200;
    pollTimer = setTimeout(() => {
      void pollAgentStream();
    }, interval);
  }
}

function stopPolling(): void {
  if (pollTimer !== null) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  pollSession = null;
}

/**
 * 终帧（assistant-text / assistant-reasoning）落位：回溯到本轮 turn 边界内的
 * 同类项做整段替换。不能只看末项——真实帧序是 reasoning 增量 → 正文增量 →
 * reasoning 终帧 → 正文终帧，reasoning 终帧到达时末项已是正文气泡（只看末项
 * 曾导致双重渲染，2026-09-09 用户实测抓到）。边界内找不到同类项（无增量的
 * 回放路径）则追加；找到已终态的同类项（重复终帧）幂等跳过。
 */
function finalizeStreamingItem(kind: "assistant" | "reasoning", seq: number, text: string): void {
  for (let i = agentSession.items.length - 1; i >= 0; i--) {
    const item = agentSession.items[i];
    if (item.kind === "turn") break; // 跨轮边界：本轮没有同类项，走追加。
    if (item.kind === kind) {
      if (item.streaming) {
        item.text = text;
        item.streaming = false;
      }
      return; // 已终态（重复终帧）：幂等跳过，不追加。
    }
  }
  agentSession.items.push({ kind, seq, text, streaming: false });
}

/** 帧到视图项的追加（未知帧丢弃）。user-text 与乐观气泡按文本回声去重。 */
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
    case "user-text": {
      // 直播路径：乐观气泡已展示同文本，帧只做出队确认；切换/重连路径（气泡已
      // 重置）队列必空，帧即唯一来源。
      if (typeof frame.text === "string" && frame.text.length > 0) {
        const echoIndex = pendingUserEcho.indexOf(frame.text);
        if (echoIndex >= 0) {
          pendingUserEcho.splice(echoIndex, 1);
          break;
        }
        agentSession.items.push({ kind: "user", seq: frame.seq, text: frame.text });
      }
      break;
    }
    case "assistant-delta": {
      // 流式增量：末项是流式 assistant 气泡则累进，否则开新气泡。
      // 回放路径（重连/切会话）同样成立——终帧 assistant-text 负责整段替换。
      if (typeof frame.text === "string" && frame.text.length > 0) {
        const last = agentSession.items[agentSession.items.length - 1];
        if (last?.kind === "assistant" && last.streaming) {
          last.text += frame.text;
        } else {
          agentSession.items.push({
            kind: "assistant",
            seq: frame.seq,
            text: frame.text,
            streaming: true,
          });
        }
      }
      break;
    }
    case "assistant-reasoning-delta": {
      // thinking 流：与正文增量同构，但累进到 reasoning 项（终帧整段替换）。
      if (typeof frame.text === "string" && frame.text.length > 0) {
        const last = agentSession.items[agentSession.items.length - 1];
        if (last?.kind === "reasoning" && last.streaming) {
          last.text += frame.text;
        } else {
          agentSession.items.push({
            kind: "reasoning",
            seq: frame.seq,
            text: frame.text,
            streaming: true,
          });
        }
      }
      break;
    }
    case "assistant-reasoning": {
      if (typeof frame.text === "string" && frame.text.length > 0) {
        finalizeStreamingItem("reasoning", frame.seq, frame.text);
      }
      break;
    }
    case "session-title": {
      // 内核自动命名：即时更新会话列表标题（不进对话流；持久回放走转录 meta）。
      const title = typeof frame.text === "string" ? frame.text.trim() : "";
      if (title.length > 0) {
        for (const session of agentSessionsList.sessions) {
          if (session.sessionId === frame.sessionId) session.title = title;
        }
      }
      break;
    }
    case "assistant-text": {
      if (typeof frame.text === "string" && frame.text.length > 0) {
        finalizeStreamingItem("assistant", frame.seq, frame.text);
      }
      break;
    }
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
      const reason =
        typeof frame.text === "string" && frame.text.length > 0 ? frame.text : "completed";
      agentSession.items.push({ kind: "turn", seq: frame.seq, label: `Turn end (${reason})` });
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
    case "mode-changed": {
      const payload = frame.payload as { from?: unknown; to?: unknown } | undefined;
      const from = (typeof payload?.from === "string" ? payload.from : "free") as DshAgentMode;
      const to = (typeof payload?.to === "string" ? payload.to : "free") as DshAgentMode;
      agentSession.items.push({ kind: "mode", seq: frame.seq, from, to });
      agentSession.mode = to;
      break;
    }
  }
  const cap = 500;
  if (agentSession.items.length > cap) {
    agentSession.items.splice(0, agentSession.items.length - cap);
  }
}

/** 加载配置投影（model/preset/permission/defaultMode + 凭据状态）。 */
export async function loadAgentSettings(): Promise<{
  view: DshStewardSettingsView | null;
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

/**
 * 写入 provider 凭据（只写面；结果视图更新 agentRuntimeConfig，值永不回流）。
 * 类型化 rejected 原样返回给调用方投影。
 */
export async function setAgentCredential(
  provider: string,
  apiKey: string,
): Promise<{ outcome: "stored" } | { outcome: "rejected"; code: string; detail: string } | null> {
  const request = credentialGate.issue();
  agentRuntimeConfig.updating = true;
  try {
    const result = await requireRpc().agent.credentials.set({ provider, apiKey });
    if (!request.isCurrent()) return null;
    if (result.outcome === "stored") agentRuntimeConfig.view = result.view;
    return result;
  } catch (error) {
    if (!request.isCurrent()) return null;
    return {
      outcome: "rejected",
      code: "NETWORK",
      detail: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (request.isCurrent()) agentRuntimeConfig.updating = false;
  }
}

/** 清除 provider 凭据（结果视图含最新凭据状态）。 */
export async function clearAgentCredential(provider: string): Promise<void> {
  const request = credentialGate.issue();
  agentRuntimeConfig.updating = true;
  try {
    const view = await requireRpc().agent.credentials.clear({ provider });
    if (!request.isCurrent()) return;
    agentRuntimeConfig.view = view;
  } catch (error) {
    if (!request.isCurrent()) return;
    agentRuntimeConfig.error = error instanceof Error ? error.message : String(error);
  } finally {
    if (request.isCurrent()) agentRuntimeConfig.updating = false;
  }
}
