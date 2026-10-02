/**
 * 用户原始需求 [2026-09-30]（evaluation-corpus Ch3 后续批 / evaluation-webui-view）：
 * 「webui 里面还有一些残留的未完成的工作，比如 skill 测试与评估」——评估语料的
 * 最小只读查看面（Creator Eval 子视图的数据源）。
 *
 * 正交意图：
 *   [1] evaluationViewState 拉取与三态投影（loading / error / empty；
 *       latest-request-wins 代次门 + connection owner generation，被取代或
 *       断线的请求不提交 rows/error——不伪造数据）。
 *   [2] 纯函数投影：每案最新结果选取（endedAt 倒序 + resultId 稳定 tie-break）、
 *       case × 结果的行合并、五态 outcome 徽标配色（互异、可区分）。
 */
import type {
  EvaluationCase,
  EvaluationResultView,
  EvaluationTarget,
} from "$shared/contracts/evaluation.js";
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
  boundRevision: string;
  latest: EvaluationResultView | null;
}

const loadGate = createRequestGenerationGate(getConnectionGeneration);

/** Eval 子视图状态（rows=null 表示未加载/不可用——不伪造数据）。 */
export const evaluationViewState = $state<{
  rows: EvaluationRow[] | null;
  loading: boolean;
  error: string | null;
}>({ rows: null, loading: false, error: null });

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
    evaluationViewState.error = null;
  } catch (error) {
    if (!request.isCurrent()) return;
    evaluationViewState.rows = null;
    evaluationViewState.error = error instanceof Error ? error.message : String(error);
  } finally {
    if (request.isLatest()) evaluationViewState.loading = false;
  }
}

/** 清空视图状态并作废在途请求（消费方卸载/切换技能身份时调用）。 */
export function resetEvaluationView(): void {
  loadGate.invalidate();
  evaluationViewState.rows = null;
  evaluationViewState.loading = false;
  evaluationViewState.error = null;
}

/** 每案最新结果：endedAt 倒序（同刻按 resultId 倒序稳定 tie-break）首见即最新。 */
export function latestResultByCase(
  results: EvaluationResultView[],
): Map<string, EvaluationResultView> {
  const ordered = [...results].sort((left, right) => {
    if (left.endedAt !== right.endedAt) return left.endedAt < right.endedAt ? 1 : -1;
    return left.resultId < right.resultId ? 1 : -1;
  });
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
