/**
 * evaluation-view store 单测（evaluation-webui-view 2.1/2.2/3.1）。
 * 用户原始需求 [2026-09-30]（evaluation-corpus Ch3 后续批）：评估语料最小只读查看面。
 * 正交意图：
 *   [1] loading / error / empty 三态与 latest-wins + 连接替换的提交纪律
 *       （被取代或断线的请求不伪造数据）。
 *   [2] 纯函数投影：每案最新结果选取（含同时刻 tie-break）、行合并、五态徽标
 *       配色互异。
 * 说明：daemon 侧存储/五态协议/读写闸门由 test/evaluation-*.test.ts 覆盖；
 * 本文件只覆盖 WebUI store 层不变量。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

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
  buildEvaluationRows,
  compareResultsNewestFirst,
  evaluationOutcomeBadge,
  evaluationViewState,
  latestResultByCase,
  loadEvaluationView,
  resetEvaluationView,
} from "../evaluation-view.svelte";
import type {
  EvaluationCase,
  EvaluationResultView,
  EvaluationTarget,
} from "$shared/contracts/evaluation.js";

const target = {
  workspaceId: "ws_0123456789abcdef01234567",
  providerId: "openclaw",
  skillId: "sk_0123456789abcdef01234567",
} as EvaluationTarget;

function makeCase(overrides: Partial<EvaluationCase> = {}): EvaluationCase {
  return {
    schemaVersion: 1,
    caseId: `ev_${"a".repeat(24)}`,
    enabled: true,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    source: "user",
    boundRevision: `sha256:${"b".repeat(64)}`,
    input: {
      prompt: "Summarize the licensing section",
      assertions: [
        { kind: "contains", value: "MIT" },
        { kind: "finding-triggered", value: true },
      ],
    },
    ...overrides,
  } as EvaluationCase;
}

function makeResult(overrides: Partial<EvaluationResultView> = {}): EvaluationResultView {
  return {
    schemaVersion: 1,
    resultId: `evr_${"1".repeat(24)}`,
    runId: `run_${"2".repeat(24)}`,
    caseId: `ev_${"a".repeat(24)}`,
    target,
    expectedRevision: `sha256:${"b".repeat(64)}`,
    observedStartRevision: `sha256:${"b".repeat(64)}`,
    observedEndRevision: `sha256:${"b".repeat(64)}`,
    runner: {
      kind: "analyzer",
      version: { promptVersion: "p1", toolVersion: "t1", dshVersion: "n/a" },
    },
    startedAt: "2026-10-01T00:00:01.000Z",
    endedAt: "2026-10-01T00:00:02.000Z",
    outcome: "passed",
    assertions: [
      { ref: 0, outcome: "passed" },
      { ref: 1, outcome: "passed" },
    ],
    stale: false,
    ...overrides,
  } as EvaluationResultView;
}

function mockEvaluation(
  cases: EvaluationCase[],
  results: EvaluationResultView[],
): { casesList: ReturnType<typeof vi.fn>; resultsList: ReturnType<typeof vi.fn> } {
  const casesList = vi.fn().mockResolvedValue({ cases });
  const resultsList = vi.fn().mockResolvedValue({ results });
  rpcClient = { evaluation: { cases: { list: casesList }, results: { list: resultsList } } };
  return { casesList, resultsList };
}

beforeEach(() => {
  connectionGeneration = 0;
  rpcClient = null;
  resetEvaluationView();
});

describe("evaluation-view store (evaluation-webui-view)", () => {
  it("loads both read-only RPCs with the target and merges rows", async () => {
    const { casesList, resultsList } = mockEvaluation(
      [makeCase()],
      [makeResult({ outcome: "failed" })],
    );
    const pending = loadEvaluationView(target);
    expect(evaluationViewState.loading).toBe(true);
    await pending;
    expect(casesList).toHaveBeenCalledWith({ target });
    expect(resultsList).toHaveBeenCalledWith({ target });
    expect(evaluationViewState.loading).toBe(false);
    expect(evaluationViewState.error).toBeNull();
    expect(evaluationViewState.rows).toEqual([
      {
        caseId: `ev_${"a".repeat(24)}`,
        prompt: "Summarize the licensing section",
        enabled: true,
        assertionCount: 2,
        boundRevision: `sha256:${"b".repeat(64)}`,
        latest: expect.objectContaining({ outcome: "failed" }),
      },
    ]);
  });

  it("projects an empty corpus as zero rows without fabricating data", async () => {
    mockEvaluation([], []);
    await loadEvaluationView(target);
    expect(evaluationViewState.rows).toEqual([]);
    expect(evaluationViewState.error).toBeNull();
  });

  it("records the failure as structured error and drops rows", async () => {
    rpcClient = {
      evaluation: {
        cases: { list: vi.fn().mockRejectedValue(new Error("evaluation store unreadable")) },
        results: { list: vi.fn().mockResolvedValue({ results: [] }) },
      },
    };
    evaluationViewState.rows = [buildEvaluationRows([makeCase()], [])[0]!];
    await loadEvaluationView(target);
    expect(evaluationViewState.rows).toBeNull();
    expect(evaluationViewState.error).toBe("evaluation store unreadable");
  });

  it("drops a load superseded by a newer request", async () => {
    const firstRelease: { run?: (value: unknown) => void } = {};
    const firstCall = new Promise<unknown>((resolve) => {
      firstRelease.run = resolve;
    });
    rpcClient = {
      evaluation: {
        cases: { list: vi.fn().mockImplementationOnce(() => firstCall) },
        results: { list: vi.fn().mockResolvedValue({ results: [] }) },
      },
    };
    const first = loadEvaluationView(target);
    mockEvaluation(
      [
        makeCase({
          input: { prompt: "newer corpus", assertions: [{ kind: "contains", value: "x" }] },
        }),
      ],
      [],
    );
    const second = loadEvaluationView(target);
    firstRelease.run?.({
      cases: [
        makeCase({
          input: { prompt: "older corpus", assertions: [{ kind: "contains", value: "x" }] },
        }),
      ],
    });
    await first;
    await second;
    // 旧请求虽已完成，但已被新请求取代：新请求的语料拥有投影。
    expect(evaluationViewState.rows?.map((row) => row.prompt)).toEqual(["newer corpus"]);
  });

  it("drops a load after the connection was replaced", async () => {
    const release: { run?: (value: unknown) => void } = {};
    const pendingCases = new Promise<unknown>((resolve) => {
      release.run = resolve;
    });
    rpcClient = {
      evaluation: {
        cases: { list: vi.fn().mockImplementationOnce(() => pendingCases) },
        results: { list: vi.fn().mockResolvedValue({ results: [] }) },
      },
    };
    const inFlight = loadEvaluationView(target);
    connectionGeneration += 1; // 断线重连替换了 client 所有权。
    release.run?.({ cases: [makeCase()] });
    await inFlight;
    expect(evaluationViewState.rows).toBeNull();
    expect(evaluationViewState.error).toBeNull();
    expect(evaluationViewState.loading).toBe(false);
  });

  it("issues no RPC and fakes nothing when disconnected", async () => {
    const casesList = vi.fn();
    rpcClient = { evaluation: { cases: { list: casesList } } };
    rpcClient = null;
    await loadEvaluationView(target);
    expect(casesList).not.toHaveBeenCalled();
    expect(evaluationViewState.rows).toBeNull();
    expect(evaluationViewState.error).toBeNull();
    expect(evaluationViewState.loading).toBe(false);
  });

  it("picks the newest result per case with a deterministic same-instant tie-break", () => {
    const caseId = `ev_${"a".repeat(24)}`;
    const otherCaseId = `ev_${"c".repeat(24)}`;
    const older = makeResult({ caseId, endedAt: "2026-10-01T00:00:02.000Z" });
    const newer = makeResult({
      resultId: `evr_${"9".repeat(24)}`,
      caseId,
      endedAt: "2026-10-01T00:00:09.000Z",
      outcome: "stale",
    });
    const byCase = latestResultByCase([older, newer, makeResult({ caseId: otherCaseId })]);
    expect(byCase.get(caseId)).toBe(newer);
    expect(byCase.get(otherCaseId)).toBeDefined();
    // 同时刻：resultId 倒序 tie-break（字典序大者胜，确定性）。
    const low = makeResult({ resultId: `evr_${"1".repeat(24)}`, caseId });
    const high = makeResult({ resultId: `evr_${"9".repeat(24)}`, caseId });
    expect(latestResultByCase([low, high]).get(caseId)).toBe(high);
    expect(latestResultByCase([high, low]).get(caseId)).toBe(high);
  });

  it("compares equal (endedAt, resultId) pairs as 0 with stable ordering (codex P2)", () => {
    // Comparator 契约：相等键必须返回 0——旧实现对相同 resultId 返回 -1，
    // 向排序器谎报严格偏序（违反 Array#sort comparator 语义）。
    const caseId = `ev_${"a".repeat(24)}`;
    const first = makeResult({ caseId });
    const sameKey = makeResult({ caseId, resultId: first.resultId, endedAt: first.endedAt });
    expect(compareResultsNewestFirst(first, sameKey)).toBe(0);
    expect(compareResultsNewestFirst(sameKey, first)).toBe(0);
    // 稳定排序落点：相同键不互换首见顺序，latest 仍取输入第一条。
    expect(latestResultByCase([first, sameKey]).get(caseId)).toBe(first);
  });

  it("maps five outcome badges to pairwise distinct tones and keeps not-run rows latest=null", () => {
    const tones = (["passed", "failed", "error", "unavailable", "stale"] as const).map((outcome) =>
      evaluationOutcomeBadge(outcome),
    );
    expect(new Set(tones).size).toBe(5);
    const rows = buildEvaluationRows(
      [makeCase({ enabled: false }), makeCase({ caseId: `ev_${"d".repeat(24)}` })],
      [makeResult({ caseId: `ev_${"a".repeat(24)}`, outcome: "unavailable" })],
    );
    expect(rows[0]).toMatchObject({ enabled: false, latest: { outcome: "unavailable" } });
    expect(rows[1]!.latest).toBeNull();
  });
});
