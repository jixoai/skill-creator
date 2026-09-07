<!--
  用户原始需求 [2026-09-07]（openspec steward-product-workflow tasks 4.1/4.2）：
  「只实现 task/target/selected-skills/runtime-config stores 和对应 workflow view」
  +「timeline, tool calls, evidence graph, diff, validation, approval, rollback
  and recovery states work at 1100px and 680px without overflow」。
  正交意图：
  1. 任务/范围选择：taskKind 分段控制 + 技能多选（来自 skills.list）+ instructions；
     选择按 target 键控存活（island 卸载/重连不重置）。
  2. runtime config：模型/预设/权限投影（dsh.settings 视图，凭据只显状态）+
     补丁更新（typed rejected 可见）。
  3. run 投影：skillSteward.startRun 终态（terminal/toolCalls/dshSessionId/proposals），
     latest-request-wins，迟到响应不覆盖。
  4. 提案工作流（4.2）：每提案 validate→approve→apply→rollback 事实链 +
     mutation diff（Manager 修订级事实）+ recovery/compensated/stale 终态 +
     append-only timeline + agent stream（脱敏帧，tool-call/tool-result 即
     tool calls 面与提案的证据链）。
-->
<script lang="ts">
  import { untrack } from "svelte";
  import { useParams } from "$lib/shell";
  import { loadSkills, skillsState, filteredSkills } from "$lib/stores/skills.svelte";
  import {
    applyStewardRuntimeConfigPatch,
    applyStewardProposal,
    applyStewardRollback,
    approveStewardProposal,
    clampInstructions,
    framesForCurrentRun,
    isReverseProposalPlaceholder,
    loadStewardRuntimeConfig,
    loadStewardStreamFrames,
    prepareStewardRollback,
    proposalStates,
    runtimeConfigState,
    selectionFor,
    startStewardWorkflowRun,
    streamFramesState,
    toggleSelectedSkill,
    validateStewardProposal,
    workflowRunState,
    workflowTimeline,
    STEWARD_INSTRUCTIONS_MAX,
    type StewardWorkflowSelection,
  } from "$lib/stores/steward-workflow.svelte";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Checkbox } from "$lib/components/ui/checkbox";
  import { Textarea } from "$lib/components/ui/textarea";
  import IconCpu from "@lucide/svelte/icons/cpu";
  import IconGitBranch from "@lucide/svelte/icons/git-branch";
  import IconHistory from "@lucide/svelte/icons/history";
  import IconLoader from "@lucide/svelte/icons/loader-circle";
  import IconPlay from "@lucide/svelte/icons/play";
  import IconSettings from "@lucide/svelte/icons/settings";
  import IconWrench from "@lucide/svelte/icons/wrench";
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
          <code class="text-[10px] text-muted-foreground">{run.snapshotId}</code>
        </div>
        <p class="text-xs text-muted-foreground">{run.terminal}</p>
      </section>
    {/if}

    <!-- 提案工作流（4.2）：validate → approve → apply → rollback + diff + recovery -->
    {#if workflowRunState.run?.proposals.length}
      <section class="flex flex-col gap-2" aria-label="Proposals">
        <span class="text-xs font-medium text-muted-foreground">
          Proposals ({workflowRunState.run.proposals.length})
        </span>
        {#each workflowRunState.run.proposals as proposal (proposal.proposalId)}
          {@const state = proposalStates[proposal.proposalId]}
          <article
            class="flex flex-col gap-2 rounded-md border p-2"
            aria-label={`Proposal ${proposal.proposalId}`}
          >
            <div class="flex flex-wrap items-center gap-2 text-xs">
              <IconWrench class="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
              <Badge variant="secondary" class="text-[10px]">{proposal.action}</Badge>
              <code class="text-[10px]">{proposal.proposalId}</code>
              {#if state?.validation}
                <Badge
                  variant="outline"
                  class="text-[10px] {state.validation.overall === 'valid'
                    ? 'text-emerald-600'
                    : state.validation.overall === 'stale'
                      ? 'text-amber-600'
                      : 'text-destructive'}"
                >
                  {state.validation.overall}
                </Badge>
              {/if}
              {#if state?.grant}
                <Badge variant="outline" class="text-[10px]">granted</Badge>
              {/if}
              {#if state?.apply}
                <Badge
                  variant="outline"
                  class="text-[10px] {state.apply.outcomeStatus === 'applied'
                    ? 'text-emerald-600'
                    : 'text-destructive'}"
                >
                  {state.apply.outcomeStatus}
                </Badge>
              {/if}
              {#if state?.busy}
                <IconLoader class="h-3.5 w-3.5 animate-spin" aria-hidden="true"></IconLoader>
              {/if}
            </div>

            {#if state?.error}
              <p class="text-xs text-destructive" role="alert">{state.error}</p>
            {/if}

            <!-- recovery / compensated 终态横幅：恢复动作=按 checks 修因或重跑 -->
            {#if state?.apply && state.apply.outcomeStatus !== "applied"}
              <div
                class="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs"
                role="status"
              >
                <p class="font-medium">
                  {state.apply.outcomeStatus === "recovery-required"
                    ? "Recovery required — the journal stopped before a clean terminal state."
                    : "Compensated — mutations were rolled back in-transaction."}
                </p>
                {#if state.apply.failure}
                  <p class="text-muted-foreground">{state.apply.failure}</p>
                {/if}
                <p class="text-muted-foreground">
                  audit {state.apply.auditId} ({state.apply.auditStatus}); run a new check after
                  resolving the cause — stale proposals are rejected at validation.
                </p>
              </div>
            {/if}

            <!-- rollback 终态（recovery-required/compensated 的恢复横幅） -->
            {#if state?.rollbackResult && state.rollbackResult.outcomeStatus !== "applied"}
              <div
                class="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs"
                role="status"
              >
                <p class="font-medium">
                  Rollback {state.rollbackResult.outcomeStatus} — the reverse transaction did not reach
                  a clean terminal state.
                </p>
                {#if state.rollbackResult.failure}
                  <p class="text-muted-foreground">{state.rollbackResult.failure}</p>
                {/if}
                <p class="text-muted-foreground">
                  audit {state.rollbackResult.auditId} ({state.rollbackResult.auditStatus}); resolve
                  the reported cause before retrying — file states are preserved.
                </p>
              </div>
            {/if}

            <!-- validation checks（证据：逐项通过/失败/跳过） -->
            {#if state?.validation}
              <ul class="flex flex-col gap-0.5 text-[11px]">
                {#each state.validation.checks as check (check.name)}
                  <li class="flex items-start gap-2">
                    <span
                      class="mt-0.5 shrink-0 {check.status === 'passed'
                        ? 'text-emerald-600'
                        : check.status === 'failed'
                          ? 'text-destructive'
                          : 'text-muted-foreground'}"
                    >
                      {check.status === "passed" ? "✓" : check.status === "failed" ? "✕" : "–"}
                    </span>
                    <span class="min-w-0 break-words">
                      <span class="font-medium">{check.name}</span>
                      {#if check.detail}
                        <span class="text-muted-foreground"> — {check.detail}</span>
                      {/if}
                    </span>
                  </li>
                {/each}
              </ul>
            {/if}

            <!-- mutation diff（Manager 修订级事实：relPath + semantic + before→after） -->
            {#if state?.apply?.mutations.length}
              <div class="overflow-x-auto">
                <table
                  class="w-full min-w-72 border-collapse text-[11px]"
                  aria-label="Mutation diff"
                >
                  <thead>
                    <tr class="text-left text-muted-foreground">
                      <th class="py-0.5 pr-2 font-medium">path</th>
                      <th class="py-0.5 pr-2 font-medium">semantic</th>
                      <th class="py-0.5 font-medium">revision</th>
                    </tr>
                  </thead>
                  <tbody>
                    {#each state.apply.mutations as mutation (mutation.relPath)}
                      <tr class="border-t">
                        <td class="max-w-56 truncate py-0.5 pr-2" title={mutation.relPath}>
                          {mutation.relPath}
                        </td>
                        <td class="py-0.5 pr-2 text-muted-foreground">{mutation.semantic}</td>
                        <td class="py-0.5 font-mono text-[10px]">
                          {(mutation.beforeRevision ?? "∅").slice(0, 8)} → {(
                            mutation.afterRevision ?? "∅"
                          ).slice(0, 8)}
                        </td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
              <p class="text-[10px] text-muted-foreground">
                diff shows Manager mutation facts (revision fingerprints); byte-level content review
                belongs to the workspace provider view.
              </p>
            {/if}

            <!-- 操作链 -->
            <div class="flex flex-wrap items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                class="h-6 px-2 text-[11px]"
                disabled={state?.busy !== null && state?.busy !== undefined}
                onclick={() => void validateStewardProposal(proposal.proposalId)}
              >
                Validate
              </Button>
              <Button
                variant="outline"
                size="sm"
                class="h-6 px-2 text-[11px]"
                disabled={(state?.busy !== null && state?.busy !== undefined) ||
                  state?.validation?.overall !== "valid"}
                title={state?.validation?.overall === "stale"
                  ? "Revision drift — re-run the task to refresh the snapshot"
                  : "Approve requires a passing validation"}
                onclick={() => void approveStewardProposal(proposal.proposalId)}
              >
                Approve
              </Button>
              <Button
                size="sm"
                class="h-6 px-2 text-[11px]"
                disabled={(state?.busy !== null && state?.busy !== undefined) ||
                  !state?.grant ||
                  state?.apply !== null}
                onclick={() => void applyStewardProposal(proposal.proposalId)}
              >
                Apply
              </Button>
              {#if state?.apply?.outcomeStatus === "applied"}
                <Button
                  variant="outline"
                  size="sm"
                  class="h-6 gap-1 px-2 text-[11px]"
                  disabled={(state?.busy !== null && state?.busy !== undefined) ||
                    state.rollbackPrep !== null}
                  onclick={() =>
                    void prepareStewardRollback(proposal.proposalId, state!.apply!.auditId)}
                >
                  <IconGitBranch class="h-3 w-3" aria-hidden="true" />
                  Prepare rollback
                </Button>
                {#if state?.rollbackPrep}
                  {#if !isReverseProposalPlaceholder(state.rollbackPrep.reverseProposalId) && state.rollbackPrep.reverseProposalId}
                    <!-- enablement 逆操作：reverse proposal 需独立审批后按正常 apply 链执行 -->
                    <Button
                      variant="outline"
                      size="sm"
                      class="h-6 px-2 text-[11px]"
                      disabled={proposalStates[state.rollbackPrep.reverseProposalId]?.grant !==
                        undefined ||
                        (proposalStates[state.rollbackPrep.reverseProposalId]?.busy !== null &&
                          proposalStates[state.rollbackPrep.reverseProposalId]?.busy !== undefined)}
                      onclick={() =>
                        void approveStewardProposal(state!.rollbackPrep!.reverseProposalId!)}
                    >
                      Approve reverse
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      class="h-6 px-2 text-[11px]"
                      disabled={proposalStates[state.rollbackPrep.reverseProposalId]?.grant ===
                        undefined}
                      onclick={() =>
                        void applyStewardProposal(state!.rollbackPrep!.reverseProposalId!)}
                    >
                      Apply reverse
                    </Button>
                  {:else}
                    <!-- split/merge 逆操作：rollback grant 直接消费（journal 反向重放） -->
                    <Button
                      variant="outline"
                      size="sm"
                      class="h-6 px-2 text-[11px]"
                      disabled={state?.busy !== null && state?.busy !== undefined}
                      title={state.rollbackPrep.note}
                      onclick={() =>
                        void applyStewardRollback(proposal.proposalId, state!.apply!.auditId)}
                    >
                      Rollback (replay)
                    </Button>
                  {/if}
                {/if}
              {/if}
            </div>
            {#if state?.rollbackPrep}
              <p class="text-[11px] text-muted-foreground">{state.rollbackPrep.note}</p>
            {/if}
            {#if state?.grant}
              <p class="text-[10px] text-muted-foreground">
                grant {state.grant.grantId} · fingerprint {state.grant.fingerprint.slice(0, 16)}… ·
                issued {state.grant.issuedAt}
              </p>
            {/if}
          </article>
        {/each}
      </section>
    {/if}

    <!-- agent stream（tool calls 证据链；脱敏帧） -->
    <section class="flex flex-col gap-1.5" aria-label="Agent stream">
      <div class="flex items-center gap-1.5">
        <IconHistory class="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        <span class="text-xs font-medium text-muted-foreground">Agent stream</span>
        <Button
          variant="ghost"
          size="sm"
          class="h-6 px-2 text-[11px]"
          disabled={streamFramesState.loading}
          onclick={() => void loadStewardStreamFrames()}
        >
          {#if streamFramesState.loading}
            <IconLoader class="h-3 w-3 animate-spin" aria-hidden="true" />
          {:else}
            refresh
          {/if}
        </Button>
        {#if workflowRunState.run?.dshSessionId}
          <span class="text-[10px] text-muted-foreground">
            filtered to session {workflowRunState.run.dshSessionId}
          </span>
        {/if}
      </div>
      {#if streamFramesState.error}
        <p class="text-xs text-destructive">{streamFramesState.error}</p>
      {:else if framesForCurrentRun().length === 0}
        <p class="text-xs text-muted-foreground">
          {streamFramesState.loading
            ? "Loading frames…"
            : "No frames yet — run a task to populate the stream."}
        </p>
      {:else}
        <ol class="flex max-h-56 flex-col gap-0.5 overflow-auto text-[11px]">
          {#each framesForCurrentRun().slice(-30).reverse() as frame (frame.seq)}
            <li class="flex items-baseline gap-2">
              <span class="w-8 shrink-0 text-right font-mono text-[10px] text-muted-foreground">
                {frame.seq}
              </span>
              <span
                class="shrink-0 font-mono text-[10px] {frame.kind === 'tool-call' ||
                frame.kind === 'tool-result'
                  ? 'text-primary'
                  : 'text-muted-foreground'}"
              >
                {frame.kind}
              </span>
              {#if frame.toolName}
                <code class="shrink-0 text-[10px]">{frame.toolName}</code>
              {/if}
              {#if frame.text}
                <span class="min-w-0 flex-1 truncate" title={frame.text}>{frame.text}</span>
              {/if}
            </li>
          {/each}
        </ol>
      {/if}
    </section>

    <!-- timeline（run + 提案生命周期追加式时间线） -->
    {#if workflowTimeline.length > 0}
      <section class="flex flex-col gap-1.5" aria-label="Workflow timeline">
        <div class="flex items-center gap-1.5">
          <IconHistory class="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          <span class="text-xs font-medium text-muted-foreground">Timeline</span>
        </div>
        <ol class="flex flex-col gap-0.5 text-[11px]">
          {#each [...workflowTimeline].reverse() as event, index (workflowTimeline.length - index)}
            <li class="flex items-baseline gap-2">
              <span class="w-14 shrink-0 font-mono text-[10px] text-muted-foreground">
                {new Date(event.at).toLocaleTimeString()}
              </span>
              <span
                class="shrink-0 font-mono text-[10px] {event.kind === 'error'
                  ? 'text-destructive'
                  : event.kind === 'applied' || event.kind === 'rolled-back'
                    ? 'text-emerald-600'
                    : 'text-muted-foreground'}"
              >
                {event.kind}
              </span>
              <span class="min-w-0 flex-1 break-words">{event.text}</span>
            </li>
          {/each}
        </ol>
      </section>
    {/if}
  {/if}
</div>
