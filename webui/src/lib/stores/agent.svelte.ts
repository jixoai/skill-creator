/**
 * Agent 面板 store（dsh-kernel-rebase task 3.x）。
 *
 * 用户原始需求 [2026-09-08]：「我们可以简单理解成，我们在 skill creator 的右侧
 * 嵌入了一个聊天对话框。」——shell 级右栏 drawer 的会话/帧/审批/配置投影；
 * 跨 tab 存活（module-level 状态），断线可见与恢复。
 *
 * 正交意图：
 *   [1] 面板状态：open/当前会话/帧视图累积（latest-request-wins 代次门 +
 *       连接 owner generation；失效响应投影为无结果）。帧视图按
 *       redesign-model-tabs-and-agent-panel §3.5 投影：tool call+result 合并
 *       单行（toolCallId 关联 + 同名回退）、turn-end 药丸（pendingUsage 合入）、
 *       tool-args-delta 渐进参数、todos 出列 TodoDock、user-text 附件回显。
 *       2026-09-12 codex R2 阻塞 4：todo-snapshot / approval-request /
 *       mode-changed 帧 payload 经模块级 Zod schema safeParse 收窄，畸形帧
 *       静默丢弃并保留上一个投影状态。
 *   [2] 轮询生命周期：running 或有待答审批时 1.2s 轮询；idle 且无待答时停轮询
 *       （终态停轮询语义平移），prompt/answer/手动刷新重启。
 *   [3] 配置投影：model/preset/approval policy 的 load/patch（agent.settings.*）。
 *   [4] New Session 态（R12-B 6/8）：pendingMode 是空态模式卡与 composer 模式
 *       chip 的唯一数据源（默认 free/General）；会话创建是惰性的——只发生在
 *       首条消息发出时（sendAgentPrompt 无会话先建），header 的 + 只回到空态。
 * 修订 [2026-09-13]（R17-A）：composer 草稿按 sessionId 分轨，本模块是草稿生命
 *       周期的挂接点——beginNewAgentSession 清 "__new__" 桶、resetSessionView
 *       换轨、sendAgentPrompt 惰性建会话迁移在途草稿并在发送成功后清发送轨
 *       （分轨真相见 agent-composer.svelte）。
 * 妥协声明：面板不是 MCP client——会话经 agent.* RPC 消费内核（design D2）；
 * 无 callId 的 tool-result 回退匹配在并行同名工具时可能错位（design §7）。
 */
import { z } from "zod";
import {
  AgentApprovalQuestionSchema,
  type AgentSessionsCleanupInput,
  type AgentSessionsCleanupResult,
  type AgentSessionSummary,
} from "$shared/contracts/agent.js";
import {
  DshAgentModeSchema,
  DshUserTextAttachmentSchema,
  type DshAgentMode,
  type DshSettingsUpdate,
  type DshRouteConnectionTestInput,
  type DshRouteConnectionTestResult,
  type DshSessionStreamFrame,
  type DshStewardSettingsView,
} from "$shared/contracts/dsh-runtime.js";
import { getConnectionGeneration, getRpc, requireRpc } from "./connection.svelte";
import {
  NEW_SESSION_COMPOSER_TRACK,
  agentComposer,
  migrateComposerDraft,
  resetComposerTrack,
  switchComposerTrack,
} from "./agent-composer.svelte";
import { createRequestGenerationGate } from "./request-generation.js";
import { showToast } from "$lib/toast.svelte";

/** 待答审批的视图投影（approval-request 帧的 questions 载荷）。 */
export interface PanelApprovalQuestion {
  id: string;
  question: string;
  detail?: string;
  header?: string;
  multiSelect?: boolean;
  options?: Array<{ label: string; description?: string }>;
}

/**
 * 面板视图项（帧流的结构化分组投影；redesign-model-tabs-and-agent-panel §3.5）。
 * tool 行 = call+result 合并单行（callId 关联，缺省回退同 turn 同名最近未闭合项）；
 * turn-end 独立项承载 usage/elapsed 药丸；todos 出列到 agentSession.todos。
 */
export type PanelItem =
  | { kind: "turn"; seq: number; label?: string }
  | {
      /** 轮次收尾药丸行（usage ↑/↓ + elapsed；替换旧「Turn end (reason)」假分隔行）。 */
      kind: "turn-end";
      seq: number;
      reason: string;
      usage?: { inputTokens: number; outputTokens: number };
      elapsedMs?: number;
    }
  | { kind: "status"; seq: number; text: string }
  /** 居中注记行（auto-compact 等系统动作留痕；text 为人话说明）。 */
  | { kind: "note"; seq: number; text: string }
  | {
      kind: "user";
      seq: number;
      text: string;
      /** 图片预览（乐观路径 = 本地 dataURL；回放路径 = payload.attachments.thumb）。 */
      images?: string[];
      /** 文件/无缩略图片的名字 chip（乐观 = 上传名；回放 = attachments.name）。 */
      files?: string[];
      /** files 中属图片附件（无 thumb）的名字子集——chip 图标分型（IconImage；
       * PM 修复 3 的对称 chip 方案：live 有图、回放 chip，跨处视觉语言一致）。 */
      imageChipNames?: string[];
    }
  | { kind: "assistant"; seq: number; text: string; streaming: boolean }
  | { kind: "reasoning"; seq: number; text: string; streaming: boolean }
  | {
      /** 一次工具调用一行：argsText 渐进累积（tool-args-delta），result 回填收敛。 */
      kind: "tool";
      seq: number;
      toolCallId?: string;
      toolName: string;
      argsText?: string;
      result?: unknown;
      phase: "calling" | "done" | "error";
      startedAt: string;
      endedAt?: string;
    }
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
// 会话清理（R14-C）：成功后代次门失效旧响应并刷新列表；失效结果投影为 null。
const cleanupGate = createRequestGenerationGate(getConnectionGeneration);

/** 宽屏侧栏宽度语义（R17-C resize）：≥720px 可拖拽，320–720px，默认 440；
 * 持久键 sessionStorage（会话级，随 tab 存活，不在 daemon/文件系统落地）。 */
export const AGENT_PANEL_MIN_WIDTH = 320;
export const AGENT_PANEL_MAX_WIDTH = 720;
export const AGENT_PANEL_DEFAULT_WIDTH = 440;
const AGENT_PANEL_WIDTH_STORAGE_KEY = "skill-creator.agentPanelWidth.v1";

/** 宽度收窄：非有限数（持久值损坏/坐标派生 NaN）回默认，越界 clamp 到边界。 */
export function clampAgentPanelWidth(width: number): number {
  if (!Number.isFinite(width)) return AGENT_PANEL_DEFAULT_WIDTH;
  return Math.min(AGENT_PANEL_MAX_WIDTH, Math.max(AGENT_PANEL_MIN_WIDTH, Math.round(width)));
}

/** 恢复持久宽度（外部输入：不可读/损坏一律回默认，不迁移、不写回）。 */
function readStoredAgentPanelWidth(): number {
  try {
    const stored = sessionStorage.getItem(AGENT_PANEL_WIDTH_STORAGE_KEY);
    if (stored === null) return AGENT_PANEL_DEFAULT_WIDTH;
    return clampAgentPanelWidth(Number(stored));
  } catch {
    return AGENT_PANEL_DEFAULT_WIDTH;
  }
}

/** drawer 开合（跨 tab 存活，开关=收起不销毁）；seedPrompt 为首屏行动塞进
 * composer 的一次性种子；width 为 ≥720px 侧栏宽度（初始化自 sessionStorage）。 */
export const agentPanel = $state({
  open: false,
  seedPrompt: null as string | null,
  width: readStoredAgentPanelWidth(),
});

/** 当前会话与帧视图（跨 tab 存活；切会话清空重载）。 */
export const agentSession = $state({
  sessionId: null as string | null,
  status: "idle" as AgentSessionSummary["status"],
  /** 会话模式（setMode 成功或 mode-changed 帧到达时更新；无会话为 null）。 */
  mode: null as DshAgentMode | null,
  /**
   * 待建会话模式（R12-B 6）：New Session 态的唯一数据源——空态模式卡与
   * composer 模式 chip 双向同步，默认 free（General）；首条消息惰性建会话时
   * 消费（sendAgentPrompt）。会话建立后显示态切换为 agentSession.mode。
   */
  pendingMode: "free" as DshAgentMode,
  items: [] as PanelItem[],
  /** Todo 快照（latest-wins；TodoDock 消费，不再进 items）。 */
  todos: [] as Array<{ content: string; status: string }>,
  /** 当前轮起始时间戳（turn-start 帧驱动 Working 计时与 turn-end elapsed）。 */
  turnStartedAt: null as string | null,
  /** 最新帧 seq（轮询游标）。 */
  cursor: 0,
  sending: false,
  error: null as string | null,
  /** prompt 提交失败（独立于轮询错误：轮询成功不得清掉它，由下次成功提交清除）。 */
  promptError: null as string | null,
  /** 最近一次模型回合的 token 用量（assistant-text payload.usage 投影）。 */
  lastUsage: null as { inputTokens: number; outputTokens: number } | null,
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
/**
 * assistant-text 终帧 usage 的暂存：turn-end 到达时合入 turn-end 药丸行
 * （§3.5；终帧先于 turn-end 落序，且轮询可能分批）。
 */
let pendingUsage: { inputTokens: number; outputTokens: number } | null = null;
/**
 * tool-args-delta 的先到缓冲（callId 键）：参数分片先于终帧 tool-call 落序，
 * 终帧以完整参数收敛（payload 缺失时以缓冲拼接兜底）；切会话/新轮清空。
 */
let pendingToolArgs = new Map<string, { name?: string; text: string }>();

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

/** 拖拽改宽（R17-C）：clamp 后写状态并持久；存储不可用只丢持久化，不阻塞拖拽。 */
export function setAgentPanelWidth(width: number): void {
  agentPanel.width = clampAgentPanelWidth(width);
  try {
    sessionStorage.setItem(AGENT_PANEL_WIDTH_STORAGE_KEY, String(agentPanel.width));
  } catch {
    // 隐私上下文等存储异常：本次会话内宽度仍生效。
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

/**
 * 清理面板会话（R14-C，Settings → Sessions 消费）：beforeDays / all / 显式
 * sessionIds 三种范围；成功后标记列表失效并重拉。失效响应投影为 null；失败
 * 以 { error } 返回（调用方自行呈现）。
 */
export async function cleanupAgentSessions(
  input: AgentSessionsCleanupInput,
): Promise<AgentSessionsCleanupResult | { error: string } | null> {
  const request = cleanupGate.issue();
  try {
    const result = await requireRpc().agent.sessions.cleanup(input);
    if (!request.isCurrent()) return null;
    // R15 codex P1-4：当前会话被删 → 回 New Session 空态（不得向已删 ID 发
    // prompt 或 resume 不存在的转录）。deletedIds 截断时以刷新后的列表复核。
    if (result.kind === "summary" && agentSession.sessionId !== null) {
      const currentId = agentSession.sessionId;
      if ((result.deletedIds ?? []).includes(currentId)) {
        beginNewAgentSession();
      } else if (result.deletedIdsTruncated === true) {
        await loadAgentSessions();
        if (
          request.isCurrent() &&
          !agentSessionsList.sessions.some(
            // hasTranscript:false = 转录已删、仅内核投影回填——对该 id 发 prompt
            // 必命中墓碑/NOT_FOUND，视同已删（codex R15 追加 P1-5）。
            (item) => item.sessionId === currentId && item.hasTranscript !== false,
          )
        ) {
          beginNewAgentSession();
        }
      }
    }
    agentSessionsList.loaded = false;
    void loadAgentSessions();
    return result;
  } catch (error) {
    if (!request.isCurrent()) return null;
    return { error: error instanceof Error ? error.message : String(error) };
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
 * 首屏快速行动：打开面板进入 New Session 态并预选模式；seedPrompt 在面板就绪
 * 后一次性填入 composer（不自动发送——会话由首条消息惰性创建，用户保有最后
 * 一步）。
 */
export function startAgentAction(mode: DshAgentMode, seedPrompt?: string): void {
  beginNewAgentSession();
  agentPanel.open = true;
  agentPanel.seedPrompt = seedPrompt ?? null;
  agentSession.pendingMode = mode;
}

/**
 * 进入 New Session 空态（R12-B 8）：退出当前会话视图（内核会话与列表不动），
 * 不创建任何会话——创建只发生在首条消息发出时（sendAgentPrompt 惰性建会话）。
 * pendingMode 复位 free：空态默认选中 General。
 */
export function beginNewAgentSession(): void {
  stopPolling();
  agentSession.sessionId = null;
  agentSession.status = "idle";
  agentSession.mode = null;
  agentSession.pendingMode = "free";
  agentSession.items = [];
  agentSession.todos = [];
  agentSession.turnStartedAt = null;
  agentSession.cursor = 0;
  agentSession.error = null;
  agentSession.promptError = null;
  agentSession.lastUsage = null;
  pendingUserEcho = [];
  pendingUsage = null;
  pendingToolArgs = new Map();
  // R17-A：草稿分轨——显式新建清空 "__new__" 共享桶（换轨先暂存上一会话轨，
  // 其草稿不受影响）。这是清轨收窄后的两个调用点之一。
  switchComposerTrack(NEW_SESSION_COMPOSER_TRACK);
  resetComposerTrack(NEW_SESSION_COMPOSER_TRACK);
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
  agentSession.todos = [];
  agentSession.turnStartedAt = null;
  agentSession.cursor = 0;
  agentSession.error = null;
  agentSession.lastUsage = null;
  pendingUserEcho = [];
  pendingUsage = null;
  pendingToolArgs = new Map();
  // R17-A：sessionId 变化即换轨到该会话的草稿（selectAgentSession 与惰性 create
  // 两个向量共用本入口；双向暂存，切换不丢任何一轨）。
  switchComposerTrack(sessionId);
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

/**
 * 发送一轮用户输入（可选附件双通道，R17-B）：本地 File 通道（mediaType+data
 * base64 wire）或后端真实路径通道（path——daemon 读盘 + magic 嗅探，浏览器不经
 * 手原始字节）；daemon 经内核 attachment 准入。New Session 态的首条消息先以待建
 * 模式（pendingMode）惰性建会话——这是空态下唯一的会话创建向量（R12-B 8：
 * 模式卡/chip 只改选择，不 eager 建会话）。
 */
export async function sendAgentPrompt(
  text: string,
  images: Array<{
    mediaType?: string;
    data?: string;
    path?: string;
    name?: string;
    preview?: string;
  }> = [],
  files: Array<{ name?: string; data?: string; path?: string }> = [],
): Promise<void> {
  if (text.trim().length === 0 && images.length === 0 && files.length === 0) {
    return;
  }
  if (!agentSession.sessionId) {
    await createAgentSession(undefined, agentSession.pendingMode);
    // 创建失败（含被代次门取代）：sessionId 仍为 null，错误已进 error 面。
    if (!agentSession.sessionId) return;
    // R17-A：惰性建会话换轨后，把 "__new__" 桶的在途草稿迁到新会话轨——草稿在
    // 发送期间继续可见；成功清该轨，失败留在当前会话轨可重试。
    migrateComposerDraft(NEW_SESSION_COMPOSER_TRACK, agentSession.sessionId);
  }
  const sessionId = agentSession.sessionId;
  const request = promptGate.issue();
  agentSession.sending = true;
  // 乐观追加用户消息（失败时由错误状态覆盖）；同文本 user-text 帧到达时出队去重。
  // path 通道图片有缩略用缩略，无缩略（webp/gif）以名字进 files chip（回显语义
  // 与转录 attachmentsOf 的 image/file 块投影一致）。
  const thumblessImageNames = images
    .filter((image) => image.preview === undefined)
    .map((image) => image.name ?? "image");
  agentSession.items.push({
    kind: "user",
    seq: -Date.now(),
    text,
    ...(images.some((image) => image.preview !== undefined)
      ? {
          images: images.flatMap((image) => (image.preview !== undefined ? [image.preview] : [])),
        }
      : {}),
    ...(files.length > 0 || thumblessImageNames.length > 0
      ? { files: [...files.map((file) => file.name ?? "file"), ...thumblessImageNames] }
      : {}),
  });
  pendingUserEcho.push(text);
  try {
    await requireRpc().agent.session.prompt({
      sessionId,
      text,
      images: images.map((image) => {
        // R17-B 双通道分流：path 通道 daemon 读盘（mediaType 由 magic 字节嗅探）。
        if (image.path !== undefined) {
          return { path: image.path, ...(image.name ? { name: image.name } : {}) };
        }
        if (image.mediaType === undefined || image.data === undefined) {
          throw new Error("image attachment needs either path or mediaType+data");
        }
        return {
          mediaType: image.mediaType as "image/png" | "image/jpeg" | "image/webp" | "image/gif",
          data: image.data,
          ...(image.name ? { name: image.name } : {}),
        };
      }),
      files: files.map((file) => {
        if (file.path !== undefined) {
          return { path: file.path };
        }
        if (file.name === undefined || file.data === undefined) {
          throw new Error("file attachment needs either path or name+data");
        }
        return { name: file.name, data: file.data };
      }),
    });
    if (!request.isCurrent()) return;
    agentSession.promptError = null;
    // R17-A：发送成功清发送轨（清轨收窄后的第二个调用点；提交点不清草稿——
    // 失败留在原轨可重试）。发送中途切走的会话轨照常按发送目标清理。
    resetComposerTrack(sessionId);
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

/** assistant-text 终帧 payload.usage 的白名单提取（provider 别名归一）。 */
function usageOfPayload(payload: unknown): { inputTokens: number; outputTokens: number } | null {
  const usage = (
    payload as
      | {
          usage?: {
            inputTokens?: number;
            outputTokens?: number;
            promptTokens?: number;
            completionTokens?: number;
            input_tokens?: number;
            output_tokens?: number;
          };
        }
      | undefined
  )?.usage;
  if (!usage) return null;
  const input = usage.inputTokens ?? usage.promptTokens ?? usage.input_tokens ?? 0;
  const output = usage.outputTokens ?? usage.completionTokens ?? usage.output_tokens ?? 0;
  return input > 0 || output > 0 ? { inputTokens: input, outputTokens: output } : null;
}

/**
 * 本轮内未闭合的工具行匹配（§3.5 + §7 妥协）：优先 toolCallId 精确关联；缺省时
 * 回退同 toolName 最近一个无 result 的项（并行同名工具可能错位——已知妥协，
 * callId 落地后消除）。跨过 turn 边界即停（匹配只在当前轮内）。
 */
function openToolInTurn(
  toolCallId: string | undefined,
  toolName: string,
): Extract<PanelItem, { kind: "tool" }> | null {
  for (let i = agentSession.items.length - 1; i >= 0; i--) {
    const item = agentSession.items[i];
    if (item.kind === "turn") return null;
    if (item.kind !== "tool" || item.result !== undefined) continue;
    if (toolCallId !== undefined) {
      if (item.toolCallId === toolCallId) return item;
      continue;
    }
    if (item.toolName === toolName) return item;
  }
  return null;
}

/** tool-result 错误信号面：isError 字面量 true，或非空 error 字符串/对象（空串不算错）。 */
const ToolErrorSignalSchema = z
  .object({
    isError: z.literal(true).optional(),
    error: z.union([z.string().min(1), z.object()]).optional(),
  })
  .passthrough();

/** tool-result 的错误判定（外部帧 payload 经 safeParse，无 cast）。 */
function isToolErrorResult(result: unknown): boolean {
  const checked = ToolErrorSignalSchema.safeParse(result);
  if (!checked.success) return false;
  return checked.data.isError === true || checked.data.error !== undefined;
}

/** user-text 帧附件信封（外部 payload 无 cast 收窄）。 */
const UserTextAttachmentsEnvelopeSchema = z
  .object({ attachments: z.array(z.unknown()).optional() })
  .passthrough();

/** user-text 帧 payload.attachments 的 safeParse 投影（外部输入 runtime 收窄）。
 * 无 thumb 的图片附件名字照常进 files（既有回显事实），同时记入 imageChipNames
 * 供 UI 以 IconImage 渲染 image-typed chip。 */
function attachmentsFromPayload(payload: unknown): {
  images: string[];
  files: string[];
  imageChipNames: string[];
} | null {
  const checked = UserTextAttachmentsEnvelopeSchema.safeParse(payload);
  const raw = checked.success ? checked.data.attachments : undefined;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const images: string[] = [];
  const files: string[] = [];
  const imageChipNames: string[] = [];
  for (const entry of raw) {
    const parsed = DshUserTextAttachmentSchema.safeParse(entry);
    if (!parsed.success) continue;
    if (parsed.data.kind === "image" && parsed.data.thumb !== undefined) {
      images.push(parsed.data.thumb);
    } else {
      const name = parsed.data.name ?? (parsed.data.kind === "image" ? "image" : "file");
      files.push(name);
      if (parsed.data.kind === "image") imageChipNames.push(name);
    }
  }
  return images.length > 0 || files.length > 0 ? { images, files, imageChipNames } : null;
}

/*
 * 帧 payload 消费 schema（2026-09-12 codex R2 阻塞 4）：服务端帧是跨进程外部
 * 输入，todo/approval/mode 三面写入 agentSession 前统一 safeParse 收窄。模块级
 * 常量（热路径不随帧重建）；失败静默丢弃该帧（WebUI 侧不打 console 噪音），
 * 保留上一个投影状态。形状对齐 $shared/contracts（dsh-runtime / agent）既有类型，
 * 不在 WebUI 维护第二份手写镜像。
 */
const TodoSnapshotPayloadSchema = z.object({
  todos: z.array(z.unknown()),
});
/** todo 条目（TodoDock 消费面）：content/status 字符串；畸形条目逐条丢弃。 */
const TodoEntrySchema = z.object({ content: z.string(), status: z.string() });
/** approval-request：questions 是 requestSeq 键的原子请求单元，整面收窄。 */
const ApprovalRequestPayloadSchema = z.object({
  questions: z.array(AgentApprovalQuestionSchema),
});
/** mode-changed：from/to 必须命中闭合 mode 枚举（任意字符串不得污染 mode 状态）。 */
const ModeChangedPayloadSchema = z.object({
  from: DshAgentModeSchema,
  to: DshAgentModeSchema,
});

/** todo-snapshot payload → 全量快照数组（条目级收窄，extra 键剥除）；畸形 payload → null（丢帧）。 */
function todosFromSnapshotPayload(
  payload: unknown,
): Array<{ content: string; status: string }> | null {
  const checked = TodoSnapshotPayloadSchema.safeParse(payload);
  if (!checked.success) return null;
  const todos: Array<{ content: string; status: string }> = [];
  for (const entry of checked.data.todos) {
    const parsed = TodoEntrySchema.safeParse(entry);
    if (parsed.success) todos.push(parsed.data);
  }
  return todos;
}

/** 帧到视图项的追加（未知帧丢弃）。user-text 与乐观气泡按文本回声去重。 */
function appendFrame(frame: DshSessionStreamFrame): void {
  switch (frame.kind) {
    case "turn-start":
      agentSession.turnStartedAt = frame.at;
      pendingToolArgs = new Map();
      agentSession.items.push({ kind: "turn", seq: frame.seq, label: "Turn" });
      break;
    case "status":
      agentSession.items.push({
        kind: "status",
        seq: frame.seq,
        text: JSON.stringify(frame.payload ?? {}),
      });
      break;
    case "auto-compact":
      // codex R7 B1：自动压缩留痕（daemon 在阈值触发时先落此帧再执行 /compact）。
      if (typeof frame.text === "string" && frame.text.length > 0) {
        agentSession.items.push({ kind: "note", seq: frame.seq, text: frame.text });
      }
      break;
    case "user-text": {
      // 直播路径：乐观气泡已展示同文本，帧只做出队确认；切换/重连路径（气泡已
      // 重置）队列必空，帧即唯一来源（attachments 元数据同时回填回显）。
      if (typeof frame.text === "string" && frame.text.length > 0) {
        const echoIndex = pendingUserEcho.indexOf(frame.text);
        if (echoIndex >= 0) {
          pendingUserEcho.splice(echoIndex, 1);
          break;
        }
        const attachments = attachmentsFromPayload(frame.payload);
        agentSession.items.push({
          kind: "user",
          seq: frame.seq,
          text: frame.text,
          ...(attachments && attachments.images.length > 0 ? { images: attachments.images } : {}),
          ...(attachments && attachments.files.length > 0 ? { files: attachments.files } : {}),
          ...(attachments && attachments.imageChipNames.length > 0
            ? { imageChipNames: attachments.imageChipNames }
            : {}),
        });
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
    case "todo-snapshot": {
      // 全量快照 latest-wins：出列到 agentSession.todos（TodoDock 消费）；
      // 畸形 payload（含缺失）丢弃该帧，保留上一个快照（codex R2 阻塞 4）。
      const todos = todosFromSnapshotPayload(frame.payload);
      if (todos !== null) agentSession.todos = todos;
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
        // usage 快照：终帧 payload.usage 暂存 pendingUsage（turn-end 药丸合入）
        // + lastUsage（composer ContextMeter 消费）。
        const usage = usageOfPayload(frame.payload);
        if (usage) {
          agentSession.lastUsage = usage;
          pendingUsage = usage;
        }
      }
      break;
    }
    case "tool-args-delta": {
      // 参数流分片：行已开（终帧前重复到达）则渐进追加；否则按 callId 暂存，
      // 终帧 tool-call 以完整参数收敛。
      if (typeof frame.text === "string" && frame.text.length > 0 && frame.toolCallId) {
        const open = openToolInTurn(frame.toolCallId, frame.toolName ?? "");
        if (open && open.toolCallId === frame.toolCallId && open.phase === "calling") {
          open.argsText = (open.argsText ?? "") + frame.text;
        } else if (!open) {
          const buffered = pendingToolArgs.get(frame.toolCallId);
          pendingToolArgs.set(frame.toolCallId, {
            ...(frame.toolName ? { name: frame.toolName } : {}),
            text: (buffered?.text ?? "") + frame.text,
          });
        }
      }
      break;
    }
    case "tool-call": {
      const toolName = frame.toolName ?? "tool";
      const callId = frame.toolCallId;
      // 幂等：重复 tool-call（回放竞态）不重建行。
      if (callId !== undefined && openToolInTurn(callId, toolName) !== null) break;
      const buffered = callId !== undefined ? pendingToolArgs.get(callId) : undefined;
      if (callId !== undefined) pendingToolArgs.delete(callId);
      // 完整参数优先（终帧收敛）；payload 空而缓冲有值时以缓冲拼接兜底。
      let argsText: string | undefined;
      if (frame.payload !== undefined && frame.payload !== null) {
        argsText =
          typeof frame.payload === "string" ? frame.payload : safeJsonStringify(frame.payload);
      }
      if ((argsText === undefined || argsText.length === 0) && buffered) {
        argsText = buffered.text;
      }
      agentSession.items.push({
        kind: "tool",
        seq: frame.seq,
        ...(callId !== undefined ? { toolCallId: callId } : {}),
        toolName,
        ...(argsText !== undefined && argsText.length > 0 ? { argsText } : {}),
        phase: "calling",
        startedAt: frame.at,
      });
      break;
    }
    case "tool-result": {
      const toolName = frame.toolName ?? "tool";
      const open = openToolInTurn(frame.toolCallId, toolName);
      if (open) {
        open.result = frame.payload;
        open.phase = isToolErrorResult(frame.payload) ? "error" : "done";
        open.endedAt = frame.at;
        break;
      }
      // 无可闭合行（结果先于 call 到达/跨轮残留）：防御性单行回放。
      agentSession.items.push({
        kind: "tool",
        seq: frame.seq,
        ...(frame.toolCallId !== undefined ? { toolCallId: frame.toolCallId } : {}),
        toolName,
        result: frame.payload,
        phase: isToolErrorResult(frame.payload) ? "error" : "done",
        startedAt: frame.at,
        endedAt: frame.at,
      });
      break;
    }
    case "turn-end": {
      const reason =
        typeof frame.text === "string" && frame.text.length > 0 ? frame.text : "completed";
      const usage = pendingUsage;
      pendingUsage = null;
      const startedAt = agentSession.turnStartedAt;
      const elapsed =
        startedAt !== null
          ? Number.isNaN(Date.parse(startedAt)) || Number.isNaN(Date.parse(frame.at))
            ? undefined
            : Math.max(0, Date.parse(frame.at) - Date.parse(startedAt))
          : undefined;
      agentSession.items.push({
        kind: "turn-end",
        seq: frame.seq,
        reason,
        ...(usage ? { usage } : {}),
        ...(elapsed !== undefined ? { elapsedMs: elapsed } : {}),
      });
      break;
    }
    case "approval-request": {
      // questions 整面 safeParse：畸形（含缺失 payload）丢弃该帧，不产生审批卡，
      // 也不把未收窄的问题对象写入 items（codex R2 阻塞 4）。
      const checked = ApprovalRequestPayloadSchema.safeParse(frame.payload);
      if (!checked.success) break;
      agentSession.items.push({
        kind: "approval",
        seq: frame.seq,
        questions: checked.data.questions,
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
      // from/to 必须命中闭合 mode 枚举：畸形（含任意字符串 mode）丢弃该帧，
      // agentSession.mode 与 items 均不被污染（codex R2 阻塞 4）。
      const checked = ModeChangedPayloadSchema.safeParse(frame.payload);
      if (!checked.success) break;
      agentSession.items.push({
        kind: "mode",
        seq: frame.seq,
        from: checked.data.from,
        to: checked.data.to,
      });
      agentSession.mode = checked.data.to;
      break;
    }
  }
  const cap = 500;
  if (agentSession.items.length > cap) {
    agentSession.items.splice(0, agentSession.items.length - cap);
  }
}

/** JSON 序列化兜底（循环引用等异常形状退化为 String()）。 */
function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? "";
  } catch {
    return String(value);
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
 * 写入 provider 凭据（R16 起视图回显 apiKey；结果更新 agentRuntimeConfig）。
 * 类型化 rejected 原样返回给调用方投影。
 */
/**
 * 原生文件选择（R18 + 2.0.1 修复）：daemon 子进程 sync 对话框。
 * null = 取消 / 无连接（静默——取消是用户意图）；RPC 失败已 toast（2.0.0 回归
 * 教训：失败静默会让按钮「点了没反应」无法与取消区分）。
 */
export async function pickAgentFiles(mode: "image" | "file"): Promise<{ paths: string[] } | null> {
  try {
    const rpc = getRpc();
    if (rpc === null) return null;
    return await rpc.agent.files.pickFiles({ mode });
  } catch (error) {
    showToast(`File picker failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/**
 * 附件缩略预览（R17-B daemon jSquash 管线；2026-09-15 修复重新接回——R18 换
 * 原生选择器时丢了回填，chip 永远落图标占位）。非图片/失败/无连接 → null。
 */
export async function previewAgentImage(path: string): Promise<string | null> {
  try {
    const rpc = getRpc();
    if (rpc === null) return null;
    const result = await rpc.agent.files.preview({ path });
    return result.kind === "image" ? result.dataUrl : null;
  } catch {
    return null;
  }
}

/**
 * 选中图片的缩略回填：preview RPC 到达即写回对应附件（chip 从图标占位升级为
 * 缩略图）；用户已移除或已另行设置 preview 的条目跳过——不复活、不覆盖。
 */
export async function hydratePickedImagePreviews(
  picks: Array<{ path: string; name: string }>,
): Promise<void> {
  await Promise.all(
    picks.map(async (pick) => {
      const dataUrl = await previewAgentImage(pick.path);
      if (dataUrl === null) return;
      const target = agentComposer.images.find(
        (image) =>
          image.path === pick.path && image.name === pick.name && image.preview === undefined,
      );
      if (target !== undefined) target.preview = dataUrl;
    }),
  );
}

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

/**
 * 路由连接测试（R7 8.7；ModelListItem 消费）：路由草案即可测的只读外呼探活。
 * apiKey 不进此输入面——daemon 侧按 provider 从已存凭据注入（key 已按 R16 回显）；
 * 未连接返回 null（调用方自行投影为不可用）。结果 typed，永不 throw。
 */
export async function testRouteConnection(
  input: DshRouteConnectionTestInput,
): Promise<DshRouteConnectionTestResult | null> {
  const rpc = getRpc();
  if (rpc === null) return null;
  try {
    return await rpc.agent.settings.testConnection(input);
  } catch (error) {
    return {
      outcome: "failed",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}
