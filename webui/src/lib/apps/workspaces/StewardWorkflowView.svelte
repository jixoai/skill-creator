<!--
  用户原始需求 [2026-09-07]（openspec steward-product-workflow task 4.1）：
  「只实现 task/target/selected-skills/runtime-config stores 和对应 workflow view；
  复用阶段 4 已注册的 plugin/root/connection/RPC owner。」
  正交意图：
  1. 任务/范围选择：taskKind 分段控制 + 技能多选（来自 skills.list）+ instructions；
     选择按 target 键控存活（island 卸载/重连不重置）。
  2. runtime config：模型/预设/权限投影（dsh.settings 视图，凭据只显状态）+
     补丁更新（typed rejected 可见）。
  3. run 投影：skillSteward.startRun 终态（terminal/toolCalls/dshSessionId/proposals），
     latest-request-wins，迟到响应不覆盖。
-->
<script lang="ts">
  import { untrack } from "svelte";
  import { useParams } from "$lib/shell";
  import { loadSkills, skillsState, filteredSkills } from "$lib/stores/skills.svelte";
  import {
    applyStewardRuntimeConfigPatch,
    clampInstructions,
    loadStewardRuntimeConfig,
    runtimeConfigState,
    selectionFor,
    startStewardWorkflowRun,
    toggleSelectedSkill,
    workflowRunState,
    STEWARD_INSTRUCTIONS_MAX,
    type StewardWorkflowSelection,
  } from "$lib/stores/steward-workflow.svelte";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Checkbox } from "$lib/components/ui/checkbox";
  import { Textarea } from "$lib/components/ui/textarea";
  import IconCpu from "@lucide/svelte/icons/cpu";
  import IconLoader from "@lucide/svelte/icons/loader-circle";
  import IconPlay from "@lucide/svelte/icons/play";
  import IconSettings from "@lucide/svelte/icons/settings";
  import { ProviderIdSchema, WorkspaceIdSchema } from "$shared/contracts/workspaces.js";
  import type { StewardTaskKind } from "$shared/contracts/skill-steward.js";

  const getParams = useParams<{ wsId: string; providerId: string }>();
  const wsId = $derived(getParams?.()?.wsId);
  const providerId = $derived(getParams?.()?.providerId);

  const providerTarget = $derived.by(() => {
    if (!wsId || !providerId) return null;
    const ws = WorkspaceIdSchema.safeParse(wsId);
    const prov = ProviderIdSchema.safeParse(providerId);
    if (!ws.success || !prov.success) return null;
    return { workspaceId: ws.data, providerId: prov.data };
  });

  /** 本 target 的选择（模块级键控；重连/卸载后仍在）。初始化在 $effect.pre 内
   *  完成——selectionFor 会写入 $state 选择表，不能在 derived 求值中调用
   *  （state_unsafe_mutation，2026-09-07 实测会击穿叶子渲染）。 */
  let selection = $state<StewardWorkflowSelection | null>(null);
  $effect.pre(() => {
    selection = providerTarget ? selectionFor(providerTarget) : null;
  });

  const taskKinds: ReadonlyArray<{ value: StewardTaskKind; label: string }> = [
    { value: "check", label: "Check" },
    { value: "optimize", label: "Optimize" },
    { value: "organize", label: "Organize" },
  ];

  let applyingConfig = $state(false);
  /** 上一次补丁的 typed 结果（rejected 的拒绝码展示）。 */
  let lastPatchOutcome = $state<string | null>(null);

  const skills = $derived(filteredSkills());
  const view = $derived(runtimeConfigState.view);

  $effect(() => {
    if (providerTarget) void loadSkills(providerTarget);
  });
  $effect(() => {
    void loadStewardRuntimeConfig();
  });

  function setTaskKind(kind: StewardTaskKind): void {
    if (selection) selection.taskKind = kind;
  }

  function onInstructionsInput(event: Event): void {
    if (!selection) return;
    selection.instructions = clampInstructions((event.currentTarget as HTMLTextAreaElement).value);
  }

  async function onStart(): Promise<void> {
    if (!providerTarget) return;
    await startStewardWorkflowRun(providerTarget);
  }

  async function onApplyApprovalPolicy(policy: "ask" | "never"): Promise<void> {
    applyingConfig = true;
    lastPatchOutcome = null;
    try {
      const result = await applyStewardRuntimeConfigPatch({
        permissions: { approvalPolicy: policy },
      });
      if (!result) return;
      lastPatchOutcome =
        result.outcome === "updated"
          ? result.changed
            ? `updated (revision ${result.previousRevision} → ${result.revision})`
            : `no change (revision ${result.revision})`
          : `rejected: ${result.code}`;
    } finally {
      applyingConfig = false;
    }
  }
</script>

<div class="flex flex-col gap-4">
  <header class="flex flex-wrap items-center gap-2">
    <IconCpu class="h-4 w-4 text-muted-foreground" aria-hidden="true" />
    <h2 class="text-sm font-semibold">Steward Workflow</h2>
    <Badge variant="secondary" class="text-[10px]">
      {selection ? `${selection.selectedSkillIds.length} selected` : "no target"}
    </Badge>
    {#if view}
      <Badge variant="outline" class="text-[10px]">
        {view.settings.preset} · {view.settings.model.provider}/{view.settings.model.model}
      </Badge>
      <Badge variant="outline" class="text-[10px]">
        approval: {view.settings.permissions.approvalPolicy}
      </Badge>
    {/if}
  </header>

  {#if !providerTarget}
    <p class="text-sm text-muted-foreground">Invalid workspace or provider identity.</p>
  {:else}
    <!-- 任务类别 -->
    <section class="flex flex-col gap-1.5" aria-label="Task kind">
      <span class="text-xs font-medium text-muted-foreground">Task</span>
      <div class="inline-flex rounded-md border" role="group" aria-label="Task kind">
        {#each taskKinds as kind (kind.value)}
          <button
            type="button"
            class="h-7 px-3 text-xs first:rounded-l-md last:rounded-r-md transition-colors {selection?.taskKind ===
            kind.value
              ? 'bg-primary text-primary-foreground'
              : 'hover:bg-accent'}"
            aria-pressed={selection?.taskKind === kind.value}
            onclick={() => setTaskKind(kind.value)}
          >
            {kind.label}
          </button>
        {/each}
      </div>
    </section>

    <!-- 范围：技能多选 -->
    <section class="flex flex-col gap-1.5" aria-label="Selected skills">
      <span class="text-xs font-medium text-muted-foreground">
        Skills in scope ({selection?.selectedSkillIds.length ?? 0}; empty = whole provider)
      </span>
      {#if skillsState.error}
        <p class="text-xs text-destructive">{skillsState.error}</p>
      {:else if skills.length === 0}
        <p class="text-xs text-muted-foreground">
          {skillsState.loading ? "Loading skills…" : "No skills in this provider."}
        </p>
      {:else}
        <ul class="max-h-48 overflow-auto rounded-md border divide-y">
          {#each skills as skill (skill.id)}
            {@const checked = selection?.selectedSkillIds.includes(skill.id) ?? false}
            <li class="flex items-center gap-2 px-2 py-1">
              <Checkbox
                id={`steward-scope-${skill.id}`}
                {checked}
                onCheckedChange={() =>
                  providerTarget && toggleSelectedSkill(providerTarget, skill.id)}
                aria-label={`Include ${skill.name} in the steward scope`}
              />
              <label for={`steward-scope-${skill.id}`} class="flex-1 truncate text-xs">
                {skill.name}
              </label>
              {#if skill.disabled}
                <Badge variant="outline" class="text-[10px]">disabled</Badge>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <!-- 补充指令 -->
    <section class="flex flex-col gap-1.5" aria-label="Instructions">
      <label class="text-xs font-medium text-muted-foreground" for="steward-instructions">
        Additional instructions (optional, max {STEWARD_INSTRUCTIONS_MAX})
      </label>
      <Textarea
        id="steward-instructions"
        class="min-h-16 text-xs"
        placeholder="Constraints or focus for this run"
        value={selection?.instructions ?? ""}
        oninput={onInstructionsInput}
        maxlength={STEWARD_INSTRUCTIONS_MAX}
      ></Textarea>
    </section>

    <!-- runtime config -->
    <section class="flex flex-col gap-1.5" aria-label="Runtime config">
      <div class="flex items-center gap-1.5">
        <IconSettings class="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        <span class="text-xs font-medium text-muted-foreground">Runtime config</span>
        {#if runtimeConfigState.loading}
          <IconLoader class="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        {/if}
      </div>
      {#if runtimeConfigState.error}
        <p class="text-xs text-destructive">{runtimeConfigState.error}</p>
      {:else if view}
        <div class="flex flex-wrap items-center gap-2 text-xs">
          <span class="text-muted-foreground">
            model {view.settings.model.provider}/{view.settings.model.model}
          </span>
          <span class="text-muted-foreground">preset {view.settings.preset}</span>
          <span class="inline-flex items-center gap-1">
            <span class="text-muted-foreground">approval</span>
            <Button
              variant="ghost"
              size="sm"
              class="h-6 px-2 text-xs"
              aria-pressed={view.settings.permissions.approvalPolicy === "ask"}
              disabled={applyingConfig}
              onclick={() => void onApplyApprovalPolicy("ask")}
            >
              ask
            </Button>
            <Button
              variant="ghost"
              size="sm"
              class="h-6 px-2 text-xs"
              aria-pressed={view.settings.permissions.approvalPolicy === "never"}
              disabled={applyingConfig}
              onclick={() => void onApplyApprovalPolicy("never")}
            >
              never
            </Button>
          </span>
          <span class="text-muted-foreground">rev {view.settings.revision}</span>
          {#if lastPatchOutcome}
            <span class="text-muted-foreground">{lastPatchOutcome}</span>
          {/if}
        </div>
        <p class="text-[10px] text-muted-foreground">
          approval policy only projects to the agent runtime; apply always requires a human grant.
        </p>
      {/if}
    </section>

    <!-- 启动 -->
    <section class="flex items-center gap-2">
      <Button
        size="sm"
        class="h-7 gap-1.5 text-xs"
        disabled={workflowRunState.starting}
        onclick={() => void onStart()}
      >
        {#if workflowRunState.starting}
          <IconLoader class="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        {:else}
          <IconPlay class="h-3.5 w-3.5" aria-hidden="true" />
        {/if}
        Run {selection?.taskKind ?? "check"}
      </Button>
      {#if workflowRunState.error}
        <span class="text-xs text-destructive">{workflowRunState.error}</span>
      {/if}
    </section>

    <!-- run 投影 -->
    {#if workflowRunState.run}
      {@const run = workflowRunState.run}
      <section class="flex flex-col gap-1.5 rounded-md border p-2" aria-label="Run projection">
        <div class="flex flex-wrap items-center gap-2 text-xs">
          <span class="font-medium">Last run</span>
          <Badge variant="outline" class="text-[10px]">{run.toolCalls} tool calls</Badge>
          <Badge variant="outline" class="text-[10px]">
            {run.acceptedResponses} accepted / {run.droppedLateResponses} dropped
          </Badge>
          {#if run.dshSessionId}
            <Badge variant="outline" class="text-[10px]">dsh {run.dshSessionId}</Badge>
          {/if}
          {#if run.proposals.length > 0}
            <Badge variant="secondary" class="text-[10px]">{run.proposals.length} proposals</Badge>
          {/if}
        </div>
        <p class="text-xs text-muted-foreground">{run.terminal}</p>
        {#if run.proposals.length > 0}
          <ul class="flex flex-col gap-1 text-xs">
            {#each run.proposals as proposal (proposal.proposalId)}
              <li class="flex items-center gap-2">
                <Badge variant="outline" class="text-[10px]">{proposal.action}</Badge>
                <code class="text-[10px]">{proposal.proposalId}</code>
              </li>
            {/each}
          </ul>
        {/if}
        <p class="text-[10px] text-muted-foreground">
          approval / apply / rollback arrive with the product workflow UI (task 4.2).
        </p>
      </section>
    {/if}
  {/if}
</div>
