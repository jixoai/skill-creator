/**
 * evaluation-view store 单测（evaluation-webui-view 2.1/2.2/3.1 +
 * evaluating-dashboard 1.2/1.3 store 面）。
 * 用户原始需求 [2026-09-30]（evaluation-corpus Ch3 后续批）：评估语料最小只读查看面。
 * 修订 [2026-10-03]（evaluating-dashboard）：补 overview 聚合（分页/代次门）、
 * run 追踪（Global 前置拒/轮询至终态/cancel 幂等）与展示层纯投影。
 * 修订 [2026-10-04]（evaluating-world-class 1.2）：run 时间线/case 树/断言详情
 * 行纯投影、case 树键盘导航、run 轮询 live 进度（resultCount/totalCases）与
 * 运行中匹配投影刷新。
 * 正交意图：
 *   [1] loading / error / empty 三态与 latest-wins + 连接替换的提交纪律
 *       （被取代或断线的请求不伪造数据）——详情行与总览分页双面。
 *   [2] 纯函数投影：每案最新结果选取（含同时刻 tie-break）、行合并（含断言
 *       定义）、五态徽标配色互异、相对时间、分页合并去重、run 时间线/case 树/
 *       断言详情行/键盘导航。
 *   [3] run 生命周期：Global 拒（零 RPC）、断线拒、start→queued→轮询→completed
 *       （每刻刷新匹配投影 + live 进度）、cancel（终态幂等 + 刷新）。
 * 说明：daemon 侧存储/五态协议/读写闸门由 test/evaluation-*.test.ts 覆盖；
 * 本文件只覆盖 WebUI store 层不变量。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  assertionDetailRows,
  buildCaseTreeNodes,
  buildEvaluationRows,
  buildRunTimeline,
  cancelEvaluationRun,
  caseTreeKeyboard,
  caseTreeLabel,
  compareResultsNewestFirst,
  detailErrorCount,
  evaluationHealthFor,
  evaluationOutcomeBadge,
  evaluationOverviewState,
  evaluationPassRate,
  evaluationRunState,
  evaluationTargetKey,
  evaluationViewState,
  latestResultByCase,
  loadEvaluationOverview,
  loadEvaluationView,
  loadMoreEvaluationOverview,
  mergeOverviewTargets,
  newestRecentRunForTarget,
  relativeTimeParts,
  resetEvaluationOverview,
  resetEvaluationRun,
  resetEvaluationView,
  runResultsByCase,
  RUN_POLL_INTERVAL_MS,
  startEvaluationRun,
  type CaseTreeSelectionState,
} from "../evaluation-view.svelte";
import type {
  EvaluationCase,
  EvaluationOverviewOutput,
  EvaluationOverviewRecentRun,
  EvaluationOverviewTarget,
  EvaluationResultView,
  EvaluationTarget,
} from "$shared/contracts/evaluation.js";
import type { WorkspaceId } from "$shared/contracts/workspaces.js";

const WS_ID = "ws_0123456789abcdef01234567" as WorkspaceId;
const OTHER_WS_ID = "ws_ffffffffffffffffffffffff" as WorkspaceId;

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
      { ref: 0, kind: "contains", expected: "MIT", observed: "…MIT…", outcome: "passed" },
      { ref: 1, kind: "finding-triggered", expected: "true", observed: "true", outcome: "passed" },
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
  resetEvaluationOverview();
  resetEvaluationRun();
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
    expect(evaluationViewState.target).toEqual(target);
    expect(evaluationViewState.rows).toEqual([
      {
        caseId: `ev_${"a".repeat(24)}`,
        prompt: "Summarize the licensing section",
        enabled: true,
        assertionCount: 2,
        assertions: [
          { kind: "contains", value: "MIT" },
          { kind: "finding-triggered", value: true },
        ],
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

  it("counts detail error rows for the non-zero red chip projection", () => {
    const rows = [
      { latest: { outcome: "error" } },
      { latest: { outcome: "error" } },
      { latest: { outcome: "passed" } },
      { latest: null },
    ] as unknown as ReturnType<typeof buildEvaluationRows>;
    expect(detailErrorCount(rows)).toBe(2);
    expect(detailErrorCount([])).toBe(0);
  });
});

/** 构造 overview target 行（ok 或 typed error）。 */
function okTarget(
  overrides: Partial<Extract<EvaluationOverviewTarget, { skillName: string }>> = {},
): Extract<EvaluationOverviewTarget, { skillName: string }> {
  return {
    target,
    skillName: "code-review",
    caseCount: 2,
    ...(overrides.lastRun === undefined ? {} : { lastRun: overrides.lastRun }),
    ...(overrides.staleRatio === undefined ? {} : { staleRatio: overrides.staleRatio }),
    ...overrides,
  } as Extract<EvaluationOverviewTarget, { skillName: string }>;
}

function overviewOutput(
  targets: EvaluationOverviewTarget[],
  recentRuns: EvaluationOverviewOutput["recentRuns"] = [],
  nextCursor?: string,
): EvaluationOverviewOutput {
  return {
    targets,
    recentRuns,
    ...(nextCursor === undefined ? {} : { nextCursor }),
  } as EvaluationOverviewOutput;
}

function mockOverview(): ReturnType<typeof vi.fn> {
  const overview = vi.fn();
  rpcClient = { evaluation: { overview } };
  return overview;
}

describe("evaluation overview store (evaluating-dashboard 1.2)", () => {
  it("commits the first page with wsId ownership and clears prior error", async () => {
    const overview = mockOverview().mockResolvedValue(
      overviewOutput(
        [okTarget()],
        [
          {
            runId: `run_${"1".repeat(24)}`,
            target,
            status: "running",
            startedAt: "2026-10-03T00:00:00.000Z",
            resultIds: [],
          },
        ],
        "cursor-1",
      ),
    );
    await loadEvaluationOverview(WS_ID);
    expect(overview).toHaveBeenCalledWith({ wsId: WS_ID });
    expect(evaluationOverviewState.wsId).toBe(WS_ID);
    expect(evaluationOverviewState.targets).toHaveLength(1);
    expect(evaluationOverviewState.recentRuns).toHaveLength(1);
    expect(evaluationOverviewState.nextCursor).toBe("cursor-1");
    expect(evaluationOverviewState.error).toBeNull();
  });

  it("appends the next cursor page with triple-key dedupe (incoming wins)", async () => {
    const otherTarget = {
      ...target,
      skillId: "sk_ffffffffffffffffffffffff" as EvaluationTarget["skillId"],
    };
    const overview = mockOverview()
      .mockResolvedValueOnce(overviewOutput([okTarget()], [], "cursor-1"))
      .mockResolvedValueOnce(
        overviewOutput([
          // 续页重复首页行（服务端不产生，防御性去重）+ 新行。
          okTarget({ caseCount: 9 }),
          okTarget({ target: otherTarget }),
        ]),
      );
    await loadEvaluationOverview(WS_ID);
    await loadMoreEvaluationOverview(WS_ID);
    expect(overview).toHaveBeenLastCalledWith({
      wsId: WS_ID,
      cursor: "cursor-1",
    });
    expect(evaluationOverviewState.targets).toHaveLength(2);
    expect(evaluationOverviewState.targets[0]).toMatchObject({ caseCount: 9 });
    expect(evaluationOverviewState.nextCursor).toBeNull();
  });

  it("no-ops load-more without a cursor or a matching ws owner", async () => {
    const overview = mockOverview();
    await loadMoreEvaluationOverview(WS_ID);
    expect(overview).not.toHaveBeenCalled();
    evaluationOverviewState.nextCursor = "cursor-1";
    evaluationOverviewState.wsId = OTHER_WS_ID;
    await loadMoreEvaluationOverview(WS_ID);
    expect(overview).not.toHaveBeenCalled();
  });

  it("drops a superseded overview commit (replace wins over slow in-flight)", async () => {
    const release: { run?: (value: unknown) => void } = {};
    const slow = new Promise<unknown>((resolve) => {
      release.run = resolve;
    });
    const overview = mockOverview()
      .mockImplementationOnce(() => slow)
      .mockResolvedValueOnce(overviewOutput([okTarget({ skillName: "fresh" })]));
    const first = loadEvaluationOverview(WS_ID);
    const second = loadEvaluationOverview(WS_ID);
    release.run?.(overviewOutput([okTarget({ skillName: "stale" })]));
    await first;
    await second;
    expect(
      evaluationOverviewState.targets.map((row) => ("skillName" in row ? row.skillName : "")),
    ).toEqual(["fresh"]);
  });

  it("drops an overview commit after the connection was replaced", async () => {
    const release: { run?: (value: unknown) => void } = {};
    const slow = new Promise<unknown>((resolve) => {
      release.run = resolve;
    });
    mockOverview().mockImplementationOnce(() => slow);
    const inFlight = loadEvaluationOverview(WS_ID);
    connectionGeneration += 1;
    release.run?.(overviewOutput([okTarget()]));
    await inFlight;
    expect(evaluationOverviewState.targets).toEqual([]);
    expect(evaluationOverviewState.error).toBeNull();
  });

  it("records overview failures as typed error and clears projections", async () => {
    mockOverview().mockRejectedValue(new Error("evaluation overview enumeration failed"));
    await loadEvaluationOverview(WS_ID);
    expect(evaluationOverviewState.error).toBe("evaluation overview enumeration failed");
    expect(evaluationOverviewState.targets).toEqual([]);
    expect(evaluationOverviewState.wsId).toBe(WS_ID);
  });

  it("issues no overview RPC when disconnected", async () => {
    const overview = mockOverview();
    rpcClient = null;
    await loadEvaluationOverview(WS_ID);
    expect(overview).not.toHaveBeenCalled();
    expect(evaluationOverviewState.loading).toBe(false);
    expect(evaluationOverviewState.error).toBeNull();
  });

  it("merges overview pages by triple key keeping first-seen order (pure projection)", () => {
    const otherTarget = {
      ...target,
      skillId: "sk_ffffffffffffffffffffffff" as EvaluationTarget["skillId"],
    };
    const merged = mergeOverviewTargets(
      [okTarget(), okTarget({ target: otherTarget })],
      [
        okTarget({ caseCount: 5 }),
        okTarget({
          target: { ...target, providerId: "claude-code" as EvaluationTarget["providerId"] },
        }),
      ],
    );
    expect(merged).toHaveLength(3);
    expect(merged[0]).toMatchObject({ caseCount: 5 });
  });

  it("projects relative time parts across unit boundaries", () => {
    const now = new Date("2026-10-03T12:00:00.000Z").getTime();
    expect(relativeTimeParts("2026-10-03T11:59:30.000Z", now)).toEqual({ unit: "now" });
    expect(relativeTimeParts("2026-10-03T11:30:00.000Z", now)).toEqual({
      unit: "minutes",
      value: 30,
    });
    expect(relativeTimeParts("2026-10-03T07:00:00.000Z", now)).toEqual({ unit: "hours", value: 5 });
    expect(relativeTimeParts("2026-09-30T12:00:00.000Z", now)).toEqual({ unit: "days", value: 3 });
    expect(relativeTimeParts("not-a-date", now)).toBeNull();
  });
});

function mockRunRpc(): {
  start: ReturnType<typeof vi.fn>;
  status: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
} {
  const start = vi.fn();
  const status = vi.fn();
  const cancel = vi.fn();
  rpcClient = { evaluation: { run: { start, status, cancel } } };
  return { start, status, cancel };
}

describe("evaluation run tracking (evaluating-dashboard 1.3)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects a Global target before any RPC (design §2 UI 门)", async () => {
    const { start } = mockRunRpc();
    const outcome = await startEvaluationRun({
      target: { ...target, workspaceId: "~" },
      caseIds: [`ev_${"a".repeat(24)}`],
      runner: "analyzer",
    });
    expect(outcome).toEqual({ ok: false, reason: "global" });
    expect(start).not.toHaveBeenCalled();
    expect(evaluationRunState.runId).toBeNull();
  });

  it("rejects with a typed reason while disconnected", async () => {
    rpcClient = null;
    const outcome = await startEvaluationRun({
      target,
      caseIds: [`ev_${"a".repeat(24)}`],
      runner: "analyzer",
    });
    expect(outcome).toEqual({ ok: false, reason: "disconnected" });
  });

  it("tracks queued → running → completed and refreshes matching projections", async () => {
    vi.useFakeTimers();
    // 匹配投影：详情行与总览均已装载同一 target/ws。
    evaluationViewState.target = target;
    evaluationViewState.rows = [];
    evaluationOverviewState.wsId = target.workspaceId;
    const {
      cases: { list: casesList },
      results: { list: resultsList },
    } = {
      cases: { list: vi.fn().mockResolvedValue({ cases: [makeCase()] }) },
      results: { list: vi.fn().mockResolvedValue({ results: [] }) },
    } as never;
    const overview = vi.fn().mockResolvedValue(overviewOutput([]));
    const { start, status } = mockRunRpc();
    rpcClient = {
      evaluation: {
        run: { start, status, cancel: vi.fn() },
        cases: { list: casesList },
        results: { list: resultsList },
        overview,
      },
    };

    start.mockResolvedValue({ runId: `run_${"1".repeat(24)}`, status: "queued" });
    status
      .mockResolvedValueOnce({ status: "running", resultIds: [] })
      .mockResolvedValue({ status: "completed", resultIds: [`evr_${"1".repeat(24)}`] });

    const outcome = await startEvaluationRun({
      target,
      caseIds: [`ev_${"a".repeat(24)}`],
      runner: "analyzer",
    });
    expect(outcome).toEqual({ ok: true, runId: `run_${"1".repeat(24)}` });
    expect(evaluationRunState.status).toBe("queued");

    await vi.advanceTimersByTimeAsync(RUN_POLL_INTERVAL_MS);
    expect(status).toHaveBeenCalledTimes(1);
    expect(evaluationRunState.status).toBe("running");
    // live 进度（evaluating-world-class 1.2）：start 记录总数、每刻同步已到达数。
    expect(evaluationRunState.totalCases).toBe(1);
    expect(evaluationRunState.resultCount).toBe(0);
    // 运行中即刷新匹配投影（case 逐个点亮的驱动源）。
    await Promise.resolve();
    await Promise.resolve();
    expect(casesList).toHaveBeenCalledWith({ target });

    await vi.advanceTimersByTimeAsync(RUN_POLL_INTERVAL_MS);
    expect(evaluationRunState.status).toBe("completed");
    expect(evaluationRunState.resultCount).toBe(1);
    // 终态刷新：匹配 target 的详情行 + 匹配 ws 的总览页都被重拉。
    await Promise.resolve();
    await Promise.resolve();
    expect(casesList).toHaveBeenCalledWith({ target });
    expect(overview).toHaveBeenCalledWith({ wsId: target.workspaceId });
  });

  it("stops tracking with an error when the run disappears (daemon restart)", async () => {
    vi.useFakeTimers();
    const { start, status } = mockRunRpc();
    start.mockResolvedValue({ runId: `run_${"1".repeat(24)}`, status: "queued" });
    status.mockRejectedValue(new Error("run not found"));
    await startEvaluationRun({ target, caseIds: [`ev_${"a".repeat(24)}`], runner: "analyzer" });
    await vi.advanceTimersByTimeAsync(RUN_POLL_INTERVAL_MS);
    expect(evaluationRunState.error).toBe("run not found");
    expect(evaluationRunState.status).toBe("queued"); // 不伪装终态。
  });

  it("cancel settles the tracked run and refreshes (idempotent terminal semantics)", async () => {
    vi.useFakeTimers();
    const start = vi.fn().mockResolvedValue({ runId: `run_${"1".repeat(24)}`, status: "queued" });
    const status = vi.fn();
    const casesList = vi.fn().mockResolvedValue({ cases: [] });
    const resultsList = vi.fn().mockResolvedValue({ results: [] });
    const cancel = vi
      .fn()
      .mockResolvedValue({ runId: `run_${"1".repeat(24)}`, status: "completed" });
    rpcClient = {
      evaluation: {
        run: { start, status, cancel },
        cases: { list: casesList },
        results: { list: resultsList },
      },
    };
    await startEvaluationRun({ target, caseIds: [`ev_${"a".repeat(24)}`], runner: "analyzer" });
    evaluationViewState.target = target;
    evaluationViewState.rows = [];

    // cancel 幂等返终态（completed 后 cancel → completed）。
    const outcome = await cancelEvaluationRun(`run_${"1".repeat(24)}`);
    expect(outcome.ok).toBe(true);
    expect(evaluationRunState.status).toBe("completed");
    await Promise.resolve();
    await Promise.resolve();
    expect(casesList).toHaveBeenCalledWith({ target });
    expect(status).not.toHaveBeenCalled();
  });

  it("cancel failures surface the message without faking success", async () => {
    mockRunRpc();
    evaluationRunState.runId = `run_${"1".repeat(24)}`;
    evaluationRunState.status = "running";
    (
      rpcClient as { evaluation: { run: { cancel: ReturnType<typeof vi.fn> } } }
    ).evaluation.run.cancel = vi.fn().mockRejectedValue(new Error("cancel blew up"));
    const outcome = await cancelEvaluationRun(`run_${"1".repeat(24)}`);
    expect(outcome).toEqual({ ok: false, message: "cancel blew up" });
    expect(evaluationRunState.status).toBe("running");
  });
});

describe("run timeline / case tree projections (evaluating-world-class 1.2)", () => {
  const RUN_A = `run_${"1".repeat(24)}`;
  const RUN_B = `run_${"3".repeat(24)}`;

  it("groups results into newest-first timeline rows with five-state counts", () => {
    const rows = buildRunTimeline(
      [
        makeResult({
          runId: RUN_A,
          startedAt: "2026-10-01T00:00:01.000Z",
          endedAt: "2026-10-01T00:00:02.000Z",
        }),
        makeResult({
          runId: RUN_A,
          caseId: `ev_${"b".repeat(24)}`,
          outcome: "failed",
          assertions: [
            { ref: 0, kind: "contains", expected: "MIT", observed: "nope", outcome: "failed" },
          ],
          startedAt: "2026-10-01T00:00:03.000Z",
          endedAt: "2026-10-01T00:00:04.000Z",
        }),
        makeResult({
          runId: RUN_B,
          outcome: "unavailable",
          assertions: [],
          failure: { code: "DSH_UNAVAILABLE", detail: "x" },
          startedAt: "2026-10-02T00:00:00.000Z",
          endedAt: "2026-10-02T00:00:01.000Z",
        }),
      ],
      null,
    );
    expect(rows.map((row) => row.runId)).toEqual([RUN_B, RUN_A]);
    expect(rows[0]).toMatchObject({
      status: "completed",
      startedAt: "2026-10-02T00:00:00.000Z",
      endedAt: "2026-10-02T00:00:01.000Z",
    });
    expect(rows[0].counts).toEqual({ passed: 0, failed: 0, error: 0, unavailable: 1, stale: 0 });
    expect(rows[1].counts).toEqual({ passed: 1, failed: 1, error: 0, unavailable: 0, stale: 0 });
    // 组内 startedAt 取最小、endedAt 取最大。
    expect(rows[1].startedAt).toBe("2026-10-01T00:00:01.000Z");
    expect(rows[1].endedAt).toBe("2026-10-01T00:00:04.000Z");
  });

  it("lets the tracked in-memory run win and synthesizes a row before any result lands", () => {
    const tracked = {
      runId: RUN_A,
      status: "running" as const,
      startedAt: "2026-10-03T00:00:00.000Z",
    };
    const noResults = buildRunTimeline([], tracked);
    expect(noResults).toHaveLength(1);
    expect(noResults[0]).toMatchObject({ runId: RUN_A, status: "running", endedAt: null });

    const withPersisted = buildRunTimeline(
      [makeResult({ runId: RUN_A, startedAt: "2026-10-01T00:00:00.000Z" })],
      tracked,
    );
    expect(withPersisted).toHaveLength(1);
    expect(withPersisted[0].status).toBe("running");
    expect(withPersisted[0].startedAt).toBe("2026-10-01T00:00:00.000Z");
  });

  it("maps the selected run's results per case keeping the newest duplicate", () => {
    const caseId = `ev_${"a".repeat(24)}`;
    const byCase = runResultsByCase(
      [
        makeResult({
          runId: RUN_B,
          caseId,
          endedAt: "2026-10-01T00:00:05.000Z",
          resultId: `evr_${"9".repeat(24)}`,
        }),
        makeResult({ runId: RUN_A, caseId, endedAt: "2026-10-01T00:00:09.000Z" }),
        makeResult({ runId: RUN_A, caseId: `ev_${"c".repeat(24)}` }),
      ],
      RUN_A,
    );
    expect(byCase.size).toBe(2);
    expect(byCase.get(caseId)?.resultId).toBe(`evr_${"1".repeat(24)}`);
  });

  it("builds case tree nodes with run results and assertion score fractions", () => {
    const failed = `ev_${"a".repeat(24)}`;
    const clean = `ev_${"b".repeat(24)}`;
    const untouched = `ev_${"c".repeat(24)}`;
    const cases = [failed, clean, untouched].map((caseId, index) =>
      makeCase({
        caseId,
        enabled: index !== 2,
        input: {
          prompt: index === 0 ? "first line\nsecond line" : `prompt ${index}`,
          assertions: makeCase().input.assertions,
        },
      }),
    );
    const nodes = buildCaseTreeNodes(
      cases,
      new Map([
        [
          failed,
          makeResult({
            caseId: failed,
            outcome: "failed",
            assertions: [
              { ref: 0, kind: "contains", expected: "MIT", observed: "no", outcome: "passed" },
              {
                ref: 1,
                kind: "finding-triggered",
                expected: "true",
                observed: "false",
                outcome: "failed",
              },
            ],
          }),
        ],
        [
          clean,
          makeResult({
            caseId: clean,
            outcome: "unavailable",
            assertions: [],
            failure: { code: "DSH_UNAVAILABLE", detail: "x" },
          }),
        ],
      ]),
    );
    expect(nodes.map((node) => node.caseId)).toEqual([failed, clean, untouched]);
    expect(nodes[0].label).toBe("first line");
    expect(nodes[0].score).toEqual({ passed: 1, total: 2 });
    // unavailable 族无断言裁决 → score=null、结果行保留。
    expect(nodes[1].score).toBeNull();
    expect(nodes[1].runResult?.outcome).toBe("unavailable");
    // 未进该 run 的 case → 灰态（runResult=null）。
    expect(nodes[2].runResult).toBeNull();
    expect(nodes[2].enabled).toBe(false);
  });

  it("truncates long tree labels to the first prompt line", () => {
    expect(caseTreeLabel("one\ntwo")).toBe("one");
    expect(caseTreeLabel(`${"x".repeat(80)}\ntwo`)).toBe(`${"x".repeat(72)}…`);
    expect(caseTreeLabel(`${"x".repeat(72)}\ntwo`)).toBe("x".repeat(72));
  });

  it("projects assertion detail rows from frozen result fields with case descriptions", () => {
    const rows = assertionDetailRows(
      makeResult({
        outcome: "failed",
        assertions: [
          {
            ref: 0,
            kind: "contains",
            expected: "MIT",
            observed: "Apache instead",
            outcome: "passed",
          },
          {
            ref: 1,
            kind: "finding-triggered",
            expected: "false",
            observed: "true",
            outcome: "failed",
          },
        ],
      }),
      [
        { kind: "contains", value: "MIT", description: "license line" },
        { kind: "finding-triggered", value: false },
      ],
    );
    expect(rows).toEqual([
      {
        ref: 0,
        kind: "contains",
        expected: "MIT",
        observed: "Apache instead",
        outcome: "passed",
        description: "license line",
      },
      {
        ref: 1,
        kind: "finding-triggered",
        expected: "false",
        observed: "true",
        outcome: "failed",
        description: null,
      },
    ]);
    // stale/unavailable（assertions 恒空）与未跑 → 空行集。
    expect(
      assertionDetailRows(
        makeResult({ outcome: "stale", assertions: [] }),
        makeCase().input.assertions,
      ),
    ).toEqual([]);
    expect(assertionDetailRows(null, makeCase().input.assertions)).toEqual([]);
  });

  it("navigates the case tree with arrows clamped at the ends and Escape collapsing", () => {
    const ids = [`ev_${"a".repeat(24)}`, `ev_${"b".repeat(24)}`, `ev_${"c".repeat(24)}`];
    // 无初始选择：↓ 取首行、↑ 取末行。
    expect(caseTreeKeyboard({ selectedCaseId: null }, "ArrowDown", ids)).toEqual({
      selectedCaseId: ids[0],
    });
    expect(caseTreeKeyboard({ selectedCaseId: null }, "ArrowUp", ids)).toEqual({
      selectedCaseId: ids[2],
    });
    // 移动 + 端点钳制。
    let state: CaseTreeSelectionState = { selectedCaseId: ids[0] };
    state = caseTreeKeyboard(state, "ArrowDown", ids);
    expect(state.selectedCaseId).toBe(ids[1]);
    state = caseTreeKeyboard(state, "ArrowDown", ids);
    state = caseTreeKeyboard(state, "ArrowDown", ids);
    expect(state.selectedCaseId).toBe(ids[2]);
    state = caseTreeKeyboard(state, "ArrowUp", ids);
    state = caseTreeKeyboard(state, "ArrowUp", ids);
    state = caseTreeKeyboard(state, "ArrowUp", ids);
    expect(state.selectedCaseId).toBe(ids[0]);
    // Enter/→ 展开语义 = 保持选中；Esc 收起 = 清空。
    expect(caseTreeKeyboard({ selectedCaseId: ids[1] }, "Enter", ids)).toEqual({
      selectedCaseId: ids[1],
    });
    expect(caseTreeKeyboard({ selectedCaseId: ids[1] }, "ArrowRight", ids)).toEqual({
      selectedCaseId: ids[1],
    });
    expect(caseTreeKeyboard({ selectedCaseId: ids[1] }, "Escape", ids)).toEqual({
      selectedCaseId: null,
    });
    // 空 case 集：任何键 no-op。
    expect(caseTreeKeyboard({ selectedCaseId: null }, "ArrowDown", [])).toEqual({
      selectedCaseId: null,
    });
  });

  it("computes pass rates with a zero-denominator null (never 0/NaN)", () => {
    expect(
      evaluationPassRate({ passedCount: 3, failedCount: 1, errorCount: 0, unavailableCount: 0 }),
    ).toBe(0.75);
    expect(
      evaluationPassRate({ passedCount: 0, failedCount: 0, errorCount: 0, unavailableCount: 0 }),
    ).toBeNull();
    // stale 计数不在分母内（调用方不传）。
    expect(
      evaluationPassRate({ passedCount: 2, failedCount: 0, errorCount: 2, unavailableCount: 0 }),
    ).toBe(0.5);
  });
});

describe("health snapshot binding (批评环 R1：最近 completed 持久快照)", () => {
  const snapshot = {
    endedAt: "2026-10-01T00:00:02.000Z",
    status: "completed" as const,
    passedCount: 2,
    failedCount: 1,
    errorCount: 0,
    unavailableCount: 0,
  };

  it("picks the newest recent run per target mirroring daemon ordering (startedAt desc, runId asc tie)", () => {
    const runs = [
      {
        runId: `run_${"b".repeat(24)}`,
        target,
        status: "completed" as const,
        startedAt: "2026-10-02T00:00:00.000Z",
        resultIds: [],
      },
      {
        runId: `run_${"a".repeat(24)}`,
        target,
        status: "cancelled" as const,
        startedAt: "2026-10-02T00:00:00.000Z",
        resultIds: [`evr_${"1".repeat(24)}`],
      },
      {
        runId: `run_${"c".repeat(24)}`,
        target: { ...target, skillId: "sk_ffffffffffffffffffffffff" },
        status: "running" as const,
        startedAt: "2026-10-03T00:00:00.000Z",
        resultIds: [],
      },
    ] as EvaluationOverviewRecentRun[];
    const newest = newestRecentRunForTarget(runs, target);
    // 同刻 runId 字典序升者胜（镜像 daemon recentRuns tie-break）。
    expect(newest?.runId).toBe(`run_${"a".repeat(24)}`);
    expect(newestRecentRunForTarget(runs, { ...target, providerId: "amp" } as never)).toBeNull();
  });

  it("trusts payload lastRun when the newest run is completed or has no persisted results", () => {
    // 最新 run 已 completed → payload 可信。
    expect(
      evaluationHealthFor(snapshot, { status: "completed", resultIds: ["x"] }, undefined),
    ).toEqual({ snapshot, trusted: true });
    // 最新 run 未终结但尚无落盘结果 → lastRun 归属更早持久桶，payload 仍可信。
    expect(evaluationHealthFor(snapshot, { status: "running", resultIds: [] }, undefined)).toEqual({
      snapshot,
      trusted: true,
    });
    // 无持久证据 → null（trusted：缓存可清理）。
    expect(evaluationHealthFor(undefined, null, snapshot)).toEqual({
      snapshot: null,
      trusted: true,
    });
  });

  it("falls back to the remembered completed snapshot when the newest run already persisted partial results", () => {
    const newest = { status: "cancelled" as const, resultIds: [`evr_${"1".repeat(24)}`] };
    // cancelled 部分落盘 → payload lastRun 指向该 run 的部分计数：不采信。
    expect(evaluationHealthFor(snapshot, newest, undefined)).toEqual({
      snapshot: null,
      trusted: false,
    });
    // 会话内有最近 completed 记忆 → 回落（cancelled/running 不覆盖健康度）。
    expect(evaluationHealthFor(snapshot, newest, snapshot)).toEqual({
      snapshot,
      trusted: false,
    });
  });

  it("commits healthByTarget and holds the last completed snapshot across a poisoned refresh", async () => {
    const overview = mockOverview();
    // 第一页：最新 run completed → payload 可信并进入会话记忆。
    overview.mockResolvedValueOnce(
      overviewOutput(
        [okTarget({ lastRun: snapshot })],
        [
          {
            runId: `run_${"1".repeat(24)}`,
            target,
            status: "completed",
            startedAt: "2026-10-01T00:00:00.000Z",
            resultIds: [`evr_${"1".repeat(24)}`, `evr_${"2".repeat(24)}`, `evr_${"3".repeat(24)}`],
          },
        ],
      ),
    );
    await loadEvaluationOverview(WS_ID);
    const key = evaluationTargetKey(target);
    expect(evaluationOverviewState.healthByTarget[key]).toEqual(snapshot);

    // 刷新：running run 已部分落盘，payload lastRun 指向部分计数 → 健康度回落
    // 上一次 completed 快照（不被运行中/取消的部分数据覆盖）。
    const poisoned = {
      endedAt: "2026-10-02T00:00:02.000Z",
      status: "completed" as const,
      passedCount: 1,
      failedCount: 0,
      errorCount: 0,
      unavailableCount: 0,
    };
    overview.mockResolvedValueOnce(
      overviewOutput(
        [okTarget({ lastRun: poisoned })],
        [
          {
            runId: `run_${"2".repeat(24)}`,
            target,
            status: "running",
            startedAt: "2026-10-02T00:00:00.000Z",
            resultIds: [`evr_${"9".repeat(24)}`],
          },
        ],
      ),
    );
    await loadEvaluationOverview(WS_ID);
    expect(evaluationOverviewState.healthByTarget[key]).toEqual(snapshot);
  });

  it("projects a null health (empty ring) when only a cancelled run exists and no snapshot was ever trusted", async () => {
    const overview = mockOverview();
    overview.mockResolvedValueOnce(
      overviewOutput(
        [okTarget()],
        [
          {
            runId: `run_${"1".repeat(24)}`,
            target,
            status: "cancelled",
            startedAt: "2026-10-01T00:00:00.000Z",
            resultIds: [],
          },
        ],
      ),
    );
    await loadEvaluationOverview(WS_ID);
    const key = evaluationTargetKey(target);
    expect(evaluationOverviewState.healthByTarget[key]).toBeNull();
  });
});

describe("settled summary (批评环 R1 P2-10：终态 toast 计数摘要)", () => {
  it("computes passed/executed from the refreshed detail projection on completion", async () => {
    vi.useFakeTimers();
    const runId = `run_${"1".repeat(24)}`;
    evaluationViewState.target = target;
    evaluationViewState.rows = [];
    const resultsList = vi
      .fn()
      .mockResolvedValueOnce({ results: [] })
      .mockResolvedValue({
        results: [
          makeResult({ runId, outcome: "passed" }),
          makeResult({
            runId,
            resultId: `evr_${"2".repeat(24)}`,
            caseId: `ev_${"b".repeat(24)}`,
            outcome: "failed",
          }),
        ],
      });
    const overview = vi.fn().mockResolvedValue(overviewOutput([]));
    const start = vi.fn().mockResolvedValue({ runId, status: "queued" });
    const status = vi
      .fn()
      .mockResolvedValueOnce({ status: "running", resultIds: [] })
      .mockResolvedValue({ status: "completed", resultIds: [`evr_${"1".repeat(24)}`] });
    rpcClient = {
      evaluation: {
        run: { start, status, cancel: vi.fn() },
        cases: { list: vi.fn().mockResolvedValue({ cases: [makeCase()] }) },
        results: { list: resultsList },
        overview,
      },
    };
    await startEvaluationRun({ target, caseIds: [`ev_${"a".repeat(24)}`], runner: "analyzer" });
    await vi.advanceTimersByTimeAsync(RUN_POLL_INTERVAL_MS);
    await vi.advanceTimersByTimeAsync(RUN_POLL_INTERVAL_MS);
    expect(evaluationRunState.status).toBe("completed");
    await Promise.resolve();
    await Promise.resolve();
    // 详情投影在位 → passed/executed 从该 run 的结果行直数（1/2 passed）。
    expect(evaluationRunState.settledSummary).toEqual({
      runId,
      status: "completed",
      passed: 1,
      executed: 2,
    });
    vi.useRealTimers();
  });

  it("records the cancelled terminal with an idempotent single summary (dedupe key)", async () => {
    vi.useFakeTimers();
    const runId = `run_${"1".repeat(24)}`;
    const cancel = vi.fn().mockResolvedValue({ runId, status: "cancelled" });
    rpcClient = {
      evaluation: {
        run: {
          start: vi.fn().mockResolvedValue({ runId, status: "queued" }),
          status: vi.fn(),
          cancel,
        },
        cases: { list: vi.fn().mockResolvedValue({ cases: [] }) },
        results: { list: vi.fn().mockResolvedValue({ results: [] }) },
      },
    };
    await startEvaluationRun({ target, caseIds: [`ev_${"a".repeat(24)}`], runner: "analyzer" });
    const outcome = await cancelEvaluationRun(runId);
    expect(outcome.ok).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(evaluationRunState.settledSummary).toEqual({
      runId,
      status: "cancelled",
      passed: null,
      executed: null,
    });
    vi.useRealTimers();
  });

  it("clears the settled summary when a new run starts", async () => {
    evaluationRunState.settledSummary = {
      runId: `run_${"0".repeat(24)}`,
      status: "completed",
      passed: 1,
      executed: 1,
    };
    const start = vi.fn().mockResolvedValue({ runId: `run_${"1".repeat(24)}`, status: "queued" });
    rpcClient = { evaluation: { run: { start, status: vi.fn(), cancel: vi.fn() } } };
    await startEvaluationRun({ target, caseIds: [`ev_${"a".repeat(24)}`], runner: "analyzer" });
    expect(evaluationRunState.settledSummary).toBeNull();
  });
});
