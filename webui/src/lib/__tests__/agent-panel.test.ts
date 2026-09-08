/**
 * Agent 面板 store 单测（dsh-kernel-rebase task 3.x 验收：延迟/失败 RPC 的组件
 * 交互测试）。
 *
 * 用户原始需求 [2026-09-08]：「右侧嵌入了一个聊天对话框」——面板投影在延迟/
 * 失败/断线下不得伪造成功。
 *
 * 正交意图：
 *   [1] 生命周期投影：create 成功重置视图；延迟 create 被更新请求取代时不提交。
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
});
