<!--
  用户原始需求 [2026-10-04]（evaluating-world-class design §4.2）：详情屏按
  「run 报告」语言重做——run 选择器（时间线胶囊，最新在前，运行中 live 进度）+
  左侧 case 步骤树 + 右侧断言详情（期望 vs 观测 diff 双栏记忆点 + finding 触发
  语义标记 + revision stale 判读）+ 键盘 ↑↓/Enter/Esc + ?case= 深链。
  case 新建/编辑收进「管理」折叠区（诊断流优先）；Imported-only 门控沿旧。
  迁移保留（evaluating-dashboard 回归钉）：三段路由身份消费、挂载竞态补救、
  Run… 固定三元组显式确认、Cancel 幂等、Global 只读、技能不可解析降级面。
  正交意图：
  1. run 报告投影：results 全量 → run 时间线（选中 run 的 per-case 结果）→
     case 树（三态 icon + 分式徽标）→ 断言详情（冻结 expected/observed）。
  2. 选择状态机：URL ?case= 深链 ↔ selectedCaseId（replace）；默认选首个失败
     case（design §4.2「失败默认展开且选中；成功折叠」）；键盘沿纯函数
     caseTreeKeyboard。
  3. 三尺寸（design §3）：≥1024 树+详情双栏 / 720-1024 树抽屉 / <720 单列
     push（?case= 携带）。
  视图状态：行/结果 → evaluation-view store；技能名/revision → skills.info
  现读；选择/弹层/抽屉 → 组件本地 $state。
-->
<script lang="ts">
  import { untrack } from "svelte";
  import { useParams, useSearch, goById } from "$lib/shell";
  import { t } from "$lib/i18n";
  import { Button } from "$lib/components/ui/button";
  import { showToast } from "$lib/toast.svelte";
  import { connectionState } from "$lib/store.svelte";
  import { getRpc } from "$lib/stores/connection.svelte";
  import {
    assertionDetailRows,
    buildCaseTreeNodes,
    buildRunTimeline,
    cancelEvaluationRun,
    caseTreeKeyboard,
    evaluationOutcomeBadge,
    evaluationRunState,
    evaluationViewState,
    isGlobalEvaluationTarget,
    loadEvaluationView,
    relativeTimeParts,
    resetEvaluationRun,
    resetEvaluationView,
    runResultsByCase,
    type EvaluationCaseTreeNode,
  } from "$lib/stores/evaluation-view.svelte";
  import type {
    EvaluationAssertionKind,
    EvaluationResultView,
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
  import IconClipboard from "@lucide/svelte/icons/clipboard-check";
  import IconCheck from "@lucide/svelte/icons/check";
  import IconX from "@lucide/svelte/icons/x";
  import IconAlert from "@lucide/svelte/icons/triangle-alert";
  import IconClock from "@lucide/svelte/icons/clock";
  import IconBan from "@lucide/svelte/icons/ban";
  import IconChevronRight from "@lucide/svelte/icons/chevron-right";
  import IconListTree from "@lucide/svelte/icons/list-tree";

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

  const getSearch = useSearch<{ case?: string }>();
  const searchCase = $derived(getSearch?.()?.case);

  let runOpen = $state(false);
  let caseEditorOpen = $state(false);
  let editingCaseId = $state<string | null>(null);
  /** 「管理」折叠区（design §4.2：诊断流优先，case 编辑次之）。 */
  let manageOpen = $state(false);
  /** 720-1024 抽屉态的树开关。 */
  let treeDrawerOpen = $state(false);
  /** 选中 run（null = 最新 run；用户选择后固定）。 */
  let selectedRunId = $state<string | null>(null);
  /** 选中 case（右侧断言详情归属；null = 无展开——成功折叠语义）。 */
  let selectedCaseId = $state<string | null>(null);

  // 技能名 + 当前 revision（skills.info 现读：stale 判读与新建 case 绑定源）。
  let skillName = $state<string | null>(null);
  let currentRevision = $state<string | null>(null);
  let skillUnresolvable = $state(false);

  /** 身份变化（含首挂载）重拉行 + 技能信息 + 重置选择；卸载清空（防串数据）。 */
  $effect(() => {
    const scope = target;
    if (scope === null) return;
    selectedRunId = null;
    selectedCaseId = null;
    treeDrawerOpen = false;
    manageOpen = false;
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

  // 挂载竞态补救（WS5 走查 B）：深链首帧 WS 未就绪时静默 no-op——连接转 ready
  // 且尚无数据时自动重发（行 + 技能信息）。
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

  // ---- 三尺寸（design §3）：≥1024 双栏 / 720-1024 抽屉 / <720 单列 push ----
  const wideQuery = typeof matchMedia !== "undefined" ? matchMedia("(min-width: 1024px)") : null;
  const midQuery = typeof matchMedia !== "undefined" ? matchMedia("(min-width: 720px)") : null;
  let wideMatch = $state(wideQuery?.matches ?? false);
  let midMatch = $state(midQuery?.matches ?? false);
  $effect(() => {
    const onWide = () => (wideMatch = wideQuery?.matches ?? false);
    const onMid = () => (midMatch = midQuery?.matches ?? false);
    wideQuery?.addEventListener("change", onWide);
    midQuery?.addEventListener("change", onMid);
    return () => {
      wideQuery?.removeEventListener("change", onWide);
      midQuery?.removeEventListener("change", onMid);
    };
  });
  const layoutMode = $derived(wideMatch ? "wide" : midMatch ? "drawer" : "stack");

  // ---- run 报告投影（store 纯函数；results 全量 = 时间线源） ----
  const cases = $derived(evaluationViewState.cases);
  const results = $derived(evaluationViewState.results);
  const loading = $derived(evaluationViewState.loading);
  const error = $derived(evaluationViewState.error);
  const activeRun = $derived(
    evaluationRunState.runId !== null &&
      (evaluationRunState.status === "queued" || evaluationRunState.status === "running"),
  );
  const trackedRun = $derived(
    evaluationRunState.runId !== null && evaluationRunState.status !== null
      ? {
          runId: evaluationRunState.runId,
          status: evaluationRunState.status,
          startedAt: evaluationRunState.startedAt,
        }
      : null,
  );
  const timeline = $derived(results === null ? [] : buildRunTimeline(results, trackedRun));
  /** 选中 run（用户选择优先；默认最新）。 */
  const effectiveRunId = $derived.by<string | null>(() => {
    if (timeline.length === 0) return null;
    if (selectedRunId !== null && timeline.some((row) => row.runId === selectedRunId)) {
      return selectedRunId;
    }
    return timeline[0].runId;
  });
  const runByCase = $derived(
    results === null || effectiveRunId === null
      ? new Map<string, EvaluationResultView>()
      : runResultsByCase(results, effectiveRunId),
  );
  const nodes = $derived(cases === null ? [] : buildCaseTreeNodes(cases, runByCase));
  const selectedNode = $derived(
    selectedCaseId === null ? null : (nodes.find((node) => node.caseId === selectedCaseId) ?? null),
  );
  const selectedCaseEntry = $derived(
    selectedCaseId === null || cases === null
      ? null
      : (cases.find((entry) => entry.caseId === selectedCaseId) ?? null),
  );
  const detailRows = $derived(
    assertionDetailRows(selectedNode?.runResult ?? null, selectedCaseEntry?.input.assertions ?? []),
  );
  /** 选中 run 是否是 tracked 活跃 run（live 进度行 + 树顶进度）。 */
  const trackingSelectedRun = $derived(
    trackedRun !== null &&
      activeRun &&
      effectiveRunId === trackedRun.runId &&
      evaluationRunState.resultCount !== null,
  );
  const liveProgressText = $derived.by(() => {
    if (!trackingSelectedRun) return null;
    const done = evaluationRunState.resultCount ?? 0;
    return evaluationRunState.totalCases === null
      ? t("evaluating.liveProgressCount", { done })
      : t("evaluating.liveProgress", { done, total: evaluationRunState.totalCases });
  });

  /**
   * 选择状态机（design §4.2）：?case= 深链优先；用户已选且仍存在则保持；
   * 否则默认选首个失败 case（失败默认展开且选中；成功折叠——无失败不预选）。
   */
  $effect(() => {
    const list = nodes;
    if (list.length === 0) {
      selectedCaseId = null;
      return;
    }
    const fromUrl = searchCase;
    if (fromUrl !== undefined && list.some((node) => node.caseId === fromUrl)) {
      selectedCaseId = fromUrl;
      return;
    }
    if (selectedCaseId !== null && list.some((node) => node.caseId === selectedCaseId)) return;
    const firstFailed = list.find((node) => node.runResult?.outcome === "failed");
    selectedCaseId = firstFailed?.caseId ?? null;
  });

  /** 选中 case 并同步 URL（replace；<720 push 语义由同一 search 承载）。 */
  function selectCase(caseId: string | null, push = false): void {
    selectedCaseId = caseId;
    if (target === null) return;
    goById(
      "evaluating.detail",
      {
        wsId: target.workspaceId,
        providerId: target.providerId,
        skillId: target.skillId,
      },
      caseId === null ? {} : { case: caseId },
      push ? "PUSH" : "REPLACE",
    );
    // 抽屉态选择后收起抽屉（诊断落回详情面）。
    if (caseId !== null && layoutMode === "drawer") treeDrawerOpen = false;
  }

  function selectRun(runId: string): void {
    selectedRunId = runId;
    // run 切换后选中 case 若不在新 run，重置为该 run 的首个失败（否则保持）。
    if (
      selectedCaseId !== null &&
      !nodes.some((node) => node.caseId === selectedCaseId && node.runResult !== null)
    ) {
      selectedCaseId = nodes.find((node) => node.runResult?.outcome === "failed")?.caseId ?? null;
    }
  }

  /** 键盘导航（纯函数 caseTreeKeyboard；树容器 tabindex=0）。 */
  function onTreeKeydown(event: KeyboardEvent): void {
    const key = event.key;
    if (
      key !== "ArrowUp" &&
      key !== "ArrowDown" &&
      key !== "Enter" &&
      key !== "ArrowRight" &&
      key !== "Escape"
    ) {
      return;
    }
    event.preventDefault();
    const next = caseTreeKeyboard(
      { selectedCaseId },
      key,
      nodes.map((node) => node.caseId),
    );
    if (next.selectedCaseId !== selectedCaseId) selectCase(next.selectedCaseId);
  }

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

  const editingCase = $derived.by(() => {
    if (editingCaseId === null || evaluationViewState.cases === null) return null;
    return evaluationViewState.cases.find((entry) => entry.caseId === editingCaseId) ?? null;
  });

  /** revision 短显：剥 `sha256:` 前缀后截 hex。 */
  function shortRevision(value: string): string {
    const hex = value.startsWith("sha256:") ? value.slice("sha256:".length) : value;
    return hex.slice(0, 14);
  }

  /** 相对时间 → i18n 文案（无效时间回退空串）。 */
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

  /** 树行/断言行三态 icon 语义（绿✓/红✕/灰●运行中 + 五态族扩展）。 */
  function nodeTone(node: EvaluationCaseTreeNode): {
    tone: "passed" | "failed" | "error" | "unavailable" | "stale" | "pending";
    label: string;
  } {
    const result = node.runResult;
    if (result === null) return { tone: "pending", label: t("evaluating.notInRun") };
    switch (result.outcome) {
      case "passed":
        return { tone: "passed", label: t("evaluating.assertionOutcomePassed") };
      case "failed":
        return { tone: "failed", label: t("evaluating.assertionOutcomeFailed") };
      case "error":
        return { tone: "error", label: t("evaluating.outcomeError") };
      case "unavailable":
        return { tone: "unavailable", label: t("evaluating.outcomeUnavailable") };
      case "stale":
        return { tone: "stale", label: t("evaluating.staleTag") };
    }
  }

  /** 断言种类人读标签。 */
  function assertionKindLabel(kind: EvaluationAssertionKind): string {
    switch (kind) {
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
</script>

<div class="flex h-full flex-col overflow-hidden">
  <!-- 顶行：返回总览 + 技能名（人语汇）+ opaque id 次要行 + 动作（Run/Cancel/刷新/抽屉）。 -->
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
        {#if layoutMode === "drawer"}
          <Button
            variant="outline"
            size="sm"
            class="h-7 gap-1.5"
            aria-expanded={treeDrawerOpen}
            onclick={() => (treeDrawerOpen = !treeDrawerOpen)}
          >
            <IconListTree class="h-3.5 w-3.5" />
            {t("evaluating.casesButton")}
          </Button>
        {/if}
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
            disabled={cases !== null && cases.length === 0}
            title={t("evaluating.runStartTitle", { skill: skillName ?? skillId ?? "" })}
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
      {#if cases !== null}
        <span aria-hidden="true" class="text-border">·</span>
        <span
          >{t(cases.length === 1 ? "evaluating.caseCountOne" : "evaluating.caseCountMany", {
            count: cases.length,
          })}</span
        >
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

  {#if loading && cases === null}
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
  {:else if cases !== null && cases.length === 0}
    <div class="flex flex-1 flex-col items-center justify-center gap-1 p-6 text-center">
      <p class="text-xs font-medium text-foreground">{t("evaluating.noCasesTitle")}</p>
      <p class="max-w-sm text-xs text-muted-foreground">
        {isGlobal ? t("evaluating.noCasesBodyGlobal") : t("evaluating.noCasesBodyImported")}
      </p>
      {#if canWrite && !skillUnresolvable}
        <Button variant="outline" size="sm" class="mt-2" onclick={openNewCase}>
          {t("evaluating.newCase")}
        </Button>
      {/if}
    </div>
  {:else if nodes.length > 0}
    <!-- run 选择器（时间线胶囊：最新在前，选中态；运行中 live 进度）。 -->
    <div
      class="flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-border px-4 py-1.5"
      data-testid="evaluating-run-selector"
    >
      {#if timeline.length === 0}
        <span class="text-[11px] text-muted-foreground">{t("evaluating.noRunsSkill")}</span>
      {:else}
        {#each timeline as run (run.runId)}
          {@const selected = run.runId === effectiveRunId}
          {@const live = trackedRun?.runId === run.runId && activeRun ? liveProgressText : null}
          <button
            type="button"
            class="flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors {selected
              ? 'border-primary/50 bg-primary/10 font-medium text-primary'
              : 'border-border text-muted-foreground hover:bg-muted/40'}"
            aria-pressed={selected}
            data-testid="evaluating-run-capsule"
            data-run-id={run.runId}
            onclick={() => selectRun(run.runId)}
          >
            {#if run.status === "running"}
              <IconLoader class="size-3 animate-spin" aria-hidden="true" />
            {:else if run.status === "completed"}
              <IconCheck
                class="size-3 {run.counts.failed > 0 || run.counts.error > 0
                  ? 'text-destructive'
                  : 'text-emerald-600 dark:text-emerald-400'}"
                aria-hidden="true"
              />
            {:else}
              <IconClock class="size-3" aria-hidden="true" />
            {/if}
            <span>{relativeTime(run.startedAt)}</span>
            {#if run.counts.failed > 0}
              <span
                class="font-medium text-destructive"
                aria-label={t("evaluating.failedCount", { count: run.counts.failed })}
              >
                <IconX class="inline size-3" aria-hidden="true" />{run.counts.failed}
              </span>
            {:else if run.counts.passed > 0}
              <span
                class="text-emerald-700 dark:text-emerald-300"
                aria-label={t("evaluating.passedCount", { count: run.counts.passed })}
              >
                <IconCheck class="inline size-3" aria-hidden="true" />{run.counts.passed}
              </span>
            {/if}
            {#if run.counts.error > 0}
              <span
                class="rounded bg-destructive px-1 py-0.5 font-medium text-destructive-foreground"
                data-testid="evaluating-errors-chip"
                aria-label={t(
                  run.counts.error === 1 ? "evaluating.errorCountOne" : "evaluating.errorCount",
                  { count: run.counts.error },
                )}
              >
                {run.counts.error}
              </span>
            {/if}
            {#if live !== null}
              <span class="font-medium" data-testid="evaluating-run-live-progress">{live}</span>
            {/if}
            <span class="sr-only">{runStatusLabel(run.status)}</span>
          </button>
        {/each}
      {/if}
    </div>

    <!-- 主体：≥1024 树+详情双栏 / 720-1024 详情+树抽屉 / <720 单列 push。 -->
    <div class="relative min-h-0 flex-1 {layoutMode === 'wide' ? 'flex' : ''}">
      <!-- case 步骤树（抽屉态 = 左滑覆盖层；单列态 = 无选中时的整面）。 -->
      {#if layoutMode !== "drawer" || treeDrawerOpen}
        <aside
          class="{layoutMode === 'wide'
            ? 'h-full w-full border-r border-border'
            : layoutMode === 'drawer'
              ? 'absolute inset-y-0 left-0 z-10 w-72 border-r border-border bg-background shadow-lg'
              : 'h-full w-full'} {layoutMode === 'stack' && selectedCaseId !== null
            ? 'hidden'
            : ''}"
          data-testid="evaluating-case-tree-pane"
        >
          <div class="flex h-full min-h-0 flex-col">
            <!-- 树顶 live 进度行（运行中 run 逐个点亮的驱动源）。 -->
            {#if liveProgressText !== null}
              <p
                class="flex shrink-0 items-center gap-1.5 border-b border-border bg-primary/5 px-3 py-1.5 text-[11px] font-medium text-primary"
                data-testid="evaluating-live-line"
              >
                <IconLoader class="size-3 animate-spin" aria-hidden="true" />
                {liveProgressText}
              </p>
            {/if}
            <div
              class="min-h-0 flex-1 overflow-y-auto p-2"
              role="tree"
              aria-label={t("evaluating.caseTreeAria")}
              tabindex="0"
              data-testid="evaluating-case-tree"
              onkeydown={onTreeKeydown}
            >
              <ul class="space-y-0.5">
                {#each nodes as node (node.caseId)}
                  {@const tone = nodeTone(node)}
                  {@const selected = node.caseId === selectedCaseId}
                  <li role="treeitem" aria-selected={selected} data-case-id={node.caseId}>
                    <button
                      type="button"
                      class="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-xs transition-colors {selected
                        ? 'bg-muted font-medium'
                        : 'hover:bg-muted/40'}"
                      data-testid="evaluating-case-node"
                      data-case-id={node.caseId}
                      data-tone={tone.tone}
                      onclick={() => selectCase(selected ? null : node.caseId, true)}
                      title={node.label}
                    >
                      <span
                        class="flex size-4 shrink-0 items-center justify-center"
                        aria-hidden="true"
                      >
                        {#if tone.tone === "pending" && activeRun && trackingSelectedRun}
                          <IconLoader class="size-3 animate-spin text-muted-foreground" />
                        {:else if tone.tone === "passed"}
                          <IconCheck class="size-3.5 text-emerald-600 dark:text-emerald-400" />
                        {:else if tone.tone === "failed"}
                          <IconX class="size-3.5 text-destructive" />
                        {:else if tone.tone === "error"}
                          <IconAlert class="size-3.5 text-orange-600 dark:text-orange-400" />
                        {:else if tone.tone === "stale"}
                          <IconClock class="size-3.5 text-amber-600 dark:text-amber-400" />
                        {:else if tone.tone === "pending"}
                          <span class="size-2 rounded-full bg-muted-foreground/40"></span>
                        {:else}
                          <IconBan class="size-3.5 text-muted-foreground" />
                        {/if}
                      </span>
                      <span class="min-w-0 flex-1 truncate">{node.label}</span>
                      {#if !node.enabled}
                        <span class="shrink-0 text-[10px] text-muted-foreground">
                          {t("evaluating.disabledShort")}
                        </span>
                      {/if}
                      {#if node.score !== null}
                        <span
                          class="shrink-0 rounded px-1 py-0.5 text-[10px] font-medium tabular-nums {node
                            .score.passed === node.score.total
                            ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                            : 'bg-destructive/10 text-destructive'}"
                          data-testid="evaluating-case-score"
                        >
                          {node.score.passed}/{node.score.total}
                        </span>
                      {/if}
                      <IconChevronRight
                        class="size-3 shrink-0 text-muted-foreground/60"
                        aria-hidden="true"
                      />
                    </button>
                  </li>
                {/each}
              </ul>
            </div>

            <!-- 「管理」折叠区（design §4.2：诊断流优先，case 新建/编辑次之；
                 Imported-only + 技能可解析——无 revision 不能绑定新 case）。 -->
            {#if canWrite && !skillUnresolvable && cases !== null}
              <div class="shrink-0 border-t border-border" data-testid="evaluating-manage">
                <button
                  type="button"
                  class="flex w-full items-center justify-between px-3 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground"
                  aria-expanded={manageOpen}
                  onclick={() => (manageOpen = !manageOpen)}
                >
                  {t("evaluating.manageHeading", { count: cases.length })}
                  <IconChevronRight
                    class="size-3 transition-transform {manageOpen ? 'rotate-90' : ''}"
                    aria-hidden="true"
                  />
                </button>
                {#if manageOpen}
                  <div class="max-h-44 space-y-0.5 overflow-y-auto px-2 pb-2">
                    <Button
                      variant="outline"
                      size="sm"
                      class="mb-1 h-7 w-full"
                      onclick={openNewCase}
                    >
                      {t("evaluating.newCase")}
                    </Button>
                    {#each cases as entry (entry.caseId)}
                      <button
                        type="button"
                        class="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-[11px] hover:bg-muted/40"
                        onclick={() => openEditCase(entry.caseId)}
                        title={entry.input.prompt.split("\n")[0] ?? ""}
                      >
                        <span class="min-w-0 flex-1 truncate text-muted-foreground">
                          {entry.input.prompt.split("\n")[0] ?? ""}
                        </span>
                        <span class="shrink-0 underline-offset-2 hover:underline">
                          {t("evaluating.editCaseTitle")}
                        </span>
                      </button>
                    {/each}
                  </div>
                {/if}
              </div>
            {/if}
          </div>
        </aside>
      {/if}

      <!-- 断言详情（选中 case；双栏态右栏 / 单列态 push 视图）。 -->
      {#if layoutMode !== "stack" || selectedCaseId !== null}
        <section
          class={layoutMode === "wide"
            ? "h-full min-w-0 flex-1 overflow-y-auto"
            : layoutMode === "drawer"
              ? "h-full min-w-0 flex-1 overflow-y-auto"
              : "h-full w-full overflow-y-auto"}
          data-testid="evaluating-assertion-pane"
        >
          {#if layoutMode === "stack" && selectedCaseId !== null}
            <div
              class="sticky top-0 z-[1] flex items-center gap-2 border-b border-border bg-background/95 px-3 py-1.5 backdrop-blur"
            >
              <Button
                variant="ghost"
                size="sm"
                class="h-6 w-6 p-0 text-muted-foreground"
                title={t("evaluating.backToTreeTitle")}
                onclick={() => selectCase(null)}
              >
                <IconArrowLeft class="h-3.5 w-3.5" />
              </Button>
              <span class="min-w-0 truncate text-xs font-medium">
                {selectedNode?.label ?? ""}
              </span>
            </div>
          {/if}

          {#if selectedNode === null}
            <div class="flex h-full flex-col items-center justify-center gap-1 p-6 text-center">
              {#if layoutMode === "wide"}
                <p class="text-xs text-muted-foreground">{t("evaluating.selectCaseHint")}</p>
              {/if}
            </div>
          {:else if selectedNode.runResult === null}
            <!-- 未进该 run（新增 case 或未启用）：灰态说明。 -->
            <div class="flex h-full flex-col items-center justify-center gap-1 p-6 text-center">
              <p class="max-w-sm text-xs font-medium">{selectedNode.label}</p>
              <p class="max-w-sm text-xs text-muted-foreground">
                {t("evaluating.notInRunDetail")}
              </p>
            </div>
          {:else}
            {@const result = selectedNode.runResult}
            <div class="mx-auto max-w-3xl space-y-3 p-4" data-testid="evaluating-assertion-detail">
              <!-- case 头：状态徽标 + 分式 + stale 判读（observedEndRevision vs 当前）。 -->
              <div class="flex flex-wrap items-center gap-2">
                <span
                  class="rounded px-1.5 py-0.5 text-[11px] font-medium {evaluationOutcomeBadge(
                    result.outcome,
                  )}"
                  data-testid="evaluating-outcome-badge"
                >
                  {result.outcome}
                </span>
                {#if selectedNode.score !== null}
                  <span class="text-[11px] text-muted-foreground tabular-nums">
                    {t(
                      result.assertions.length === 1
                        ? "evaluating.assertionCountOne"
                        : "evaluating.assertionCountMany",
                      { count: result.assertions.length },
                    )}
                    · {selectedNode.score.passed}/{selectedNode.score.total}
                  </span>
                {/if}
                <span class="text-[11px] text-muted-foreground" title={result.observedEndRevision}>
                  {t("evaluating.observedRev", { rev: shortRevision(result.observedEndRevision) })}
                </span>
                {#if result.stale && result.outcome !== "stale"}
                  <span
                    class="rounded bg-amber-500/10 px-1 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300"
                    data-testid="evaluating-stale-tag"
                  >
                    {t("evaluating.staleTag")}
                  </span>
                {/if}
                {#if result.runner.kind === "provider-model"}
                  <span class="text-[11px] text-muted-foreground">
                    {t("evaluating.runRunnerProviderModel")}
                  </span>
                {/if}
              </div>

              <!-- stale：revision 漂移说明（无断言裁决）。 -->
              {#if result.outcome === "stale"}
                <p
                  class="rounded border border-amber-500/40 bg-amber-500/5 p-2 text-xs text-amber-700 dark:text-amber-300"
                >
                  {t("evaluating.staleDetail")}
                </p>
              {:else if result.outcome === "error" || result.outcome === "unavailable"}
                <!-- error/unavailable：failure 代码 + detail。 -->
                <div
                  class="rounded border border-border p-2 text-xs"
                  data-testid="evaluating-failure-detail"
                >
                  <p class="font-mono text-[11px] font-medium">{result.failure.code}</p>
                  <p class="mt-1 break-all text-muted-foreground">{result.failure.detail}</p>
                </div>
              {:else}
                <!-- 断言逐条行 + 期望 vs 观测 diff 双栏（记忆点）。 -->
                <div class="space-y-2">
                  {#each detailRows as row (row.ref)}
                    {@const failed = row.outcome !== "passed"}
                    <div
                      class="rounded-md border {failed ? 'border-destructive/40' : 'border-border'}"
                      data-testid="evaluating-assertion-row"
                      data-ref={row.ref}
                      data-outcome={row.outcome}
                    >
                      <div
                        class="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 px-2.5 py-1.5"
                      >
                        <span class="flex min-w-0 items-center gap-1.5 text-[11px]">
                          {#if row.outcome === "passed"}
                            <IconCheck
                              class="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400"
                              aria-hidden="true"
                            />
                          {:else}
                            <IconX class="size-3.5 shrink-0 text-destructive" aria-hidden="true" />
                          {/if}
                          <span class="shrink-0 font-medium text-foreground">
                            {assertionKindLabel(row.kind)}
                          </span>
                          {#if row.description}
                            <span class="min-w-0 truncate text-muted-foreground">
                              {row.description}
                            </span>
                          {/if}
                        </span>
                        <span
                          class="shrink-0 text-[11px] font-medium {failed
                            ? 'text-destructive'
                            : 'text-emerald-700 dark:text-emerald-300'}"
                        >
                          {row.outcome === "passed"
                            ? t("evaluating.assertionOutcomePassed")
                            : t("evaluating.assertionOutcomeFailed")}
                        </span>
                      </div>
                      {#if row.kind === "finding-triggered"}
                        <!-- 触发语义标记（design §4.2：期望触发/不触发 × 实际已/未触发）。 -->
                        <div
                          class="flex flex-wrap items-center gap-1.5 px-2.5 pb-2"
                          data-testid="evaluating-trigger-mark"
                        >
                          <span
                            class="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
                          >
                            {row.expected === "true"
                              ? t("evaluating.expectTriggered")
                              : t("evaluating.expectNotTriggered")}
                          </span>
                          <IconChevronRight
                            class="size-3 text-muted-foreground"
                            aria-hidden="true"
                          />
                          {#if row.observed === "true"}
                            <span
                              class="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300"
                            >
                              {t("evaluating.observedTriggered")}
                            </span>
                          {:else}
                            <span
                              class="rounded bg-destructive/10 px-1.5 py-0.5 text-[11px] font-medium text-destructive"
                            >
                              {t("evaluating.observedNotTriggered")}
                            </span>
                          {/if}
                        </div>
                      {:else}
                        <!-- 期望 vs 观测 diff 双栏（等宽字体并排对照；不做行级算法 diff）。 -->
                        <div
                          class="grid grid-cols-2 border-t {failed
                            ? 'border-destructive/30'
                            : 'border-border'}"
                          data-testid="evaluating-assertion-diff"
                        >
                          <div class="min-w-0 border-r border-border p-2">
                            <p
                              class="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
                            >
                              {t("evaluating.assertionExpected")}
                            </p>
                            <p class="break-all font-mono text-[11px] text-foreground">
                              {row.expected === "" ? t("evaluating.observedEmpty") : row.expected}
                            </p>
                          </div>
                          <div class="min-w-0 p-2">
                            <p
                              class="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
                            >
                              {t("evaluating.assertionObserved")}
                            </p>
                            <p
                              class="break-all font-mono text-[11px] {failed
                                ? 'text-destructive'
                                : 'text-foreground'}"
                            >
                              {row.observed === "" ? t("evaluating.observedEmpty") : row.observed}
                            </p>
                          </div>
                        </div>
                      {/if}
                    </div>
                  {/each}
                </div>
              {/if}

              <!-- prompt 全文（折叠 details；诊断上下文）。 -->
              {#if selectedCaseEntry !== null}
                <details class="rounded border border-border">
                  <summary class="cursor-pointer px-2.5 py-1.5 text-[11px] text-muted-foreground">
                    {t("evaluating.promptDetail")}
                  </summary>
                  <p
                    class="whitespace-pre-wrap break-words px-2.5 pb-2 font-mono text-[11px] text-muted-foreground"
                  >
                    {selectedCaseEntry.input.prompt}
                  </p>
                </details>
              {/if}
            </div>
          {/if}
        </section>
      {/if}

      <!-- 抽屉态遮罩（点选外部收起）。 -->
      {#if layoutMode === "drawer" && treeDrawerOpen}
        <button
          type="button"
          class="absolute inset-0 z-[5] bg-background/40"
          aria-label={t("evaluating.closeTreeDrawerTitle")}
          onclick={() => (treeDrawerOpen = false)}
        ></button>
      {/if}
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
