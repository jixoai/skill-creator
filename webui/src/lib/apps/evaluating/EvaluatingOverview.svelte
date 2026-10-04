<!--
  用户原始需求 [2026-10-04]（evaluating-world-class design §4.1）：Evaluating 总览屏
  按「健康度仪表」语言重做——「近期 runs 时间线（GitHub Actions run list 式行，
  最新在前）+ 技能健康卡网格（通过率环 + 三态计数行 + stale 黄带 + 失败摘要行）」；
  空态单焦点引导（Creator 深链）。Run… 显式确认与 Global 只读沿 evaluating-dashboard
  既有裁决。
  修订 [2026-10-04]（evaluating-world-class 批评环 R1 处置批）：健康卡绑定
  「最近 completed 持久快照」（store healthByTarget——cancelled/running 的部分
  落盘计数不覆盖健康度；空态区分「从未运行」与「尚无完成的运行」）；P1-3 卡网格
  auto-fill minmax 220px 下限 + 头部降级序（标题/徽标不截断，容器 <480px 按钮
  先降级为图标）；P2-1 时间线完成态结局色（可对齐 lastRun 计数时红✗/绿✓）；
  P2-2 百分比旁带「N ran」分母；P2-5 completed-but-empty 行级「No cases ran」；
  P2-10 终态 toast 消费 settledSummary（计数摘要 + runId 幂等；取消入口手动
  成功 toast 退役——effect 是唯一终态播报源）；P2-12 focus-visible 2px outline。
  正交意图：
  1. overview 投影消费：健康卡（通过率环 SVG token 色 + 三态计数 + stale 环带 +
     typed error 降级卡 + nextCursor 续页）+ 近期 runs 时间线（运行中 live 进度 +
     cancel；tracked run 经 evaluationRunState 注入 n/m）。
  2. run 入口门控：Run… 仅 Imported ws（Global 只读——spec「run 发起 MUST 限定
     Imported」）；run 经确认弹层显式发起（绝不自动运行）。
  视图状态：数据 → evaluation-overview store（latest-request-wins + 连接门；
  挂载竞态补救）；运行追踪 → evaluation-run store。
-->
<script lang="ts">
  import { untrack } from "svelte";
  import { useParams, goById } from "$lib/shell";
  import { t } from "$lib/i18n";
  import { Button } from "$lib/components/ui/button";
  import { showToast } from "$lib/toast.svelte";
  import { connectionState } from "$lib/store.svelte";
  import {
    cancelEvaluationRun,
    evaluationOutcomeBadge,
    evaluationOverviewState,
    evaluationPassRate,
    evaluationRunState,
    evaluationTargetKey,
    loadEvaluationOverview,
    loadMoreEvaluationOverview,
    newestRecentRunForTarget,
    relativeTimeParts,
    resetEvaluationOverview,
    resetEvaluationRun,
    sameEvaluationTarget,
    type EvaluationHealthSnapshot,
  } from "$lib/stores/evaluation-view.svelte";
  import type {
    EvaluationOverviewRecentRun,
    EvaluationOverviewTarget,
    EvaluationRunStatus,
    EvaluationTarget,
  } from "$shared/contracts/evaluation.js";
  import type { WorkspaceId } from "$shared/contracts/workspaces.js";
  import RunConfirmDialog from "./run-confirm-dialog.svelte";
  import IconLoader from "@lucide/svelte/icons/loader-circle";
  import IconPlay from "@lucide/svelte/icons/play";
  import IconRefresh from "@lucide/svelte/icons/refresh-cw";
  import IconAlert from "@lucide/svelte/icons/triangle-alert";
  import IconCheck from "@lucide/svelte/icons/check";
  import IconX from "@lucide/svelte/icons/x";
  import IconCircleSlash from "@lucide/svelte/icons/circle-slash";
  import IconBan from "@lucide/svelte/icons/ban";

  const getParams = useParams<{ wsId: WorkspaceId }>();
  const wsId = $derived(getParams?.()?.wsId ?? null);
  const isGlobal = $derived(wsId === "~");

  let runOpen = $state(false);

  // wsId 变化（含首挂载）拉第一页；卸载清空总览与 run 追踪（防跨 ws 串数据）。
  $effect(() => {
    const id = wsId;
    if (id === null) return;
    void loadEvaluationOverview(id);
  });
  $effect(() => {
    return () => {
      resetEvaluationOverview();
      resetEvaluationRun();
    };
  });

  // 挂载竞态补救（WS5 走查 B）：深链首帧 WS 未就绪时静默 no-op——连接转 ready
  // 且尚无数据时自动重发。
  let lastConnectionStatus = $state(connectionState.status);
  $effect(() => {
    const status = connectionState.status;
    const was = untrack(() => lastConnectionStatus);
    lastConnectionStatus = status;
    if (was === "connected" || status !== "connected") return;
    const retryWsId = untrack(() => wsId);
    if (retryWsId === null) return;
    if (untrack(() => evaluationOverviewState.wsId) !== null) return;
    void loadEvaluationOverview(retryWsId);
  });

  // run 终态 toast（批评环 R1 P2-10）：消费 settledSummary（含计数摘要），按
  // runId 幂等去重——取消入口的手动成功 toast 退役，本 effect 是唯一终态播报源。
  let toastedSettledRunId = $state<string | null>(null);
  $effect(() => {
    const summary = evaluationRunState.settledSummary;
    if (summary === null) return;
    if (untrack(() => toastedSettledRunId) === summary.runId) return;
    toastedSettledRunId = summary.runId;
    // R2-3：lifecycle key——终态帧取代仍在屏上的「Run queued」帧（同一 run 至多一张）。
    const toastKey = `eval-run-${summary.runId}`;
    if (summary.status === "cancelled") {
      showToast(t("evaluating.runCancelledToast"), undefined, toastKey);
    } else if (summary.executed === 0) {
      showToast(t("evaluating.runCompletedEmptyToast"), undefined, toastKey);
    } else if (summary.passed !== null && summary.executed !== null) {
      showToast(
        t("evaluating.runCompletedToast", { passed: summary.passed, total: summary.executed }),
        undefined,
        toastKey,
      );
    } else {
      showToast(
        t("evaluating.runStateToast", { status: t("evaluating.runStatusCompleted") }),
        undefined,
        toastKey,
      );
    }
  });

  type OkTarget = Extract<EvaluationOverviewTarget, { skillName: string }>;

  const targets = $derived(evaluationOverviewState.targets);
  const loading = $derived(evaluationOverviewState.loading);
  const error = $derived(evaluationOverviewState.error);
  const recentRuns = $derived(evaluationOverviewState.recentRuns);
  const nextCursor = $derived(evaluationOverviewState.nextCursor);
  const loadingMore = $derived(evaluationOverviewState.loadingMore);

  /** Run 弹层的可选清单：本 ws 的正常行（error 行无摘要，不可发起）。 */
  const runTargets = $derived(
    wsId === null || isGlobal
      ? []
      : targets
          .filter((row): row is OkTarget => !("error" in row))
          .filter((row) => row.target.workspaceId === wsId)
          .map((row) => ({ target: row.target, skillName: row.skillName })),
  );

  /** run 状态 → 行徽标配色（四态穷尽）。 */
  function runStatusTone(status: EvaluationRunStatus): string {
    switch (status) {
      case "queued":
        return "bg-muted text-muted-foreground";
      case "running":
        return "bg-primary/10 text-primary";
      case "completed":
        return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
      case "cancelled":
        return "bg-amber-500/10 text-amber-700 dark:text-amber-300";
    }
  }

  function runStatusLabel(status: EvaluationRunStatus): string {
    switch (status) {
      case "queued":
        return t("evaluating.runStatusQueued");
      case "running":
        return t("evaluating.runStatusRunning");
      case "completed":
        return t("evaluating.runStatusCompleted");
      case "cancelled":
        return t("evaluating.runStatusCancelled");
    }
  }

  /** 相对时间 → i18n 文案（无效时间回退空串——不渲染误导文本）。 */
  function relativeTime(iso: string): string {
    const parts = relativeTimeParts(iso);
    if (parts === null) return "";
    switch (parts.unit) {
      case "now":
        return t("evaluating.timeJustNow");
      case "minutes":
        return t("evaluating.timeMinutesAgo", { n: parts.value });
      case "hours":
        return t("evaluating.timeHoursAgo", { n: parts.value });
      case "days":
        return t("evaluating.timeDaysAgo", { n: parts.value });
    }
  }

  /** 通过率环配色（design §4.1：token 色——绿/红两相，不引入新色相）。 */
  function ringTone(health: EvaluationHealthSnapshot): string {
    if (health.failedCount > 0) return "stroke-destructive";
    return "stroke-emerald-600 dark:stroke-emerald-400";
  }

  /**
   * 健康度绑定（批评环 R1）：卡（环/计数/摘要）绑定最近 completed 持久快照
   * （store 的 healthByTarget——cancelled/running 的部分落盘计数不覆盖健康度）。
   */
  function healthOf(row: OkTarget): EvaluationHealthSnapshot | null {
    return evaluationOverviewState.healthByTarget[evaluationTargetKey(row.target)] ?? null;
  }

  /** 该 target 在 recentRuns 窗口内是否有任何活动（区分「从未运行」与「尚无完成」）。 */
  function hasRunActivity(row: OkTarget): boolean {
    return recentRuns.some((run) => sameEvaluationTarget(run.target, row.target));
  }

  /**
   * P2-1：completed 行结局判读——该 run 是 target 最新 run 且结果数与
   * targets[].lastRun 四计数和对齐时，失败/错误 → 红✗；对不齐（窗口外旧 run
   * 或计数归属不明）维持绿✓中性完成态。
   */
  function completedRunFailed(run: EvaluationOverviewRecentRun): boolean {
    const newest = newestRecentRunForTarget(recentRuns, run.target);
    if (newest === null || newest.runId !== run.runId) return false;
    const row = targets.find(
      (candidate) => !("error" in candidate) && sameEvaluationTarget(candidate.target, run.target),
    );
    const lastRun = row !== undefined && !("error" in row) ? row.lastRun : undefined;
    if (lastRun === undefined) return false;
    const executed =
      lastRun.passedCount + lastRun.failedCount + lastRun.errorCount + lastRun.unavailableCount;
    if (run.resultIds.length !== executed) return false;
    return lastRun.failedCount > 0 || lastRun.errorCount > 0;
  }

  /** stale 黄带（design §4.1：有则环绕卡片；error 行与零占比不渲染）。 */
  function staleBand(row: EvaluationOverviewTarget): string {
    return !("error" in row) && row.staleRatio !== undefined && row.staleRatio > 0
      ? "ring-1 ring-amber-500/60"
      : "";
  }

  function openDetail(target: EvaluationTarget): void {
    goById("evaluating.detail", {
      wsId: target.workspaceId,
      providerId: target.providerId,
      skillId: target.skillId,
    });
  }

  function refresh(): void {
    if (wsId !== null) void loadEvaluationOverview(wsId);
  }

  async function cancelRun(runId: string): Promise<void> {
    const outcome = await cancelEvaluationRun(runId);
    if (!outcome.ok) {
      showToast(t("evaluating.runCancelFailedToast", { error: outcome.message ?? "" }));
      return;
    }
    // 成功播报统一归 settledSummary effect（tracked run 按 runId 幂等单次播报）；
    // 非本 UI 追踪的 run 不驱动 store 终态——就地播报并重拉总览。
    if (evaluationRunState.runId !== runId) {
      // 非 store 追踪的 run：就地播报同一 lifecycle key（取代其 queued 帧若有）。
      showToast(t("evaluating.runCancelledToast"), undefined, `eval-run-${runId}`);
      if (wsId !== null) void loadEvaluationOverview(wsId);
    }
  }

  /** recentRuns 行的人读技能名（无 skillName 字段——按三元组从 targets 查）。 */
  function skillLabelFor(target: EvaluationTarget): string {
    const row = targets.find(
      (candidate) => evaluationTargetKey(candidate.target) === evaluationTargetKey(target),
    );
    return row && !("error" in row) ? row.skillName : target.skillId;
  }

  /** tracked run 的 live 进度文案（n/m；分母未知时只报已完成数）。 */
  function liveProgress(runId: string): string | null {
    if (evaluationRunState.runId !== runId) return null;
    if (evaluationRunState.resultCount === null) return null;
    if (evaluationRunState.totalCases === null) {
      return t("evaluating.liveProgressCount", { done: evaluationRunState.resultCount });
    }
    return t("evaluating.liveProgress", {
      done: evaluationRunState.resultCount,
      total: evaluationRunState.totalCases,
    });
  }

  function openCreator(): void {
    if (wsId !== null) goById("creator.home", { wsId });
  }
</script>

<div class="evaluating-overview-shell evaluating-kbd-scope flex h-full flex-col overflow-hidden">
  <!-- 顶行：标题 + 刷新 + Run…（Global ws 无 run 入口——run 限定 Imported）。
       P1-3：标题/徽标不截断（shrink-0 + nowrap），窄容器下按钮先降级为图标。 -->
  <header class="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-2">
    <span class="flex min-w-0 items-center gap-2 text-xs font-medium">
      <IconPlay class="size-3.5 shrink-0 text-muted-foreground" />
      <span class="shrink-0">{t("evaluating.title")}</span>
      {#if targets.length > 0}
        <span class="shrink-0 whitespace-nowrap font-normal text-muted-foreground">
          {t(targets.length === 1 ? "evaluating.caseTargetOne" : "evaluating.caseTargetMany", {
            count: targets.length,
          })}
        </span>
      {/if}
    </span>
    <div class="flex shrink-0 items-center gap-1.5">
      {#if !isGlobal}
        <Button
          variant="outline"
          size="sm"
          class="h-7 gap-1.5"
          disabled={loading || runTargets.length === 0}
          hidden={targets.length === 0}
          title={t("evaluating.runEntry")}
          onclick={() => (runOpen = true)}
        >
          <IconPlay class="h-3.5 w-3.5" />
          <span class="evaluating-btn-label">{t("evaluating.runEntry")}</span>
        </Button>
      {/if}
      <Button
        variant="outline"
        size="sm"
        class="h-7 gap-1.5"
        title={t("evaluating.refreshTitle")}
        onclick={refresh}
        disabled={loading}
      >
        {#if loading}<IconLoader class="h-3.5 w-3.5 animate-spin" />{:else}<IconRefresh
            class="h-3.5 w-3.5"
          />{/if}
        <span class="evaluating-btn-label">{t("evaluating.refresh")}</span>
      </Button>
    </div>
  </header>

  {#if wsId === null}
    <div class="flex flex-1 items-center justify-center p-4 text-xs text-muted-foreground">
      Invalid workspace target.
    </div>
  {:else if loading && evaluationOverviewState.wsId === null}
    <div
      class="flex flex-1 items-center justify-center gap-2 text-xs text-muted-foreground"
      role="status"
      aria-label={t("evaluating.loadingAria")}
    >
      <IconLoader class="h-4 w-4 animate-spin" />
      {t("evaluating.loadingAria")}
    </div>
  {:else if error}
    <div class="flex flex-1 flex-col items-center justify-center gap-2 px-8 text-center">
      <p class="text-xs font-medium">{t("evaluating.loadErrorTitle")}</p>
      <p class="text-xs text-destructive">{error}</p>
      <Button variant="outline" size="sm" onclick={refresh}>{t("common.retry")}</Button>
    </div>
  {:else if targets.length === 0}
    <!-- 空态（design §4.1）：单焦点引导卡 + Creator 深链（衔接 creator 引导链）。 -->
    <div class="flex flex-1 items-center justify-center p-6">
      <div
        class="flex max-w-sm flex-col items-center gap-3 rounded-lg border border-border p-6 text-center"
        data-testid="evaluating-empty"
      >
        <IconPlay class="size-5 text-muted-foreground" />
        <div class="space-y-1">
          <p class="text-xs font-medium text-foreground">{t("evaluating.emptyTitle")}</p>
          <p class="text-xs text-muted-foreground">{t("evaluating.emptyBody")}</p>
        </div>
        <Button variant="outline" size="sm" onclick={openCreator}>
          {t("evaluating.emptyAction")}
        </Button>
      </div>
    </div>
  {:else}
    <div class="min-h-0 flex-1 overflow-y-auto p-3">
      <!-- 近期 runs 时间线（固定窗口 20；最新在前；queued/running live 进度 + cancel）。 -->
      <p class="px-1 pb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {t("evaluating.recentRunsHeading")}
      </p>
      {#if recentRuns.length === 0}
        <p class="px-1 pb-3 text-xs text-muted-foreground">{t("evaluating.noRuns")}</p>
      {:else}
        <ul class="mb-4 space-y-1" data-testid="evaluating-recent-runs">
          {#each recentRuns as run (run.runId)}
            {@const active = run.status === "queued" || run.status === "running"}
            {@const progress = active ? liveProgress(run.runId) : null}
            {@const ranNothing = run.status === "completed" && run.resultIds.length === 0}
            <li
              class="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs"
              data-testid="evaluating-recent-run"
              data-run-state={run.status}
            >
              <!-- 四态瞬时判读（GA 品类肌肉记忆 + P2-1 结局色）：运行中转圈、排队
                   灰 ⊘、完成打勾（对齐得到失败计数时红✗/否则绿✓）、取消黄🚫。 -->
              <span class="flex size-4 shrink-0 items-center justify-center" aria-hidden="true">
                {#if run.status === "running"}
                  <IconLoader class="size-3.5 animate-spin text-primary" />
                {:else if run.status === "queued"}
                  <IconCircleSlash class="size-3.5 text-muted-foreground" />
                {:else if run.status === "completed"}
                  {#if completedRunFailed(run)}
                    <IconX class="size-3.5 text-destructive" />
                  {:else}
                    <IconCheck class="size-3.5 text-emerald-600 dark:text-emerald-400" />
                  {/if}
                {:else}
                  <IconBan class="size-3.5 text-amber-600 dark:text-amber-400" />
                {/if}
              </span>
              <span
                class="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap {runStatusTone(
                  run.status,
                )}"
              >
                {runStatusLabel(run.status)}
              </span>
              <button
                type="button"
                class="min-w-0 flex-1 truncate text-left underline-offset-2 hover:underline"
                title={t("evaluating.openDetailTitle", { skill: skillLabelFor(run.target) })}
                onclick={() => openDetail(run.target)}
              >
                {skillLabelFor(run.target)}
                <span class="text-muted-foreground"> · {run.target.providerId}</span>
              </button>
              {#if ranNothing}
                <!-- P2-5：completed-but-empty → 行级「No cases ran」。 -->
                <span class="shrink-0 text-[11px] text-muted-foreground">
                  {t("evaluating.noCasesRan")}
                </span>
              {/if}
              {#if progress !== null}
                <span
                  class="shrink-0 font-medium text-primary"
                  data-testid="evaluating-run-live-progress"
                >
                  {progress}
                </span>
              {/if}
              <span class="shrink-0 text-[11px] text-muted-foreground whitespace-nowrap">
                {relativeTime(run.startedAt)}
              </span>
              {#if active}
                <Button
                  variant="outline"
                  size="sm"
                  class="h-6 px-2 text-[11px]"
                  title={t("evaluating.cancelRunTitle")}
                  onclick={() => void cancelRun(run.runId)}
                >
                  {t("evaluating.cancelRun")}
                </Button>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}

      <!-- 技能健康卡网格（design §4.1：仪表语言——通过率环 + 三态计数 + 失败摘要）。
           P1-3（批评环 R1）：auto-fill minmax——卡下限 220px，Agent 面板挤压下
           列数收缩换行，不再把卡截到不可辨认。 -->
      <p class="px-1 pb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {t("evaluating.targetsHeading")}
      </p>
      <div
        class="grid grid-cols-[repeat(auto-fill,minmax(min(220px,100%),1fr))] gap-2"
        data-testid="evaluating-target-grid"
      >
        {#each targets as row (evaluationTargetKey(row.target))}
          {@const health = "error" in row ? null : healthOf(row)}
          {@const rate = health === null ? null : evaluationPassRate(health)}
          {@const ranTotal =
            health === null
              ? null
              : health.passedCount +
                health.failedCount +
                health.errorCount +
                health.unavailableCount}
          <button
            type="button"
            class="flex flex-col gap-2 rounded-lg border border-border p-3 text-left transition-colors hover:bg-muted/40 {staleBand(
              row,
            )}"
            data-testid="evaluating-target-card"
            title={t("evaluating.openDetailTitle", {
              skill: "error" in row ? row.target.skillId : row.skillName,
            })}
            onclick={() => openDetail(row.target)}
          >
            {#if "error" in row}
              <!-- typed error 行（单 target IO 失败——摘要缺席，整页不失败）。 -->
              <div class="flex items-center gap-2">
                <IconAlert class="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <span class="min-w-0 truncate text-xs font-medium">{row.target.skillId}</span>
                <span
                  class="shrink-0 rounded bg-amber-500/10 px-1.5 py-0.5 text-[11px] text-amber-700 dark:text-amber-300"
                >
                  {t("evaluating.targetError")}
                </span>
              </div>
              <p class="line-clamp-2 text-[11px] text-muted-foreground" title={row.error.message}>
                {row.error.code}: {row.error.message}
              </p>
            {:else}
              {@const stale = row.staleRatio !== undefined && row.staleRatio > 0}
              <div class="flex items-center gap-3">
                <!-- 通过率环（token 色：失败相 destructive / 通过相 emerald；无 completed
                     快照 = 空环——健康度绑定最近 completed，cancelled/running 不覆盖）。 -->
                <svg
                  viewBox="0 0 36 36"
                  class="size-9 shrink-0"
                  aria-hidden="true"
                  data-testid="evaluating-pass-ring"
                >
                  <circle
                    cx="18"
                    cy="18"
                    r="15.5"
                    fill="none"
                    stroke-width="4"
                    class="stroke-border"
                  />
                  {#if rate !== null}
                    <circle
                      cx="18"
                      cy="18"
                      r="15.5"
                      fill="none"
                      stroke-width="4"
                      stroke-linecap="round"
                      transform="rotate(-90 18 18)"
                      stroke-dasharray="{(rate * 97.39).toFixed(2)} 97.39"
                      class={ringTone(health!)}
                    />
                  {/if}
                </svg>
                <div class="min-w-0 flex-1">
                  <p class="truncate text-xs font-medium">{row.skillName}</p>
                  <p class="truncate text-[11px] text-muted-foreground">{row.target.providerId}</p>
                </div>
                {#if rate !== null}
                  <!-- P2-2：百分比旁带分母（实际执行数——四计数之和）。 -->
                  <span class="flex shrink-0 flex-col items-end leading-tight">
                    <span
                      class="text-sm font-semibold tabular-nums {health!.failedCount > 0
                        ? 'text-destructive'
                        : 'text-emerald-700 dark:text-emerald-300'}"
                    >
                      {Math.round(rate * 100)}%
                    </span>
                    <span class="text-[10px] text-muted-foreground tabular-nums">
                      {t("evaluating.ranCount", { count: ranTotal! })}
                    </span>
                  </span>
                {:else}
                  <span class="shrink-0 text-sm font-semibold text-muted-foreground">—</span>
                {/if}
              </div>
              <!-- 三态计数行（icon + 数字；非零才渲染）+ 相对时间。 -->
              <div
                class="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px]"
                data-testid="evaluating-card-counts"
              >
                <span
                  class="whitespace-nowrap rounded bg-muted px-1.5 py-0.5 text-muted-foreground"
                >
                  {t(row.caseCount === 1 ? "evaluating.caseCountOne" : "evaluating.caseCountMany", {
                    count: row.caseCount,
                  })}
                </span>
                {#if health !== null}
                  {#if health.passedCount > 0}
                    <span
                      class="flex items-center gap-0.5 font-medium text-emerald-700 dark:text-emerald-300"
                      aria-label={t("evaluating.passedCount", { count: health.passedCount })}
                    >
                      <IconCheck class="size-3" aria-hidden="true" />{health.passedCount}
                    </span>
                  {/if}
                  {#if health.failedCount > 0}
                    <span
                      class="flex items-center gap-0.5 font-medium text-destructive"
                      aria-label={t("evaluating.failedCount", { count: health.failedCount })}
                    >
                      <IconX class="size-3" aria-hidden="true" />{health.failedCount}
                    </span>
                  {/if}
                  {#if health.errorCount > 0}
                    <span
                      class="flex items-center gap-0.5 rounded bg-destructive px-1.5 py-0.5 font-medium text-destructive-foreground"
                      data-testid="evaluating-errors-chip"
                      aria-label={t(
                        health.errorCount === 1
                          ? "evaluating.errorCountOne"
                          : "evaluating.errorCount",
                        { count: health.errorCount },
                      )}
                    >
                      <IconAlert class="size-3" aria-hidden="true" />{health.errorCount}
                    </span>
                  {/if}
                  {#if health.unavailableCount > 0}
                    <span
                      class="flex items-center gap-0.5 text-muted-foreground"
                      aria-label={t("evaluating.unavailableCount", {
                        count: health.unavailableCount,
                      })}
                    >
                      <IconBan class="size-3" aria-hidden="true" />{health.unavailableCount}
                    </span>
                  {/if}
                  <span class="whitespace-nowrap text-muted-foreground">
                    {relativeTime(health.endedAt)}
                  </span>
                {:else if hasRunActivity(row)}
                  <!-- 有 run 活动但尚无 completed 快照（如仅取消）——不谎称「从未运行」。 -->
                  <span class="text-muted-foreground">{t("evaluating.noCompletedRun")}</span>
                {:else}
                  <span class="text-muted-foreground">{t("evaluating.notRunYet")}</span>
                {/if}
                {#if stale}
                  <span
                    class="rounded {evaluationOutcomeBadge(
                      'stale',
                    )} px-1.5 py-0.5 text-[11px] font-medium"
                  >
                    {t("evaluating.staleShare", {
                      percent: Math.round((row.staleRatio ?? 0) * 100),
                    })}
                  </span>
                {/if}
              </div>
              <!-- 失败摘要行（design §4.1：最近 completed run 的失败/错误面；点卡直达断言详情）。 -->
              {#if health !== null && health.failedCount > 0}
                <p
                  class="flex items-center gap-1.5 text-[11px] font-medium text-destructive"
                  data-testid="evaluating-failing-line"
                >
                  <IconX class="size-3 shrink-0" aria-hidden="true" />
                  {t("evaluating.failingLine", { count: health.failedCount })}
                </p>
              {:else if health !== null && health.errorCount > 0}
                <p
                  class="flex items-center gap-1.5 text-[11px] font-medium text-orange-700 dark:text-orange-300"
                >
                  <IconAlert class="size-3 shrink-0" aria-hidden="true" />
                  {t("evaluating.erroredLine", { count: health.errorCount })}
                </p>
              {/if}
            {/if}
          </button>
        {/each}
      </div>

      {#if nextCursor !== null}
        <div class="flex justify-center pt-3">
          <Button
            variant="outline"
            size="sm"
            class="h-7"
            disabled={loadingMore}
            onclick={() => wsId !== null && void loadMoreEvaluationOverview(wsId)}
          >
            {#if loadingMore}{t("evaluating.loadingMore")}{:else}{t("evaluating.loadMore")}{/if}
          </Button>
        </div>
      {/if}
    </div>
  {/if}
</div>

{#if wsId !== null}
  <RunConfirmDialog bind:open={runOpen} {wsId} targets={runTargets} />
{/if}

<style>
  /*
   * 批评环 R1 处置批的 CSS 契约（jsdom 无法断言样式——class 钩子由 dom 测试钉死）：
   * 1. P1-3 头部降级顺序：标题与「N skills」徽标不截断（shrink-0 + nowrap），
   *    容器 <480px 时 Run…/Refresh 按钮先降级为纯图标（label 隐藏，title 保语义）。
   *    容器宽度（非视口）驱动——Agent 面板挤压下视口断点失效。
   * 2. P2-12 键盘导航 focus-visible 2px outline（原生 button 无 shadcn ring）。
   */
  .evaluating-overview-shell {
    container-type: inline-size;
  }
  @container (width < 480px) {
    .evaluating-btn-label {
      display: none;
    }
  }
  .evaluating-kbd-scope :global(button:focus-visible) {
    outline: 2px solid var(--ring);
    outline-offset: 1px;
  }
</style>
