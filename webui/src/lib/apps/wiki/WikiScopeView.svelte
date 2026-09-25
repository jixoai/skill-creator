<!--
  用户原始需求 [2026-09-21]：「P1 本质上是在收集一些碎片的认知，这和 skill-wiki
  是有一些重叠的，是 skill-wiki 输入的一部分」——wiki 通道是碎片认知的收集面。
  用户原始需求 [2026-09-22]（wiki-directory-standard）：旧 Workspaces 内 wiki 视图
  平移至第四个一级 Wiki 面板的 detail（/wiki/:wsId）。
  用户原始需求 [2026-09-25]（skill-wiki-maintainer tasks 1.6）：「WikiScopeView
  workspace scope『Distill to global』：start→进度→跳 proposal 面」。
  正交意图：
  1. 双级 scope 的 pattern 列表（前端过滤 + 惰性展开正文）。
  2. 碎片追加表单（幂等提交：deduplicated 有独立反馈；失败 toast 可区分）。
  3. 进入 detail 聚焦语义标题（窄屏单屏列表/详情切换法则；返回恢复由 WikiHome 承担）。
  4. 加载 / 空 / 错误三态可区分；断线保留草稿（store 列表门不重置表单态）。
  5. workspace scope 的蒸馏入口（进度/终态/typed 错误可区分 + awaiting-approval
     决定面；状态投影与代次纪律在 wiki-distill store——global scope 无入口）。
-->
<script lang="ts">
  import { goto } from "$app/navigation";
  import { useParams } from "$lib/shell";
  import {
    appendWikiFragment,
    loadWiki,
    readWikiPattern,
    resetWiki,
    wikiState,
  } from "$lib/stores/wiki.svelte";
  import {
    cancelWikiDistill,
    isTerminalWikiDistillState,
    resetWikiDistill,
    setWikiDistillProposalsOpen,
    startWikiDistill,
    wikiDistillProposals,
    wikiDistillState,
  } from "$lib/stores/wiki-distill.svelte";
  import { workspaceState } from "$lib/store.svelte";
  import { showToast } from "$lib/toast.svelte";
  import { Button } from "$lib/components/ui/button";
  import { Badge } from "$lib/components/ui/badge";
  import { Input } from "$lib/components/ui/input";
  import { Textarea } from "$lib/components/ui/textarea";
  import AgentProposalCard from "$lib/components/agent/AgentProposalCard.svelte";
  import IconArrowLeft from "@lucide/svelte/icons/arrow-left";
  import IconBookOpen from "@lucide/svelte/icons/book-open";
  import IconCheck from "@lucide/svelte/icons/check";
  import IconPlus from "@lucide/svelte/icons/plus";
  import IconRefresh from "@lucide/svelte/icons/refresh-cw";
  import IconSparkles from "@lucide/svelte/icons/sparkles";
  import IconLoader from "@lucide/svelte/icons/loader-circle";
  import IconAlert from "@lucide/svelte/icons/triangle-alert";
  import IconX from "@lucide/svelte/icons/x";
  import type { PatternListItem, WikiReadResult } from "$lib/types";
  import type {
    DistillCounters,
    DistillFailReason,
    RunState,
  } from "$shared/contracts/wiki-distill.js";
  import { WorkspaceIdSchema } from "$shared/contracts/workspaces.js";

  // 渲染前身份收窄：路由 params zod 已过滤非法值；此处 parse 只做 branded 类型
  // 收窄（shell 的 useParams 注入——$app/state 的 page.params 属 SvelteKit catch-all
  // 承载层，永远不含 shell 路由参数，ws_* 会被静默兜底成 Global，走查实证）。
  const getParams = useParams<{ wsId: string }>();
  const wsId = $derived.by(() => getParams?.()?.wsId);
  const scope = $derived(WorkspaceIdSchema.parse(wsId ?? "~"));
  const scopeLabel = $derived.by(() => {
    const match = workspaceState.workspaces.find((workspace) => workspace.id === scope);
    return match?.label ?? (scope === "~" ? "Global" : scope);
  });

  let filterQuery = $state("");
  let formOpen = $state(false);
  let draftTitle = $state("");
  let draftBody = $state("");
  let appending = $state(false);
  let expanded = $state<
    Record<string, { loading: boolean; error: string | null; read: WikiReadResult | null }>
  >({});
  let headingEl = $state<HTMLHeadingElement | null>(null);

  const filtered = $derived.by(() => {
    const q = filterQuery.trim().toLowerCase();
    if (q === "") return wikiState.patterns;
    return wikiState.patterns.filter(
      (pattern) =>
        pattern.title.toLowerCase().includes(q) || pattern.name.toLowerCase().includes(q),
    );
  });

  $effect(() => {
    void loadWiki(scope);
  });

  // 离开视图时复位（下次进入不携带旧 scope 的投影；蒸馏轮询与代次一并作废）。
  $effect(() => {
    return () => {
      resetWiki();
      resetWikiDistill();
    };
  });

  // 进入 detail 聚焦语义标题（挂载时一次；刷新/追加不重复夺焦）。
  $effect(() => {
    headingEl?.focus();
  });

  async function refresh(): Promise<void> {
    await loadWiki(scope);
  }

  function openForm(): void {
    formOpen = true;
    draftTitle = "";
    draftBody = "";
  }

  async function submitFragment(): Promise<void> {
    const title = draftTitle.trim();
    const body = draftBody;
    if (title === "" || appending) return;
    appending = true;
    try {
      const result = await appendWikiFragment(scope, { title, body });
      if (result === null) return;
      if (result.deduplicated) {
        showToast(`Already captured as “${result.item.title}”.`);
      } else {
        showToast(`Added “${result.item.title}” to the wiki.`);
      }
      formOpen = false;
      draftTitle = "";
      draftBody = "";
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error));
    } finally {
      appending = false;
    }
  }

  async function toggleExpand(pattern: PatternListItem): Promise<void> {
    const current = expanded[pattern.name];
    if (current?.read) {
      delete expanded[pattern.name];
      expanded = { ...expanded };
      return;
    }
    expanded = { ...expanded, [pattern.name]: { loading: true, error: null, read: null } };
    try {
      const read = await readWikiPattern(scope, pattern.name);
      expanded = { ...expanded, [pattern.name]: { loading: false, error: null, read } };
    } catch (error) {
      expanded = {
        ...expanded,
        [pattern.name]: {
          loading: false,
          error: error instanceof Error ? error.message : String(error),
          read: null,
        },
      };
    }
  }

  /* ---------- 蒸馏入口（tasks 1.6；投影与代次纪律在 wiki-distill store） ---------- */

  /** RunState 徽标文案（六态穷尽；无 phase 字段——RunState 即阶段真相）。 */
  const RUN_STATE_LABELS: Record<RunState, string> = {
    collecting: "collecting",
    "kernel-running": "running model",
    "awaiting-approval": "awaiting approval",
    completed: "completed",
    failed: "failed",
    cancelled: "cancelled",
  };

  /** DistillFailReason 的人读文案（仅 failed/cancelled 终态携带；null = 用户主动取消）。 */
  const FAIL_REASON_LABELS: Record<DistillFailReason, string> = {
    "no-valid-proposals": "The model produced no valid proposals, so nothing was generalized.",
    capacity: "The proposal store was at capacity; every proposal was refused.",
    io: "A disk error interrupted the run.",
    timeout: "The model run timed out.",
    "kernel-unavailable": "The agent kernel is unavailable right now.",
    restarted: "The daemon restarted and the run was cancelled.",
    "cancelled-by-shutdown": "The daemon stopped and the run was cancelled.",
  };

  /** counters 摘要的稳定键序（全键枚举的 canonical 顺序）。 */
  const COUNTER_KEYS: ReadonlyArray<keyof DistillCounters> = [
    "applied",
    "idempotent",
    "stale",
    "patch-failed",
    "model-invalid",
    "rejected",
    "expired",
    "not-proposed",
    "io-failed",
  ];

  /** run 进行中（start 阻塞窗口 + runId 已知的非终态窗口）——期间禁用入口按钮。 */
  const distillBusy = $derived(
    wikiDistillState.starting ||
      (wikiDistillState.runId !== null &&
        wikiDistillState.state !== null &&
        !isTerminalWikiDistillState(wikiDistillState.state)),
  );

  /** 蒸馏卡的呈现条件：启动中 / 有 run 投影（终态保留到显式关闭）/ start 拒绝。 */
  const showDistillCard = $derived(
    wikiDistillState.starting || wikiDistillState.runId !== null || wikiDistillState.error !== null,
  );

  /** awaiting-approval 的待决数（pending/applying 不在 counters，从 proposalRefs 取）。 */
  const pendingProposalCount = $derived(
    wikiDistillState.proposalRefs.filter(
      (ref) => ref.status === "pending" || ref.status === "applying",
    ).length,
  );

  const countersSummary = $derived.by(() => {
    const counters = wikiDistillState.counters;
    if (counters === null) return "";
    const parts: string[] = [];
    for (const key of COUNTER_KEYS) {
      const value = counters[key];
      if (value > 0) parts.push(`${key} ${value}`);
    }
    return parts.join(" · ");
  });

  async function beginDistill(): Promise<void> {
    // started → 进度卡接手反馈；rejected（含 DISTILL_ACTIVE_RUN）→ typed 错误面
    // 在卡内呈现（store 已分类，不抛栈）。
    await startWikiDistill(scope);
  }
</script>

<div class="flex h-full flex-col overflow-y-auto p-5">
  <header
    class="flex shrink-0 items-start justify-between gap-3 border-b border-border pb-4 max-[720px]:flex-col max-[720px]:gap-2.5"
  >
    <div class="min-w-0 max-[720px]:w-full">
      <div class="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          class="h-8 w-8 shrink-0 max-[720px]:h-11 max-[720px]:w-11"
          title="Back to wiki scopes"
          aria-label="Back to wiki scopes"
          onclick={() => void goto("/wiki")}
        >
          <IconArrowLeft class="h-4 w-4" />
        </Button>
        <h1
          tabindex="-1"
          bind:this={headingEl}
          class="min-w-0 flex-1 truncate text-lg font-semibold outline-none"
        >
          {scopeLabel} wiki
        </h1>
      </div>
      <p class="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
        {#if scope === "~"}
          <Badge variant="secondary" class="shrink-0">~ global</Badge>
        {:else}
          <Badge variant="secondary" class="shrink-0">workspace</Badge>
        {/if}
        <span class="min-w-0 max-[720px]:truncate">
          Persistent notes for {scopeLabel} — fragments collected here feed skill evolution.
        </span>
      </p>
    </div>
    <div class="flex shrink-0 items-center gap-1.5 max-[720px]:w-full">
      <Button
        variant="ghost"
        size="icon"
        class="h-9 w-9 max-[720px]:h-11 max-[720px]:w-11"
        title="Refresh wiki"
        aria-label="Refresh wiki"
        disabled={wikiState.loading}
        onclick={() => void refresh()}
      >
        {#if wikiState.loading}
          <IconLoader class="h-4 w-4 animate-spin" />
        {:else}
          <IconRefresh class="h-4 w-4" />
        {/if}
      </Button>
      {#if scope !== "~"}
        <Button
          size="sm"
          variant="outline"
          class="max-[720px]:h-11"
          title="Distill this workspace's fragments into the global wiki"
          disabled={distillBusy}
          onclick={() => void beginDistill()}
        >
          <IconSparkles class="h-4 w-4" />
          Distill to global
        </Button>
      {/if}
      <Button size="sm" class="max-[720px]:h-11" onclick={openForm}>
        <IconPlus class="h-4 w-4" />
        Add fragment
      </Button>
    </div>
  </header>

  <div class="mx-auto mt-5 w-full max-w-3xl space-y-4">
    {#if showDistillCard}
      <section
        aria-label="Distill to global"
        class="rounded-lg border border-border bg-background p-4"
      >
        <div class="flex flex-wrap items-center gap-2">
          {#if wikiDistillState.starting}
            <IconLoader class="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
            <span class="min-w-0 flex-1 text-sm font-medium">
              Distilling fragments to the global wiki…
            </span>
          {:else if wikiDistillState.runId === null && wikiDistillState.error !== null}
            <IconAlert class="h-4 w-4 shrink-0 text-destructive" />
            <span class="min-w-0 flex-1 text-sm font-medium text-destructive">
              Couldn't start the distillation
            </span>
          {:else if wikiDistillState.state === "failed"}
            <IconAlert class="h-4 w-4 shrink-0 text-destructive" />
            <span class="min-w-0 flex-1 text-sm font-medium">Distillation failed</span>
          {:else if wikiDistillState.state === "completed"}
            <IconCheck class="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <span class="min-w-0 flex-1 text-sm font-medium">Distillation completed</span>
          {:else if wikiDistillState.state === "cancelled"}
            <span class="min-w-0 flex-1 text-sm font-medium">Distillation cancelled</span>
          {:else if wikiDistillState.state !== null}
            <IconLoader class="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
            <span class="min-w-0 flex-1 text-sm font-medium">Distilling to the global wiki…</span>
          {/if}
          {#if wikiDistillState.state !== null}
            <Badge
              class="shrink-0"
              variant={wikiDistillState.state === "failed"
                ? "destructive"
                : wikiDistillState.state === "awaiting-approval"
                  ? "default"
                  : wikiDistillState.state === "completed" || wikiDistillState.state === "cancelled"
                    ? "outline"
                    : "secondary"}
            >
              {RUN_STATE_LABELS[wikiDistillState.state]}
            </Badge>
          {/if}
        </div>

        <div class="mt-1 min-w-0 space-y-1 text-xs text-muted-foreground">
          {#if wikiDistillState.starting}
            <p>
              Collecting this workspace's fragments and asking the model for generalizations — this
              can take up to two minutes.
            </p>
          {:else if wikiDistillState.runId === null && wikiDistillState.error !== null}
            <p class="break-words text-destructive/90">{wikiDistillState.error}</p>
          {:else if wikiDistillState.state === "awaiting-approval"}
            <p>
              {wikiDistillState.proposalRefs.length}
              {wikiDistillState.proposalRefs.length === 1 ? "proposal" : "proposals"}
              ready for review ({pendingProposalCount} pending). Nothing is written to the global wiki
              until you approve.
            </p>
          {:else if wikiDistillState.state === "failed"}
            {#if wikiDistillState.reason !== null}
              <p>{FAIL_REASON_LABELS[wikiDistillState.reason]}</p>
            {/if}
          {:else if wikiDistillState.state === "cancelled"}
            {#if wikiDistillState.reason !== null}
              <p>{FAIL_REASON_LABELS[wikiDistillState.reason]}</p>
            {:else}
              <p>Cancelled — no proposal was applied.</p>
            {/if}
          {/if}
          {#if countersSummary !== ""}
            <p class="font-mono">{countersSummary}</p>
          {/if}
          {#if wikiDistillState.pollError !== null}
            <p class="break-words text-destructive/90" role="alert">
              Status polling stopped: {wikiDistillState.pollError}
            </p>
          {/if}
        </div>

        <div class="mt-3 flex flex-wrap justify-end gap-2">
          {#if wikiDistillState.state === "awaiting-approval"}
            <Button
              size="sm"
              onclick={() => setWikiDistillProposalsOpen(!wikiDistillProposals.open)}
            >
              {wikiDistillProposals.open ? "Hide proposals" : "View proposals"}
            </Button>
          {/if}
          {#if wikiDistillState.runId !== null && wikiDistillState.state !== null && !isTerminalWikiDistillState(wikiDistillState.state)}
            <Button
              size="sm"
              variant="outline"
              disabled={wikiDistillState.cancelling}
              onclick={() => void cancelWikiDistill()}
            >
              {#if wikiDistillState.cancelling}
                <IconLoader class="h-4 w-4 animate-spin" />
              {/if}
              Cancel run
            </Button>
          {/if}
          {#if !distillBusy}
            <Button
              size="sm"
              variant="ghost"
              class="max-[720px]:h-11"
              onclick={() => resetWikiDistill()}>Dismiss</Button
            >
          {/if}
        </div>

        {#if wikiDistillProposals.open}
          <div class="mt-3 space-y-2 border-t border-border/60 pt-3">
            {#if wikiDistillProposals.loading && wikiDistillProposals.proposals.length === 0}
              <p class="flex items-center gap-2 text-xs text-muted-foreground" role="status">
                <IconLoader class="h-3.5 w-3.5 animate-spin" /> Loading proposals…
              </p>
            {:else if wikiDistillProposals.error !== null}
              <p class="break-words text-xs text-destructive" role="alert">
                {wikiDistillProposals.error}
              </p>
            {:else if wikiDistillProposals.proposals.length === 0}
              <p class="text-xs text-muted-foreground">No proposals found for this run.</p>
            {/if}
            {#each wikiDistillProposals.proposals as row (row.view.proposalId)}
              <AgentProposalCard
                proposalId={row.view.proposalId}
                capability={row.view.capability}
                input={row.view.input}
                status={row.view.status}
              />
            {/each}
          </div>
        {/if}
      </section>
    {/if}

    {#if formOpen}
      <section
        aria-label="Add a fragment"
        class="rounded-lg border border-border bg-background p-4"
      >
        <div class="flex items-center justify-between gap-2">
          <h2 class="text-sm font-medium">New fragment</h2>
          <Button
            variant="ghost"
            size="icon"
            class="h-8 w-8"
            title="Cancel"
            aria-label="Cancel adding a fragment"
            onclick={() => (formOpen = false)}
          >
            <IconX class="h-4 w-4" />
          </Button>
        </div>
        <div class="mt-3 space-y-3">
          <label class="block space-y-1.5">
            <span class="text-xs font-medium text-muted-foreground">Title</span>
            <Input
              bind:value={draftTitle}
              placeholder="One-line insight, e.g. Pin exit codes"
              maxlength={120}
            />
          </label>
          <label class="block space-y-1.5">
            <span class="text-xs font-medium text-muted-foreground">Note</span>
            <Textarea
              bind:value={draftBody}
              rows={4}
              placeholder="What should the agent remember next time?"
            />
          </label>
          <div class="flex justify-end gap-2">
            <Button variant="outline" size="sm" onclick={() => (formOpen = false)}>Cancel</Button>
            <Button
              size="sm"
              disabled={draftTitle.trim() === "" || appending}
              onclick={() => void submitFragment()}
            >
              {#if appending}
                <IconLoader class="h-4 w-4 animate-spin" />
              {/if}
              Add to wiki
            </Button>
          </div>
        </div>
      </section>
    {/if}

    {#if wikiState.error}
      <div
        class="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4"
        role="alert"
      >
        <IconAlert class="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
        <div class="min-w-0 flex-1">
          <p class="text-sm font-medium text-destructive">Couldn't load the wiki</p>
          <p class="mt-1 break-words text-xs text-destructive/90">{wikiState.error}</p>
        </div>
        <Button variant="outline" size="sm" onclick={() => void refresh()}>Retry</Button>
      </div>
    {:else if wikiState.loading && wikiState.patterns.length === 0}
      <div class="space-y-3" aria-label="Loading wiki">
        <div class="h-16 animate-pulse rounded-lg border border-border bg-muted/50"></div>
        <div class="h-16 animate-pulse rounded-lg border border-border bg-muted/50"></div>
      </div>
    {:else if wikiState.patterns.length === 0}
      <div class="rounded-lg border border-dashed border-border p-8 text-center">
        <IconBookOpen class="mx-auto h-8 w-8 text-muted-foreground" />
        <p class="mt-3 text-sm font-medium">No fragments yet</p>
        <p class="mt-1 text-xs text-muted-foreground">
          Capture recurring insights here; they become the input for skill evolution.
        </p>
        <Button class="mt-4" size="sm" onclick={openForm}>
          <IconPlus class="h-4 w-4" />
          Add the first fragment
        </Button>
      </div>
    {:else}
      {#if wikiState.patterns.length > 0}
        <Input
          bind:value={filterQuery}
          placeholder="Filter fragments…"
          aria-label="Filter wiki fragments"
        />
      {/if}
      <ul class="divide-y divide-border rounded-lg border border-border">
        {#each filtered as pattern (pattern.name)}
          {@const state = expanded[pattern.name]}
          <li>
            <button
              class="flex min-h-11 w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-muted/50"
              onclick={() => void toggleExpand(pattern)}
              aria-expanded={state?.read !== null && state !== undefined}
            >
              <span class="min-w-0 flex-1">
                <span class="block truncate text-sm font-medium">{pattern.title}</span>
                <span class="block truncate font-mono text-xs text-muted-foreground">
                  {pattern.name}
                </span>
              </span>
              {#if pattern.promotedFrom}
                <Badge variant="outline" class="shrink-0 text-xs">promoted</Badge>
              {/if}
              <span class="shrink-0 text-xs text-muted-foreground"
                >{pattern.updated.slice(0, 10)}</span
              >
            </button>
            {#if state}
              <div class="border-t border-border/60 px-3 py-2.5">
                {#if state.loading}
                  <p class="flex items-center gap-2 text-xs text-muted-foreground" role="status">
                    <IconLoader class="h-3.5 w-3.5 animate-spin" /> Loading…
                  </p>
                {:else if state.error}
                  <p class="text-xs text-destructive" role="alert">{state.error}</p>
                {:else if state.read}
                  <pre
                    class="max-h-72 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-muted/40 p-3 text-xs leading-relaxed">{state.read.body.trim()}</pre>
                {/if}
              </div>
            {/if}
          </li>
        {:else}
          <li class="px-3 py-6 text-center text-xs text-muted-foreground">
            No fragments match “{filterQuery.trim()}”.
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</div>
