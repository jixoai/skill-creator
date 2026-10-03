/**
 * 用户原始需求 [2026-09-30]（evaluation-corpus Ch3 后续批 / evaluation-webui-view）：
 * 「webui 里面还有一些残留的未完成的工作，比如 skill 测试与评估」——评估语料的
 * 最小只读查看面。
 * 修订 [2026-10-03]（evaluating-dashboard）：Eval 子视图退役为独立 Evaluating 区块；
 * 本 store 升格为其唯一数据层——详情行 + 总览聚合（cursor 分页）+ run 追踪
 * （start/cancel/status 轮询；completed 后 cancel 幂等返终态）。
 *
 * 正交意图：
 *   [1] evaluationViewState 拉取与三态投影（loading / error / empty；
 *       latest-request-wins 代次门 + connection owner generation，被取代或
 *       断线的请求不提交 rows/error——不伪造数据）。
 *   [2] 纯函数投影：每案最新结果选取（endedAt 倒序 + resultId 稳定 tie-break）、
 *       case × 结果的行合并（含断言定义，供失败断言展开）、五态 outcome 徽标
 *       配色（互异、可区分）。
 *   [3] evaluationOverviewState：总览聚合第一页替换 + nextCursor 续页追加
 *       （三元组去重合并），同一 latest-request-wins + 连接门纪律。
 *   [4] run 追踪：start（Global 前置拒，与 daemon 闸同源语义）→ 内存轮询
 *       run.status 至终态 → 自动刷新匹配投影；cancel 幂等（终态返回即刷新）。
 */
import type {
  EvaluationAssertion,
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
  /** rows 归属的 target（run 终态后判定是否就地刷新；null = 未加载）。 */
  target: EvaluationTarget | null;
  loading: boolean;
  error: string | null;
}>({ rows: null, cases: null, target: null, loading: false, error: null });

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
    evaluationViewState.target = target;
    evaluationViewState.error = null;
  } catch (error) {
    if (!request.isCurrent()) return;
    evaluationViewState.rows = null;
    evaluationViewState.cases = null;
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
  error: string | null;
}>({ runId: null, target: null, status: null, error: null });

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
        await refreshAfterRunSettled();
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
  evaluationRunState.error = null;
}

/** 轮询 run.status 至终态；终态或失联即停，并刷新匹配的详情/总览投影。 */
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
      if (output.status === "completed" || output.status === "cancelled") {
        await refreshAfterRunSettled();
        return;
      }
    } catch (error) {
      if (evaluationRunState.runId !== runId) return;
      // daemon 重启丢失内存 run 等：停止追踪并呈现错误（不伪装终态）。
      evaluationRunState.error = error instanceof Error ? error.message : String(error);
      return;
    }
  }
}

/** run 终态后：刷新归属匹配的详情行与总览页（latest-request-wins 保护并发）。 */
async function refreshAfterRunSettled(): Promise<void> {
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
