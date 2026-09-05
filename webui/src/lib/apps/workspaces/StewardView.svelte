<!--
  用户原始需求 [2026-09-06]（openspec agent-steward）：
  「运行列表、实时事件、推荐队列、approval/reject、stale run 和失败原因；
  不把历史写入 localStorage。」
  正交意图：
  1. backend 状态 + 显式选择 + 启动 run（typed unavailable 可见，无自动 fallback）。
  2. 选中 run 的实时事件轮询（running 期间增量拉取，代次门防 stale 投影）。
  3. 审批门：permission 一次性裁决、proposal approve/reject、终态/失败原因展示。
-->
<script lang="ts">
  import { untrack } from "svelte";
  import { useParams, goById } from "$lib/shell";
  import {
    approveStewardProposal,
    cancelStewardRun,
    decideStewardPermission,
    loadStewardBackends,
    loadStewardRuns,
    pollStewardEvents,
    rejectStewardProposal,
    startStewardRun,
  } from "$lib/stores/steward.svelte";
  import { showToast } from "$lib/toast.svelte";
  import type {
    BackendStatus,
    RunEvent,
    StewardRun,
    StewardRunId,
  } from "$shared/contracts/agent-steward.js";
  import { ProviderIdSchema, WorkspaceIdSchema } from "$shared/contracts/workspaces.js";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import IconBot from "@lucide/svelte/icons/bot";
  import IconCheck from "@lucide/svelte/icons/check";
  import IconLoader from "@lucide/svelte/icons/loader-circle";
  import IconShieldOff from "@lucide/svelte/icons/shield-off";
  import IconX from "@lucide/svelte/icons/x";

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

  // ---- backend 状态 ----
  let backends = $state<BackendStatus[] | null>(null);
  let backendsError = $state<string | null>(null);
  let selectedBackend = $state<string>("");
  let starting = $state(false);

  // ---- run 列表 + 选中 run ----
  let runs = $state<StewardRun[]>([]);
  let runsError = $state<string | null>(null);
  let selectedRunId = $state<StewardRunId | null>(null);
  /** 选中 run 的最新投影（由 events 轮询顺带刷新 list 兜底）。 */
  let selectedRun = $state<StewardRun | null>(null);
  let events = $state<RunEvent[]>([]);
  let lastSeq = $state(0);
  let actionBusy = $state(false);

  const availableBackends = $derived(
    (backends ?? []).filter((backend) => backend.state === "available"),
  );

  $effect(() => {
    if (providerTarget) void refreshBootstrap();
  });

  async function refreshBootstrap(): Promise<void> {
    void refreshRuns();
    const result = await loadStewardBackends();
    if (!result.backends && !result.error) return;
    backends = result.backends;
    backendsError = result.error;
    if (!selectedBackend) {
      selectedBackend =
        result.backends?.find((b) => b.state === "available")?.capabilities.backendId ?? "";
    }
  }

  async function refreshRuns(): Promise<void> {
    const result = await loadStewardRuns();
    if (!result.runs && !result.error) return;
    runs = result.runs ?? [];
    runsError = result.error;
    if (result.runs) {
      const current = untrack(() => selectedRunId);
      if (!current || !result.runs.some((run) => run.runId === current)) {
        selectedRunId = result.runs[0]?.runId ?? null;
        events = [];
        lastSeq = 0;
      }
      selectedRun = result.runs.find((run) => run.runId === selectedRunId) ?? null;
    }
  }

  // ---- 事件轮询：选中 run 运行期间每秒增量拉取 ----
  $effect(() => {
    const runId = selectedRunId;
    if (!runId) return;
    const status = untrack(() => selectedRun?.status ?? "running");
    const timer = setInterval(() => void pollOnce(runId), 1000);
    if (status === "running") void pollOnce(runId);
    else void pollOnce(runId);
    return () => clearInterval(timer);
  });

  async function pollOnce(runId: StewardRunId): Promise<void> {
    const after = untrack(() => lastSeq);
    const result = await pollStewardEvents(runId, after);
    if (!result.status && !result.error && result.events.length === 0) return;
    if (result.error) {
      return; // 单次轮询失败静默；下次轮询重试
    }
    if (result.events.length > 0) {
      events = [...untrack(() => events), ...result.events];
      lastSeq = result.events[result.events.length - 1]!.seq;
    }
    if (result.status) {
      // 状态推进时同步刷新 run 投影（含 recommendations/proposals）。
      const list = await loadStewardRuns();
      if (list.runs) {
        runs = list.runs;
        selectedRun = list.runs.find((run) => run.runId === runId) ?? null;
      }
    }
  }

  async function handleStart(): Promise<void> {
    const target = providerTarget;
    if (!target || !selectedBackend || starting) return;
    starting = true;
    try {
      const result = await startStewardRun({ backendId: selectedBackend as never, target });
      if (!result.run && !result.error) return;
      if (result.error) {
        showToast(`Steward run failed to start: ${result.error}`);
        return;
      }
      selectedRunId = result.run!.runId;
      selectedRun = result.run!;
      events = [];
      lastSeq = 0;
      showToast(`Steward run started on ${result.run!.backendId}.`);
      void pollOnce(result.run!.runId);
    } finally {
      starting = false;
    }
  }

  async function handleCancel(): Promise<void> {
    const runId = selectedRunId;
    if (!runId || actionBusy) return;
    actionBusy = true;
    try {
      const result = await cancelStewardRun(runId);
      if (result.error) showToast(`Cancel failed: ${result.error}`);
      else if (result.run) {
        selectedRun = result.run;
        void pollOnce(runId);
      }
    } finally {
      actionBusy = false;
    }
  }

  async function handlePermission(
    requestId: string,
    decision: "granted" | "denied",
  ): Promise<void> {
    const runId = selectedRunId;
    if (!runId || actionBusy) return;
    actionBusy = true;
    try {
      const result = await decideStewardPermission({ runId, requestId, decision });
      if (result.error) showToast(`Decision failed: ${result.error}`);
      else void pollOnce(runId);
    } finally {
      actionBusy = false;
    }
  }

  async function handleApprove(proposalId: string): Promise<void> {
    const runId = selectedRunId;
    if (!runId || actionBusy) return;
    actionBusy = true;
    try {
      const result = await approveStewardProposal({ runId, proposalId: proposalId as never });
      if (result.error) showToast(`Approve failed: ${result.error}`);
      else if (result.result) {
        showToast(
          `Applied: ${result.result.applied} applied · ${result.result.conflicts} conflicts · ${result.result.failed} failed.`,
        );
      }
      void pollOnce(runId);
    } finally {
      actionBusy = false;
    }
  }

  async function handleReject(proposalId: string): Promise<void> {
    const runId = selectedRunId;
    if (!runId || actionBusy) return;
    actionBusy = true;
    try {
      const result = await rejectStewardProposal({ runId, proposalId: proposalId as never });
      if (result.error) showToast(`Reject failed: ${result.error}`);
      else void pollOnce(runId);
    } finally {
      actionBusy = false;
    }
  }

  function openSkillDetail(): void {
    if (!wsId || !providerId) return;
    goById("workspaces.provider", { wsId, providerId }, { view: "list" });
  }

  const pendingPermissions = $derived.by(() => {
    const run = selectedRun;
    if (!run || run.status !== "running") return [];
    const decided = new Set(run.permissionDecisions.map((decision) => decision.requestId));
    return run.permissionRequests.filter((request) => !decided.has(request.id));
  });

  const statusBadgeVariant = (
    status: string,
  ): "default" | "destructive" | "secondary" | "outline" => {
    if (status === "completed") return "default";
    if (status === "failed" || status === "disconnected" || status === "unavailable")
      return "destructive";
    if (status === "running") return "secondary";
    return "outline";
  };

  const eventLabel: Record<string, string> = {
    "run-started": "run",
    phase: "phase",
    "agent-message": "agent",
    "agent-item": "item",
    recommendation: "recommendation",
    "permission-request": "permission?",
    "permission-decision": "permission",
    "draft-created": "draft",
    "draft-failed": "draft ✗",
    approval: "approval",
    apply: "apply",
    "run-terminal": "end",
  };
</script>

<div class="flex h-full min-h-0 flex-col overflow-y-auto">
  <header class="shrink-0 border-b border-border px-5 py-4">
    <div class="flex flex-wrap items-center gap-3">
      <IconBot class="h-5 w-5 text-primary" />
      <div class="min-w-0 flex-1">
        <h1 class="truncate text-base font-semibold">Agent Steward</h1>
        <p class="mt-0.5 text-xs text-muted-foreground">
          {providerId ?? "—"} · agent proposes, the Manager applies.
        </p>
      </div>
      <Button size="sm" class="h-8 gap-1.5" variant="outline" onclick={openSkillDetail}>
        Back to skills
      </Button>
    </div>
  </header>

  <div class="min-h-0 flex-1 px-5 py-4">
    <!-- backend 状态 + 启动 -->
    <section class="mb-4" aria-label="Backends">
      <h2 class="mb-2 text-xs font-medium text-muted-foreground">Backends</h2>
      {#if backendsError}
        <p class="text-xs text-destructive">{backendsError}</p>
      {:else if !backends}
        <p class="flex items-center gap-2 py-2 text-xs text-muted-foreground">
          <IconLoader class="h-3.5 w-3.5 animate-spin" /> Probing backends…
        </p>
      {:else}
        <div class="flex flex-col gap-2">
          {#each backends as backend (backend.capabilities.backendId)}
            <label
              class="flex cursor-pointer items-start gap-3 rounded-md border border-border px-3 py-2 text-xs {backend.state ===
              'available'
                ? 'hover:bg-muted/40'
                : 'cursor-not-allowed opacity-70'}"
            >
              <input
                type="radio"
                name="steward-backend"
                class="mt-0.5"
                value={backend.capabilities.backendId}
                checked={selectedBackend === backend.capabilities.backendId}
                disabled={backend.state !== "available"}
                onchange={() => (selectedBackend = backend.capabilities.backendId)}
              />
              <span class="min-w-0 flex-1">
                <span class="flex flex-wrap items-center gap-2">
                  <span class="font-medium">{backend.capabilities.backendId}</span>
                  {#if backend.state === "available"}
                    <Badge variant="outline">{backend.capabilities.version}</Badge>
                  {:else}
                    <Badge variant="destructive">unavailable</Badge>
                  {/if}
                </span>
                {#if backend.state === "unavailable"}
                  <span class="mt-1 block break-words text-muted-foreground">{backend.reason}</span>
                {/if}
              </span>
            </label>
          {/each}
        </div>
      {/if}
      <div class="mt-3 flex items-center gap-2">
        <Button
          size="sm"
          class="h-8 gap-1.5"
          disabled={!selectedBackend || starting}
          onclick={() => void handleStart()}
        >
          {#if starting}<IconLoader class="h-3.5 w-3.5 animate-spin" /> Starting…{:else}
            <IconBot class="h-3.5 w-3.5" /> Start run
          {/if}
        </Button>
        {#if selectedRun?.status === "running"}
          <Button
            size="sm"
            variant="outline"
            class="h-8 gap-1.5"
            disabled={actionBusy}
            onclick={() => void handleCancel()}
          >
            <IconX class="h-3.5 w-3.5" /> Cancel run
          </Button>
        {/if}
      </div>
    </section>

    <!-- run 列表 -->
    <section class="mb-4" aria-label="Runs">
      <h2 class="mb-2 text-xs font-medium text-muted-foreground">Runs</h2>
      {#if runsError}
        <p class="text-xs text-destructive">{runsError}</p>
      {:else if runs.length === 0}
        <p class="py-2 text-xs text-muted-foreground">No steward runs yet.</p>
      {:else}
        <ul class="flex flex-col gap-1">
          {#each runs as run (run.runId)}
            <li>
              <button
                type="button"
                class="flex w-full flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2 text-left text-xs hover:bg-muted/40 {run.runId ===
                selectedRunId
                  ? 'border-primary/60 bg-muted/40'
                  : ''}"
                onclick={() => {
                  selectedRunId = run.runId;
                  selectedRun = run;
                  events = [];
                  lastSeq = 0;
                  void pollOnce(run.runId);
                }}
              >
                <Badge variant={statusBadgeVariant(run.status)}>{run.status}</Badge>
                <span class="font-mono text-[10px] text-muted-foreground"
                  >{run.runId.slice(0, 11)}</span
                >
                <span>{run.backendId}</span>
                <span class="text-muted-foreground">{run.skillIds.length} skills</span>
                {#if run.phase}
                  <Badge variant="secondary">{run.phase}</Badge>
                {/if}
                <span class="ml-auto text-[10px] text-muted-foreground">
                  {run.startedAt.slice(11, 19)}
                </span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <!-- 选中 run：失败原因 / 授权 / 审批门 / 事件时间线 -->
    {#if selectedRun}
      <section class="mb-4" aria-label="Selected run">
        {#if selectedRun.error}
          <div
            class="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
          >
            {selectedRun.error}
          </div>
        {/if}
        {#if selectedRun.status === "running" && selectedRun.phase !== "awaiting-approval" && selectedRun.phase !== "applying"}
          <p class="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
            <IconLoader class="h-3.5 w-3.5 animate-spin" /> Run in progress ({selectedRun.phase ??
              "…"}).
          </p>
        {/if}

        <!-- 待决授权 -->
        {#if pendingPermissions.length > 0}
          <div class="mb-3 rounded-md border border-border bg-muted/20 px-3 py-2">
            <h3 class="mb-1 text-xs font-medium">Permission requested</h3>
            {#each pendingPermissions as request (request.id)}
              <div class="flex flex-wrap items-start gap-2 py-1 text-xs">
                <IconShieldOff class="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span class="min-w-0 flex-1 break-words">
                  {request.summary}
                  {#if request.detail}<span class="block text-muted-foreground"
                      >{request.detail}</span
                    >{/if}
                </span>
                <span class="flex gap-1">
                  <Button
                    size="sm"
                    class="h-7 gap-1 px-2 text-xs"
                    disabled={actionBusy}
                    onclick={() => void handlePermission(request.id, "granted")}
                  >
                    <IconCheck class="h-3 w-3" /> Grant
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    class="h-7 gap-1 px-2 text-xs"
                    disabled={actionBusy}
                    onclick={() => void handlePermission(request.id, "denied")}
                  >
                    <IconX class="h-3 w-3" /> Deny
                  </Button>
                </span>
              </div>
            {/each}
          </div>
        {/if}

        <!-- 推荐队列 + 审批门 -->
        {#if selectedRun.recommendations.length > 0}
          <div class="mb-3">
            <h3 class="mb-1 text-xs font-medium text-muted-foreground">Recommendations</h3>
            <ul class="flex flex-col gap-2">
              {#each selectedRun.recommendations as recommendation (recommendation.id)}
                <li class="rounded-md border border-border px-3 py-2 text-xs">
                  <div class="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">{recommendation.kind}</Badge>
                    <span class="min-w-0 flex-1 break-words">{recommendation.rationale}</span>
                  </div>
                  <p class="mt-1 font-mono text-[10px] text-muted-foreground">
                    {recommendation.skillIds.join(" · ")}
                  </p>
                  {#if selectedRun.proposalIds.length > 0 && selectedRun.status === "running"}
                    {#if recommendation.id === selectedRun.recommendations[selectedRun.recommendations.length - 1]!.id}
                      {#if selectedRun.phase === "awaiting-approval"}
                        <div class="mt-2 flex items-center gap-2">
                          <span class="text-muted-foreground">Proposals awaiting approval:</span>
                          {#each selectedRun.proposalIds as proposalId (proposalId)}
                            <span class="flex gap-1">
                              <Button
                                size="sm"
                                class="h-7 gap-1 px-2 text-xs"
                                disabled={actionBusy}
                                onclick={() => void handleApprove(proposalId)}
                              >
                                <IconCheck class="h-3 w-3" /> Approve {proposalId.slice(0, 8)}
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                class="h-7 gap-1 px-2 text-xs"
                                disabled={actionBusy}
                                onclick={() => void handleReject(proposalId)}
                              >
                                <IconX class="h-3 w-3" /> Reject
                              </Button>
                            </span>
                          {/each}
                        </div>
                      {/if}
                    {/if}
                  {/if}
                </li>
              {/each}
            </ul>
          </div>
        {/if}

        <!-- 事件时间线 -->
        <div>
          <h3 class="mb-1 text-xs font-medium text-muted-foreground">Timeline</h3>
          {#if events.length === 0}
            <p class="py-2 text-xs text-muted-foreground">Waiting for events…</p>
          {:else}
            <ol class="flex flex-col gap-0.5 font-mono text-[10px] leading-relaxed">
              {#each events as event (event.seq)}
                <li class="flex gap-2">
                  <span class="w-10 shrink-0 text-right text-muted-foreground">{event.seq}</span>
                  <span class="w-24 shrink-0 text-primary/80"
                    >{eventLabel[event.kind] ?? event.kind}</span
                  >
                  <span class="min-w-0 flex-1 break-words">
                    {event.message ?? event.phase ?? event.itemKind ?? event.terminalStatus ?? ""}
                  </span>
                </li>
              {/each}
            </ol>
          {/if}
        </div>
      </section>
    {:else}
      <p class="py-8 text-center text-xs text-muted-foreground">
        Start a steward run to see live events, recommendations, and the approval gate.
      </p>
    {/if}
  </div>
</div>
