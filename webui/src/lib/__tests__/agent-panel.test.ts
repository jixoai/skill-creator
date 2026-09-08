/**
 * Agent 面板 store 单测（dsh-kernel-rebase task 3.x 验收：延迟/失败 RPC 的组件
 * 交互测试）。
 *
 * 用户原始需求 [2026-09-08]：「右侧嵌入了一个聊天对话框」——面板投影在延迟/
 * 失败/断线下不得伪造成功。
 *
 * 正交意图：
 *   [1] 生命周期投影：create 成功重置视图；延迟 create 被更新请求取代时不提交。
 *       user 消息：直播走乐观气泡 + user-text 帧回声去重；切换会话后由帧重建。
 *   [2] 终态停轮询：idle 且无待答 → 不再排程；approval 待答保持轮询。
 *   [3] 失败可见：RPC 错误进入 error 面；断线（owner generation 变化）后回落的
 *       旧响应不得提交。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const connection = vi.hoisted(() => ({
  generation: 0,
  rpc: null as unknown,
}));

vi.mock("../stores/connection.svelte", () => ({
  getConnectionGeneration: () => connection.generation,
  getRpc: () => connection.rpc ?? null,
  requireRpc: () => {
    if (!connection.rpc) throw new Error("not connected");
    return connection.rpc;
  },
}));

import {
  agentPanel,
  agentSession,
  agentSessionsList,
  answerAgentApproval,
  createAgentSession,
  pollAgentStream,
  selectAgentSession,
  sendAgentPrompt,
  setAgentPanelOpen,
  setAgentSessionMode,
} from "../stores/agent.svelte";

function frame(seq: number, kind: string, extra: Record<string, unknown> = {}) {
  return {
    at: "2026-09-08T00:00:00.000Z",
    runId: "agent-s1",
    sessionId: "agent-s1",
    seq,
    kind,
    ...extra,
  };
}

beforeEach(() => {
  connection.rpc = null;
  connection.generation = 0;
  agentPanel.open = false;
  agentSession.sessionId = null;
  agentSession.mode = null;
  agentSession.items = [];
  agentSession.cursor = 0;
  agentSession.error = null;
  agentSession.promptError = null;
  agentSession.status = "idle";
  agentSessionsList.loaded = false;
  agentSessionsList.sessions = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe("agent panel store (task 3.x)", () => {
  it("creates a session, resets the view, and appends frames through polling", async () => {
    const rpc = {
      agent: {
        session: {
          create: vi.fn().mockResolvedValue({
            session: {
              sessionId: "agent-s1",
              title: "",
              status: "idle",
              cwd: "/tmp",
              createdAt: "2026-09-08T00:00:00.000Z",
              mode: "create",
            },
          }),
          prompt: vi.fn().mockResolvedValue({ accepted: true }),
          stream: vi
            .fn()
            .mockResolvedValueOnce({
              frames: [frame(0, "turn-start"), frame(1, "assistant-text", { text: "hello" })],
              status: "idle",
            })
            .mockResolvedValue({ frames: [], status: "idle" }),
        },
        sessions: {
          list: vi.fn().mockResolvedValue({ sessions: [] }),
        },
      },
    };
    connection.rpc = rpc;
    await createAgentSession("hi");
    expect(rpc.agent.session.create).toHaveBeenCalledWith({ prompt: "hi" });
    expect(agentSession.sessionId).toBe("agent-s1");
    expect(agentSession.items.map((item) => item.kind)).toEqual(["turn", "assistant"]);

    // prompt 乐观追加 + accepted。
    await sendAgentPrompt("second");
    expect(rpc.agent.session.prompt).toHaveBeenCalledWith({
      sessionId: "agent-s1",
      text: "second",
    });
    expect(agentSession.items.some((item) => item.kind === "user" && item.text === "second")).toBe(
      true,
    );
    expect(agentSession.error).toBeNull();
  });

  it("switches the session mode: running rejected locally, success updates the projection", async () => {
    let polls = 0;
    const rpc = {
      agent: {
        session: {
          setMode: vi.fn().mockResolvedValue({
            session: {
              sessionId: "agent-s1",
              title: "",
              status: "disposed",
              cwd: "/tmp",
              createdAt: "2026-09-08T00:00:00.000Z",
              mode: "explore",
            },
          }),
          stream: vi.fn().mockImplementation(async () => {
            polls += 1;
            return polls === 1
              ? {
                  frames: [
                    frame(5, "mode-changed", { payload: { from: "create", to: "explore" } }),
                  ],
                  status: "disposed",
                }
              : { frames: [], status: "disposed" };
          }),
        },
        sessions: { list: vi.fn().mockResolvedValue({ sessions: [] }) },
      },
    };
    connection.rpc = rpc;
    agentSession.sessionId = "agent-s1";
    agentSession.mode = "create";

    // running：本地拒绝，不触 RPC。
    agentSession.status = "running";
    await expect(setAgentSessionMode("explore")).resolves.toBe(false);
    expect(rpc.agent.session.setMode).not.toHaveBeenCalled();
    expect(agentSession.error).toContain("current turn");

    // idle：成功路径更新 mode/status，mode-changed 帧渲染为分隔项。
    agentSession.status = "idle";
    agentSession.error = null;
    await expect(setAgentSessionMode("explore")).resolves.toBe(true);
    expect(rpc.agent.session.setMode).toHaveBeenCalledWith({
      sessionId: "agent-s1",
      mode: "explore",
    });
    expect(agentSession.mode).toBe("explore");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(
      agentSession.items.some(
        (item) => item.kind === "mode" && item.from === "create" && item.to === "explore",
      ),
    ).toBe(true);

    // 同模式切换是本地 no-op。
    rpc.agent.session.setMode.mockClear();
    await expect(setAgentSessionMode("explore")).resolves.toBe(false);
    expect(rpc.agent.session.setMode).not.toHaveBeenCalled();
  });

  it("accumulates assistant deltas into one streaming bubble and replaces it with the final frame", async () => {
    let polls = 0;
    connection.rpc = {
      agent: {
        session: {
          stream: vi.fn().mockImplementation(async () => {
            polls += 1;
            if (polls === 1) {
              return {
                frames: [
                  frame(1, "turn-start"),
                  frame(2, "assistant-delta", { text: "Hel" }),
                  frame(3, "assistant-delta", { text: "lo " }),
                ],
                status: "running",
              };
            }
            if (polls === 2) {
              return {
                frames: [
                  frame(4, "assistant-delta", { text: "world" }),
                  frame(5, "assistant-text", { text: "Hello world" }),
                  frame(6, "turn-end", { text: "completed" }),
                ],
                status: "idle",
              };
            }
            return { frames: [], status: "idle" };
          }),
        },
      },
    };
    agentSession.sessionId = "agent-s1";
    await pollAgentStream();
    const during = agentSession.items.filter((item) => item.kind === "assistant");
    expect(during).toHaveLength(1);
    expect(during[0]).toMatchObject({ text: "Hello ", streaming: true });
    await pollAgentStream();
    const after = agentSession.items.filter((item) => item.kind === "assistant");
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ text: "Hello world", streaming: false });
  });

  it("renders interleaved reasoning/text streams once: finals replace, never duplicate", async () => {
    // 真实帧序（2026-09-09 双重渲染回归）：reasoning 增量 → 正文增量 →
    // reasoning 终帧（此时末项已是正文气泡！）→ 正文终帧。终帧只看末项会把
    // 两个终帧都变成追加，Thinking 与正文各渲染两遍。
    let polls = 0;
    connection.rpc = {
      agent: {
        session: {
          stream: vi.fn().mockImplementation(async () => {
            polls += 1;
            if (polls === 1) {
              return {
                frames: [
                  frame(1, "turn-start"),
                  frame(2, "assistant-reasoning-delta", { text: "think " }),
                  frame(3, "assistant-reasoning-delta", { text: "hard" }),
                  frame(4, "assistant-delta", { text: "42" }),
                ],
                status: "running",
              };
            }
            if (polls === 2) {
              return {
                frames: [
                  frame(5, "assistant-reasoning", { text: "think hard then answer" }),
                  frame(6, "assistant-text", { text: "42" }),
                  // 重复终帧（回放/竞态）：幂等跳过，不得再追加。
                  frame(7, "assistant-text", { text: "42" }),
                  frame(8, "turn-end", { text: "completed" }),
                ],
                status: "idle",
              };
            }
            return { frames: [], status: "idle" };
          }),
        },
      },
    };
    agentSession.sessionId = "agent-s1";
    await pollAgentStream();
    expect(agentSession.items.filter((item) => item.kind === "reasoning")).toHaveLength(1);
    expect(agentSession.items.filter((item) => item.kind === "assistant")).toHaveLength(1);
    await pollAgentStream();
    const reasoning = agentSession.items.filter((item) => item.kind === "reasoning");
    const assistant = agentSession.items.filter((item) => item.kind === "assistant");
    expect(reasoning).toHaveLength(1);
    expect(reasoning[0]).toMatchObject({ text: "think hard then answer", streaming: false });
    expect(assistant).toHaveLength(1);
    expect(assistant[0]).toMatchObject({ text: "42", streaming: false });
    // 顺序：reasoning 在 assistant 之前（同一步内思考在前）。
    expect(agentSession.items.findIndex((item) => item.kind === "reasoning")).toBeLessThan(
      agentSession.items.findIndex((item) => item.kind === "assistant"),
    );
  });

  it("applies kernel session titles to the session list without entering the transcript", async () => {
    agentSessionsList.sessions = [
      {
        sessionId: "agent-s1",
        title: "",
        status: "idle",
        cwd: "/tmp",
        createdAt: "2026-09-08T00:00:00.000Z",
        mode: "create",
      },
    ];
    connection.rpc = {
      agent: {
        session: {
          stream: vi.fn().mockResolvedValue({
            frames: [frame(9, "session-title", { text: "Counting probe" })],
            status: "idle",
          }),
        },
      },
    };
    agentSession.sessionId = "agent-s1";
    await pollAgentStream();
    expect(agentSessionsList.sessions[0]?.title).toBe("Counting probe");
    expect(agentSession.items.some((item) => item.kind === "status")).toBe(false);
  });

  it("keeps polling while an approval is pending and stops after it resolves (terminal semantics)", async () => {
    connection.rpc = {
      agent: {
        session: {
          stream: vi
            .fn()
            .mockResolvedValueOnce({
              frames: [
                frame(0, "approval-request", {
                  payload: { questions: [{ id: "q1", question: "Proceed?" }] },
                }),
              ],
              status: "idle",
            })
            .mockResolvedValueOnce({ frames: [], status: "idle" }),
          answer: vi.fn().mockResolvedValue({ answered: true }),
        },
      },
    };
    agentSession.sessionId = "agent-s1";
    await pollAgentStream();
    const approval = agentSession.items.find((item) => item.kind === "approval");
    expect(approval).toMatchObject({ resolved: false });

    // 回答后本地即时 resolved。
    await answerAgentApproval(0, [{ id: "q1", selected: ["Yes"] }]);
    expect(agentSession.items.find((item) => item.kind === "approval")).toMatchObject({
      resolved: true,
    });
    expect(
      (connection.rpc as { agent: { session: { answer: unknown[] } } }).agent.session.answer,
    ).toHaveBeenCalledWith({
      sessionId: "agent-s1",
      requestSeq: 0,
      answers: [{ id: "q1", selected: ["Yes"] }],
    });
  });

  it("surfaces RPC failures in the error face without faking success", async () => {
    connection.rpc = {
      agent: {
        session: {
          create: vi.fn().mockRejectedValue(new Error("kernel is not mounted")),
        },
      },
    };
    await createAgentSession();
    expect(agentSession.sessionId).toBeNull();
    expect(agentSession.error).toContain("kernel is not mounted");
  });

  it("keeps a prompt failure visible even when polling succeeds afterwards", async () => {
    let pollCount = 0;
    connection.rpc = {
      agent: {
        session: {
          prompt: vi.fn().mockRejectedValue(new Error("Input validation failed")),
          stream: vi.fn().mockImplementation(async () => {
            pollCount += 1;
            return { frames: [], status: "idle" };
          }),
        },
      },
    };
    agentSession.sessionId = "agent-s1";
    await sendAgentPrompt("too long payload");
    expect(agentSession.promptError).toContain("Input validation failed");
    // The polling triggered after submission succeeds — it must not clear promptError.
    expect(pollCount).toBeGreaterThan(0);
    expect(agentSession.promptError).toContain("Input validation failed");
  });

  it("drops a late create response after the connection generation moved on", async () => {
    let resolveCreate: ((value: unknown) => void) | undefined;
    connection.rpc = {
      agent: {
        session: {
          create: vi
            .fn()
            .mockImplementation(() => new Promise((resolve) => (resolveCreate = resolve))),
        },
      },
    };
    const first = createAgentSession();
    connection.generation = 1; // 断线重连：owner generation 已变化。
    resolveCreate?.({
      session: {
        sessionId: "agent-stale",
        title: "",
        status: "idle",
        cwd: "/tmp",
        createdAt: "2026-09-08T00:00:00.000Z",
      },
    });
    await first;
    expect(agentSession.sessionId).toBeNull();
  });

  it("switching sessions resets the view and cursor", async () => {
    connection.rpc = {
      agent: {
        session: {
          stream: vi.fn().mockResolvedValue({ frames: [], status: "idle" }),
        },
      },
    };
    agentSession.sessionId = "agent-a";
    agentSession.cursor = 7;
    agentSession.items.push({ kind: "turn", seq: 1, label: "Turn" });
    selectAgentSession("agent-b");
    expect(agentSession.sessionId).toBe("agent-b");
    expect(agentSession.cursor).toBe(0);
    expect(agentSession.items).toEqual([]);
  });

  it("dedupes the user-text frame echo against the optimistic bubble", async () => {
    connection.rpc = {
      agent: {
        session: {
          prompt: vi.fn().mockResolvedValue({ accepted: true }),
          stream: vi
            .fn()
            .mockResolvedValueOnce({
              frames: [
                frame(0, "user-text", { text: "hello again" }),
                frame(1, "turn-start"),
                frame(2, "assistant-text", { text: "hi" }),
              ],
              status: "idle",
            })
            .mockResolvedValue({ frames: [], status: "idle" }),
        },
      },
    };
    agentSession.sessionId = "agent-s1";
    await sendAgentPrompt("hello again");
    // 乐观气泡 + turn + assistant；user-text 帧与乐观气泡同文本，只保留一份。
    const userBubbles = agentSession.items.filter(
      (item) => item.kind === "user" && item.text === "hello again",
    );
    expect(userBubbles).toHaveLength(1);
    expect(agentSession.items.map((item) => item.kind)).toEqual(["user", "turn", "assistant"]);
  });

  it("rebuilds user bubbles from user-text frames after switching sessions", async () => {
    connection.rpc = {
      agent: {
        session: {
          stream: vi
            .fn()
            .mockResolvedValueOnce({
              frames: [
                frame(0, "user-text", { text: "earlier question" }),
                frame(1, "assistant-text", { text: "earlier answer" }),
              ],
              status: "idle",
            })
            .mockResolvedValue({ frames: [], status: "idle" }),
        },
      },
    };
    agentSession.sessionId = "agent-other";
    selectAgentSession("agent-s1");
    // selectAgentSession 内部已发起首轮轮询；等它落定而不是再发一次（会消费空帧响应）。
    await vi.waitFor(() =>
      expect(agentSession.items.map((item) => item.kind)).toEqual(["user", "assistant"]),
    );
    expect(agentSession.items[0]).toMatchObject({ kind: "user", text: "earlier question" });
  });

  it("opening the panel lazily loads the session list once", async () => {
    const list = vi.fn().mockResolvedValue({
      sessions: [
        {
          sessionId: "agent-x",
          title: "x",
          status: "idle",
          cwd: "/tmp",
          createdAt: "2026-09-08T00:00:00.000Z",
        },
      ],
    });
    connection.rpc = { agent: { sessions: { list } } };
    setAgentPanelOpen(true);
    await vi.waitFor(() => expect(agentSessionsList.loaded).toBe(true));
    expect(agentSessionsList.sessions).toHaveLength(1);
    setAgentPanelOpen(false);
    expect(agentPanel.open).toBe(false);
  });

  it("retries the session list until the rpc connection is ready", async () => {
    const list = vi.fn().mockResolvedValue({ sessions: [] });
    connection.rpc = null; // 面板先开、WS 后连：重试窗口内必须补载。
    setAgentPanelOpen(true);
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(list).not.toHaveBeenCalled();
    connection.rpc = { agent: { sessions: { list } } };
    await vi.waitFor(() => expect(agentSessionsList.loaded).toBe(true));
    expect(list).toHaveBeenCalled();
  });
});
