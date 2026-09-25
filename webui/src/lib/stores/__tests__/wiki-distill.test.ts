/**
 * wiki-distill store 单测（skill-wiki-maintainer task 1.6，2026-09-25）。
 * 用户原始需求 [2026-09-25]：「WikiScopeView workspace scope『Distill to global』：
 * start→进度→跳 proposal 面」+ route/store 测试。
 * 正交意图：
 *   [1] start 闭环：成功进入轮询并提交首帧投影；DISTILL_ACTIVE_RUN 等 typed
 *       拒绝以 { code, message } 返回（错误面不崩栈、不落 runId）。
 *   [2] 轮询纪律：1.5s 间隔、终态（completed/failed/cancelled）自停、轮询失败
 *       停轮并记 pollError（保留已提交投影）。
 *   [3] 代次纪律：路由切换（resetWikiDistill）与断线（connection owner
 *       generation 变化）作废在途 start/status 响应的提交资格。
 *   [4] 决定面投影：agent.proposals.list 按 capability + runId 过滤、ordinal
 *       升序、畸形 input 丢弃；awaiting-approval 且展开时随轮询刷新。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ORPCError } from "@orpc/client";

let connectionGeneration = 0;
let rpcClient: Record<string, unknown> | null = null;

vi.mock("../connection.svelte", () => ({
  connectionState: { status: "idle", error: null },
  connect: vi.fn(),
  disconnect: vi.fn(),
  getConnectionGeneration: () => connectionGeneration,
  getRpc: () => rpcClient,
  requireRpc: () => {
    if (!rpcClient) throw new Error("The Skill Creator daemon is not connected.");
    return rpcClient;
  },
}));

import {
  cancelWikiDistill,
  loadWikiDistillProposals,
  resetWikiDistill,
  setWikiDistillProposalsOpen,
  startWikiDistill,
  wikiDistillProposals,
  wikiDistillState,
} from "../wiki-distill.svelte";
import type {
  DistillCounters,
  DistillStatusOutput,
  RunState,
} from "$shared/contracts/wiki-distill.js";
import { WorkspaceIdSchema } from "$shared/contracts/workspaces.js";

const WS = WorkspaceIdSchema.parse("ws_" + "d".repeat(24));
const RUN_ID = "wd_" + "a".repeat(24);
const OTHER_RUN_ID = "wd_" + "b".repeat(24);

function zeroCounters(overrides: Partial<DistillCounters> = {}): DistillCounters {
  return {
    applied: 0,
    idempotent: 0,
    stale: 0,
    "patch-failed": 0,
    "model-invalid": 0,
    rejected: 0,
    expired: 0,
    "not-proposed": 0,
    "io-failed": 0,
    ...overrides,
  };
}

function statusOf(state: RunState, extra: Partial<DistillStatusOutput> = {}): DistillStatusOutput {
  return {
    runId: RUN_ID,
    state,
    reason: null,
    counters: zeroCounters(),
    proposalRefs: [],
    ...extra,
  };
}

function mockDistill() {
  const start = vi.fn();
  const status = vi.fn();
  const cancel = vi.fn();
  const list = vi.fn();
  rpcClient = { wiki: { distill: { start, status, cancel } }, agent: { proposals: { list } } };
  return { start, status, cancel, list };
}

async function flush(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
  vi.useFakeTimers();
  connectionGeneration = 0;
  rpcClient = null;
  resetWikiDistill();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("startWikiDistill", () => {
  it("starts, commits the run identity, and polls immediately", async () => {
    const { start, status } = mockDistill();
    start.mockResolvedValue({ runId: RUN_ID });
    status.mockResolvedValue(
      statusOf("awaiting-approval", {
        counters: zeroCounters({ applied: 1, stale: 1 }),
        proposalRefs: [
          { ordinal: 0, proposalId: "p0", status: "pending" },
          { ordinal: 1, proposalId: "p1", status: "pending" },
          { ordinal: 2, proposalId: null, status: "applying" },
        ],
      }),
    );

    await expect(startWikiDistill(WS)).resolves.toEqual({ outcome: "started", runId: RUN_ID });
    expect(start).toHaveBeenCalledWith({ source: WS });
    expect(wikiDistillState.starting).toBe(false);
    expect(wikiDistillState.runId).toBe(RUN_ID);

    await flush();
    expect(status).toHaveBeenCalledTimes(1);
    expect(status).toHaveBeenCalledWith({ runId: RUN_ID });
    expect(wikiDistillState.state).toBe("awaiting-approval");
    expect(wikiDistillState.counters).toEqual(zeroCounters({ applied: 1, stale: 1 }));
    expect(wikiDistillState.proposalRefs).toHaveLength(3);
  });

  it("keeps polling at the interval until a terminal state stops it", async () => {
    const { start, status } = mockDistill();
    start.mockResolvedValue({ runId: RUN_ID });
    status
      .mockResolvedValueOnce(statusOf("awaiting-approval"))
      .mockResolvedValueOnce(statusOf("completed", { counters: zeroCounters({ applied: 2 }) }));

    await startWikiDistill(WS);
    await flush();
    await vi.advanceTimersByTimeAsync(1500);
    expect(status).toHaveBeenCalledTimes(2);
    expect(wikiDistillState.state).toBe("completed");

    status.mockClear();
    await vi.advanceTimersByTimeAsync(6000);
    expect(status).not.toHaveBeenCalled();
  });

  it("classifies a DISTILL_ACTIVE_RUN rejection without crashing or committing a run", async () => {
    const { start } = mockDistill();
    start.mockRejectedValue(
      new ORPCError("DISTILL_ACTIVE_RUN", {
        message: `an active distill run ${OTHER_RUN_ID} exists for ${WS}`,
      }),
    );

    const outcome = await startWikiDistill(WS);

    expect(outcome).toEqual({
      outcome: "rejected",
      code: "DISTILL_ACTIVE_RUN",
      message: expect.stringContaining("already running"),
    });
    expect(wikiDistillState.runId).toBeNull();
    expect(wikiDistillState.errorCode).toBe("DISTILL_ACTIVE_RUN");
    expect(wikiDistillState.error).toContain("already running");
    expect(wikiDistillState.starting).toBe(false);
  });

  it("projects a start failure when the daemon is not connected", async () => {
    const outcome = await startWikiDistill(WS);
    expect(outcome?.outcome).toBe("rejected");
    expect(wikiDistillState.errorCode).toBe("UNAVAILABLE");
    expect(wikiDistillState.error).toBe("The Skill Creator daemon is not connected.");
  });

  it("drops a start whose generation went stale on route leave (resetWikiDistill)", async () => {
    const { start } = mockDistill();
    let resolveStart: (value: { runId: string }) => void = () => {};
    start.mockReturnValue(
      new Promise((resolve) => {
        resolveStart = resolve;
      }),
    );

    const pending = startWikiDistill(WS);
    expect(wikiDistillState.starting).toBe(true);
    resetWikiDistill(); // 路由离开：作废在途 start 的提交资格。
    resolveStart({ runId: RUN_ID });
    await expect(pending).resolves.toBeNull();
    expect(wikiDistillState.runId).toBeNull();
    expect(wikiDistillState.starting).toBe(false);
  });

  it("drops a start whose connection owner generation changed mid-flight (reconnect)", async () => {
    const { start } = mockDistill();
    let resolveStart: (value: { runId: string }) => void = () => {};
    start.mockReturnValue(
      new Promise((resolve) => {
        resolveStart = resolve;
      }),
    );

    const pending = startWikiDistill(WS);
    connectionGeneration += 1;
    resolveStart({ runId: RUN_ID });
    await expect(pending).resolves.toBeNull();
    expect(wikiDistillState.runId).toBeNull();
  });

  it("drops an in-flight status poll invalidated by route leave", async () => {
    const { start, status } = mockDistill();
    start.mockResolvedValue({ runId: RUN_ID });
    let resolveStatus: (value: DistillStatusOutput) => void = () => {};
    status.mockReturnValue(
      new Promise((resolve) => {
        resolveStatus = resolve;
      }),
    );

    await startWikiDistill(WS);
    resetWikiDistill();
    resolveStatus(statusOf("awaiting-approval"));
    await flush();
    expect(wikiDistillState.state).toBeNull();
    expect(wikiDistillState.runId).toBeNull();
  });
});

describe("distill polling failure and cancel", () => {
  it("stops polling and records pollError when status fails, keeping the last projection", async () => {
    const { start, status } = mockDistill();
    start.mockResolvedValue({ runId: RUN_ID });
    status
      .mockResolvedValueOnce(statusOf("awaiting-approval"))
      .mockRejectedValue(new Error("distill status blew up"));

    await startWikiDistill(WS);
    await flush();
    expect(wikiDistillState.state).toBe("awaiting-approval");

    await vi.advanceTimersByTimeAsync(1500);
    expect(wikiDistillState.pollError).toBe("distill status blew up");
    expect(wikiDistillState.state).toBe("awaiting-approval"); // 保留已提交投影。

    status.mockClear();
    await vi.advanceTimersByTimeAsync(5000);
    expect(status).not.toHaveBeenCalled();
  });

  it("cancels an awaiting-approval run and stops polling on the terminal state", async () => {
    const { start, status, cancel } = mockDistill();
    start.mockResolvedValue({ runId: RUN_ID });
    status.mockResolvedValue(statusOf("awaiting-approval"));
    cancel.mockResolvedValue({ runId: RUN_ID, state: "cancelled" });

    await startWikiDistill(WS);
    await flush();

    await expect(cancelWikiDistill()).resolves.toBe(true);
    expect(cancel).toHaveBeenCalledWith({ runId: RUN_ID });
    expect(wikiDistillState.state).toBe("cancelled");

    status.mockClear();
    await vi.advanceTimersByTimeAsync(5000);
    expect(status).not.toHaveBeenCalled();
  });

  it("surfaces a typed cancel failure without wiping the run projection", async () => {
    const { start, status, cancel } = mockDistill();
    start.mockResolvedValue({ runId: RUN_ID });
    status.mockResolvedValue(statusOf("awaiting-approval"));
    cancel.mockRejectedValue(
      new ORPCError("DISTILL_RUN_NOT_FOUND", { message: `distill run not found: ${RUN_ID}` }),
    );

    await startWikiDistill(WS);
    await flush();

    await expect(cancelWikiDistill()).resolves.toBe(false);
    expect(wikiDistillState.state).toBe("awaiting-approval");
    expect(wikiDistillState.errorCode).toBe("DISTILL_RUN_NOT_FOUND");
    expect(wikiDistillState.error).toContain("distill run not found");
  });
});

describe("wikiDistillProposals decision face", () => {
  function proposalView(overrides: {
    proposalId: string;
    capability?: string;
    input?: unknown;
    status?: "pending" | "approved" | "rejected" | "executed" | "failed";
  }) {
    return {
      proposalId: overrides.proposalId,
      capability: overrides.capability ?? "wiki.distill_apply",
      input: overrides.input ?? { runId: RUN_ID, ordinal: 0 },
      status: overrides.status ?? "pending",
      createdAt: "2026-09-25T00:00:00.000Z",
    };
  }

  async function arriveAtAwaitingApproval() {
    const mocks = mockDistill();
    mocks.start.mockResolvedValue({ runId: RUN_ID });
    mocks.status.mockResolvedValue(statusOf("awaiting-approval"));
    await startWikiDistill(WS);
    await flush();
    return mocks;
  }

  it("filters by capability and runId, orders by ordinal, and drops malformed inputs", async () => {
    const { list } = await arriveAtAwaitingApproval();
    list.mockResolvedValue({
      proposals: [
        proposalView({ proposalId: "p-late", input: { runId: RUN_ID, ordinal: 2 } }),
        proposalView({ proposalId: "p-other-capability", capability: "skill.save" }),
        proposalView({ proposalId: "p-other-run", input: { runId: OTHER_RUN_ID, ordinal: 0 } }),
        proposalView({ proposalId: "p-bad-input", input: { runId: RUN_ID } }),
        proposalView({ proposalId: "p-first", input: { runId: RUN_ID, ordinal: 0 } }),
        proposalView({
          proposalId: "p-decided",
          input: { runId: RUN_ID, ordinal: 1 },
          status: "executed",
        }),
      ],
    });

    setWikiDistillProposalsOpen(true);
    await flush();

    expect(list).toHaveBeenCalledWith({});
    expect(wikiDistillProposals.open).toBe(true);
    expect(wikiDistillProposals.proposals.map((row) => row.view.proposalId)).toEqual([
      "p-first",
      "p-decided",
      "p-late",
    ]);
    expect(wikiDistillProposals.proposals.map((row) => row.ordinal)).toEqual([0, 1, 2]);
    expect(wikiDistillProposals.error).toBeNull();
  });

  it("refreshes the open list on each awaiting-approval poll tick", async () => {
    const { list } = await arriveAtAwaitingApproval();
    list.mockResolvedValue({ proposals: [] });

    setWikiDistillProposalsOpen(true);
    await flush();
    expect(list).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1500);
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("does not refresh a closed list while polling", async () => {
    const { list } = await arriveAtAwaitingApproval();
    await vi.advanceTimersByTimeAsync(1500);
    expect(list).not.toHaveBeenCalled();
  });

  it("keeps the last list and records the error when loading fails", async () => {
    const { list } = await arriveAtAwaitingApproval();
    list.mockResolvedValueOnce({
      proposals: [proposalView({ proposalId: "p-first" })],
    });

    setWikiDistillProposalsOpen(true);
    await flush();
    expect(wikiDistillProposals.proposals).toHaveLength(1);

    list.mockRejectedValue(new Error("proposals list failed"));
    await loadWikiDistillProposals();
    expect(wikiDistillProposals.error).toBe("proposals list failed");
    expect(wikiDistillProposals.proposals).toHaveLength(1);
  });
});
