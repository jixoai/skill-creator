<!--
  用户原始需求 [2026-10-03]（evaluating-dashboard design §3）：Evaluating 总览屏——
  「顶行：ws 名 + Run… 入口（显式选 target 确认）+ 刷新；主体：技能卡网格
  （五态徽标行 + stale 黄标 + 最近 run 相对时间）；点卡跳三段路由详情」+
  有界近期 runs 行（运行中进度态/取消入口）。
  正交意图：
  1. overview 投影消费：技能卡网格（typed error 行降级卡 + nextCursor 续页）+
     近期 runs 行（queued/running 进度态 + cancel）。
  2. run 入口门控：Run… 仅 Imported ws（Global 只读——spec「run 发起 MUST 限定
     Imported」）；run 经确认弹层显式发起（绝不自动运行）。
  视图状态：数据 → evaluation-overview store（latest-request-wins + 连接门；
  挂载竞态补救与 eval-view 同族）；运行追踪 → evaluation-run store。
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

  // 挂载竞态补救（WS5 走查 B；与 eval-view 同族）：深链首帧 WS 未就绪时静默
  // no-op——连接转 ready 且尚无数据时自动重发。
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
          .filter(
            (row): row is Extract<EvaluationOverviewTarget, { skillName: string }> =>
              !("error" in row),
          )
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
</script>

<div class="flex h-full flex-col overflow-hidden">
  <!-- 顶行：标题 + 刷新 + Run…（Global ws 无 run 入口——run 限定 Imported）。 -->
  <header class="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-2">
    <span class="flex items-center gap-2 text-xs font-medium">
      <IconPlay class="size-3.5 text-muted-foreground" />
      {t("evaluating.title")}
      {#if targets.length > 0}
        <span class="font-normal text-muted-foreground">
          {t(targets.length === 1 ? "evaluating.caseCountOne" : "evaluating.caseCountMany", {
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
    <div class="flex flex-1 flex-col items-center justify-center gap-1 p-6 text-center">
      <p class="text-xs font-medium text-foreground">{t("evaluating.emptyTitle")}</p>
      <p class="max-w-sm text-xs text-muted-foreground">{t("evaluating.emptyBody")}</p>
    </div>
  {:else}
    <div class="min-h-0 flex-1 overflow-y-auto p-3">
      <p class="px-1 pb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {t("evaluating.targetsHeading")}
      </p>
      <!-- 技能卡网格：点卡 → 三段路由详情（卡片按钮 = 单一交互目标）。 -->
      <div class="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {#each targets as row (evaluationTargetKey(row.target))}
          <button
            type="button"
            class="flex flex-col gap-2 rounded-lg border border-border p-3 text-left transition-colors hover:bg-muted/40"
            data-testid="evaluating-target-card"
            title={t("evaluating.openDetailTitle", {
              skill: "error" in row ? row.target.skillId : row.skillName,
            })}
            onclick={() => openDetail(row.target)}
          >
            {#if "error" in row}
              <!-- typed error 行（design §1 r2：单 target IO 失败——摘要缺席，整页不失败）。 -->
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
              <div class="flex items-start justify-between gap-2">
                <span class="min-w-0 truncate text-xs font-medium">{row.skillName}</span>
                <span class="shrink-0 text-[11px] text-muted-foreground"
                  >{row.target.providerId}</span
                >
              </div>
              <div class="flex flex-wrap items-center gap-1.5" data-testid="evaluating-card-badges">
                <span class="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                  {t(row.caseCount === 1 ? "evaluating.caseCountOne" : "evaluating.caseCountMany", {
                    count: row.caseCount,
                  })}
                </span>
                {#if row.lastRun}
                  {#if row.lastRun.passedCount > 0}
                    <span
                      class="rounded px-1.5 py-0.5 text-[11px] font-medium {evaluationOutcomeBadge(
                        'passed',
                      )}"
                    >
                      {t("evaluating.passedCount", { count: row.lastRun.passedCount })}
                    </span>
                  {/if}
                  {#if row.lastRun.failedCount > 0}
                    <span
                      class="rounded px-1.5 py-0.5 text-[11px] font-medium {evaluationOutcomeBadge(
                        'failed',
                      )}"
                    >
                      {t("evaluating.failedCount", { count: row.lastRun.failedCount })}
                    </span>
                  {/if}
                  <!-- 残留台账（task 1.5）：非零 errors → 红 chip；=0 不渲染。 -->
                  {#if row.lastRun.errorCount > 0}
                    <span
                      class="rounded bg-destructive px-1.5 py-0.5 text-[11px] font-medium text-destructive-foreground"
                      data-testid="evaluating-errors-chip"
                    >
                      {t(
                        row.lastRun.errorCount === 1
                          ? "evaluating.errorCountOne"
                          : "evaluating.errorCount",
                        { count: row.lastRun.errorCount },
                      )}
                    </span>
                  {/if}
                  {#if row.lastRun.unavailableCount > 0}
                    <span
                      class="rounded px-1.5 py-0.5 text-[11px] font-medium {evaluationOutcomeBadge(
                        'unavailable',
                      )}"
                    >
                      {t("evaluating.unavailableCount", { count: row.lastRun.unavailableCount })}
                    </span>
                  {/if}
                {/if}
                {#if row.staleRatio !== undefined && row.staleRatio > 0}
                  <span
                    class="rounded {evaluationOutcomeBadge(
                      'stale',
                    )} px-1.5 py-0.5 text-[11px] font-medium"
                  >
                    {t("evaluating.staleShare", { percent: Math.round(row.staleRatio * 100) })}
                  </span>
                {/if}
              </div>
              <p class="text-[11px] text-muted-foreground">
                {#if row.lastRun}
                  {t("evaluating.lastRunAt", { time: relativeTime(row.lastRun.endedAt) })}
                {:else}
                  {t("evaluating.notRunYet")}
                {/if}
              </p>
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

      <!-- 近期 runs（固定窗口 20；queued/running 进度态 + cancel 入口）。 -->
      <p
        class="px-1 pb-2 pt-4 text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
      >
        {t("evaluating.recentRunsHeading")}
      </p>
      {#if recentRuns.length === 0}
        <p class="px-1 text-xs text-muted-foreground">{t("evaluating.noRuns")}</p>
      {:else}
        <ul class="space-y-1">
          {#each recentRuns as run (run.runId)}
            {@const active = run.status === "queued" || run.status === "running"}
            <li
              class="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs"
              data-testid="evaluating-recent-run"
            >
              <span
                class="flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[11px] font-medium {runStatusTone(
                  run.status,
                )}"
              >
                {#if run.status === "running"}<IconLoader class="h-3 w-3 animate-spin" />{/if}
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
    </div>
  {/if}
</div>

{#if wsId !== null}
  <RunConfirmDialog bind:open={runOpen} {wsId} targets={runTargets} />
{/if}
