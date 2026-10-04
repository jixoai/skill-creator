<!--
  用户原始需求 [2026-10-03]（evaluating-dashboard design §3）：
  「动作：Run（target 确认弹层，三段标注 workspace/provider/skill）」——run 发起
  的唯一显式确认面（绝不自动运行）。
  修订 [2026-10-04]（evaluating-world-class 批评环 R1）：三段标注 label 化
  （workspace label + 技能人名主显，opaque ID 降次级 mono）+ started toast 同源
  label 化（P2-3）；Provider model 选中后展示将运行的 model/route 只读行
  （agent.settings.get 默认路由；P2-11）。
  正交意图：
  1. 双形态：总览模式（targets 可选列表）与详情模式（fixedTarget 固定三元组）；
     三段标注（label 主显）+ runner 二选一 + case 显式勾选。
  2. 提交门：未选 target / 未勾 case / Global target（runGlobalBlocked）一律不可
     启动；成功后 toast + 关闭 + onStarted 回调（刷新由消费方/轮询负责）。
  3. model/route 只读投影：runner=provider-model 时现读 agent 默认模型路由，
     只读非选择器；失败静默降级（非关键信息不阻塞 run）。
  视图状态：cases 拉取（getRpc 空连接 → typed 提示，不 throw——$effect 内安全）；
  草稿（runner/勾选/modelLine）→ 组件本地 $state（弹层关闭即弃）。
-->
<script lang="ts">
  import * as Dialog from "$lib/components/ui/dialog";
  import { Button } from "$lib/components/ui/button";
  import { Checkbox } from "$lib/components/ui/checkbox";
  import { t } from "$lib/i18n";
  import { showErrorToast, showToast } from "$lib/toast.svelte";
  import { getRpc } from "$lib/stores/connection.svelte";
  import { workspaceState } from "$lib/stores/workspaces.svelte";
  import {
    evaluationTargetKey,
    isGlobalEvaluationTarget,
    startEvaluationRun,
  } from "$lib/stores/evaluation-view.svelte";
  import type { EvaluationCase, EvaluationTarget } from "$shared/contracts/evaluation.js";
  import type { WorkspaceId } from "$shared/contracts/workspaces.js";
  import IconBot from "@lucide/svelte/icons/bot";
  import IconLoader from "@lucide/svelte/icons/loader-circle";
  import IconPlay from "@lucide/svelte/icons/play";

  /** 总览模式的可选 target 行（skillName 供人识别；target 是唯一真相）。 */
  export interface RunTargetOption {
    target: EvaluationTarget;
    skillName: string;
  }

  let {
    open = $bindable(false),
    wsId,
    targets,
    fixedTarget = null,
    fixedSkillName = null,
    onStarted = () => {},
  }: {
    open?: boolean;
    wsId: WorkspaceId;
    /** 总览模式：可运行的 target 清单（消费方过滤 Imported；Global 由本层再闸）。 */
    targets: RunTargetOption[];
    /** 详情模式：固定三元组（target 选择器缺席）。 */
    fixedTarget?: EvaluationTarget | null;
    /** 详情模式：技能人名（P2-3 toast label 化；缺省回退 skillId）。 */
    fixedSkillName?: string | null;
    onStarted?: (runId: string) => void;
  } = $props();

  let selectedKey = $state<string | null>(null);
  let runner = $state<"analyzer" | "provider-model">("analyzer");
  let cases = $state<EvaluationCase[] | null>(null);
  let casesLoading = $state(false);
  let casesError = $state<string | null>(null);
  let selectedCaseIds = $state<string[]>([]);
  let starting = $state(false);

  const effectiveTarget = $derived.by<EvaluationTarget | null>(() => {
    if (fixedTarget) return fixedTarget;
    if (selectedKey === null) return null;
    return (
      targets.find((option) => evaluationTargetKey(option.target) === selectedKey)?.target ?? null
    );
  });
  const isGlobal = $derived(effectiveTarget !== null && isGlobalEvaluationTarget(effectiveTarget));
  const canStart = $derived(
    effectiveTarget !== null && !isGlobal && selectedCaseIds.length > 0 && !starting,
  );

  /** P2-3：目标块与 toast 的 label 化（skill 人名优先；ID 降次级）。 */
  const selectedSkillName = $derived.by(() => {
    if (fixedTarget !== null) return fixedSkillName ?? fixedTarget.skillId;
    if (selectedKey === null) return null;
    return targets.find((option) => evaluationTargetKey(option.target) === selectedKey)?.skillName;
  });
  /** workspace 人名（注册表 label；Global 专名；未注册回退 wsId）。 */
  const workspaceLabel = $derived.by(() => {
    if (wsId === "~") return t("evaluating.globalWorkspaceLabel");
    return workspaceState.workspaces.find((workspace) => workspace.id === wsId)?.label ?? wsId;
  });

  // 弹层开启且 target 就绪时拉 cases（断线 → typed 提示行；不 throw）。
  $effect(() => {
    if (!open) return;
    const target = effectiveTarget;
    if (target === null) {
      cases = null;
      casesError = null;
      return;
    }
    const rpc = getRpc();
    if (!rpc) {
      cases = null;
      casesError = t("evaluating.runDisconnectedToast");
      return;
    }
    let cancelled = false;
    casesLoading = true;
    casesError = null;
    rpc.evaluation.cases
      .list({ target })
      .then((output) => {
        if (cancelled) return;
        cases = output.cases;
        // 默认勾选 enabled case（disabled 可显式补勾——enabled 是执行提示非硬闸）。
        selectedCaseIds = output.cases
          .filter((entry) => entry.enabled)
          .map((entry) => entry.caseId);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        cases = null;
        casesError = error instanceof Error ? error.message : String(error);
      })
      .finally(() => {
        if (!cancelled) casesLoading = false;
      });
    return () => {
      cancelled = true;
    };
  });

  // P2-11：选 Provider model 后显示将运行的 model/route 只读行——provider-model
  // 会话走内核默认路由（agent.settings.get 的 settings.model）；拉取失败静默降级
  // 为「未解析」提示（非关键信息，不阻塞 run）。
  let modelLine = $state<string | null>(null);
  let modelLoading = $state(false);
  $effect(() => {
    if (!open || runner !== "provider-model") {
      modelLine = null;
      return;
    }
    const rpc = getRpc();
    if (!rpc) {
      modelLine = null;
      return;
    }
    let cancelled = false;
    modelLoading = true;
    rpc.agent.settings
      .get({})
      .then((view) => {
        if (cancelled) return;
        const selection = view.settings.model;
        if (selection === undefined) {
          modelLine = null;
          return;
        }
        modelLine =
          selection.reasoningEffort !== undefined && selection.reasoningEffort !== ""
            ? t("evaluating.runModelLineWithEffort", {
                provider: selection.provider,
                model: selection.model,
                effort: selection.reasoningEffort,
              })
            : t("evaluating.runModelLine", {
                provider: selection.provider,
                model: selection.model,
              });
      })
      .catch(() => {
        if (!cancelled) modelLine = null;
      })
      .finally(() => {
        if (!cancelled) modelLoading = false;
      });
    return () => {
      cancelled = true;
    };
  });

  function selectTarget(option: RunTargetOption): void {
    selectedKey = evaluationTargetKey(option.target);
  }

  function toggleCase(caseId: string): void {
    selectedCaseIds = selectedCaseIds.includes(caseId)
      ? selectedCaseIds.filter((id) => id !== caseId)
      : [...selectedCaseIds, caseId];
  }

  function toggleSelectAll(): void {
    if (cases === null) return;
    selectedCaseIds =
      selectedCaseIds.length === cases.length ? [] : cases.map((entry) => entry.caseId);
  }

  function promptSummary(entry: EvaluationCase): string {
    const firstLine = entry.input.prompt.split("\n")[0] ?? "";
    return firstLine.length > 64 ? `${firstLine.slice(0, 64)}…` : firstLine;
  }

  async function confirmRun(): Promise<void> {
    const target = effectiveTarget;
    if (target === null || selectedCaseIds.length === 0) return;
    starting = true;
    const outcome = await startEvaluationRun({
      target,
      caseIds: [...selectedCaseIds],
      runner,
    });
    starting = false;
    if (outcome.ok) {
      // P2-3：toast 技能 label 化（人名优先；ID 只在无名时兜底）；R2-3 lifecycle
      // key——终态播报（settledSummary effect）取代本帧，同一 run 至多一张 toast。
      showToast(
        t("evaluating.runStartedToast", {
          skill: selectedSkillName ?? target.skillId,
        }),
        undefined,
        `eval-run-${outcome.runId}`,
      );
      open = false;
      onStarted(outcome.runId);
    } else if (outcome.reason === "global") {
      showToast(t("evaluating.runGlobalBlocked"));
    } else if (outcome.reason === "disconnected") {
      showToast(t("evaluating.runDisconnectedToast"));
    } else {
      showErrorToast(t("evaluating.runStartFailedToast", { error: outcome.message ?? "" }));
    }
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="sm:max-w-[520px]">
    <Dialog.Header>
      <Dialog.Title>{t("evaluating.runTitle")}</Dialog.Title>
      <Dialog.Description>{t("evaluating.runDescription")}</Dialog.Description>
    </Dialog.Header>

    <div class="space-y-4">
      {#if !fixedTarget}
        <div class="space-y-1.5">
          <p class="text-xs font-medium">{t("evaluating.runTargetLabel")}</p>
          {#if targets.length === 0}
            <p class="text-xs text-muted-foreground">{t("evaluating.runNoCases")}</p>
          {:else}
            <div class="max-h-36 overflow-y-auto rounded-md border border-border">
              {#each targets as option (evaluationTargetKey(option.target))}
                <button
                  type="button"
                  class="flex w-full items-center justify-between gap-2 border-b border-border px-3 py-1.5 text-left text-xs last:border-b-0 transition-colors {evaluationTargetKey(
                    option.target,
                  ) === selectedKey
                    ? 'bg-primary/10 text-primary'
                    : 'hover:bg-muted'}"
                  aria-pressed={evaluationTargetKey(option.target) === selectedKey}
                  onclick={() => selectTarget(option)}
                >
                  <span class="min-w-0 truncate">{option.skillName}</span>
                  <span class="shrink-0 text-[11px] text-muted-foreground">
                    {option.target.providerId}
                  </span>
                </button>
              {/each}
            </div>
          {/if}
        </div>
      {/if}

      {#if effectiveTarget}
        <!-- 三段标注（design §3：workspace/provider/skill 显式确认；P2-3 label 化——
             人名/ID 双层：label 主显，opaque ID 降次级 mono）。 -->
        <dl
          class="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1 rounded-md bg-muted/40 px-3 py-2 text-xs"
          data-testid="run-target-triple"
        >
          <dt class="text-muted-foreground">{t("evaluating.runTripleWorkspace")}</dt>
          <dd class="min-w-0 truncate">
            <span class="font-medium">{workspaceLabel}</span>
            <span class="ml-1.5 font-mono text-[11px] text-muted-foreground">{wsId}</span>
          </dd>
          <dt class="text-muted-foreground">{t("evaluating.runTripleProvider")}</dt>
          <dd class="min-w-0 truncate">
            <span class="font-medium">{effectiveTarget.providerId}</span>
          </dd>
          <dt class="text-muted-foreground">{t("evaluating.runTripleSkill")}</dt>
          <dd class="min-w-0 truncate">
            <span class="font-medium">{selectedSkillName ?? effectiveTarget.skillId}</span>
            <span class="ml-1.5 font-mono text-[11px] text-muted-foreground">
              {effectiveTarget.skillId}
            </span>
          </dd>
        </dl>
      {/if}

      {#if isGlobal}
        <p class="rounded bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          {t("evaluating.runGlobalBlocked")}
        </p>
      {:else if effectiveTarget}
        <div class="space-y-1.5">
          <p class="text-xs font-medium">{t("evaluating.runRunnerLabel")}</p>
          <div
            class="inline-flex overflow-hidden rounded-md border border-border"
            role="radiogroup"
          >
            {#each ["analyzer", "provider-model"] as kind (kind)}
              <button
                type="button"
                role="radio"
                aria-checked={runner === kind}
                class="px-3 py-1.5 text-xs transition-colors {runner === kind
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-muted'}"
                onclick={() => (runner = kind as typeof runner)}
              >
                {kind === "analyzer"
                  ? t("evaluating.runRunnerAnalyzer")
                  : t("evaluating.runRunnerProviderModel")}
              </button>
            {/each}
          </div>
          {#if runner === "provider-model"}
            <!-- P2-11：将运行的 model/route 只读行（内核默认路由；只读非选择器）。 -->
            <p
              class="flex items-center gap-1.5 text-[11px] text-muted-foreground"
              data-testid="run-provider-model-line"
            >
              {#if modelLoading}
                <IconLoader class="size-3 animate-spin" aria-hidden="true" />
              {:else}
                <IconBot class="size-3" aria-hidden="true" />
              {/if}
              <span class="min-w-0 truncate">
                {modelLine !== null
                  ? `${t("evaluating.runModelLabel")}: ${modelLine}`
                  : t("evaluating.runModelUnavailable")}
              </span>
            </p>
          {/if}
        </div>

        <div class="space-y-1.5">
          <div class="flex items-center justify-between">
            <p class="text-xs font-medium">{t("evaluating.runCasesLabel")}</p>
            {#if cases !== null && cases.length > 0}
              <button
                type="button"
                class="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
                onclick={toggleSelectAll}
              >
                {t("evaluating.runSelectAll")}
              </button>
            {/if}
          </div>
          {#if casesLoading}
            <p class="flex items-center gap-1.5 text-xs text-muted-foreground">
              <IconLoader class="h-3.5 w-3.5 animate-spin" />
              {t("evaluating.runCasesLoading")}
            </p>
          {:else if casesError}
            <p class="text-xs text-destructive">{casesError}</p>
          {:else if cases === null || cases.length === 0}
            <p class="text-xs text-muted-foreground">{t("evaluating.runNoCases")}</p>
          {:else}
            <div class="max-h-44 space-y-1 overflow-y-auto rounded-md border border-border p-2">
              {#each cases as entry (entry.caseId)}
                <label
                  class="flex cursor-pointer items-start gap-2 rounded px-1 py-1 text-xs hover:bg-muted/50"
                >
                  <Checkbox
                    checked={selectedCaseIds.includes(entry.caseId)}
                    onCheckedChange={() => toggleCase(entry.caseId)}
                    class="mt-0.5"
                  />
                  <span class="min-w-0 flex-1">
                    <span class="block truncate">{promptSummary(entry)}</span>
                    <span class="text-[11px] text-muted-foreground">
                      {entry.enabled ? t("evaluating.enabled") : t("evaluating.disabled")}
                      · {t(
                        entry.input.assertions.length === 1
                          ? "evaluating.assertionCountOne"
                          : "evaluating.assertionCountMany",
                        { count: entry.input.assertions.length },
                      )}
                    </span>
                  </span>
                </label>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    </div>

    <Dialog.Footer>
      <Button variant="outline" size="sm" onclick={() => (open = false)}>
        {t("common.cancel")}
      </Button>
      <Button
        size="sm"
        disabled={!canStart}
        title={t("evaluating.runStartTitle", {
          skill: effectiveTarget?.skillId ?? "",
        })}
        onclick={() => void confirmRun()}
      >
        {#if starting}<IconLoader class="h-3.5 w-3.5 animate-spin" />{:else}<IconPlay
            class="h-3.5 w-3.5"
          />{/if}
        {t("evaluating.runStart")}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
