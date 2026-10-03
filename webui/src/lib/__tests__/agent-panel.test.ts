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
  seedAgentTestRun,
  seedComposerPrompt,
  seedFindingPropose,
  selectAgentSession,
  sendAgentPrompt,
  setAgentPanelOpen,
  setAgentSessionMode,
} from "../stores/agent.svelte";
import {
  FINDING_PROPOSE_TEMPLATES,
  type FindingProposeAction,
} from "../apps/workspaces/finding-propose-templates";
import {
  addComposerReference,
  agentComposer,
  resetAllComposerTracks,
} from "../stores/agent-composer.svelte";
import type { SkillId, WorkspaceProviderTarget } from "../types";

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
  agentPanel.seed = null;
  agentSession.sessionId = null;
  agentSession.mode = null;
  agentSession.items = [];
  agentSession.todos = [];
  agentSession.turnStartedAt = null;
  agentSession.cursor = 0;
  agentSession.error = null;
  agentSession.promptError = null;
  agentSession.status = "idle";
  agentSession.lastUsage = null;
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
      images: [],
      files: [],
      mode: "queue",
      references: [],
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
        seedSkill: null,
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

  it("sends prompts with image attachments as multimodal parts", async () => {
    const rpc = {
      agent: {
        session: {
          prompt: vi.fn().mockResolvedValue({ accepted: true }),
          stream: vi
            .fn()
            .mockResolvedValueOnce({
              frames: [frame(1, "turn-start"), frame(2, "user-text", { text: "look" })],
              status: "idle",
            })
            .mockResolvedValue({ frames: [], status: "idle" }),
        },
      },
    };
    connection.rpc = rpc;
    agentSession.sessionId = "agent-s1";
    await sendAgentPrompt("look", [
      {
        mediaType: "image/png",
        data: "aGk=",
        name: "dot.png",
        preview: "data:image/png;base64,aGk=",
      },
    ]);
    expect(rpc.agent.session.prompt).toHaveBeenCalledWith({
      sessionId: "agent-s1",
      text: "look",
      images: [{ mediaType: "image/png", data: "aGk=", name: "dot.png" }],
      files: [],
      mode: "queue",
      references: [],
    });
    // 乐观气泡带图片预览。
    const bubble = agentSession.items.find((item) => item.kind === "user");
    expect(bubble).toMatchObject({ images: ["data:image/png;base64,aGk="] });
  });

  it("projects todo snapshots latest-wins into the dock state and extracts turn usage", async () => {
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
                  frame(2, "todo-snapshot", {
                    payload: { todos: [{ content: "draft", status: "in_progress" }] },
                  }),
                  frame(3, "assistant-text", {
                    text: "ok",
                    payload: { usage: { inputTokens: 1200, outputTokens: 34 } },
                  }),
                ],
                status: "idle",
              };
            }
            return {
              frames: [
                frame(4, "todo-snapshot", {
                  payload: { todos: [{ content: "draft", status: "completed" }] },
                }),
              ],
              status: "idle",
            };
          }),
        },
      },
    };
    agentSession.sessionId = "agent-s1";
    await pollAgentStream();
    // todos 出列（§3.5）：不再进 items，改投影 TodoDock 状态（负断言走宽化字串）。
    expect(agentSession.items.some((item) => (item.kind as string) === "todo")).toBe(false);
    expect(agentSession.todos).toEqual([{ content: "draft", status: "in_progress" }]);
    expect(agentSession.lastUsage).toEqual({ inputTokens: 1200, outputTokens: 34 });
    await pollAgentStream();
    expect(agentSession.todos).toEqual([{ content: "draft", status: "completed" }]);
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

  it("merges tool call and result into one row keyed by toolCallId (§3.5)", async () => {
    connection.rpc = {
      agent: {
        session: {
          stream: vi.fn().mockResolvedValue({
            frames: [
              frame(1, "turn-start"),
              frame(2, "tool-call", {
                toolName: "bash",
                toolCallId: "c1",
                payload: { command: "ls -la", description: "list files" },
              }),
              frame(3, "tool-result", {
                toolName: "bash",
                toolCallId: "c1",
                payload: { ok: true },
              }),
            ],
            status: "idle",
          }),
        },
      },
    };
    agentSession.sessionId = "agent-s1";
    await pollAgentStream();
    const tools = agentSession.items.filter((item) => item.kind === "tool");
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({
      kind: "tool",
      toolName: "bash",
      toolCallId: "c1",
      phase: "done",
      result: { ok: true },
    });
    expect((tools[0] as { argsText?: string }).argsText).toContain("list files");
  });

  it("falls back to name matching within the turn when callId is absent (§7 妥协)", async () => {
    connection.rpc = {
      agent: {
        session: {
          stream: vi.fn().mockResolvedValue({
            frames: [
              frame(1, "turn-start"),
              frame(2, "tool-call", { toolName: "read", payload: { file_path: "/tmp/a.md" } }),
              frame(3, "tool-result", { toolName: "read", payload: "file body" }),
            ],
            status: "idle",
          }),
        },
      },
    };
    agentSession.sessionId = "agent-s1";
    await pollAgentStream();
    const tools = agentSession.items.filter((item) => item.kind === "tool");
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({ toolName: "read", phase: "done", result: "file body" });
    expect((tools[0] as { argsText?: string }).argsText).toContain("/tmp/a.md");
  });

  it("accumulates tool-args-delta before the final tool-call converges the args (§4.1)", async () => {
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
                  frame(2, "tool-args-delta", {
                    toolCallId: "c2",
                    toolName: "bash",
                    text: '{"comm',
                  }),
                  frame(3, "tool-args-delta", { toolCallId: "c2", text: 'and":"ls -la"}' }),
                ],
                status: "running",
              };
            }
            return {
              frames: [
                frame(4, "tool-call", {
                  toolCallId: "c2",
                  toolName: "bash",
                  payload: { command: "ls -la", description: "list files" },
                }),
                frame(5, "tool-result", { toolCallId: "c2", payload: { ok: true } }),
              ],
              status: "idle",
            };
          }),
        },
      },
    };
    agentSession.sessionId = "agent-s1";
    await pollAgentStream();
    // 分片先到：终帧 tool-call 前不建行（缓冲）。
    expect(agentSession.items.some((item) => item.kind === "tool")).toBe(false);
    await pollAgentStream();
    const tools = agentSession.items.filter((item) => item.kind === "tool");
    expect(tools).toHaveLength(1);
    // 终帧以完整参数收敛（不保留渐进前缀拼接）。
    expect((tools[0] as { argsText?: string }).argsText).toContain("list files");
    expect(tools[0]).toMatchObject({ toolCallId: "c2", phase: "done" });
  });

  it("keeps buffered args when the final tool-call carries no payload", async () => {
    connection.rpc = {
      agent: {
        session: {
          stream: vi.fn().mockResolvedValue({
            frames: [
              frame(1, "turn-start"),
              frame(2, "tool-args-delta", {
                toolCallId: "c3",
                toolName: "grep",
                text: '{"pattern":"todo"',
              }),
              frame(3, "tool-call", { toolCallId: "c3", toolName: "grep" }),
            ],
            status: "running",
          }),
        },
      },
    };
    agentSession.sessionId = "agent-s1";
    await pollAgentStream();
    const tools = agentSession.items.filter((item) => item.kind === "tool");
    expect(tools).toHaveLength(1);
    expect((tools[0] as { argsText?: string }).argsText).toBe('{"pattern":"todo"');
    expect(tools[0]).toMatchObject({ phase: "calling" });
  });

  it("marks a tool row as error when the result payload carries an error face", async () => {
    connection.rpc = {
      agent: {
        session: {
          stream: vi.fn().mockResolvedValue({
            frames: [
              frame(1, "turn-start"),
              frame(2, "tool-call", {
                toolCallId: "c4",
                toolName: "bash",
                payload: { command: "boom" },
              }),
              frame(3, "tool-result", {
                toolCallId: "c4",
                payload: { isError: true, error: "command not found" },
              }),
            ],
            status: "idle",
          }),
        },
      },
    };
    agentSession.sessionId = "agent-s1";
    await pollAgentStream();
    const tools = agentSession.items.filter((item) => item.kind === "tool");
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({ phase: "error" });
  });

  it("renders a turn-end pill carrying the stashed usage and elapsed time", async () => {
    connection.rpc = {
      agent: {
        session: {
          stream: vi.fn().mockResolvedValue({
            frames: [
              frame(1, "turn-start", { at: "2026-09-08T00:00:00.000Z" }),
              frame(2, "assistant-text", {
                text: "ok",
                payload: { usage: { inputTokens: 1200, outputTokens: 340 } },
              }),
              frame(3, "turn-end", { at: "2026-09-08T00:00:08.400Z", text: "completed" }),
            ],
            status: "idle",
          }),
        },
      },
    };
    agentSession.sessionId = "agent-s1";
    await pollAgentStream();
    const end = agentSession.items.find((item) => item.kind === "turn-end");
    expect(end).toMatchObject({
      kind: "turn-end",
      reason: "completed",
      usage: { inputTokens: 1200, outputTokens: 340 },
      elapsedMs: 8400,
    });
  });

  it("replays user-text attachments from the frame payload (§4.2)", async () => {
    connection.rpc = {
      agent: {
        session: {
          stream: vi.fn().mockResolvedValue({
            frames: [
              frame(0, "user-text", {
                text: "see these",
                payload: {
                  attachments: [
                    { kind: "image", name: "a.png", thumb: "data:image/png;base64,xx" },
                    { kind: "file", name: "b.txt" },
                    { kind: "image", name: "c.jpg" },
                  ],
                },
              }),
            ],
            status: "idle",
          }),
        },
      },
    };
    agentSession.sessionId = "agent-s1";
    await pollAgentStream();
    const bubble = agentSession.items.find((item) => item.kind === "user");
    // 带 thumb 的 image → 预览；file 与无 thumb 的 image → 名字 chip。
    expect(bubble).toMatchObject({
      images: ["data:image/png;base64,xx"],
      files: ["b.txt", "c.jpg"],
    });
  });
});

describe("creator-test-session seed (A5 store matrix)", () => {
  const skill = {
    workspaceId: "ws_0123456789abcdef01234567" as WorkspaceProviderTarget["workspaceId"],
    providerId: "claude-code" as WorkspaceProviderTarget["providerId"],
    skillId: "sk_0123456789abcdef01234567" as SkillId,
  };
  const revision = `sha256:${"a".repeat(64)}`;

  function sessionRpc() {
    return {
      agent: {
        session: {
          create: vi.fn().mockResolvedValue({
            session: {
              sessionId: "agent-t1",
              title: "",
              status: "idle",
              cwd: "/tmp",
              createdAt: "2026-09-30T00:00:00.000Z",
              mode: "free",
            },
          }),
          prompt: vi.fn().mockResolvedValue({ accepted: true }),
          stream: vi.fn().mockResolvedValue({ frames: [], status: "idle" }),
        },
        sessions: { list: vi.fn().mockResolvedValue({ sessions: [] }) },
      },
    };
  }

  beforeEach(() => {
    agentSession.pendingMode = "free";
    resetAllComposerTracks();
  });

  it("seeds text + skill reference + metadata; wire prompt carries the opaque triple and create carries metadata", async () => {
    const rpc = sessionRpc();
    connection.rpc = rpc;
    seedAgentTestRun({
      text: "请阅读引用的技能文档（code-review 芯片）。",
      skill,
      skillName: "code-review",
      revision,
      templateId: "probe-recall-v1",
      templateVersion: 1,
    });
    expect(agentPanel.open).toBe(true);
    expect(agentPanel.seed?.reference?.kind).toBe("skill");
    expect(agentPanel.seed?.metadata).toMatchObject({
      kind: "test-run",
      templateId: "probe-recall-v1",
      revision,
    });
    // 面板消费效果注册的引用（registry 唯一写者）——提交时随 wire 走。
    addComposerReference(agentPanel.seed!.reference!);
    await sendAgentPrompt("$code-review 试跑", [], [], "queue", agentComposer.references);
    const createCall = rpc.agent.session.create.mock.calls[0][0];
    expect(createCall.metadata).toMatchObject({
      kind: "test-run",
      workspaceId: "ws_0123456789abcdef01234567",
      providerId: "claude-code",
      skillId: "sk_0123456789abcdef01234567",
      templateVersion: 1,
    });
    const promptCall = rpc.agent.session.prompt.mock.calls[0][0];
    expect(promptCall.references[0]).toEqual({
      kind: "skill",
      workspaceId: "ws_0123456789abcdef01234567",
      providerId: "claude-code",
      skillId: "sk_0123456789abcdef01234567",
    });
  });

  it("retains seed metadata for retry when the lazy create fails", async () => {
    const rpc = sessionRpc();
    rpc.agent.session.create.mockRejectedValueOnce(new Error("kernel down")).mockResolvedValueOnce({
      session: {
        sessionId: "agent-t2",
        title: "",
        status: "idle",
        cwd: "/tmp",
        createdAt: "2026-09-30T00:00:00.000Z",
        mode: "free",
      },
    });
    connection.rpc = rpc;
    seedAgentTestRun({
      text: "probe",
      skill,
      skillName: "code-review",
      revision,
      templateId: "probe-recall-v1",
      templateVersion: 1,
    });
    await sendAgentPrompt("first try", [], [], "queue", []);
    expect(agentSession.sessionId).toBeNull();
    await sendAgentPrompt("retry", [], [], "queue", []);
    expect(agentSession.sessionId).toBe("agent-t2");
    const retryCreate = rpc.agent.session.create.mock.calls[1][0];
    expect(retryCreate.metadata?.kind).toBe("test-run");
  });

  it("generic seedComposerPrompt never attaches reference or seed metadata, and drops a stale pending test-run seed (codex r5 P1)", async () => {
    const rpc = sessionRpc();
    connection.rpc = rpc;
    // 先种一次 test-run（stash pending metadata），紧接一次通用行动——普通行动
    // 不得继承上一次的 test-run 元数据。
    seedAgentTestRun({
      text: "probe",
      skill,
      skillName: "code-review",
      revision,
      templateId: "probe-recall-v1",
      templateVersion: 1,
    });
    agentPanel.seed = null;
    seedComposerPrompt("帮我看下技能库");
    expect(agentPanel.seed).toEqual({ text: "帮我看下技能库" });
    await sendAgentPrompt("帮我看下技能库", [], [], "queue", []);
    const createCall = rpc.agent.session.create.mock.calls[0][0];
    expect("metadata" in createCall).toBe(false);
  });
});

describe("finding-propose seed (intelligence-proposal-parity 3.1)", () => {
  const skill = {
    workspaceId: "ws_0123456789abcdef01234567" as WorkspaceProviderTarget["workspaceId"],
    providerId: "claude-code" as WorkspaceProviderTarget["providerId"],
    skillId: "sk_0123456789abcdef01234567" as SkillId,
  };
  const revision = `sha256:${"b".repeat(64)}`;
  const actions: FindingProposeAction[] = ["edit", "disable", "split", "merge"];

  function sessionRpc() {
    return {
      agent: {
        session: {
          create: vi.fn().mockResolvedValue({
            session: {
              sessionId: "agent-f1",
              title: "",
              status: "idle",
              cwd: "/tmp",
              createdAt: "2026-09-30T00:00:00.000Z",
              mode: "free",
            },
          }),
          prompt: vi.fn().mockResolvedValue({ accepted: true }),
          stream: vi.fn().mockResolvedValue({ frames: [], status: "idle" }),
        },
        sessions: { list: vi.fn().mockResolvedValue({ sessions: [] }) },
      },
    };
  }

  beforeEach(() => {
    agentSession.pendingMode = "free";
    resetAllComposerTracks();
  });

  it("freezes the four templates: id/version, action tool name, and context injection", () => {
    for (const action of actions) {
      const template = FINDING_PROPOSE_TEMPLATES[action];
      expect(template.id).toBe(`finding-propose-${action}-v1`);
      expect(template.version).toBe(1);
      const text = template.render({
        skillName: "code-review",
        findingId: "f-42",
        observedRevision: revision,
      });
      // $name token（芯片配对前提）+ finding/revision 上下文 + 同名工具指令。
      expect(text).toContain("$code-review");
      expect(text).toContain("f-42");
      expect(text).toContain(revision);
      expect(text).toContain(`intelligence_propose_${action}`);
    }
  });

  it("seeds the panel with metadata + skill reference and does not auto-send", () => {
    const rpc = sessionRpc();
    connection.rpc = rpc;
    const text = FINDING_PROPOSE_TEMPLATES.edit.render({
      skillName: "code-review",
      findingId: "f-42",
      observedRevision: revision,
    });
    seedFindingPropose({
      action: "edit",
      text,
      skill,
      skillName: "code-review",
      findingId: "f-42",
      observedRevision: revision,
      templateId: FINDING_PROPOSE_TEMPLATES.edit.id,
      templateVersion: 1,
    });
    expect(agentPanel.open).toBe(true);
    expect(agentPanel.seed?.text).toBe(text);
    expect(agentPanel.seed?.reference).toMatchObject({
      kind: "skill",
      token: "$code-review",
      target: skill.skillId,
      skill,
    });
    expect(agentPanel.seed?.metadata).toMatchObject({
      kind: "finding-propose",
      action: "edit",
      findingId: "f-42",
      observedRevision: revision,
      templateId: "finding-propose-edit-v1",
      templateVersion: 1,
      workspaceId: skill.workspaceId,
      providerId: skill.providerId,
      skillId: skill.skillId,
    });
    // 不自动发送：种子只填输入面，不触任何 RPC。
    expect(rpc.agent.session.create).not.toHaveBeenCalled();
    expect(rpc.agent.session.prompt).not.toHaveBeenCalled();
    expect(agentSession.sessionId).toBeNull();
  });

  it("lazy create carries finding-propose metadata; wire prompt carries the opaque triple", async () => {
    const rpc = sessionRpc();
    connection.rpc = rpc;
    const text = FINDING_PROPOSE_TEMPLATES.merge.render({
      skillName: "code-review",
      findingId: "f-42",
      observedRevision: revision,
    });
    seedFindingPropose({
      action: "merge",
      text,
      skill,
      skillName: "code-review",
      findingId: "f-42",
      observedRevision: revision,
      templateId: "finding-propose-merge-v1",
      templateVersion: 1,
    });
    addComposerReference(agentPanel.seed!.reference!);
    await sendAgentPrompt(text, [], [], "queue", agentComposer.references);
    const createCall = rpc.agent.session.create.mock.calls[0][0];
    expect(createCall.metadata).toMatchObject({
      kind: "finding-propose",
      action: "merge",
      skillId: "sk_0123456789abcdef01234567",
    });
    const promptCall = rpc.agent.session.prompt.mock.calls[0][0];
    expect(promptCall.references[0]).toEqual({
      kind: "skill",
      workspaceId: "ws_0123456789abcdef01234567",
      providerId: "claude-code",
      skillId: "sk_0123456789abcdef01234567",
    });
  });

  it("generic seedComposerPrompt drops a stale pending finding-propose seed (r5 P1 同族)", async () => {
    const rpc = sessionRpc();
    connection.rpc = rpc;
    seedFindingPropose({
      action: "disable",
      text: "disable draft",
      skill,
      skillName: "code-review",
      findingId: "f-42",
      observedRevision: revision,
      templateId: "finding-propose-disable-v1",
      templateVersion: 1,
    });
    agentPanel.seed = null;
    seedComposerPrompt("帮我看下技能库");
    expect(agentPanel.seed).toEqual({ text: "帮我看下技能库" });
    await sendAgentPrompt("帮我看下技能库", [], [], "queue", []);
    const createCall = rpc.agent.session.create.mock.calls[0][0];
    expect("metadata" in createCall).toBe(false);
  });
});
