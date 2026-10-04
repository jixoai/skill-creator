<!--
  用户原始需求 [2026-10-04]（evaluating-world-class design §4.1）：Evaluating 总览屏
  按「健康度仪表」语言重做——「近期 runs 时间线（GitHub Actions run list 式行，
  最新在前）+ 技能健康卡网格（通过率环 + 三态计数行 + stale 黄带 + 失败摘要行）」；
  空态单焦点引导（Creator 深链）。Run… 显式确认与 Global 只读沿 evaluating-dashboard
  既有裁决。
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
    relativeTimeParts,
    resetEvaluationOverview,
    resetEvaluationRun,
  } from "$lib/stores/evaluation-view.svelte";
  import type {
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

  // run 终态 toast（状态迁移边沿触发；挂载时的既有终态不播报）。
  let lastRunStatus = $state<EvaluationRunStatus | null>(null);
  $effect(() => {
    const status = evaluationRunState.status;
    const was = untrack(() => lastRunStatus);
    lastRunStatus = status;
    if (was === null || was === status) return;
    if (status === "completed" || status === "cancelled") {
      showToast(
        t("evaluating.runStateToast", {
          status: t(
            status === "completed"
              ? "evaluating.runStatusCompleted"
              : "evaluating.runStatusCancelled",
          ),
        }),
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
  function ringTone(row: OkTarget): string {
    const lastRun = row.lastRun;
    if (lastRun === undefined) return "stroke-border";
    if (lastRun.failedCount > 0) return "stroke-destructive";
    return "stroke-emerald-600 dark:stroke-emerald-400";
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
    showToast(t("evaluating.runCancelledToast"));
    // 非追踪 run 的取消不触发 store 内刷新——就地重拉总览。
    if (wsId !== null && evaluationRunState.runId !== runId) void loadEvaluationOverview(wsId);
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

<div class="flex h-full flex-col overflow-hidden">
  <!-- 顶行：标题 + 刷新 + Run…（Global ws 无 run 入口——run 限定 Imported）。 -->
  <header class="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-2">
    <span class="flex items-center gap-2 text-xs font-medium">
      <IconPlay class="size-3.5 text-muted-foreground" />
      {t("evaluating.title")}
      {#if targets.length > 0}
        <span class="font-normal text-muted-foreground">
          {t(targets.length === 1 ? "evaluating.caseTargetOne" : "evaluating.caseTargetMany", {
            count: targets.length,
          })}
        </span>
      {/if}
    </span>
    <div class="flex items-center gap-1.5">
      {#if !isGlobal}
        <Button
          variant="outline"
          size="sm"
          class="h-7 gap-1.5"
          disabled={loading || runTargets.length === 0}
          onclick={() => (runOpen = true)}
        >
          <IconPlay class="h-3.5 w-3.5" />
          {t("evaluating.runEntry")}
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
        {t("evaluating.refresh")}
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
            <li
              class="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs"
              data-testid="evaluating-recent-run"
            >
              <!-- 三态瞬时判读（GA 品类肌肉记忆）：运行中转圈、完成打勾、取消黄叉。 -->
              <span class="flex size-4 shrink-0 items-center justify-center" aria-hidden="true">
                {#if run.status === "running"}
                  <IconLoader class="size-3.5 animate-spin text-primary" />
                {:else if run.status === "queued"}
                  <IconCircleSlash class="size-3.5 text-muted-foreground" />
                {:else if run.status === "completed"}
                  <IconCheck class="size-3.5 text-emerald-600 dark:text-emerald-400" />
                {:else}
                  <IconBan class="size-3.5 text-amber-600 dark:text-amber-400" />
                {/if}
              </span>
              <span
                class="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium {runStatusTone(
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
              {#if progress !== null}
                <span
                  class="shrink-0 font-medium text-primary"
                  data-testid="evaluating-run-live-progress"
                >
                  {progress}
                </span>
              {/if}
              <span class="shrink-0 text-[11px] text-muted-foreground">
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

      <!-- 技能健康卡网格（design §4.1：仪表语言——通过率环 + 三态计数 + 失败摘要）。 -->
      <p class="px-1 pb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {t("evaluating.targetsHeading")}
      </p>
      <div class="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {#each targets as row (evaluationTargetKey(row.target))}
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
              {@const rate = row.lastRun === undefined ? null : evaluationPassRate(row.lastRun)}
              {@const stale = row.staleRatio !== undefined && row.staleRatio > 0}
              <div class="flex items-center gap-3">
                <!-- 通过率环（token 色：失败相 destructive / 通过相 emerald；无 run = 空环）。 -->
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
                      class={ringTone(row)}
                    />
                  {/if}
                </svg>
                <div class="min-w-0 flex-1">
                  <p class="truncate text-xs font-medium">{row.skillName}</p>
                  <p class="truncate text-[11px] text-muted-foreground">{row.target.providerId}</p>
                </div>
                {#if rate !== null}
                  <span
                    class="shrink-0 text-sm font-semibold tabular-nums {row.lastRun!.failedCount > 0
                      ? 'text-destructive'
                      : 'text-emerald-700 dark:text-emerald-300'}"
                  >
                    {Math.round(rate * 100)}%
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
                <span class="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
                  {t(row.caseCount === 1 ? "evaluating.caseCountOne" : "evaluating.caseCountMany", {
                    count: row.caseCount,
                  })}
                </span>
                {#if row.lastRun}
                  {#if row.lastRun.passedCount > 0}
                    <span
                      class="flex items-center gap-0.5 font-medium text-emerald-700 dark:text-emerald-300"
                      aria-label={t("evaluating.passedCount", { count: row.lastRun.passedCount })}
                    >
                      <IconCheck class="size-3" aria-hidden="true" />{row.lastRun.passedCount}
                    </span>
                  {/if}
                  {#if row.lastRun.failedCount > 0}
                    <span
                      class="flex items-center gap-0.5 font-medium text-destructive"
                      aria-label={t("evaluating.failedCount", { count: row.lastRun.failedCount })}
                    >
                      <IconX class="size-3" aria-hidden="true" />{row.lastRun.failedCount}
                    </span>
                  {/if}
                  {#if row.lastRun.errorCount > 0}
                    <span
                      class="flex items-center gap-0.5 rounded bg-destructive px-1.5 py-0.5 font-medium text-destructive-foreground"
                      data-testid="evaluating-errors-chip"
                      aria-label={t(
                        row.lastRun.errorCount === 1
                          ? "evaluating.errorCountOne"
                          : "evaluating.errorCount",
                        { count: row.lastRun.errorCount },
                      )}
                    >
                      <IconAlert class="size-3" aria-hidden="true" />{row.lastRun.errorCount}
                    </span>
                  {/if}
                  {#if row.lastRun.unavailableCount > 0}
                    <span
                      class="flex items-center gap-0.5 text-muted-foreground"
                      aria-label={t("evaluating.unavailableCount", {
                        count: row.lastRun.unavailableCount,
                      })}
                    >
                      <IconBan class="size-3" aria-hidden="true" />{row.lastRun.unavailableCount}
                    </span>
                  {/if}
                  <span class="text-muted-foreground">
                    {relativeTime(row.lastRun.endedAt)}
                  </span>
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
              <!-- 失败摘要行（design §4.1：最新 run 的失败/错误面；点卡直达断言详情）。 -->
              {#if row.lastRun && row.lastRun.failedCount > 0}
                <p
                  class="flex items-center gap-1.5 text-[11px] font-medium text-destructive"
                  data-testid="evaluating-failing-line"
                >
                  <IconX class="size-3 shrink-0" aria-hidden="true" />
                  {t("evaluating.failingLine", { count: row.lastRun.failedCount })}
                </p>
              {:else if row.lastRun && row.lastRun.errorCount > 0}
                <p
                  class="flex items-center gap-1.5 text-[11px] font-medium text-orange-700 dark:text-orange-300"
                >
                  <IconAlert class="size-3 shrink-0" aria-hidden="true" />
                  {t("evaluating.erroredLine", { count: row.lastRun.errorCount })}
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
