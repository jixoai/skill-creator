/**
 * 人类终端 WS 客户端（skills-agent-page 1.6 前端；单例 store）。
 *
 * 用户原始需求 [2026-10-03]（design §4）：「前端：xterm.js（webui 依赖新增，懒
 * 加载 chunk）；多终端 tab；拖高分隔条」+ 可靠性语义冻结（seq 对账 / buffer
 * 缺口重放 / write reqId 高水位去重 / create resume 重连）。
 * 修订 [2026-10-04]（skills-agent-page-zcode-parity 2.1/2.3）：tab 所有权按
 * Workspace 分区 + ZCode 关闭/退出语义（最后一个 tab 关闭 = 收起面板保活
 * session；PTY exit = 同步删除 tab）+ 两段式 create（pane 先 fit 再带真实
 * cols/rows 建会话）+ resize 队列（id 未 ready 暂存，ack 后 flush）。
 *
 * 正交意图：
 *   [1] 连接生命周期：/ws/terminal 单端点（?token= web token 与 /ws/rpc 同法）；
 *       断线有界退避重连（有 tab 或面板在场时持续重试）；重连 = 逐 tab
 *       create{resume} + seq 对账（协议真相见 ./protocol.ts 镜像注记）。
 *   [2] seq 对账账本（per-session，非响应式）：lastSeq（已连续落放的最大 seq）
 *       + pending（乱序/回放块暂存 map）+ highestSeen；缺口触发 buffer 请求
 *       [lastSeq+1, ∞)（服务端 128 条/窗口有界回放，收敛式分窗）；gap 消息 =
 *       缓冲已裁剪 → 通知面清屏重拉（reset 事件 + lastSeq 对齐 availableFrom-1）。
 *   [3] write reqId 高水位：per-session 单调计数；server 回执 duplicate 仅确认
 *       （不重复落放——PTY stdin 收到的键序与首次发送一致由 server 保证）。
 *   [4] Workspace 分区 tab 所有权（ZCode Terminal.tsx:49-128 / terminalPanelState）：
 *       tabs 按 workspaceKey 分区，per-workspace sessionIds + activeSessionId；
 *       面板打开/切换 workspace 时懒确保该 workspace 有 session（不杀旧 workspace
 *       的 PTY）；关闭最后一个 tab = 收起面板并保活（close-panel）；PTY exit =
 *       删除 session，仅当前 workspace 的最后一个 tab 才连带关闭面板；活动 tab
 *       回退 = 被关 tab 的左侧邻居。
 *   [5] 两段式 create + resize 队列（ZCode TerminalSession.tsx:784-796/884-896）：
 *       draft tab 不立即发 create；pane 挂载 fit 出真实 cols/rows 后经
 *       attachTerminalPane 发 create{cols,rows}（避免启动输出按错误宽度重排）；
 *       id 未 ready 期间的 resize 暂存 pendingCreateSize，created ack 后 flush。
 * 妥协声明：（a）WS create 无关联 id，多个 creating draft 按 FIFO 换轨（ZCode 为
 *   per-session promise，无此歧义面）；（b）list 控制消息当前仅测试面（tab 真相
 *   在本地注册表 + resume 对账）；（c）created/list ack 不回传 shell（协议 r3/r4
 *   冻结），shellLabel 仅在调用方显式指定 shell 时可知，否则为 null（展示面隐藏）。
 */

import { readWebToken } from "$lib/rpc-client";
import { showErrorToast, showToast } from "$lib/toast.svelte";
import { t } from "$lib/i18n";
import {
  TerminalClientMessageSchema,
  TerminalServerMessageSchema,
  type TerminalClientMessage,
  type TerminalServerMessage,
} from "./protocol.js";
import {
  TERMINAL_DEFAULT_WORKSPACE_KEY,
  formatShellLabel,
  formatTerminalTabTitle,
  nextSessionIndex,
  terminalPathLeaf,
} from "./terminal-tabs.js";

/** daemon 全局并发活 PTY 上限（design §4 SHALL；客户端预判入口禁用）。 */
export const TERMINAL_MAX_LIVE = 4;

/** 服务端 gap 回放单响应窗口（分窗续拉依据；与协议常量同值）。 */
const BUFFER_WINDOW = 128;

/** 断线重连退避（ms）：1s → 2s → 4s → 封顶 8s。 */
const RECONNECT_BASE_DELAY = 1_000;
const RECONNECT_MAX_DELAY = 8_000;

/** 终端输出订阅事件（xterm pane 消费）。 */
export type TerminalOutputEvent =
  | { kind: "data"; data: string }
  | { kind: "reset" }
  | { kind: "exit"; exitCode: number };

type OutputListener = (event: TerminalOutputEvent) => void;

/** 面内可见的 tab 投影（workspace 分区所有；ZCode TerminalSessionDescriptor 同构）。 */
export interface TerminalTabView {
  /**
   * 稳定 UI key（draft 期生成，created ack 换轨后不变）。ZCode session.id 天生
   * 稳定（PTY id 另持）；本协议 sessionId 会被 ack 换轨重命名，pane 保活
   * （keyed each）必须以 uiKey 为键。
   */
  uiKey: string;
  sessionId: string;
  /** 所属 workspace 分区 key（ZCode Terminal.tsx:49 workspaceIdentity || cwd || default）。 */
  workspaceKey: string;
  /** create cwd（tab 标题的 projectName 派生源）。 */
  cwd: string | undefined;
  /** per-workspace 创建编号（最小空位；ZCode getNextTerminalSessionIndex）。 */
  index: number;
  /** 展示名（projectName / projectName N）。 */
  title: string;
  /** 实际 shell 展示 label（仅显式指定 shell 时可知；否则 null = 隐藏）。 */
  shellLabel: string | null;
  /** create ack 未达（新建中；断线重连期间为 false）。 */
  creating: boolean;
  alive: boolean;
  exitCode: number | null;
}

/** per-workspace tab 注册表（ZCode TerminalWorkspaceState 同构）。 */
export interface TerminalWorkspaceView {
  key: string;
  sessionIds: string[];
  activeSessionId: string | null;
}

/** per-session 对账账本（非响应式；UI 只看 tabs/workspaces 投影）。 */
interface SessionLedger {
  lastSeq: number;
  highestSeen: number;
  pending: Map<number, string>;
  reqCounter: number;
  bufferInFlight: boolean;
  listeners: Set<OutputListener>;
  /** create 参数（两段式：pane attach 补 cols/rows 后发 create）。 */
  createOptions: { cwd?: string; shell?: string; cols?: number; rows?: number } | null;
  /** pane 已挂载并上报过尺寸（重连补发 create 的准入）。 */
  paneAttached: boolean;
  /** create 帧已发出（测试/诊断面）。 */
  createSent: boolean;
  /** id 未 ready 期间暂存的 resize 终值（created ack 后 flush）。 */
  pendingCreateSize: { cols: number; rows: number } | null;
  /** 已发送的最近 resize 终值（同值去重）。 */
  lastSentSize: { cols: number; rows: number } | null;
  /**
   * 已落放输出的有界镜像（pane 重挂载/切 tab 回看面）：按落放顺序的 data 块；
   * reset（gap 清屏）时清空重建。字节上限有界（近似值，超限从头裁剪）。
   */
  mirror: string[];
  mirrorBytes: number;
}

/** 镜像字节上限（~1MiB：覆盖 pane 重挂载的即时回看，不对齐服务端 10k 行全景）。 */
const MIRROR_MAX_BYTES = 1 << 20;

export type TerminalConnectionStatus = "idle" | "connecting" | "open" | "closed";

export const terminalState = $state({
  status: "idle" as TerminalConnectionStatus,
  /** 全量 tab（所有 workspace；dock 按活动 workspace 过滤渲染）。 */
  tabs: [] as TerminalTabView[],
  /** workspace 分区注册表（顺序 = 首见顺序）。 */
  workspaces: [] as TerminalWorkspaceView[],
  /** 当前展示的 workspace 分区（dock 挂载/切换时设置）。 */
  activeWorkspaceKey: null as string | null,
  lastError: null as string | null,
  /** 非 sandbox 首开提示的确认态（sessionStorage——每次 WebUI 会话首开都提示）。 */
  noticeAcknowledged: readNoticeAck(),
});

const NOTICE_KEY = "skill-creator.terminalNoticeAck.v1";

function readNoticeAck(): boolean {
  try {
    return sessionStorage.getItem(NOTICE_KEY) === "1";
  } catch {
    return false;
  }
}

const ledgers = new Map<string, SessionLedger>();
let tabCounter = 0;
let socket: WebSocket | null = null;
let wanted = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
let connectToken = 0;
/** 测试注入的 socket 工厂（生产 = 原生 WebSocket）。 */
let socketFactory: ((url: string) => WebSocket) | null = null;
/** 面板关闭回调（dock 注册；close-panel 语义的唯一出口）。 */
let panelCloseHandler: (() => void) | null = null;

function ledgerOf(sessionId: string): SessionLedger {
  let ledger = ledgers.get(sessionId);
  if (ledger === undefined) {
    ledger = {
      lastSeq: 0,
      highestSeen: 0,
      pending: new Map(),
      reqCounter: 0,
      bufferInFlight: false,
      listeners: new Set(),
      createOptions: null,
      paneAttached: false,
      createSent: false,
      pendingCreateSize: null,
      lastSentSize: null,
      mirror: [],
      mirrorBytes: 0,
    };
    ledgers.set(sessionId, ledger);
  }
  return ledger;
}

/** /ws/terminal URL（同源推导；与 rpc-client 的 /ws/rpc 同法则，仅路径不同）。 */
function deriveTerminalWsUrl(token: string): string {
  if (typeof window === "undefined") return "";
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const port = window.location.port || (window.location.protocol === "https:" ? "443" : "80");
  return `${proto}//${window.location.hostname}:${port}/ws/terminal?token=${encodeURIComponent(token)}`;
}

/** WebSocket readyState 常量（规范字面量；无全局 WebSocket 的环境同样可用）。 */
const SOCKET_CONNECTING = 0;
const SOCKET_OPEN = 1;

function send(message: TerminalClientMessage): boolean {
  // 出站帧同样过镜像 schema（防御性：构造面错误在发送前暴露，不依赖服务端回执）。
  const checked = TerminalClientMessageSchema.safeParse(message);
  if (!checked.success) return false;
  if (socket === null || socket.readyState !== SOCKET_OPEN) return false;
  socket.send(JSON.stringify(checked.data));
  return true;
}

/** 面板/页面在场意向（dock 挂载 = true，卸载 = false）：无 tab 且不在场时停止重连。 */
export function setTerminalWanted(wants: boolean): void {
  wanted = wants;
  if (wants) {
    void connect();
  } else if (terminalState.tabs.length === 0) {
    cancelReconnect();
    closeSocket();
    terminalState.status = "idle";
  }
}

/** 建立连接（幂等）。 */
export async function connect(): Promise<void> {
  if (
    socket !== null &&
    (socket.readyState === SOCKET_OPEN || socket.readyState === SOCKET_CONNECTING)
  ) {
    return;
  }
  // 生产路径依赖原生 WebSocket；测试注入工厂时不要求全局存在。
  if (socketFactory === null && typeof WebSocket === "undefined") return;
  cancelReconnect();
  const token = connectToken + 1;
  connectToken = token;
  terminalState.status = "connecting";
  const url = deriveTerminalWsUrl(readWebToken());
  if (url === "") {
    terminalState.status = "idle";
    return;
  }
  const open = new Promise<void>((resolve, reject) => {
    const ws = socketFactory !== null ? socketFactory(url) : new WebSocket(url);
    socket = ws;
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error("terminal websocket error"));
    ws.onclose = () => {
      if (socket === ws) socket = null;
      reject(new Error("terminal websocket closed"));
      resolve();
    };
  });
  try {
    await open;
  } catch {
    if (token !== connectToken) return;
    scheduleReconnect();
    return;
  }
  if (token !== connectToken || socket === null) return;
  const ws = socket;
  ws.onopen = null;
  ws.onerror = null;
  ws.onclose = null;
  ws.onmessage = (event: MessageEvent) => {
    // 外部输入收窄：JSON → 镜像 schema safeParse；畸形帧静默丢弃（服务端是
    // 协议唯一实现方，防御性双保险）。
    let parsed: unknown;
    try {
      parsed = JSON.parse(typeof event.data === "string" ? event.data : String(event.data));
    } catch {
      return;
    }
    const checked = TerminalServerMessageSchema.safeParse(parsed);
    if (checked.success) dispatchServerMessage(checked.data);
  };
  ws.onclose = () => {
    if (socket === ws) socket = null;
    terminalState.status = "closed";
    scheduleReconnect();
  };
  ws.onerror = () => {
    /* close 会跟进；错误面经 onclose 路径统一 */
  };
  terminalState.status = "open";
  reconnectAttempts = 0;
  // 重连对账：已确立 tab 逐个 create{resume}（created ack 后按 replayFrom 补拉）；
  // creating tab 仅在 pane 已 attach 过时补发 create（未 attach 的由 pane 发起）。
  for (const tab of terminalState.tabs) {
    if (tab.creating) {
      const ledger = ledgers.get(tab.sessionId);
      if (ledger?.paneAttached) sendCreate(tab.sessionId);
    } else {
      send({ type: "create", resume: tab.sessionId });
    }
  }
}

/** 发送 create（两段式第二段：attach 已补尺寸；失败保序等重连）。 */
function sendCreate(sessionId: string): void {
  const ledger = ledgers.get(sessionId);
  if (ledger === undefined) return;
  const options = ledger.createOptions ?? {};
  const frame: TerminalClientMessage = {
    type: "create",
    ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
    ...(options.shell !== undefined ? { shell: options.shell } : {}),
    ...(options.cols !== undefined ? { cols: options.cols } : {}),
    ...(options.rows !== undefined ? { rows: options.rows } : {}),
  };
  if (send(frame)) ledger.createSent = true;
  else void connect();
}

function cancelReconnect(): void {
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function scheduleReconnect(): void {
  if (reconnectTimer !== null) return;
  if (!wanted && terminalState.tabs.length === 0) return;
  const delay = Math.min(RECONNECT_MAX_DELAY, RECONNECT_BASE_DELAY * 2 ** reconnectAttempts);
  reconnectAttempts = Math.min(reconnectAttempts + 1, 3);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void connect();
  }, delay);
}

function closeSocket(): void {
  if (socket !== null) {
    const ws = socket;
    socket = null;
    ws.onclose = null;
    ws.onerror = null;
    ws.onmessage = null;
    try {
      ws.close();
    } catch {
      /* 已在关闭态 */
    }
  }
}

/** 活 tab 计数（客户端侧 ≤4 预判依据）。 */
export function aliveTerminalCount(): number {
  return terminalState.tabs.filter((tab) => tab.alive).length;
}

function workspaceOf(key: string): TerminalWorkspaceView | undefined {
  return terminalState.workspaces.find((workspace) => workspace.key === key);
}

function ensureWorkspaceRecord(key: string): TerminalWorkspaceView {
  let workspace = workspaceOf(key);
  if (workspace === undefined) {
    workspace = { key, sessionIds: [], activeSessionId: null };
    terminalState.workspaces.push(workspace);
  }
  return workspace;
}

/** tab 展示名（ZCode Terminal.tsx:313-316：cwd leaf 或 "Terminal"，index 1 无后缀）。 */
function deriveTabTitle(cwd: string | undefined, index: number): string {
  const projectName = terminalPathLeaf(cwd ?? "") || t("terminal.tabTitle");
  return formatTerminalTabTitle(projectName, index);
}

/**
 * 设置活动 workspace 分区并懒确保其有 session（ZCode Terminal.tsx:67-82
 * ensureWorkspaceTerminalState：面板打开/切换 workspace 时创建首个 tab，不卸载
 * 其它 workspace 的 PTY）。LIMIT 预判失败时保持空分区（不重试循环）。
 */
export function setTerminalWorkspace(key: string, options?: { cwd?: string }): void {
  const workspaceKey = key.trim() === "" ? TERMINAL_DEFAULT_WORKSPACE_KEY : key;
  terminalState.activeWorkspaceKey = workspaceKey;
  const existing = workspaceOf(workspaceKey);
  const hasLiveSession =
    existing !== undefined &&
    existing.sessionIds.some((id) => terminalState.tabs.some((tab) => tab.sessionId === id));
  if (hasLiveSession) return;
  createTerminalTab({ ...(options?.cwd !== undefined ? { cwd: options.cwd } : {}) });
}

/**
 * 新建终端 tab（两段式第一段：draft 不发 create；pane attach 携真实尺寸发送）。
 * UI 入口；并发预判（含 creating pending 窗——两段式下 ack 前也要计入，防连点
 * 超发）+ 服务端 LIMIT_EXCEEDED 兜底。
 */
export function createTerminalTab(options?: { cwd?: string; shell?: string }): void {
  const pendingOrAlive = terminalState.tabs.filter((tab) => tab.alive || tab.creating).length;
  if (pendingOrAlive >= TERMINAL_MAX_LIVE) {
    terminalState.lastError = "LIMIT_EXCEEDED";
    showToast(t("terminal.limitReached"));
    return;
  }
  const workspaceKey = terminalState.activeWorkspaceKey ?? TERMINAL_DEFAULT_WORKSPACE_KEY;
  const workspace = ensureWorkspaceRecord(workspaceKey);
  tabCounter += 1;
  const draftId = `pending-${tabCounter}`;
  const usedIndices = workspace.sessionIds
    .map((id) => terminalState.tabs.find((tab) => tab.sessionId === id)?.index)
    .filter((index): index is number => typeof index === "number");
  const index = nextSessionIndex(usedIndices);
  const cwd = options?.cwd;
  const ledger = ledgerOf(draftId);
  ledger.createOptions = {
    ...(cwd !== undefined ? { cwd } : {}),
    ...(options?.shell !== undefined ? { shell: options.shell } : {}),
  };
  const tab: TerminalTabView = {
    uiKey: draftId,
    sessionId: draftId,
    workspaceKey,
    cwd,
    index,
    title: deriveTabTitle(cwd, index),
    shellLabel: formatShellLabel(options?.shell ?? null),
    creating: true,
    alive: false,
    exitCode: null,
  };
  terminalState.tabs.push(tab);
  workspace.sessionIds.push(draftId);
  workspace.activeSessionId = draftId;
  terminalState.activeWorkspaceKey = workspaceKey;
}

/**
 * pane 挂载就绪——两段式 create 第二段（ZCode TerminalSession.tsx:784-796
 * initial fit before create）：携带 fit 出的真实 cols/rows 发 create；无布局
 * （隐藏挂载）时省略尺寸（服务端默认，ZCode 80x24 同语义）。幂等：非
 * creating / 已 attach 的会话为 no-op。
 */
export function attachTerminalPane(sessionId: string, size?: { cols: number; rows: number }): void {
  const tab = terminalState.tabs.find((item) => item.sessionId === sessionId);
  if (tab === undefined || !tab.creating) return;
  const ledger = ledgerOf(sessionId);
  if (ledger.paneAttached) return;
  ledger.createOptions = {
    ...ledger.createOptions,
    ...(size !== undefined ? { cols: size.cols, rows: size.rows } : {}),
  };
  ledger.paneAttached = true;
  sendCreate(sessionId);
}

/** 注册面板关闭回调（close-panel 语义出口；dock 挂载期绑定，卸载解绑）。 */
export function bindTerminalPanelClose(handler: () => void): () => void {
  panelCloseHandler = handler;
  return () => {
    if (panelCloseHandler === handler) panelCloseHandler = null;
  };
}

function requestPanelClose(): boolean {
  if (panelCloseHandler === null) return false;
  panelCloseHandler();
  return true;
}

/**
 * 移除 session（ZCode terminalPanelState.ts:107-140 closeTerminalSession 语义）：
 * 活动 tab 回退 = 被关 tab 的左侧邻居（closingIndex-1）而非列表头；workspace
 * 清空时移除分区记录。
 */
function removeSession(sessionId: string): void {
  const index = terminalState.tabs.findIndex((tab) => tab.sessionId === sessionId);
  if (index < 0) return;
  const tab = terminalState.tabs[index]!;
  const workspace = workspaceOf(tab.workspaceKey);
  terminalState.tabs.splice(index, 1);
  ledgers.delete(sessionId);
  if (workspace !== undefined) {
    const closingIndex = workspace.sessionIds.indexOf(sessionId);
    const nextSessionIds = workspace.sessionIds.filter((id) => id !== sessionId);
    if (nextSessionIds.length === 0) {
      terminalState.workspaces = terminalState.workspaces.filter(
        (item) => item.key !== workspace.key,
      );
    } else {
      const fallbackSessionId = nextSessionIds[Math.max(0, closingIndex - 1)] ?? nextSessionIds[0]!;
      workspace.sessionIds = nextSessionIds;
      if (workspace.activeSessionId === sessionId) {
        workspace.activeSessionId = fallbackSessionId;
      }
    }
  }
  if (terminalState.tabs.length === 0 && !wanted) {
    cancelReconnect();
    closeSocket();
    terminalState.status = "idle";
  }
}

/**
 * 关闭 tab（ZCode Terminal.tsx:190-223 handleCloseSession）：
 * - 该 workspace 仅此一个 tab → close-panel：只收起面板并保活 session（不 exit）；
 * - 否则 → close-session：exit + 移除（活动回退左邻）。
 * 无面板宿主时（独立调用/测试）close-panel 退化为移除该 session。
 */
export function closeTerminalTab(sessionId: string): void {
  const tab = terminalState.tabs.find((item) => item.sessionId === sessionId);
  if (tab === undefined) return;
  const workspace = workspaceOf(tab.workspaceKey);
  const isLastOfWorkspace = workspace === undefined || workspace.sessionIds.length <= 1;
  if (isLastOfWorkspace) {
    if (requestPanelClose()) return;
    removeSession(sessionId);
    return;
  }
  if (!tab.creating) send({ type: "exit", sessionId });
  removeSession(sessionId);
}

/**
 * PTY 退出处置（ZCode Terminal.tsx:225-249 / terminalPanelState.ts:142-171
 * exitTerminalSession）：exit 是 session 生命周期终点——同步删除 tab；仅当前
 * workspace 的最后一个 tab 才连带关闭面板（隐藏 workspace 的退出只回收自身）。
 */
function applyExitSession(sessionId: string, exitCode: number): void {
  const tab = terminalState.tabs.find((item) => item.sessionId === sessionId);
  if (tab === undefined) return;
  tab.alive = false;
  tab.exitCode = exitCode;
  emit(sessionId, { kind: "exit", exitCode });
  const workspace = workspaceOf(tab.workspaceKey);
  const isLastOfWorkspace = workspace === undefined || workspace.sessionIds.length <= 1;
  const wasActiveWorkspace = tab.workspaceKey === terminalState.activeWorkspaceKey;
  removeSession(sessionId);
  if (isLastOfWorkspace && wasActiveWorkspace) requestPanelClose();
}

/** 选择活动 tab（其所属 workspace 的 activeSessionId；仅接受已知 tab）。 */
export function setActiveTerminal(sessionId: string): void {
  const tab = terminalState.tabs.find((item) => item.sessionId === sessionId);
  if (tab === undefined) return;
  const workspace = workspaceOf(tab.workspaceKey);
  if (workspace !== undefined) workspace.activeSessionId = sessionId;
}

/**
 * 键序写入（reqId per-session 单调；server 高水位去重回执 duplicate）。
 * creating 期间（draft 未换轨）丢弃输入——create 未确立的会话不可写。
 */
export function writeTerminal(sessionId: string, data: string): void {
  const tab = terminalState.tabs.find((item) => item.sessionId === sessionId);
  if (tab === undefined || tab.creating) return;
  const ledger = ledgerOf(sessionId);
  ledger.reqCounter += 1;
  send({ type: "write", sessionId, reqId: ledger.reqCounter, data });
}

/**
 * 尺寸变更（终值幂等 + 同值去重）。id 未 ready（creating）期间暂存
 * pendingCreateSize，created ack 后 flush（ZCode pendingTerminalSizeRef 同构）。
 */
export function resizeTerminal(sessionId: string, cols: number, rows: number): void {
  const tab = terminalState.tabs.find((item) => item.sessionId === sessionId);
  if (tab === undefined) return;
  const ledger = ledgerOf(sessionId);
  if (tab.creating) {
    ledger.pendingCreateSize = { cols, rows };
    return;
  }
  if (ledger.lastSentSize?.cols === cols && ledger.lastSentSize?.rows === rows) return;
  ledger.lastSentSize = { cols, rows };
  send({ type: "resize", sessionId, cols, rows });
}

/** 订阅会话输出（data 依 seq 有序；reset = 清屏重拉；exit = 进程退出）。
 * 新订阅者先收到既有镜像回放（pane 重挂载/切 tab 回看），再接续实时事件。 */
export function subscribeTerminal(sessionId: string, listener: OutputListener): () => void {
  const ledger = ledgerOf(sessionId);
  for (const chunk of ledger.mirror) listener({ kind: "data", data: chunk });
  ledger.listeners.add(listener);
  return () => {
    ledger.listeners.delete(listener);
  };
}

/** 确认首开提示（sessionStorage——每次 WebUI 会话首开都展示一次）。 */
export function acknowledgeTerminalNotice(): void {
  terminalState.noticeAcknowledged = true;
  try {
    sessionStorage.setItem(NOTICE_KEY, "1");
  } catch {
    /* 存储不可用只影响下次提示 */
  }
}

function emit(sessionId: string, event: TerminalOutputEvent): void {
  const ledger = ledgers.get(sessionId);
  if (ledger === undefined) return;
  for (const listener of ledger.listeners) listener(event);
}

/** 缺口补拉：[lastSeq+1, ∞) 单请求；服务端 128 条/窗口有界回放（收敛分窗）。 */
function requestCatchUp(sessionId: string): void {
  const ledger = ledgers.get(sessionId);
  if (ledger === undefined || ledger.bufferInFlight) return;
  if (ledger.highestSeen <= ledger.lastSeq) return;
  ledger.bufferInFlight = true;
  if (!send({ type: "buffer", sessionId, from: ledger.lastSeq + 1, to: Number.MAX_SAFE_INTEGER })) {
    ledger.bufferInFlight = false;
  }
}

/** output/buffer 块的有序落放：pending 暂存 → 从 lastSeq+1 连续出队。 */
function ingestEntry(sessionId: string, ledger: SessionLedger, seq: number, data: string): void {
  if (seq <= ledger.lastSeq) return; // 已落放（重复回放/回执竞态）：幂等跳过。
  ledger.pending.set(seq, data);
  if (seq > ledger.highestSeen) ledger.highestSeen = seq;
  let next = ledger.pending.get(ledger.lastSeq + 1);
  while (next !== undefined) {
    const delivering = ledger.lastSeq + 1;
    ledger.pending.delete(delivering);
    ledger.lastSeq = delivering;
    ledger.mirror.push(next);
    ledger.mirrorBytes += next.length;
    while (ledger.mirrorBytes > MIRROR_MAX_BYTES && ledger.mirror.length > 1) {
      const dropped = ledger.mirror.shift();
      ledger.mirrorBytes -= dropped?.length ?? 0;
    }
    emit(sessionId, { kind: "data", data: next });
    next = ledger.pending.get(ledger.lastSeq + 1);
  }
  if (ledger.highestSeen > ledger.lastSeq) requestCatchUp(sessionId);
}

function dispatchServerMessage(message: TerminalServerMessage): void {
  switch (message.type) {
    case "created": {
      // resume ack 优先按精确 id 匹配：resume 回执回显既有 sessionId，而全新
      // create 的服务端 id 对客户端未知——两者并发在途时（重连补发窗口），
      // 先匹配 established tab 才不会让 pending draft 误领 resume 的 ack。
      const resumeIndex = terminalState.tabs.findIndex(
        (tab) => !tab.creating && tab.sessionId === message.sessionId,
      );
      // draft pending-N → 真实 sessionId 换轨（账本/监听/workspace active 同步迁移）。
      // ack 只可能对应已发出的 create：adopt 限定 createSent 的 draft（FIFO）——
      // 未 attach 的 draft（pane 尚未发起 create）不得被别人的 ack 误领。
      const draftIndex =
        resumeIndex >= 0
          ? -1
          : terminalState.tabs.findIndex((tab) => {
              if (!tab.creating) return false;
              return ledgers.get(tab.sessionId)?.createSent === true;
            });
      if (draftIndex >= 0) {
        const draft = terminalState.tabs[draftIndex]!;
        const draftId = draft.sessionId;
        const draftLedger = ledgers.get(draftId);
        ledgers.delete(draftId);
        if (draftLedger !== undefined) {
          const ledger = ledgerOf(message.sessionId);
          ledger.lastSeq = draftLedger.lastSeq;
          ledger.highestSeen = draftLedger.highestSeen;
          ledger.reqCounter = draftLedger.reqCounter;
          ledger.pending = draftLedger.pending;
          ledger.listeners = draftLedger.listeners;
          ledger.createOptions = draftLedger.createOptions;
          ledger.paneAttached = draftLedger.paneAttached;
          ledger.createSent = draftLedger.createSent;
          ledger.pendingCreateSize = draftLedger.pendingCreateSize;
          ledger.lastSentSize = draftLedger.lastSentSize;
        }
        const workspace = workspaceOf(draft.workspaceKey);
        draft.sessionId = message.sessionId;
        draft.creating = false;
        draft.alive = true;
        if (workspace !== undefined) {
          const slot = workspace.sessionIds.indexOf(draftId);
          if (slot >= 0) workspace.sessionIds[slot] = message.sessionId;
          if (workspace.activeSessionId === draftId) {
            workspace.activeSessionId = message.sessionId;
          }
        }
      } else if (resumeIndex < 0) {
        return; // 未知会话（非本面创建）：不认领。
      }
      // resume 对账：lastSeq > 0 = 断线前已有输出——立即补拉缺失尾部（服务端
      // 环形缓冲从 from=lastSeq+1 有界回放；已裁剪区间回 gap 清屏重拉）。
      // 全新 create（lastSeq=0）无缺失面，首帧 output 自然起序。
      // stale tab 迁移后的账本（draft 换轨）复用同一路径。
      const ledger = ledgerOf(message.sessionId);
      // id ready：flush create 期间暂存的 resize 终值（与 create 帧同值则跳过）。
      const pendingSize = ledger.pendingCreateSize;
      ledger.pendingCreateSize = null;
      if (
        pendingSize !== null &&
        (ledger.createOptions?.cols !== pendingSize.cols ||
          ledger.createOptions?.rows !== pendingSize.rows)
      ) {
        ledger.lastSentSize = pendingSize;
        send({
          type: "resize",
          sessionId: message.sessionId,
          cols: pendingSize.cols,
          rows: pendingSize.rows,
        });
      }
      if (ledger.lastSeq > 0) {
        ledger.highestSeen = Math.max(ledger.highestSeen, ledger.lastSeq + 1);
        requestCatchUp(message.sessionId);
      }
      return;
    }
    case "output": {
      const ledger = ledgerOf(message.sessionId);
      ingestEntry(message.sessionId, ledger, message.seq, message.data);
      return;
    }
    case "buffer": {
      const ledger = ledgers.get(message.sessionId);
      if (ledger === undefined) return;
      ledger.bufferInFlight = false;
      for (const entry of message.entries) {
        ingestEntry(message.sessionId, ledger, entry.seq, entry.data);
      }
      // 窗口未覆盖完（仍不连续）→ 下一窗续拉。
      if (ledger.highestSeen > ledger.lastSeq) requestCatchUp(message.sessionId);
      return;
    }
    case "gap": {
      const ledger = ledgers.get(message.sessionId);
      if (ledger === undefined) return;
      ledger.bufferInFlight = false;
      // 缓冲已裁剪：清屏重拉——丢弃已裁剪区间（seq < availableFrom）的暂存块
      // 与镜像，lastSeq 对齐 availableFrom-1；≥ availableFrom 的块保留（新
      // 基准下仍有效），后续从新基准连续落放。
      ledger.pending = new Map([...ledger.pending].filter(([seq]) => seq >= message.availableFrom));
      ledger.mirror = [];
      ledger.mirrorBytes = 0;
      ledger.lastSeq = Math.max(ledger.lastSeq, message.availableFrom - 1);
      ledger.highestSeen = Math.max(ledger.highestSeen, message.availableFrom);
      emit(message.sessionId, { kind: "reset" });
      if (ledger.highestSeen > ledger.lastSeq) requestCatchUp(message.sessionId);
      return;
    }
    case "exit": {
      applyExitSession(message.sessionId, message.exitCode);
      return;
    }
    case "duplicate": {
      // server 高水位去重回执：无需动作（该键序未被二次注入）。
      return;
    }
    case "list": {
      return; // 当前无 UI 消费面（见模块妥协声明）。
    }
    case "error": {
      terminalState.lastError = message.message;
      if (message.code === "LIMIT_EXCEEDED") {
        // 新建被拒：回收 creating 中的 tab（既有 tab 不受影响；空分区保留，
        // dock 呈空态，ensure 不自动重试）。
        const index = terminalState.tabs.findIndex((tab) => tab.creating);
        if (index >= 0) {
          const tab = terminalState.tabs[index]!;
          removeSession(tab.sessionId);
        }
        showToast(t("terminal.limitReached"));
        return;
      }
      if (message.code === "SESSION_NOT_FOUND") {
        if (message.sessionId === undefined) return;
        // resume 的会话已被回收（idle 30min/daemon 重启）：本地 tab 按退出处置。
        applyExitSession(message.sessionId, -1);
        return;
      }
      showErrorToast(t("terminal.errorToast", { message: message.message }));
      return;
    }
  }
}

/** 测试面：注入 socket 工厂（生产不调用）。 */
export function __setTerminalSocketFactoryForTests(
  factory: ((url: string) => WebSocket) | null,
): void {
  socketFactory = factory;
}

/** 测试面：复位全部状态（关停 socket、清 tab/workspace/账本/计数）。 */
export function __resetTerminalClientForTests(): void {
  cancelReconnect();
  closeSocket();
  wanted = false;
  reconnectAttempts = 0;
  terminalState.status = "idle";
  terminalState.tabs = [];
  terminalState.workspaces = [];
  terminalState.activeWorkspaceKey = null;
  terminalState.lastError = null;
  ledgers.clear();
  tabCounter = 0;
  panelCloseHandler = null;
}
