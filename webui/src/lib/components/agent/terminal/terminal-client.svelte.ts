/**
 * 人类终端 WS 客户端（skills-agent-page 1.6 前端；单例 store）。
 *
 * 用户原始需求 [2026-10-03]（design §4）：「前端：xterm.js（webui 依赖新增，懒
 * 加载 chunk）；多终端 tab；拖高分隔条」+ 可靠性语义冻结（seq 对账 / buffer
 * 缺口重放 / write reqId 高水位去重 / create resume 重连）。
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
 *   [4] tab 投影：creating/alive/exited 三态 + 客户端侧并发 ≤4 预判（服务端
 *       LIMIT_EXCEEDED 兜底 typed error）。
 * 妥协声明：list 控制消息当前仅用于测试面（UI 不拉全局清单——tab 真相在本地
 *   注册表 + resume 对账；不主动认领未知会话）。
 */

import { readWebToken } from "$lib/rpc-client";
import { showToast } from "$lib/toast.svelte";
import { t } from "$lib/i18n";
import {
  TerminalClientMessageSchema,
  TerminalServerMessageSchema,
  type TerminalClientMessage,
  type TerminalServerMessage,
} from "./protocol.js";

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

/** 面内可见的 tab 投影。 */
export interface TerminalTabView {
  sessionId: string;
  /** 展示名（Terminal 1/2/…；创建序号本地分配）。 */
  title: string;
  /** create ack 未达（新建中；断线重连期间为 false）。 */
  creating: boolean;
  alive: boolean;
  exitCode: number | null;
}

/** per-session 对账账本（非响应式；UI 只看 tabs/activeSessionId 投影）。 */
interface SessionLedger {
  lastSeq: number;
  highestSeen: number;
  pending: Map<number, string>;
  reqCounter: number;
  bufferInFlight: boolean;
  listeners: Set<OutputListener>;
  /** 断线期间待补发的新建参数（created ack 未达）。 */
  createOptions: { cwd?: string } | null;
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
  tabs: [] as TerminalTabView[],
  activeSessionId: null as string | null,
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
  // 重连对账：既有 tab 逐个 resume（created ack 后按 replayFrom 触发补拉）；
  // created ack 未达的 tab 补发 create。
  for (const tab of terminalState.tabs) {
    if (tab.creating) {
      const ledger = ledgers.get(tab.sessionId);
      send({
        type: "create",
        ...(ledger?.createOptions?.cwd ? { cwd: ledger.createOptions.cwd } : {}),
      });
    } else {
      send({ type: "create", resume: tab.sessionId });
    }
  }
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

/** 新建终端 tab（UI 入口；并发预判 + 服务端 LIMIT_EXCEEDED 兜底）。 */
export function createTerminalTab(options?: { cwd?: string }): void {
  if (aliveTerminalCount() >= TERMINAL_MAX_LIVE) {
    terminalState.lastError = "LIMIT_EXCEEDED";
    showToast(t("terminal.limitReached"));
    return;
  }
  tabCounter += 1;
  const draftId = `pending-${tabCounter}`;
  const ledger = ledgerOf(draftId);
  ledger.createOptions = { ...(options?.cwd ? { cwd: options.cwd } : {}) };
  terminalState.tabs.push({
    sessionId: draftId,
    title: `${t("terminal.tabTitle")} ${tabCounter}`,
    creating: true,
    alive: false,
    exitCode: null,
  });
  terminalState.activeSessionId = draftId;
  if (!send({ type: "create", ...(options?.cwd ? { cwd: options.cwd } : {}) })) {
    void connect();
  }
}

/** 关闭 tab（发送 exit；本地立即移除——已退会话的 typed error 无面）。 */
export function closeTerminalTab(sessionId: string): void {
  const index = terminalState.tabs.findIndex((tab) => tab.sessionId === sessionId);
  if (index < 0) return;
  const tab = terminalState.tabs[index]!;
  if (!tab.creating) send({ type: "exit", sessionId });
  terminalState.tabs.splice(index, 1);
  ledgers.delete(sessionId);
  if (terminalState.activeSessionId === sessionId) {
    terminalState.activeSessionId = terminalState.tabs[0]?.sessionId ?? null;
  }
  if (terminalState.tabs.length === 0 && !wanted) {
    cancelReconnect();
    closeSocket();
    terminalState.status = "idle";
  }
}

/** 选择活动 tab。 */
export function setActiveTerminal(sessionId: string): void {
  if (terminalState.tabs.some((tab) => tab.sessionId === sessionId)) {
    terminalState.activeSessionId = sessionId;
  }
}

/** 键序写入（reqId per-session 单调；server 高水位去重回执 duplicate）。 */
export function writeTerminal(sessionId: string, data: string): void {
  const ledger = ledgerOf(sessionId);
  ledger.reqCounter += 1;
  send({ type: "write", sessionId, reqId: ledger.reqCounter, data });
}

/** 尺寸变更（终值幂等）。 */
export function resizeTerminal(sessionId: string, cols: number, rows: number): void {
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
      // draft pending-N → 真实 sessionId 换轨（账本/监听/active 同步迁移）。
      const draftIndex = terminalState.tabs.findIndex((tab) => tab.creating);
      const resumeIndex = terminalState.tabs.findIndex(
        (tab) => !tab.creating && tab.sessionId === message.sessionId,
      );
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
        }
        draft.sessionId = message.sessionId;
        draft.creating = false;
        draft.alive = true;
        if (terminalState.activeSessionId === draftId) {
          terminalState.activeSessionId = message.sessionId;
        }
      } else if (resumeIndex < 0) {
        return; // 未知会话（非本面创建）：不认领。
      }
      // resume 对账：lastSeq > 0 = 断线前已有输出——立即补拉缺失尾部（服务端
      // 环形缓冲从 from=lastSeq+1 有界回放；已裁剪区间回 gap 清屏重拉）。
      // 全新 create（lastSeq=0）无缺失面，首帧 output 自然起序。
      // stale tab 迁移后的账本（draft 换轨）复用同一路径。
      const ledger = ledgerOf(message.sessionId);
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
      const tab = terminalState.tabs.find((item) => item.sessionId === message.sessionId);
      if (tab) {
        tab.alive = false;
        tab.exitCode = message.exitCode;
      }
      emit(message.sessionId, { kind: "exit", exitCode: message.exitCode });
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
        // 新建被拒：回收 creating 中的 tab（既有 tab 不受影响）。
        const index = terminalState.tabs.findIndex((tab) => tab.creating);
        if (index >= 0) {
          const tab = terminalState.tabs[index]!;
          ledgers.delete(tab.sessionId);
          terminalState.tabs.splice(index, 1);
          terminalState.activeSessionId = terminalState.tabs[0]?.sessionId ?? null;
        }
        showToast(t("terminal.limitReached"));
        return;
      }
      if (message.code === "SESSION_NOT_FOUND") {
        if (message.sessionId === undefined) return;
        // resume 的会话已被回收（idle 30min/daemon 重启）：本地 tab 退役。
        const index = terminalState.tabs.findIndex(
          (tab) => !tab.creating && tab.sessionId === message.sessionId,
        );
        if (index >= 0) {
          const tab = terminalState.tabs[index]!;
          ledgers.delete(tab.sessionId);
          emit(message.sessionId, { kind: "exit", exitCode: -1 });
          terminalState.tabs.splice(index, 1);
          terminalState.activeSessionId = terminalState.tabs[0]?.sessionId ?? null;
        }
        return;
      }
      showToast(t("terminal.errorToast", { message: message.message }));
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

/** 测试面：复位全部状态（关停 socket、清 tab/账本/计数）。 */
export function __resetTerminalClientForTests(): void {
  cancelReconnect();
  closeSocket();
  wanted = false;
  reconnectAttempts = 0;
  terminalState.status = "idle";
  terminalState.tabs = [];
  terminalState.activeSessionId = null;
  terminalState.lastError = null;
  ledgers.clear();
  tabCounter = 0;
}
