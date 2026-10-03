// @vitest-environment jsdom
/**
 * 人类终端 WS 客户端协议层单测（skills-agent-page 1.6；mock WS，不起真服务）。
 *
 * 用户原始需求 [2026-10-03]（design §4 r3/r4 冻结语义）：seq 对账 / buffer
 * 缺口重放 / gap 清屏重拉 / write reqId 高水位去重 / create resume 重连 /
 * 并发上限回收。
 *
 * 正交意图：
 *   [1] 生命周期：create draft→真实 sessionId 换轨；exit 关闭清账本；断线
 *       退避重连 = 逐 tab create{resume}。
 *   [2] 可靠性：乱序 output 经 pending 暂存有序落放；缺口 MUST 发 buffer；
 *       gap 消息 → reset 事件 + lastSeq 对齐 availableFrom-1 + 续拉；
 *       重复回放幂等跳过；镜像让新订阅者即时回看。
 *   [3] 错误面：LIMIT_EXCEEDED 回收 creating tab；SESSION_NOT_FOUND 退役 tab。
 * 妥协声明：无真实 PTY/服务进程——协议层验证全部经注入的 FakeSocket。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../toast.svelte", () => ({
  showToast: vi.fn(),
}));

import {
  __resetTerminalClientForTests,
  __setTerminalSocketFactoryForTests,
  connect,
  createTerminalTab,
  closeTerminalTab,
  setActiveTerminal,
  setTerminalWanted,
  subscribeTerminal,
  terminalState,
  writeTerminal,
  aliveTerminalCount,
  type TerminalOutputEvent,
} from "../terminal/terminal-client.svelte";

class FakeSocket {
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
  }

  // ---- 服务端模拟面 ----
  serverOpen(): void {
    this.readyState = 1;
    this.onopen?.();
  }

  serverMessage(payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }

  serverClose(): void {
    this.readyState = 3;
    this.onclose?.();
  }

  sentMessages(): unknown[] {
    return this.sent.map((raw) => JSON.parse(raw) as unknown);
  }

  lastSent(): Record<string, unknown> {
    const messages = this.sentMessages();
    return messages[messages.length - 1] as Record<string, unknown>;
  }
}

let sockets: FakeSocket[] = [];

/** 注入工厂（url 参数被接受但本测试面不消费）。 */
const socketFactory = (url: string): WebSocket => {
  void url;
  const socket = new FakeSocket();
  sockets.push(socket);
  return socket as unknown as WebSocket;
};

function active(): FakeSocket {
  const socket = sockets[sockets.length - 1];
  if (!socket) throw new Error("no socket created");
  return socket;
}

/** 建立到 open 态的连接（含 microtask 冲刷）。 */
async function openSocket(): Promise<FakeSocket> {
  const socket = active();
  const pending = connect();
  socket.serverOpen();
  await pending;
  await Promise.resolve();
  return socket;
}

function outputs(events: TerminalOutputEvent[]): string[] {
  return events
    .filter((event) => event.kind === "data")
    .map((event) => (event as { data: string }).data);
}

beforeEach(() => {
  sockets = [];
  vi.useFakeTimers();
  sessionStorage.clear();
  __setTerminalSocketFactoryForTests(socketFactory);
});

afterEach(() => {
  __resetTerminalClientForTests();
  __setTerminalSocketFactoryForTests(null);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("terminal client lifecycle", () => {
  it("maps a creating tab onto the real sessionId from the created ack", async () => {
    setTerminalWanted(true);
    createTerminalTab();
    const socket = await openSocket();

    expect(terminalState.tabs).toHaveLength(1);
    expect(terminalState.tabs[0]!.creating).toBe(true);
    expect(socket.lastSent()).toMatchObject({ type: "create" });

    socket.serverMessage({
      type: "created",
      sessionId: "s1",
      replayFrom: 1,
      cols: 80,
      rows: 24,
    });
    expect(terminalState.tabs[0]).toMatchObject({
      sessionId: "s1",
      creating: false,
      alive: true,
    });
    expect(terminalState.activeSessionId).toBe("s1");
    expect(terminalState.status).toBe("open");
  });

  it("client-side limit gate refuses the 5th terminal without sending create", async () => {
    setTerminalWanted(true);
    await openSocket();
    for (let index = 0; index < 4; index += 1) {
      createTerminalTab();
      active().serverMessage({
        type: "created",
        sessionId: `s${index}`,
        replayFrom: 1,
        cols: 80,
        rows: 24,
      });
    }
    expect(aliveTerminalCount()).toBe(4);

    const sentBefore = active().sent.length;
    createTerminalTab();
    expect(aliveTerminalCount()).toBe(4);
    expect(terminalState.tabs).toHaveLength(4);
    expect(active().sent.length).toBe(sentBefore);
    expect(terminalState.lastError).toBe("LIMIT_EXCEEDED");
  });

  it("server LIMIT_EXCEEDED reclaims the creating tab and keeps existing tabs", async () => {
    setTerminalWanted(true);
    await openSocket();
    createTerminalTab();
    active().serverMessage({
      type: "created",
      sessionId: "s1",
      replayFrom: 1,
      cols: 80,
      rows: 24,
    });
    createTerminalTab();
    active().serverMessage({
      type: "error",
      code: "LIMIT_EXCEEDED",
      message: "terminal limit exceeded",
    });
    expect(terminalState.tabs).toHaveLength(1);
    expect(terminalState.tabs[0]!.sessionId).toBe("s1");
  });

  it("closeTerminalTab sends exit, clears ledger and detaches when idle", async () => {
    setTerminalWanted(true);
    const socket = await openSocket();
    createTerminalTab();
    socket.serverMessage({ type: "created", sessionId: "s1", replayFrom: 1, cols: 80, rows: 24 });

    closeTerminalTab("s1");
    expect(socket.lastSent()).toMatchObject({ type: "exit", sessionId: "s1" });
    expect(terminalState.tabs).toHaveLength(0);
    expect(terminalState.activeSessionId).toBeNull();
    // 无 tab 且不再 wanted → 客户端停连（socket 关闭 + status idle）。
    setTerminalWanted(false);
    expect(socket.readyState).toBe(3);
    expect(terminalState.status).toBe("idle");
  });
});

describe("terminal seq reconciliation (r3/r4 frozen semantics)", () => {
  async function establishedSession(): Promise<FakeSocket> {
    setTerminalWanted(true);
    const socket = await openSocket();
    createTerminalTab();
    socket.serverMessage({ type: "created", sessionId: "s1", replayFrom: 1, cols: 80, rows: 24 });
    return socket;
  }

  it("delivers contiguous output in order and replays the mirror to new subscribers", async () => {
    const socket = await establishedSession();
    const events: TerminalOutputEvent[] = [];
    subscribeTerminal("s1", (event) => events.push(event));

    socket.serverMessage({ type: "output", sessionId: "s1", seq: 1, data: "a" });
    socket.serverMessage({ type: "output", sessionId: "s1", seq: 2, data: "b" });
    expect(outputs(events)).toEqual(["a", "b"]);

    // 新订阅者（pane 重挂载/切 tab 回看）：先收镜像再接实时。
    const lateEvents: TerminalOutputEvent[] = [];
    subscribeTerminal("s1", (event) => lateEvents.push(event));
    expect(outputs(lateEvents)).toEqual(["a", "b"]);
    socket.serverMessage({ type: "output", sessionId: "s1", seq: 3, data: "c" });
    expect(outputs(lateEvents)).toEqual(["a", "b", "c"]);
  });

  it("detects a seq gap, MUST request buffer, and reorders the replay", async () => {
    const socket = await establishedSession();
    const events: TerminalOutputEvent[] = [];
    subscribeTerminal("s1", (event) => events.push(event));

    socket.serverMessage({ type: "output", sessionId: "s1", seq: 1, data: "a" });
    socket.serverMessage({ type: "output", sessionId: "s1", seq: 3, data: "c" });
    // 缺口 [2]：乱序块暂存，等回放补齐后才落放。
    expect(outputs(events)).toEqual(["a"]);
    expect(socket.lastSent()).toMatchObject({ type: "buffer", sessionId: "s1", from: 2 });

    socket.serverMessage({
      type: "buffer",
      sessionId: "s1",
      entries: [{ seq: 2, data: "b" }],
    });
    expect(outputs(events)).toEqual(["a", "b", "c"]);
  });

  it("treats duplicate/replayed entries below the watermark as idempotent no-ops", async () => {
    const socket = await establishedSession();
    const events: TerminalOutputEvent[] = [];
    subscribeTerminal("s1", (event) => events.push(event));

    socket.serverMessage({ type: "output", sessionId: "s1", seq: 1, data: "a" });
    socket.serverMessage({
      type: "buffer",
      sessionId: "s1",
      entries: [{ seq: 1, data: "a" }],
    });
    expect(outputs(events)).toEqual(["a"]);
  });

  it("clears the screen and re-pulls when the server reports a trimmed gap", async () => {
    const socket = await establishedSession();
    const events: TerminalOutputEvent[] = [];
    subscribeTerminal("s1", (event) => events.push(event));

    // 断线重连后：client lastSeq=0，服务端已推进到 5 且缓冲从 3 起步。
    socket.serverMessage({ type: "output", sessionId: "s1", seq: 5, data: "e" });
    expect(socket.lastSent()).toMatchObject({ type: "buffer", from: 1 });
    socket.serverMessage({ type: "gap", sessionId: "s1", availableFrom: 3 });
    expect(events.some((event) => event.kind === "reset")).toBe(true);
    // 清屏后续拉从 availableFrom 起。
    expect(socket.lastSent()).toMatchObject({ type: "buffer", from: 3 });
    socket.serverMessage({
      type: "buffer",
      sessionId: "s1",
      entries: [
        { seq: 3, data: "c" },
        { seq: 4, data: "d" },
      ],
    });
    expect(outputs(events)).toEqual(["c", "d", "e"]);
  });

  it("counts write reqIds monotonically per session and ignores duplicate acks", async () => {
    const socket = await establishedSession();
    writeTerminal("s1", "ls\r");
    writeTerminal("s1", "pwd\r");
    const writes = socket
      .sentMessages()
      .filter((message) => (message as { type?: string }).type === "write");
    expect(writes).toEqual([
      { type: "write", sessionId: "s1", reqId: 1, data: "ls\r" },
      { type: "write", sessionId: "s1", reqId: 2, data: "pwd\r" },
    ]);
    // 服务端高水位去重回执：no-op（不抛错、不重复落放）。
    socket.serverMessage({ type: "duplicate", sessionId: "s1", reqId: 1 });
    expect(terminalState.status).toBe("open");
  });

  it("reconnects after close and resumes known tabs via create{resume}", async () => {
    const socket = await establishedSession();
    socket.serverClose();
    expect(terminalState.status).toBe("closed");

    await vi.advanceTimersByTimeAsync(1_000);
    const reopened = await openSocket();
    expect(reopened).not.toBe(socket);
    expect(reopened.lastSent()).toMatchObject({ type: "create", resume: "s1" });

    // resume ack 后按 replayFrom 对账补拉（本例无缺口 → 无 buffer 请求）。
    reopened.serverMessage({
      type: "created",
      sessionId: "s1",
      replayFrom: 1,
      cols: 80,
      rows: 24,
    });
    expect(terminalState.tabs[0]).toMatchObject({ sessionId: "s1", alive: true });
  });

  it("retires a resumed tab when the server reports SESSION_NOT_FOUND", async () => {
    const socket = await establishedSession();
    socket.serverClose();
    await vi.advanceTimersByTimeAsync(1_000);
    const reopened = await openSocket();
    reopened.serverMessage({
      type: "created",
      sessionId: "s1",
      replayFrom: 1,
      cols: 80,
      rows: 24,
    });
    reopened.serverMessage({
      type: "error",
      code: "SESSION_NOT_FOUND",
      message: "terminal session not found: s1",
      sessionId: "s1",
    });
    expect(terminalState.tabs).toHaveLength(0);
    expect(terminalState.activeSessionId).toBeNull();
  });

  it("marks the tab exited on the exit notification", async () => {
    const socket = await establishedSession();
    const events: TerminalOutputEvent[] = [];
    subscribeTerminal("s1", (event) => events.push(event));
    socket.serverMessage({ type: "exit", sessionId: "s1", exitCode: 0 });
    expect(terminalState.tabs[0]).toMatchObject({ alive: false, exitCode: 0 });
    expect(events.some((event) => event.kind === "exit")).toBe(true);
  });

  it("setActiveTerminal only accepts known tabs", async () => {
    await establishedSession();
    setActiveTerminal("unknown");
    expect(terminalState.activeSessionId).toBe("s1");
  });
});
