<!--
  用户原始需求 [2026-10-03]（evaluating-dashboard design §3/§4）：评估详情屏 =
  components/creator/eval-view.svelte 迁 apps/evaluating 并升格——cases 表（五态
  最新结果 + bound/observed revision 对照 + 失败断言展开）+ run 发起（显式 target
  确认）/ cancel + case 新建编辑（Imported only；Global 只读徽标）。
  迁移保留（design-critique R1-R3 回归钉）：行 grid、bound/rev 双显合并与组内
  去重、失败摘要行、挂载竞态补救。
  正交意图：
  1. 三段路由身份消费：/w/:wsId/evaluating/:providerId/:skillId 唯一确定三元组
     （身份变化重拉；卸载清空——防跨技能串数据）。
  2. 动作面门控：Run…/New case 仅 Imported 且技能可解析（skills.info 现读
     revision 供新建绑定）；Global → 只读徽标 + 说明 + 双写入口缺席。
  3. 失败断言展开：failed 结果按 ref 对齐 case 断言（期望 vs 观测）+
     observedEndRevision 对比列。
  视图状态：行 → evaluation-view store；技能名/revision → 组件本地（skills.info）；
  展开/弹层 → 组件本地 $state。
-->
<script lang="ts">
  import { untrack } from "svelte";
  import { useParams, goById } from "$lib/shell";
  import { t } from "$lib/i18n";
  import { Button } from "$lib/components/ui/button";
  import { showToast } from "$lib/toast.svelte";
  import { connectionState } from "$lib/store.svelte";
  import { getRpc } from "$lib/stores/connection.svelte";
  import {
    cancelEvaluationRun,
    detailErrorCount,
    evaluationOutcomeBadge,
    evaluationRunState,
    evaluationViewState,
    isGlobalEvaluationTarget,
    loadEvaluationView,
    resetEvaluationRun,
    resetEvaluationView,
    type EvaluationRow,
  } from "$lib/stores/evaluation-view.svelte";
  import type {
    EvaluationAssertion,
    EvaluationRunStatus,
    EvaluationTarget,
  } from "$shared/contracts/evaluation.js";
  import type { ProviderId, WorkspaceId } from "$shared/contracts/workspaces.js";
  import type { SkillId } from "$shared/contracts/skills.js";
  import RunConfirmDialog from "./run-confirm-dialog.svelte";
  import CaseEditorDialog from "./case-editor-dialog.svelte";
  import IconArrowLeft from "@lucide/svelte/icons/arrow-left";
  import IconLoader from "@lucide/svelte/icons/loader-circle";
  import IconPlay from "@lucide/svelte/icons/play";
  import IconPlus from "@lucide/svelte/icons/plus";
  import IconClipboard from "@lucide/svelte/icons/clipboard-check";

  const getParams = useParams<{
    wsId: WorkspaceId;
    providerId: ProviderId;
    skillId: SkillId;
  }>();
  const params = $derived(getParams?.());
  const wsId = $derived(params?.wsId ?? null);
  const providerId = $derived(params?.providerId ?? null);
  const skillId = $derived(params?.skillId ?? null);
  const target = $derived.by<EvaluationTarget | null>(() => {
    if (wsId === null || providerId === null || skillId === null) return null;
    return { workspaceId: wsId, providerId, skillId };
  });
  const isGlobal = $derived(target !== null && isGlobalEvaluationTarget(target));
  const canWrite = $derived(target !== null && !isGlobal);

  let runOpen = $state(false);
  let caseEditorOpen = $state(false);
  let editingCaseId = $state<string | null>(null);
  let expandedCaseId = $state<string | null>(null);

  // 技能名 + 当前 revision（skills.info 现读：新建 case 的 boundRevision 源）。
  let skillName = $state<string | null>(null);
  let currentRevision = $state<string | null>(null);
  let skillUnresolvable = $state(false);

  /** 身份变化（含首挂载）重拉行 + 技能信息；卸载清空（防跨技能串数据）。 */
  $effect(() => {
    const scope = target;
    if (scope === null) return;
    void loadEvaluationView(scope);
    void loadSkillInfo(scope);
  });
  $effect(() => {
    return () => {
      resetEvaluationView();
      resetEvaluationRun();
    };
  });

  async function loadSkillInfo(scope: EvaluationTarget): Promise<void> {
    const rpc = getRpc();
    if (!rpc) return;
    skillName = null;
    currentRevision = null;
    skillUnresolvable = false;
    try {
      const info = await rpc.skills.info({
        workspaceId: scope.workspaceId,
        providerId: scope.providerId,
        skillId: scope.skillId,
      });
      skillName = info.name;
      currentRevision = info.revision;
    } catch {
      skillUnresolvable = true;
    }
  }

  // 挂载竞态补救（WS5 走查 B；eval-view 同族模板）：深链首帧 WS 未就绪时静默
  // no-op——连接转 ready 且尚无数据时自动重发（行 + 技能信息）。
  let lastConnectionStatus = $state(connectionState.status);
  $effect(() => {
    const status = connectionState.status;
    const was = untrack(() => lastConnectionStatus);
    lastConnectionStatus = status;
    if (was === "connected" || status !== "connected") return;
    const retryTarget = untrack(() => target);
    if (retryTarget === null) return;
    if (
      untrack(() => evaluationViewState.rows) === null &&
      untrack(() => evaluationViewState.error) === null
    ) {
      void loadEvaluationView(retryTarget);
    }
    if (untrack(() => skillName) === null && !untrack(() => skillUnresolvable)) {
      void loadSkillInfo(retryTarget);
    }
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

  const rows = $derived(evaluationViewState.rows);
  const loading = $derived(evaluationViewState.loading);
  const error = $derived(evaluationViewState.error);
  const activeRun = $derived(
    evaluationRunState.runId !== null &&
      (evaluationRunState.status === "queued" || evaluationRunState.status === "running"),
  );
  /** 汇总行（task 1.5 详情侧：非零 error 行 → 红 chip；=0 不渲染）。 */
  const summary = $derived.by(() => {
    if (rows === null) return null;
    let passed = 0;
    let failed = 0;
    let unavailable = 0;
    for (const row of rows) {
      if (row.latest === null) continue;
      if (row.latest.outcome === "passed") passed += 1;
      else if (row.latest.outcome === "failed") failed += 1;
      else if (row.latest.outcome === "unavailable") unavailable += 1;
    }
    return {
      passed,
      failed,
      errors: detailErrorCount(rows),
      unavailable,
      notRun: rows.filter((row) => row.latest === null).length,
    };
  });
  const editingCase = $derived.by(() => {
    if (editingCaseId === null || evaluationViewState.cases === null) return null;
    return evaluationViewState.cases.find((entry) => entry.caseId === editingCaseId) ?? null;
  });

  function reload(): void {
    if (target !== null) void loadEvaluationView(target);
  }

  function backToOverview(): void {
    if (wsId === null) return;
    goById("evaluating.home", { wsId });
  }

  async function cancelRun(): Promise<void> {
    const runId = evaluationRunState.runId;
    if (runId === null) return;
    const outcome = await cancelEvaluationRun(runId);
    if (!outcome.ok)
      showToast(t("evaluating.runCancelFailedToast", { error: outcome.message ?? "" }));
    else showToast(t("evaluating.runCancelledToast"));
  }

  function openNewCase(): void {
    editingCaseId = null;
    caseEditorOpen = true;
  }

  function openEditCase(caseId: string): void {
    if (!canWrite) return;
    editingCaseId = caseId;
    caseEditorOpen = true;
  }

  /** prompt 摘要（首行 + 截断；完整正文留在 case 编辑器）。 */
  function promptSummary(row: EvaluationRow): string {
    const firstLine = row.prompt.split("\n")[0] ?? "";
    return firstLine.length > 72 ? `${firstLine.slice(0, 72)}…` : firstLine;
  }

  /** revision 短显：剥 `sha256:` 前缀后截 hex。 */
  function shortRevision(value: string): string {
    const hex = value.startsWith("sha256:") ? value.slice("sha256:".length) : value;
    return hex.slice(0, 14);
  }

  /** bound 双显合并（design-critique R1 Gap 1）：结果已绑同 revision 时 bound 不播报。 */
  function showBoundRevision(row: EvaluationRow): boolean {
    return !row.latest || row.latest.observedEndRevision !== row.boundRevision;
  }

  /** 失败面摘要（R2）：failed = 未通过断言计数；error/unavailable = failure.detail 截断。 */
  function failureSummary(row: EvaluationRow): string | null {
    const latest = row.latest;
    if (!latest) return null;
    if (latest.outcome === "failed") {
      const failedCount = latest.assertions.filter((entry) => entry.outcome !== "passed").length;
      if (failedCount === 0) return null;
      return t(
        failedCount === 1 ? "evaluating.assertionFailedOne" : "evaluating.assertionFailedMany",
        {
          failed: failedCount,
          total: latest.assertions.length,
        },
      );
    }
    if (latest.outcome === "error" || latest.outcome === "unavailable") {
      const detail = latest.failure.detail;
      return detail.length > 120 ? `${detail.slice(0, 120)}…` : detail;
    }
    return null;
  }

  /** 断言种类人读标签。 */
  function assertionKindLabel(assertion: EvaluationAssertion): string {
    switch (assertion.kind) {
      case "contains":
        return t("evaluating.kindContains");
      case "not-contains":
        return t("evaluating.kindNotContains");
      case "finding-kind":
        return t("evaluating.kindFindingKind");
      case "finding-triggered":
        return t("evaluating.kindFindingTriggered");
      case "finding-severity":
        return t("evaluating.kindFindingSeverity");
    }
  }

  function assertionOutcomeLabel(outcome: "passed" | "failed" | "error"): string {
    switch (outcome) {
      case "passed":
        return t("evaluating.assertionOutcomePassed");
      case "failed":
        return t("evaluating.assertionOutcomeFailed");
      case "error":
        return t("evaluating.assertionOutcomeError");
    }
  }

  function toggleExpand(caseId: string): void {
    expandedCaseId = expandedCaseId === caseId ? null : caseId;
  }
</script>

<div class="flex h-full flex-col overflow-hidden">
  <!-- 顶行：返回总览 + 技能名（人语汇）+ opaque id 次要行 + 动作（Run/Cancel/New case）。 -->
  <header class="flex shrink-0 flex-col gap-1 border-b border-border px-4 py-2">
    <div class="flex items-center justify-between gap-2">
      <div class="flex min-w-0 items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          class="h-7 w-7 p-0 text-muted-foreground"
          title={t("evaluating.backTitle")}
          onclick={backToOverview}
        >
          <IconArrowLeft class="h-4 w-4" />
        </Button>
        <span class="min-w-0 truncate text-sm font-medium" data-testid="evaluating-detail-title">
          {skillName ?? skillId ?? ""}
        </span>
        {#if isGlobal}
          <span
            class="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground"
          >
            {t("evaluating.readonlyBadge")}
          </span>
        {/if}
      </div>
      <div class="flex shrink-0 items-center gap-1.5">
        {#if activeRun}
          <Button variant="outline" size="sm" class="h-7 gap-1.5" onclick={() => void cancelRun()}>
            <IconLoader class="h-3.5 w-3.5 animate-spin" />
            {t("evaluating.cancelAction")}
          </Button>
        {:else if canWrite && !skillUnresolvable}
          <Button
            variant="outline"
            size="sm"
            class="h-7 gap-1.5"
            disabled={rows !== null && rows.length === 0}
            title={t("evaluating.runStartTitle", { skill: skillName ?? skillId ?? "" })}
            onclick={() => (runOpen = true)}
          >
            <IconPlay class="h-3.5 w-3.5" />
            {t("evaluating.runEntry")}
          </Button>
        {/if}
        {#if canWrite && !skillUnresolvable}
          <Button variant="outline" size="sm" class="h-7 gap-1.5" onclick={openNewCase}>
            <IconPlus class="h-3.5 w-3.5" />
            {t("evaluating.newCase")}
          </Button>
        {/if}
        <Button
          variant="outline"
          size="sm"
          class="h-7 gap-1.5"
          onclick={reload}
          disabled={loading || target === null}
        >
          {#if loading}<IconLoader class="h-3.5 w-3.5 animate-spin" />{:else}<IconClipboard
              class="h-3.5 w-3.5"
            />{/if}
          {t("evaluating.refresh")}
        </Button>
      </div>
    </div>
    <div
      class="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 pl-9 text-xs text-muted-foreground"
    >
      {#if providerId}
        <span class="truncate">{providerId}</span>
      {/if}
      {#if skillId}
        <span aria-hidden="true" class="text-border">/</span>
        <span class="truncate font-mono">{skillId}</span>
      {/if}
      {#if summary && rows !== null}
        <span aria-hidden="true" class="text-border">·</span>
        <span
          >{t(rows.length === 1 ? "evaluating.caseCountOne" : "evaluating.caseCountMany", {
            count: rows.length,
          })}</span
        >
        {#if summary.passed > 0}
          <span class="rounded px-1 py-0.5 {evaluationOutcomeBadge('passed')}"
            >{summary.passed}</span
          >
        {/if}
        {#if summary.failed > 0}
          <span class="rounded px-1 py-0.5 {evaluationOutcomeBadge('failed')}"
            >{summary.failed}</span
          >
        {/if}
        <!-- task 1.5 详情侧：非零 error 行 → 红 chip；=0 不渲染。 -->
        {#if summary.errors > 0}
          <span
            class="rounded bg-destructive px-1 py-0.5 font-medium text-destructive-foreground"
            data-testid="evaluating-errors-chip"
          >
            {t(summary.errors === 1 ? "evaluating.errorCountOne" : "evaluating.errorCount", {
              count: summary.errors,
            })}
          </span>
        {/if}
        {#if summary.unavailable > 0}
          <span class="rounded px-1 py-0.5 {evaluationOutcomeBadge('unavailable')}"
            >{summary.unavailable}</span
          >
        {/if}
      {/if}
    </div>
  </header>

  {#if target === null}
    <div class="flex flex-1 items-center justify-center p-4 text-xs text-muted-foreground">
      Invalid evaluating target.
    </div>
  {:else if isGlobal}
    <p
      class="shrink-0 border-b border-border bg-muted/20 px-4 py-1.5 text-[11px] text-muted-foreground"
    >
      {t("evaluating.readonlyNote")}
    </p>
  {/if}

  {#if skillUnresolvable}
    <p
      class="shrink-0 border-b border-border bg-amber-500/10 px-4 py-1.5 text-[11px] text-amber-700 dark:text-amber-300"
      data-testid="evaluating-skill-unresolvable"
    >
      {t("evaluating.skillUnavailable")}
    </p>
  {/if}

  {#if loading && rows === null}
    <div
      class="flex flex-1 items-center justify-center gap-2 text-xs text-muted-foreground"
      role="status"
    >
      <IconLoader class="h-4 w-4 animate-spin" />
      {t("evaluating.loadingDetail")}
    </div>
  {:else if error}
    <div class="flex flex-1 flex-col items-center justify-center gap-2 px-8 text-center">
      <p class="text-xs font-medium">{t("evaluating.detailErrorTitle")}</p>
      <p class="text-xs text-destructive">{error}</p>
      <Button variant="outline" size="sm" onclick={reload}>{t("common.retry")}</Button>
    </div>
  {:else if rows !== null && rows.length === 0}
    <div class="flex flex-1 flex-col items-center justify-center gap-1 p-6 text-center">
      <p class="text-xs font-medium text-foreground">{t("evaluating.noCasesTitle")}</p>
      <p class="max-w-sm text-xs text-muted-foreground">
        {isGlobal ? t("evaluating.noCasesBodyGlobal") : t("evaluating.noCasesBodyImported")}
      </p>
    </div>
  {:else if rows !== null}
    <div class="min-h-0 flex-1 overflow-y-auto p-3">
      <ul class="space-y-1">
        {#each rows as row, index (row.caseId)}
          {@const summary = failureSummary(row)}
          {@const expandable = row.latest?.outcome === "failed"}
          {@const expanded = expandedCaseId === row.caseId}
          <li class="rounded-md border border-border px-3 py-1.5" data-testid="evaluating-case-row">
            <div class="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-2">
              <div class="min-w-0">
                <p class="truncate text-xs">{promptSummary(row)}</p>
                <p
                  class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground"
                >
                  <span>{row.enabled ? t("evaluating.enabled") : t("evaluating.disabled")}</span>
                  <span>
                    {t(
                      row.assertionCount === 1
                        ? "evaluating.assertionCountOne"
                        : "evaluating.assertionCountMany",
                      {
                        count: row.assertionCount,
                      },
                    )}
                  </span>
                  {#if canWrite}
                    <button
                      type="button"
                      class="underline-offset-2 hover:underline"
                      title={t("evaluating.editCaseTitle")}
                      onclick={() => openEditCase(row.caseId)}
                    >
                      {t("evaluating.editCaseTitle")}
                    </button>
                  {/if}
                  <!-- 组内去重（R2/R3 钉）：连续行同 revision 时仅组首播报。 -->
                  {#if showBoundRevision(row) && rows[index - 1]?.boundRevision !== row.boundRevision}
                    <span title={row.boundRevision}>
                      {t("evaluating.boundRev", { rev: shortRevision(row.boundRevision) })}
                    </span>
                  {/if}
                </p>
              </div>
              <div class="flex shrink-0 flex-col items-end gap-1">
                {#if row.latest}
                  <span
                    class="rounded px-1.5 py-0.5 text-[11px] font-medium {evaluationOutcomeBadge(
                      row.latest.outcome,
                    )}"
                  >
                    {row.latest.outcome}
                  </span>
                  <span
                    class="flex items-center gap-1.5 text-[11px] text-muted-foreground"
                    title={row.latest.observedEndRevision}
                  >
                    {#if row.latest.stale && row.latest.outcome !== "stale"}
                      <span
                        class="rounded bg-amber-500/10 px-1 py-0.5 text-amber-700 dark:text-amber-300"
                      >
                        {t("evaluating.staleTag")}
                      </span>
                    {/if}
                    {#if rows[index - 1]?.latest?.observedEndRevision !== row.latest.observedEndRevision}
                      {t("evaluating.observedRev", {
                        rev: shortRevision(row.latest.observedEndRevision),
                      })}
                    {/if}
                  </span>
                {:else}
                  <span
                    class="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground"
                  >
                    {t("evaluating.notRun")}
                  </span>
                {/if}
                {#if expandable}
                  <button
                    type="button"
                    class="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
                    title={t("evaluating.expandAssertionsTitle")}
                    aria-expanded={expanded}
                    onclick={() => toggleExpand(row.caseId)}
                  >
                    {expanded ? "▾" : "▸"}
                    {t("evaluating.assertionExpected")}/{t("evaluating.assertionObserved")}
                  </button>
                {/if}
              </div>
            </div>
            {#if summary !== null}
              <p class="mt-1 text-xs text-muted-foreground" data-testid="eval-failure-summary">
                {summary}
              </p>
            {/if}
            <!-- 失败断言展开（design §3）：期望（断言定义）vs 观测（per-assertion
                 outcome）+ observedEndRevision 对比（bound/rev 双列即对比面）。 -->
            {#if expanded && row.latest?.outcome === "failed"}
              <div
                class="mt-1.5 space-y-1 rounded bg-muted/30 p-2"
                data-testid="eval-assertion-detail"
              >
                {#each row.latest.assertions as outcome (outcome.ref)}
                  {@const assertion = row.assertions[outcome.ref]}
                  {#if assertion}
                    <div class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 text-[11px]">
                      <span class="min-w-0 truncate text-muted-foreground">
                        <span class="font-medium text-foreground"
                          >{assertionKindLabel(assertion)}</span
                        >
                        · {t("evaluating.assertionExpected")}: {assertion.kind ===
                        "finding-triggered"
                          ? String(assertion.value)
                          : assertion.value}
                        {#if assertion.description}<span class="text-muted-foreground"
                            >（{assertion.description}）</span
                          >{/if}
                      </span>
                      <span
                        class="rounded px-1.5 py-0.5 font-medium {outcome.outcome === 'passed'
                          ? evaluationOutcomeBadge('passed')
                          : evaluationOutcomeBadge(outcome.outcome)}"
                      >
                        {t("evaluating.assertionObserved")}: {assertionOutcomeLabel(
                          outcome.outcome,
                        )}
                      </span>
                    </div>
                  {/if}
                {/each}
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    </div>
  {/if}
</div>

{#if target !== null}
  <RunConfirmDialog
    bind:open={runOpen}
    wsId={target.workspaceId}
    targets={[]}
    fixedTarget={target}
  />
{/if}
{#if target !== null && canWrite && !skillUnresolvable && currentRevision !== null}
  <CaseEditorDialog
    bind:open={caseEditorOpen}
    {target}
    editing={editingCase}
    {currentRevision}
    onSaved={reload}
  />
{/if}
