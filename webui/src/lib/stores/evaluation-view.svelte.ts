/**
 * 用户原始需求 [2026-09-30]（evaluation-corpus Ch3 后续批 / evaluation-webui-view）：
 * 「webui 里面还有一些残留的未完成的工作，比如 skill 测试与评估」——评估语料的
 * 最小只读查看面。
 * 修订 [2026-10-03]（evaluating-dashboard）：Eval 子视图退役为独立 Evaluating 区块；
 * 本 store 升格为其唯一数据层——详情行 + 总览聚合（cursor 分页）+ run 追踪
 * （start/cancel/status 轮询；completed 后 cancel 幂等返终态）。
 * 修订 [2026-10-04]（evaluating-world-class）：run 时间线 + case 树 + 断言详情
 * 纯投影（design §4.2/§5：期望 vs 观测 diff 双栏数据源、键盘导航纯函数、
 * run 轮询期间刷新匹配投影驱动 case 逐个点亮与 live 进度）。
 *
 * 正交意图：
 *   [1] evaluationViewState 拉取与三态投影（loading / error / empty；
 *       latest-request-wins 代次门 + connection owner generation，被取代或
 *       断线的请求不提交 rows/error——不伪造数据）。
 *   [2] 纯函数投影：每案最新结果选取（endedAt 倒序 + resultId 稳定 tie-break）、
 *       case × 结果的行合并（含断言定义，供失败断言展开）、五态 outcome 徽标
 *       配色（互异、可区分）、run 时间线/case 树/断言详情行（run 报告视角）与
 *       case 树键盘导航。
 *   [3] evaluationOverviewState：总览聚合第一页替换 + nextCursor 续页追加
 *       （三元组去重合并），同一 latest-request-wins + 连接门纪律。
 *   [4] run 追踪：start（Global 前置拒，与 daemon 闸同源语义）→ 内存轮询
 *       run.status 至终态（轮询期间同步 resultCount/totalCases live 进度并刷新
 *       匹配投影）→ 终态刷新；cancel 幂等（终态返回即刷新）。
 */
import type {
  EvaluationAssertion,
  EvaluationAssertionKind,
  EvaluationCase,
  EvaluationOverviewRecentRun,
  EvaluationOverviewTarget,
  EvaluationResultView,
  EvaluationRunStatus,
  EvaluationTarget,
} from "$shared/contracts/evaluation.js";
import type { WorkspaceId } from "$shared/contracts/workspaces.js";
import { getConnectionGeneration, getRpc } from "./connection.svelte";
import { createRequestGenerationGate } from "./request-generation.js";

/** 五态 outcome（evaluation-corpus B3 契约判别键）。 */
export type EvaluationOutcome = EvaluationResultView["outcome"];

/** 评估行（case × 每案最新结果；latest=null 表示该 case 从未跑过）。 */
export interface EvaluationRow {
  caseId: string;
  prompt: string;
  enabled: boolean;
  assertionCount: number;
  /** 断言定义（case.input.assertions 原序；失败断言展开按 ref 对齐）。 */
  assertions: EvaluationAssertion[];
  boundRevision: string;
  latest: EvaluationResultView | null;
}

const loadGate = createRequestGenerationGate(getConnectionGeneration);

/** 详情状态（rows=null 表示未加载/不可用——不伪造数据）。 */
export const evaluationViewState = $state<{
  rows: EvaluationRow[] | null;
  /** 原始 cases（行投影的编辑源；与 rows 同次提交）。 */
  cases: EvaluationCase[] | null;
  /** 原始 results 全量（run 时间线/选中 run 投影源；与 rows 同次提交）。 */
  results: EvaluationResultView[] | null;
  /** rows 归属的 target（run 终态后判定是否就地刷新；null = 未加载）。 */
  target: EvaluationTarget | null;
  loading: boolean;
  error: string | null;
}>({
  rows: null,
  cases: null,
  results: null,
  target: null,
  loading: false,
  error: null,
});

/** 拉取一个技能作用域的 cases 与全部结果，合并为只读行（每案最新一条）。 */
export async function loadEvaluationView(target: EvaluationTarget): Promise<void> {
  const request = loadGate.issue();
  const rpc = getRpc();
  if (!rpc) {
    // 断线：静默无结果（不伪造数据；重连后由消费方重新拉取）。
    if (request.isLatest()) evaluationViewState.loading = false;
    return;
  }
  evaluationViewState.loading = true;
  try {
    const [casesRes, resultsRes] = await Promise.all([
      rpc.evaluation.cases.list({ target }),
      rpc.evaluation.results.list({ target }),
    ]);
    if (!request.isCurrent()) return;
    evaluationViewState.rows = buildEvaluationRows(casesRes.cases, resultsRes.results);
    evaluationViewState.cases = casesRes.cases;
    evaluationViewState.results = resultsRes.results;
    evaluationViewState.target = target;
    evaluationViewState.error = null;
  } catch (error) {
    if (!request.isCurrent()) return;
    evaluationViewState.rows = null;
    evaluationViewState.cases = null;
    evaluationViewState.results = null;
    evaluationViewState.target = target;
    evaluationViewState.error = error instanceof Error ? error.message : String(error);
  } finally {
    if (request.isLatest()) evaluationViewState.loading = false;
  }
}

/** 清空详情状态并作废在途请求（消费方卸载/切换技能身份时调用）。 */
export function resetEvaluationView(): void {
  loadGate.invalidate();
  evaluationViewState.rows = null;
  evaluationViewState.cases = null;
  evaluationViewState.results = null;
  evaluationViewState.target = null;
  evaluationViewState.loading = false;
  evaluationViewState.error = null;
}

/**
 * 结果排序比较器（newest first）：endedAt 倒序，同刻按 resultId 倒序稳定
 * tie-break。完全相同的 (endedAt, resultId) 返回 0（Comparator 契约：相等即
 * 0——返回 -1 会向排序器谎报严格偏序；codex 复核 P2 修正）。
 */
export function compareResultsNewestFirst(
  left: EvaluationResultView,
  right: EvaluationResultView,
): number {
  if (left.endedAt !== right.endedAt) return left.endedAt < right.endedAt ? 1 : -1;
  if (left.resultId === right.resultId) return 0;
  return left.resultId < right.resultId ? 1 : -1;
}

/** 每案最新结果：endedAt 倒序（同刻按 resultId 倒序稳定 tie-break）首见即最新。 */
export function latestResultByCase(
  results: EvaluationResultView[],
): Map<string, EvaluationResultView> {
  const ordered = [...results].sort(compareResultsNewestFirst);
  const byCase = new Map<string, EvaluationResultView>();
  for (const result of ordered) {
    if (!byCase.has(result.caseId)) byCase.set(result.caseId, result);
  }
  return byCase;
}

/** 合并 cases 与每案最新结果为只读行（行序保持 cases 自身顺序）。 */
export function buildEvaluationRows(
  cases: EvaluationCase[],
  results: EvaluationResultView[],
): EvaluationRow[] {
  const latest = latestResultByCase(results);
  return cases.map((entry) => ({
    caseId: entry.caseId,
    prompt: entry.input.prompt,
    enabled: entry.enabled,
    assertionCount: entry.input.assertions.length,
    assertions: [...entry.input.assertions],
    boundRevision: entry.boundRevision,
    latest: latest.get(entry.caseId) ?? null,
  }));
}

/** 五态 outcome → 徽标配色（互异；passed 绿 / failed 红 / error 橙 / unavailable 灰 / stale 黄）。 */
export function evaluationOutcomeBadge(outcome: EvaluationOutcome): string {
  switch (outcome) {
    case "passed":
      return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
    case "failed":
      return "bg-destructive/10 text-destructive";
    case "error":
      return "bg-orange-500/10 text-orange-700 dark:text-orange-300";
    case "unavailable":
      return "bg-muted text-muted-foreground";
    case "stale":
      return "bg-amber-500/10 text-amber-700 dark:text-amber-300";
  }
}

/** ---------- run 时间线 + case 树投影（evaluating-world-class design §4.2/§5） ---------- */

/** run 时间线行（单 target 的 results 按 runId 聚合；持久 run 投影 completed）。 */
export interface EvaluationRunTimelineRow {
  runId: string;
  status: EvaluationRunStatus;
  startedAt: string;
  endedAt: string | null;
  /** 五态计数（stale 单列；行内 results 总数 = 五计数之和）。 */
  counts: {
    passed: number;
    failed: number;
    error: number;
    unavailable: number;
    stale: number;
  };
}

/**
 * run 时间线：results 按 runId 聚合（startedAt 取组内最小、endedAt 取最大），
 * tracked run（evaluationRunState）同 runId 时内存态胜出、未落盘时合成行；
 * newest first（startedAt 降序 + runId 倒序 tie-break）。
 */
export function buildRunTimeline(
  results: readonly EvaluationResultView[],
  tracked: {
    runId: string;
    status: EvaluationRunStatus;
    startedAt: string | null;
  } | null,
): EvaluationRunTimelineRow[] {
  const byRun = new Map<string, EvaluationRunTimelineRow>();
  for (const result of results) {
    const row = byRun.get(result.runId) ?? {
      runId: result.runId,
      status: "completed" as const,
      startedAt: result.startedAt,
      endedAt: null,
      counts: { passed: 0, failed: 0, error: 0, unavailable: 0, stale: 0 },
    };
    if (result.startedAt < row.startedAt) row.startedAt = result.startedAt;
    if (row.endedAt === null || result.endedAt > row.endedAt) row.endedAt = result.endedAt;
    row.counts[result.outcome] += 1;
    byRun.set(result.runId, row);
  }
  if (tracked !== null) {
    const existing = byRun.get(tracked.runId);
    if (existing === undefined) {
      byRun.set(tracked.runId, {
        runId: tracked.runId,
        status: tracked.status,
        startedAt: tracked.startedAt ?? new Date().toISOString(),
        endedAt: null,
        counts: { passed: 0, failed: 0, error: 0, unavailable: 0, stale: 0 },
      });
    } else {
      existing.status = tracked.status;
      if (tracked.startedAt !== null && tracked.startedAt < existing.startedAt) {
        existing.startedAt = tracked.startedAt;
      }
    }
  }
  return [...byRun.values()].sort((left, right) => {
    if (left.startedAt !== right.startedAt) return left.startedAt < right.startedAt ? 1 : -1;
    if (left.runId === right.runId) return 0;
    return left.runId < right.runId ? 1 : -1;
  });
}

/** 选中 run 内的 case → 结果映射（run 内同 case 多条时留最新）。 */
export function runResultsByCase(
  results: readonly EvaluationResultView[],
  runId: string,
): Map<string, EvaluationResultView> {
  const byCase = new Map<string, EvaluationResultView>();
  for (const result of results) {
    if (result.runId !== runId) continue;
    const existing = byCase.get(result.caseId);
    if (existing === undefined || compareResultsNewestFirst(result, existing) < 0) {
      byCase.set(result.caseId, result);
    }
  }
  return byCase;
}

/** case 树节点（run 报告视角：runResult = 选中 run 内该 case 的结果行）。 */
export interface EvaluationCaseTreeNode {
  caseId: string;
  /** prompt 首行截断（树行主文案；完整正文留在详情与编辑器）。 */
  label: string;
  enabled: boolean;
  runResult: EvaluationResultView | null;
  /** 断言通过分式（仅 passed/failed 结果携带；其余五态族 = null）。 */
  score: { passed: number; total: number } | null;
}

/** prompt → 树行标签（首行 + 截断）。 */
export function caseTreeLabel(prompt: string, max = 72): string {
  const firstLine = prompt.split("\n")[0] ?? "";
  return firstLine.length > max ? `${firstLine.slice(0, max)}…` : firstLine;
}

/** cases × 选中 run 结果 → 树节点（行序保持 cases 自身顺序）。 */
export function buildCaseTreeNodes(
  cases: readonly EvaluationCase[],
  runByCase: ReadonlyMap<string, EvaluationResultView>,
): EvaluationCaseTreeNode[] {
  return cases.map((entry) => {
    const runResult = runByCase.get(entry.caseId) ?? null;
    const score =
      runResult !== null && (runResult.outcome === "passed" || runResult.outcome === "failed")
        ? {
            passed: runResult.assertions.filter((row) => row.outcome === "passed").length,
            total: runResult.assertions.length,
          }
        : null;
    return {
      caseId: entry.caseId,
      label: caseTreeLabel(entry.input.prompt),
      enabled: entry.enabled,
      runResult,
      score,
    };
  });
}

/** 断言详情行（期望 vs 观测 diff 双栏数据源；kind/expected/observed 冻结自结果行）。 */
export interface AssertionDetailRow {
  ref: number;
  kind: EvaluationAssertionKind;
  expected: string;
  observed: string;
  outcome: "passed" | "failed" | "error";
  /** case 断言定义携带的 description（按 ref 对齐；缺失 = null）。 */
  description: string | null;
}

/** 结果断言行 → 详情行（description 从 case 定义按 ref 补齐；结果冻结字段为准）。 */
export function assertionDetailRows(
  result: EvaluationResultView | null,
  caseAssertions: readonly EvaluationAssertion[],
): AssertionDetailRow[] {
  if (result === null) return [];
  return result.assertions.map((row) => ({
    ref: row.ref,
    kind: row.kind,
    expected: row.expected,
    observed: row.observed,
    outcome: row.outcome,
    description: caseAssertions[row.ref]?.description ?? null,
  }));
}

/** case 树键盘状态（↑↓ 移动选择、Enter/→ 展开、Esc 收起）。 */
export interface CaseTreeSelectionState {
  selectedCaseId: string | null;
}

/**
 * case 树键盘导航（纯函数；design §4.2）：↑↓ 沿 caseIds 移动选择（端点钳制，
 * 无初始选择时 ↓ 取首行 / ↑ 取末行），Enter/→ 保持当前选择（展开语义 =
 * 选中即右侧呈现断言详情），Esc 清空选择（收起）。未知 caseIds 返回原状态。
 */
export function caseTreeKeyboard(
  state: CaseTreeSelectionState,
  key: "ArrowUp" | "ArrowDown" | "Enter" | "ArrowRight" | "Escape",
  caseIds: readonly string[],
): CaseTreeSelectionState {
  switch (key) {
    case "ArrowDown":
    case "ArrowUp": {
      if (caseIds.length === 0) return state;
      const delta = key === "ArrowDown" ? 1 : -1;
      const current = state.selectedCaseId === null ? -1 : caseIds.indexOf(state.selectedCaseId);
      const next =
        current === -1
          ? delta === 1
            ? 0
            : caseIds.length - 1
          : Math.min(caseIds.length - 1, Math.max(0, current + delta));
      return { selectedCaseId: caseIds[next] };
    }
    case "Enter":
    case "ArrowRight":
      return state;
    case "Escape":
      return { selectedCaseId: null };
  }
}

/**
 * 通过率（健康环/时间线胶囊）：分母 = 四计数之和（stale 不计入分母——stale
 * 行无断言裁决）；零分母 → null（不定义，UI 不画进度）。
 */
export function evaluationPassRate(counts: {
  passedCount: number;
  failedCount: number;
  errorCount: number;
  unavailableCount: number;
}): number | null {
  const total =
    counts.passedCount + counts.failedCount + counts.errorCount + counts.unavailableCount;
  return total === 0 ? null : counts.passedCount / total;
}

/** ---------- 总览聚合（evaluating-dashboard design §1） ---------- */

const overviewGate = createRequestGenerationGate(getConnectionGeneration);

/** 总览状态（wsId=null 表示未加载；targets 为已累计的分页行）。 */
export const evaluationOverviewState = $state<{
  wsId: WorkspaceId | null;
  targets: EvaluationOverviewTarget[];
  recentRuns: EvaluationOverviewRecentRun[];
  nextCursor: string | null;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
}>({
  wsId: null,
  targets: [],
  recentRuns: [],
  nextCursor: null,
  loading: false,
  loadingMore: false,
  error: null,
});

/** target 三元组唯一键（cursor 分页去重合并键）。 */
export function evaluationTargetKey(target: EvaluationTarget): string {
  return `${target.workspaceId}/${target.providerId}/${target.skillId}`;
}

/** 分页合并：同三元组 incoming 胜出（续拉更新旧行），行序保持插入序。 */
export function mergeOverviewTargets(
  existing: EvaluationOverviewTarget[],
  incoming: EvaluationOverviewTarget[],
): EvaluationOverviewTarget[] {
  const merged = new Map(existing.map((row) => [evaluationTargetKey(row.target), row]));
  for (const row of incoming) merged.set(evaluationTargetKey(row.target), row);
  return [...merged.values()];
}

/** 两个 target 是否同一三元组。 */
export function sameEvaluationTarget(left: EvaluationTarget, right: EvaluationTarget): boolean {
  return evaluationTargetKey(left) === evaluationTargetKey(right);
}

/** 拉取总览第一页（替换投影；wsId 变化或显式刷新时调用）。 */
export async function loadEvaluationOverview(wsId: WorkspaceId): Promise<void> {
  const request = overviewGate.issue();
  const rpc = getRpc();
  if (!rpc) {
    if (request.isLatest()) evaluationOverviewState.loading = false;
    return;
  }
  evaluationOverviewState.loading = true;
  try {
    const output = await rpc.evaluation.overview({ wsId });
    if (!request.isCurrent()) return;
    evaluationOverviewState.wsId = wsId;
    evaluationOverviewState.targets = output.targets;
    evaluationOverviewState.recentRuns = output.recentRuns;
    evaluationOverviewState.nextCursor = output.nextCursor ?? null;
    evaluationOverviewState.error = null;
  } catch (error) {
    if (!request.isCurrent()) return;
    evaluationOverviewState.wsId = wsId;
    evaluationOverviewState.targets = [];
    evaluationOverviewState.recentRuns = [];
    evaluationOverviewState.nextCursor = null;
    evaluationOverviewState.error = error instanceof Error ? error.message : String(error);
  } finally {
    if (request.isLatest()) {
      evaluationOverviewState.loading = false;
      evaluationOverviewState.loadingMore = false;
    }
  }
}

/** 续拉下一页（nextCursor 缺席/归属不符时 no-op；追加提交经三元组去重）。 */
export async function loadMoreEvaluationOverview(wsId: WorkspaceId): Promise<void> {
  const cursor = evaluationOverviewState.nextCursor;
  if (cursor === null || evaluationOverviewState.wsId !== wsId) return;
  const request = overviewGate.issue();
  const rpc = getRpc();
  if (!rpc) {
    if (request.isLatest()) evaluationOverviewState.loadingMore = false;
    return;
  }
  evaluationOverviewState.loadingMore = true;
  try {
    const output = await rpc.evaluation.overview({ wsId, cursor });
    if (!request.isCurrent()) return;
    evaluationOverviewState.targets = mergeOverviewTargets(
      evaluationOverviewState.targets,
      output.targets,
    );
    // recentRuns 不分页：续页携带的是同一固定窗口，取末次响应即可。
    evaluationOverviewState.recentRuns = output.recentRuns;
    evaluationOverviewState.nextCursor = output.nextCursor ?? null;
  } catch (error) {
    if (!request.isCurrent()) return;
    evaluationOverviewState.error = error instanceof Error ? error.message : String(error);
  } finally {
    if (request.isLatest()) evaluationOverviewState.loadingMore = false;
  }
}

/** 清空总览状态并作废在途请求（消费方卸载时调用）。 */
export function resetEvaluationOverview(): void {
  overviewGate.invalidate();
  evaluationOverviewState.wsId = null;
  evaluationOverviewState.targets = [];
  evaluationOverviewState.recentRuns = [];
  evaluationOverviewState.nextCursor = null;
  evaluationOverviewState.loading = false;
  evaluationOverviewState.loadingMore = false;
  evaluationOverviewState.error = null;
}

/** ---------- run 追踪（start / cancel / status 轮询至终态） ---------- */

/** run.status 轮询间隔（测试可注入替换）。 */
export const RUN_POLL_INTERVAL_MS = 1200;

/** startEvaluationRun 的类型化结果（拒绝原因闭集；rpc 错误携带 message）。 */
export type StartRunOutcome =
  | { ok: true; runId: string }
  | { ok: false; reason: "global" | "disconnected" | "rpc-error"; message?: string };

/** 活跃 run 追踪（start 成功后进入；终态停留供 UI 呈现；reset 清空）。 */
export const evaluationRunState = $state<{
  runId: string | null;
  target: EvaluationTarget | null;
  status: EvaluationRunStatus | null;
  /** start 时刻（ISO；时间线合成行的排序源；未知 = null）。 */
  startedAt: string | null;
  /** 已到达结果数（run.status 的 resultIds 长度；未知 = null）。 */
  resultCount: number | null;
  /** start 时的 case 总数（live 进度分母；非本 UI 发起 = null）。 */
  totalCases: number | null;
  error: string | null;
}>({
  runId: null,
  target: null,
  status: null,
  startedAt: null,
  resultCount: null,
  totalCases: null,
  error: null,
});

/** Global（~）target：run 与 case 写入在 UI 层即拒（daemon 同闸前置）。 */
export function isGlobalEvaluationTarget(target: EvaluationTarget): boolean {
  return target.workspaceId === "~";
}

/** 测试 seam：轮询 sleep（默认 RUN_POLL_INTERVAL_MS）。 */
let pollDelay: (ms: number) => Promise<unknown> = (ms) => new Promise((r) => setTimeout(r, ms));

/** 替换轮询延迟实现（仅测试使用）。 */
export function __setRunPollDelayForTests(impl: ((ms: number) => Promise<unknown>) | null): void {
  pollDelay = impl ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
}

/** 发起一个 run（显式确认后调用；Global 前置拒、断线拒、RPC 失败 typed 返回）。 */
export async function startEvaluationRun(input: {
  target: EvaluationTarget;
  caseIds: string[];
  runner: "analyzer" | "provider-model";
}): Promise<StartRunOutcome> {
  // Global 前置闸（design §2：UI 门与 daemon 排队前拒绝对齐——绝不自动运行）。
  if (isGlobalEvaluationTarget(input.target)) return { ok: false, reason: "global" };
  const rpc = getRpc();
  if (!rpc) return { ok: false, reason: "disconnected" };
  try {
    const output = await rpc.evaluation.run.start(input);
    evaluationRunState.runId = output.runId;
    evaluationRunState.target = input.target;
    evaluationRunState.status = output.status;
    evaluationRunState.startedAt = new Date().toISOString();
    evaluationRunState.resultCount = 0;
    evaluationRunState.totalCases = input.caseIds.length;
    evaluationRunState.error = null;
    void pollRunToSettled(output.runId);
    return { ok: true, runId: output.runId };
  } catch (error) {
    return {
      ok: false,
      reason: "rpc-error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * 取消一个 run（by runId；queued/running → cancelled，completed 后幂等返终态——
 * evaluation-corpus run 竞态语义）。被取消的是当前追踪 run 时同步追踪状态；
 * 任何终态响应都触发匹配投影刷新。
 */
export async function cancelEvaluationRun(runId: string): Promise<{
  ok: boolean;
  message?: string;
}> {
  const rpc = getRpc();
  if (!rpc) return { ok: false, message: "disconnected" };
  try {
    const output = await rpc.evaluation.run.cancel({ runId });
    if (evaluationRunState.runId === runId) {
      evaluationRunState.status = output.status;
      if (output.status === "completed" || output.status === "cancelled") {
        await refreshMatchingRunProjections();
      }
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

/** 清空 run 追踪并停止轮询（消费方卸载时调用）。 */
export function resetEvaluationRun(): void {
  evaluationRunState.runId = null;
  evaluationRunState.target = null;
  evaluationRunState.status = null;
  evaluationRunState.startedAt = null;
  evaluationRunState.resultCount = null;
  evaluationRunState.totalCases = null;
  evaluationRunState.error = null;
}

/** 轮询 run.status 至终态；每刻同步 live 进度并刷新匹配投影（case 逐个点亮）。 */
async function pollRunToSettled(runId: string): Promise<void> {
  const ownerGeneration = getConnectionGeneration();
  for (;;) {
    await pollDelay(RUN_POLL_INTERVAL_MS);
    if (evaluationRunState.runId !== runId) return; // 追踪被替换/清空。
    if (getConnectionGeneration() !== ownerGeneration) return; // 连接所有权更替。
    const rpc = getRpc();
    if (!rpc) {
      evaluationRunState.error = "disconnected";
      return;
    }
    try {
      const output = await rpc.evaluation.run.status({ runId });
      if (evaluationRunState.runId !== runId) return;
      evaluationRunState.status = output.status;
      evaluationRunState.resultCount = output.resultIds.length;
      if (output.status === "completed" || output.status === "cancelled") {
        await refreshMatchingRunProjections();
        return;
      }
      // 运行中：结果逐个落盘——刷新匹配投影驱动树行点亮与 live 进度。
      await refreshMatchingRunProjections();
    } catch (error) {
      if (evaluationRunState.runId !== runId) return;
      // daemon 重启丢失内存 run 等：停止追踪并呈现错误（不伪装终态）。
      evaluationRunState.error = error instanceof Error ? error.message : String(error);
      return;
    }
  }
}

/** run 轮询每刻/终态：刷新归属匹配的详情行与总览页（latest-request-wins 保护并发）。 */
async function refreshMatchingRunProjections(): Promise<void> {
  const target = evaluationRunState.target;
  if (target === null) return;
  if (
    evaluationViewState.target !== null &&
    sameEvaluationTarget(evaluationViewState.target, target)
  ) {
    void loadEvaluationView(target);
  }
  if (evaluationOverviewState.wsId === target.workspaceId) {
    void loadEvaluationOverview(target.workspaceId);
  }
}

/** ---------- 展示层纯投影 ---------- */

/** 相对时间投影（文案由消费方 i18n；无效时间返回 null 不渲染）。 */
export type RelativeTimeProjection =
  | { unit: "now" }
  | { unit: "minutes"; value: number }
  | { unit: "hours"; value: number }
  | { unit: "days"; value: number };

export function relativeTimeParts(
  iso: string,
  now: number = Date.now(),
): RelativeTimeProjection | null {
  const ms = now - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return { unit: "now" };
  if (minutes < 60) return { unit: "minutes", value: minutes };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { unit: "hours", value: hours };
  return { unit: "days", value: Math.floor(hours / 24) };
}

/** 详情行错误计数（latest.outcome === "error" 的行数；红 chip 正反两态的数据源）。 */
export function detailErrorCount(rows: EvaluationRow[]): number {
  return rows.filter((row) => row.latest?.outcome === "error").length;
}
