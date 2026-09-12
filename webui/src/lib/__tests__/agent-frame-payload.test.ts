/**
 * 帧 payload 消费收窄单测（2026-09-12 codex R2 阻塞 4）。
 *
 * 用户原始需求 [2026-09-12]（codex R2 复审）：「todo-snapshot / approval-request /
 * mode-changed 直接把 frame.payload cast 成对象再把字段写入 agentSession」——服务端
 * 帧是跨进程外部输入，消费前必须模块级 Zod schema safeParse，失败丢弃该帧。
 *
 * 正交意图：
 *   [1] 畸形 payload：todo 列表 / 审批卡 / mode 状态均不变、无异常（error 面不亮）。
 *   [2] 合法 payload 仍正常生效（等价回归：快照替换、审批卡渲染、mode 切换落位）。
 *   [3] todo 集合语义：畸形条目逐条丢弃，合法条目保留（既有 filter 行为不变）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

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

import { agentSession, pollAgentStream } from "../stores/agent.svelte";

function frame(seq: number, kind: string, extra: Record<string, unknown> = {}) {
  return {
    at: "2026-09-12T00:00:00.000Z",
    runId: "agent-s1",
    sessionId: "agent-s1",
    seq,
    kind,
    ...extra,
  };
}

/** 单轮 stream 拉取（帧集合一次性下发；终态 idle，无待答审批即停轮询）。 */
async function streamOnce(frames: unknown[]): Promise<void> {
  connection.rpc = {
    agent: {
      session: {
        stream: vi.fn().mockResolvedValue({ frames, status: "idle" }),
      },
    },
  };
  await pollAgentStream();
}

beforeEach(() => {
  connection.rpc = null;
  connection.generation = 0;
  agentSession.sessionId = null;
  agentSession.mode = null;
  agentSession.items = [];
  agentSession.todos = [];
  agentSession.turnStartedAt = null;
  agentSession.cursor = 0;
  agentSession.error = null;
  agentSession.status = "idle";
});

describe("todo-snapshot payload narrowing (codex R2 阻塞 4)", () => {
  it("drops malformed snapshots and keeps the previous todos without erroring", async () => {
    agentSession.sessionId = "agent-s1";
    agentSession.todos = [{ content: "previous", status: "in_progress" }];
    await streamOnce([
      frame(1, "todo-snapshot", { payload: { todos: "not-an-array" } }),
      frame(2, "todo-snapshot", { payload: "garbage" }),
      frame(3, "todo-snapshot", {}),
    ]);
    // 三帧全部畸形：todo 状态保持上一个快照，error 面不亮（无异常路径）。
    expect(agentSession.todos).toEqual([{ content: "previous", status: "in_progress" }]);
    expect(agentSession.error).toBeNull();
  });

  it("keeps valid entries of a mixed snapshot and drops malformed ones (entry-level)", async () => {
    agentSession.sessionId = "agent-s1";
    await streamOnce([
      frame(1, "todo-snapshot", {
        payload: {
          todos: [
            { content: "draft", status: "pending", extra: "stripped" },
            { content: 42, status: "pending" },
            null,
            { status: "completed" },
          ],
        },
      }),
    ]);
    expect(agentSession.todos).toEqual([{ content: "draft", status: "pending" }]);
    expect(agentSession.error).toBeNull();
  });

  it("still applies valid snapshots latest-wins (equivalence)", async () => {
    agentSession.sessionId = "agent-s1";
    agentSession.todos = [{ content: "old", status: "in_progress" }];
    await streamOnce([
      frame(1, "todo-snapshot", {
        payload: { todos: [{ content: "next", status: "completed" }] },
      }),
    ]);
    expect(agentSession.todos).toEqual([{ content: "next", status: "completed" }]);
  });
});

describe("approval-request payload narrowing (codex R2 阻塞 4)", () => {
  it("drops malformed approval frames without creating a card or erroring", async () => {
    agentSession.sessionId = "agent-s1";
    await streamOnce([
      frame(1, "approval-request", { payload: { questions: [{ id: "q1", question: 42 }] } }),
      frame(2, "approval-request", { payload: { questions: "nope" } }),
      frame(3, "approval-request", { payload: undefined }),
    ]);
    expect(agentSession.items.some((item) => item.kind === "approval")).toBe(false);
    expect(agentSession.items).toEqual([]);
    expect(agentSession.error).toBeNull();
  });

  it("accepts well-formed question payloads (equivalence)", async () => {
    agentSession.sessionId = "agent-s1";
    await streamOnce([
      frame(4, "approval-request", {
        payload: {
          questions: [
            {
              id: "q1",
              question: "Proceed?",
              multiSelect: true,
              options: [{ label: "Yes" }, { label: "No", description: "abort" }],
            },
          ],
        },
      }),
    ]);
    const approval = agentSession.items.find((item) => item.kind === "approval");
    expect(approval).toMatchObject({ resolved: false });
    expect(
      approval && approval.kind === "approval"
        ? approval.questions.map((question) => question.id)
        : [],
    ).toEqual(["q1"]);
  });
});

describe("mode-changed payload narrowing (codex R2 阻塞 4)", () => {
  it("drops mode frames with non-enum modes, keeping agentSession.mode untouched", async () => {
    agentSession.sessionId = "agent-s1";
    agentSession.mode = "create";
    await streamOnce([
      frame(1, "mode-changed", { payload: { from: "create", to: "banana" } }),
      frame(2, "mode-changed", { payload: { from: 7, to: "explore" } }),
      frame(3, "mode-changed", { payload: "garbage" }),
    ]);
    // 任意字符串 mode 不再被 cast 进 agentSession.mode / items。
    expect(agentSession.mode).toBe("create");
    expect(agentSession.items.some((item) => item.kind === "mode")).toBe(false);
    expect(agentSession.error).toBeNull();
  });

  it("applies valid mode changes to the projection and the transcript divider (equivalence)", async () => {
    agentSession.sessionId = "agent-s1";
    agentSession.mode = "create";
    await streamOnce([frame(4, "mode-changed", { payload: { from: "create", to: "explore" } })]);
    expect(agentSession.mode).toBe("explore");
    expect(
      agentSession.items.some(
        (item) => item.kind === "mode" && item.from === "create" && item.to === "explore",
      ),
    ).toBe(true);
  });
});
