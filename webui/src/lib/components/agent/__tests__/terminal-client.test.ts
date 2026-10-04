// @vitest-environment jsdom
/**
 * 人类终端 WS 客户端协议层单测（skills-agent-page 1.6 + zcode-parity 2.1/2.3）。
 *
 * 用户原始需求 [2026-10-03]（design §4 r3/r4 冻结语义）：seq 对账 / buffer
 * 缺口重放 / gap 清屏重拉 / write reqId 高水位去重 / create resume 重连 /
 * 并发上限回收。
 * 修订 [2026-10-04]（skills-agent-page-zcode-parity）：Workspace 分区 tab 所有权
 * （懒确保/切换保活）+ ZCode 关闭语义（最后 tab = close-panel 保活 session）+
 * PTY exit 同步删 tab（仅活动 workspace 最后 tab 连带关面板）+ 两段式 create
 * （pane attach 带真实尺寸）+ resize 暂存/flush/去重。
 *
 * 正交意图：
 *   [1] 生命周期：draft→真实 sessionId 换轨（uiKey 稳定）；workspace 分区注册表；
 *       断线退避重连 = 已确立 tab resume / 已 attach 的 creating tab 补发 create。
 *   [2] ZCode 关闭/退出语义（Terminal.tsx:190-249 + terminalPanelState.ts）。
 *   [3] 可靠性：乱序 output 经 pending 暂存有序落放；缺口 MUST 发 buffer；
 *       gap → reset + lastSeq 对齐 + 续拉；镜像回看。
 *   [4] 两段式 create + resize 队列（TerminalSession.tsx:784-796/884-896）。
 * 妥协声明：无真实 PTY/服务进程——协议层验证全部经注入的 FakeSocket。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../toast.svelte", () => ({
  showToast: vi.fn(),
}));

import {
  __resetTerminalClientForTests,
  __setTerminalSocketFactoryForTests,
  attachTerminalPane,
  bindTerminalPanelClose,
  closeTerminalTab,
  connect,
  createTerminalTab,
  resizeTerminal,
  setActiveTerminal,
  setTerminalWanted,
  setTerminalWorkspace,
  subscribeTerminal,
  terminalState,
  writeTerminal,
  aliveTerminalCount,
  type TerminalOutputEvent,
  type TerminalWorkspaceView,
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

  sentOfType(type: string): Record<string, unknown>[] {
    return this.sentMessages().filter(
      (message) => (message as { type?: string }).type === type,
    ) as Record<string, unknown>[];
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

/** 当前最后一个 draft（creating tab）的 sessionId。 */
function lastDraftId(): string {
  const creating = terminalState.tabs.filter((tab) => tab.creating);
  const tab = creating[creating.length - 1];
  if (!tab) throw new Error("no creating tab");
  return tab.sessionId;
}

/**
 * 建立一个已确立会话（两段式全链）：draft → pane attach（真实尺寸）→ create 帧
 * → created ack 换轨。返回活 socket。
 */
async function establishedSession(
  sessionId = "s1",
  options?: { cwd?: string; shell?: string },
): Promise<FakeSocket> {
  setTerminalWanted(true);
  const socket = await openSocket();
  createTerminalTab(options);
  attachTerminalPane(lastDraftId(), { cols: 80, rows: 24 });
  socket.serverMessage({ type: "created", sessionId, replayFrom: 1, cols: 80, rows: 24 });
  return socket;
}

function workspaceOf(key: string): TerminalWorkspaceView | undefined {
  return terminalState.workspaces.find((workspace) => workspace.key === key);
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

describe("terminal client lifecycle (two-phase create + draft adoption)", () => {
  it("sends create only after pane attach, with the measured size", async () => {
    setTerminalWanted(true);
    await openSocket();
    createTerminalTab();
    // 两段式第一段：draft 不发 create。
    expect(active().sent).toHaveLength(0);

    attachTerminalPane(lastDraftId(), { cols: 97, rows: 31 });
    expect(active().lastSent()).toMatchObject({ type: "create", cols: 97, rows: 31 });
  });

  it("maps a creating tab onto the real sessionId from the created ack (uiKey stable)", async () => {
    setTerminalWanted(true);
    const socket = await openSocket();
    setTerminalWorkspace("ws_a"); // 懒确保首个 draft
    const draftId = lastDraftId();
    attachTerminalPane(draftId);
    socket.serverMessage({
      type: "created",
      sessionId: "s1",
      replayFrom: 1,
      cols: 80,
      rows: 24,
    });

    expect(terminalState.tabs).toHaveLength(1);
    const tab = terminalState.tabs[0]!;
    expect(tab).toMatchObject({
      sessionId: "s1",
      uiKey: draftId,
      creating: false,
      alive: true,
      workspaceKey: "ws_a",
    });
    expect(workspaceOf("ws_a")?.sessionIds).toEqual(["s1"]);
    expect(workspaceOf("ws_a")?.activeSessionId).toBe("s1");
    expect(terminalState.status).toBe("open");
  });

  it("attaches without a size for panes mounted without layout (server default)", async () => {
    setTerminalWanted(true);
    await openSocket();
    createTerminalTab();
    attachTerminalPane(lastDraftId());
    const create = active().lastSent();
    expect(create).toMatchObject({ type: "create" });
    expect(create).not.toHaveProperty("cols");
    expect(create).not.toHaveProperty("rows");
  });

  it("client-side limit gate refuses the 5th terminal without sending create", async () => {
    setTerminalWanted(true);
    await openSocket();
    for (let index = 0; index < 4; index += 1) {
      createTerminalTab();
      attachTerminalPane(lastDraftId());
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

  it("client-side limit gate also counts the pending (creating) window", () => {
    for (let index = 0; index < 4; index += 1) {
      createTerminalTab(); // 不 attach：draft 停留在 creating
    }
    expect(terminalState.tabs).toHaveLength(4);
    createTerminalTab(); // 第 5 个在 pending 窗内即被拒
    expect(terminalState.tabs).toHaveLength(4);
    expect(terminalState.lastError).toBe("LIMIT_EXCEEDED");
  });

  it("server LIMIT_EXCEEDED reclaims the creating tab and keeps existing tabs", async () => {
    setTerminalWanted(true);
    const socket = await establishedSession("s1");
    createTerminalTab();
    attachTerminalPane(lastDraftId());
    socket.serverMessage({
      type: "error",
      code: "LIMIT_EXCEEDED",
      message: "terminal limit exceeded",
    });
    expect(terminalState.tabs).toHaveLength(1);
    expect(terminalState.tabs[0]!.sessionId).toBe("s1");
  });

  it("drops input writes while the session is still creating", async () => {
    setTerminalWanted(true);
    await openSocket();
    createTerminalTab();
    writeTerminal(lastDraftId(), "ls\r");
    expect(active().sentOfType("write")).toHaveLength(0);
  });
});

describe("workspace-scoped tab ownership (ZCode Terminal.tsx:49-128)", () => {
  it("lazily ensures the first session when a workspace becomes active", () => {
    setTerminalWorkspace("ws_a", { cwd: "/x/alpha" });
    expect(terminalState.tabs).toHaveLength(1);
    expect(terminalState.tabs[0]).toMatchObject({
      workspaceKey: "ws_a",
      title: "alpha",
      index: 1,
      creating: true,
    });

    // 已有 session：幂等 no-op。
    setTerminalWorkspace("ws_a");
    expect(terminalState.tabs).toHaveLength(1);
  });

  it("keeps the old workspace's tabs alive when switching workspaces", () => {
    setTerminalWorkspace("ws_a", { cwd: "/x/alpha" });
    setTerminalWorkspace("ws_b", { cwd: "/y/beta" });
    expect(terminalState.tabs).toHaveLength(2);
    expect(terminalState.activeWorkspaceKey).toBe("ws_b");
    expect(workspaceOf("ws_a")?.sessionIds).toHaveLength(1);
    expect(terminalState.tabs[1]).toMatchObject({ workspaceKey: "ws_b", title: "beta" });
  });

  it("derives tab titles from the cwd leaf with per-workspace hole numbering", () => {
    setTerminalWorkspace("ws_a", { cwd: "/x/alpha" });
    createTerminalTab({ cwd: "/x/alpha" });
    createTerminalTab({ cwd: "/x/alpha" });
    const titles = terminalState.tabs.map((tab) => tab.title);
    expect(titles).toEqual(["alpha", "alpha 2", "alpha 3"]);

    // 关闭 2 号位后新建回到最小空位 2（ZCode getNextTerminalSessionIndex）。
    closeTerminalTab(terminalState.tabs[1]!.sessionId);
    createTerminalTab({ cwd: "/x/alpha" });
    expect(terminalState.tabs.at(-1)).toMatchObject({ index: 2, title: "alpha 2" });
  });

  it("falls back to the generic title without a cwd", () => {
    setTerminalWorkspace("ws_a");
    expect(terminalState.tabs[0]!.title).toBe("Terminal");
  });

  it("stores the shell label only when the caller chose an explicit shell", () => {
    setTerminalWorkspace("ws_a");
    expect(terminalState.tabs[0]!.shellLabel).toBeNull();
    createTerminalTab({ cwd: "/x/a", shell: "/usr/bin/pwsh" });
    expect(terminalState.tabs[1]!.shellLabel).toBe("PowerShell");
  });

  it("setActiveTerminal only accepts known tabs within their workspace", async () => {
    await establishedSession("s1");
    setActiveTerminal("unknown");
    expect(workspaceOf("__default__")?.activeSessionId).toBe("s1");
  });
});

describe("ZCode close semantics (Terminal.tsx:190-223 + terminalPanelState.ts:94-140)", () => {
  it("closing the last tab collapses the panel and keeps the session alive", async () => {
    const socket = await establishedSession("s1");
    let closeRequests = 0;
    const unbind = bindTerminalPanelClose(() => {
      closeRequests += 1;
    });

    closeTerminalTab("s1");
    expect(closeRequests).toBe(1);
    // 保活：tab 不移除、不发 exit（ZCode close-panel）。
    expect(terminalState.tabs).toHaveLength(1);
    expect(socket.sentOfType("exit")).toHaveLength(0);
    unbind();
  });

  it("closing a non-last tab sends exit and activates the left neighbor", async () => {
    const socket = await establishedSession("s1");
    createTerminalTab();
    attachTerminalPane(lastDraftId());
    socket.serverMessage({ type: "created", sessionId: "s2", replayFrom: 1, cols: 80, rows: 24 });
    const workspace = workspaceOf("__default__")!;
    expect(workspace.activeSessionId).toBe("s2");

    closeTerminalTab("s2");
    expect(socket.lastSent()).toMatchObject({ type: "exit", sessionId: "s2" });
    expect(terminalState.tabs).toHaveLength(1);
    expect(workspace.activeSessionId).toBe("s1");
  });

  it("falls back to removal when no panel host is bound", async () => {
    await establishedSession("s1");
    closeTerminalTab("s1");
    expect(terminalState.tabs).toHaveLength(0);
    expect(workspaceOf("__default__")).toBeUndefined();
  });

  it("re-opens lazily: panel close keeps the session, later ensure is a no-op", async () => {
    await establishedSession("s1");
    const unbind = bindTerminalPanelClose(() => {});
    closeTerminalTab("s1"); // close-panel：保活
    unbind();

    setTerminalWorkspace("__default__");
    expect(terminalState.tabs).toHaveLength(1);
    expect(terminalState.tabs[0]!.sessionId).toBe("s1");
  });
});

describe("ZCode exit semantics (Terminal.tsx:225-249 + terminalPanelState.ts:142-171)", () => {
  it("removes the exited tab and closes the panel when it is the active workspace's last", async () => {
    const socket = await establishedSession("s1");
    let closeRequests = 0;
    const unbind = bindTerminalPanelClose(() => {
      closeRequests += 1;
    });

    socket.serverMessage({ type: "exit", sessionId: "s1", exitCode: 0 });
    expect(terminalState.tabs).toHaveLength(0);
    expect(workspaceOf("__default__")).toBeUndefined();
    expect(closeRequests).toBe(1);
    unbind();
  });

  it("removes just the exited tab when the workspace keeps others", async () => {
    const socket = await establishedSession("s1");
    createTerminalTab();
    attachTerminalPane(lastDraftId());
    socket.serverMessage({ type: "created", sessionId: "s2", replayFrom: 1, cols: 80, rows: 24 });
    let closeRequests = 0;
    const unbind = bindTerminalPanelClose(() => {
      closeRequests += 1;
    });

    socket.serverMessage({ type: "exit", sessionId: "s2", exitCode: 1 });
    expect(terminalState.tabs).toHaveLength(1);
    expect(terminalState.tabs[0]).toMatchObject({ sessionId: "s1", alive: true });
    expect(workspaceOf("__default__")?.activeSessionId).toBe("s1");
    expect(closeRequests).toBe(0);
    unbind();
  });

  it("reaps a hidden workspace's exited session without closing the panel", async () => {
    const socket = await establishedSession("s1");
    setTerminalWorkspace("ws_b"); // 懒确保 ws_b 首个 draft
    attachTerminalPane(lastDraftId());
    socket.serverMessage({ type: "created", sessionId: "t1", replayFrom: 1, cols: 80, rows: 24 });
    let closeRequests = 0;
    const unbind = bindTerminalPanelClose(() => {
      closeRequests += 1;
    });

    // 隐藏 workspace ws_a 的 s1 退出：回收自身，不动面板。
    socket.serverMessage({ type: "exit", sessionId: "s1", exitCode: 0 });
    expect(terminalState.tabs).toHaveLength(1);
    expect(terminalState.tabs[0]!.sessionId).toBe("t1");
    expect(workspaceOf("ws_a")).toBeUndefined();
    expect(closeRequests).toBe(0);
    unbind();
  });

  it("retires a resumed tab on SESSION_NOT_FOUND with the same exit semantics", async () => {
    const socket = await establishedSession("s1");
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
    let closeRequests = 0;
    const unbind = bindTerminalPanelClose(() => {
      closeRequests += 1;
    });
    reopened.serverMessage({
      type: "error",
      code: "SESSION_NOT_FOUND",
      message: "terminal session not found: s1",
      sessionId: "s1",
    });
    expect(terminalState.tabs).toHaveLength(0);
    expect(closeRequests).toBe(1);
    unbind();
  });
});

describe("resize queue + dedup (ZCode TerminalSession.tsx flush semantics)", () => {
  it("queues resizes while creating and flushes after the ack when the size differs", async () => {
    const socket = await establishedSession("s1");
    void socket;
    setTerminalWorkspace("ws_b"); // 懒确保 ws_b 首个 draft
    const draftId = lastDraftId();
    resizeTerminal(draftId, 60, 20);
    expect(active().sentOfType("resize")).toHaveLength(0);
    attachTerminalPane(draftId, { cols: 80, rows: 24 });

    active().serverMessage({ type: "created", sessionId: "t1", replayFrom: 1, cols: 80, rows: 24 });
    const resizes = active().sentOfType("resize");
    expect(resizes).toEqual([{ type: "resize", sessionId: "t1", cols: 60, rows: 20 }]);
  });

  it("skips the flush when the queued size matches the create size", async () => {
    setTerminalWanted(true);
    const socket = await openSocket();
    setTerminalWorkspace("ws_b"); // 懒确保 ws_b 首个 draft
    const draftId = lastDraftId();
    resizeTerminal(draftId, 80, 24);
    attachTerminalPane(draftId, { cols: 80, rows: 24 });
    socket.serverMessage({ type: "created", sessionId: "t1", replayFrom: 1, cols: 80, rows: 24 });
    expect(socket.sentOfType("resize")).toHaveLength(0);
  });

  it("dedupes consecutive identical resize termini", async () => {
    const socket = await establishedSession("s1");
    resizeTerminal("s1", 100, 30);
    resizeTerminal("s1", 100, 30);
    resizeTerminal("s1", 120, 40);
    expect(socket.sentOfType("resize")).toEqual([
      { type: "resize", sessionId: "s1", cols: 100, rows: 30 },
      { type: "resize", sessionId: "s1", cols: 120, rows: 40 },
    ]);
  });
});

describe("terminal seq reconciliation (r3/r4 frozen semantics)", () => {
  it("delivers contiguous output in order and replays the mirror to new subscribers", async () => {
    const socket = await establishedSession("s1");
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
    const socket = await establishedSession("s1");
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
    const socket = await establishedSession("s1");
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
    const socket = await establishedSession("s1");
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
    const socket = await establishedSession("s1");
    writeTerminal("s1", "ls\r");
    writeTerminal("s1", "pwd\r");
    expect(socket.sentOfType("write")).toEqual([
      { type: "write", sessionId: "s1", reqId: 1, data: "ls\r" },
      { type: "write", sessionId: "s1", reqId: 2, data: "pwd\r" },
    ]);
    // 服务端高水位去重回执：no-op（不抛错、不重复落放）。
    socket.serverMessage({ type: "duplicate", sessionId: "s1", reqId: 1 });
    expect(terminalState.status).toBe("open");
  });

  it("reconnects after close and resumes known tabs via create{resume}", async () => {
    const socket = await establishedSession("s1");
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

  it("re-sends create for an attached draft on reconnect, but not for an unattached one", async () => {
    setTerminalWanted(true);
    const socket = await openSocket();
    // 未 attach 的 draft：重连循环不得发 create（pane attach 才是发起方）。
    createTerminalTab();
    socket.serverClose();
    await vi.advanceTimersByTimeAsync(1_000);
    const reopened = await openSocket();
    expect(reopened.sentOfType("create")).toHaveLength(0);

    attachTerminalPane(lastDraftId());
    expect(reopened.lastSent()).toMatchObject({ type: "create" });

    // attach 后断线、ack 未达：重连补发 create（paneAttached 已立）。
    reopened.serverClose();
    await vi.advanceTimersByTimeAsync(1_000);
    const third = await openSocket();
    expect(third.sentOfType("create")).toHaveLength(1);
  });

  it("a resume ack never adopts a pending draft when both creates are in flight", async () => {
    const socket = await establishedSession("s1");
    createTerminalTab();
    attachTerminalPane(lastDraftId(), { cols: 80, rows: 24 });
    // 重连窗口：resume(s1) 与 draft create 并发在途，resume ack（回显 s1）先回。
    socket.serverClose();
    await vi.advanceTimersByTimeAsync(1_000);
    const reopened = await openSocket();
    const frames = reopened.sentOfType("create");
    expect(frames).toHaveLength(2);

    reopened.serverMessage({ type: "created", sessionId: "s1", replayFrom: 1, cols: 80, rows: 24 });
    // s1 归 s1：draft 不得误领 resume ack。
    expect(terminalState.tabs).toHaveLength(2);
    expect(terminalState.tabs.find((tab) => tab.sessionId === "s1")).toMatchObject({
      creating: false,
      alive: true,
    });
    expect(terminalState.tabs.some((tab) => tab.creating)).toBe(true);

    // draft 自己的 ack 随后到达才换轨。
    reopened.serverMessage({ type: "created", sessionId: "s2", replayFrom: 1, cols: 80, rows: 24 });
    expect(terminalState.tabs.some((tab) => tab.creating)).toBe(false);
    expect(terminalState.tabs.find((tab) => tab.sessionId === "s2")).toMatchObject({
      alive: true,
    });
  });
});
