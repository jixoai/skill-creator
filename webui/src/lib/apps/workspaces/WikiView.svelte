<!--
  用户原始需求 [2026-09-21]：「P1 本质上是在收集一些碎片的认知，这和 skill-wiki
  是有一些重叠的，是 skill-wiki 输入的一部分」——wiki 通道是碎片认知的收集面。
  正交意图：
  1. 双级 scope 的 pattern 列表（前端过滤 + 惰性展开正文）。
  2. 碎片追加表单（幂等提交：deduplicated 有独立反馈；失败 toast 可区分）。
  3. 加载 / 空 / 错误三态可区分；窄屏单列。
-->
<script lang="ts">
  import { page } from "$app/state";
  import { goto } from "$app/navigation";
  import {
    appendWikiFragment,
    loadWiki,
    readWikiPattern,
    resetWiki,
    wikiState,
  } from "$lib/stores/wiki.svelte";
  import { workspaceState } from "$lib/store.svelte";
  import { showToast } from "$lib/toast.svelte";
  import { Button } from "$lib/components/ui/button";
  import { Badge } from "$lib/components/ui/badge";
  import { Input } from "$lib/components/ui/input";
  import { Textarea } from "$lib/components/ui/textarea";
  import IconArrowLeft from "@lucide/svelte/icons/arrow-left";
  import IconBookOpen from "@lucide/svelte/icons/book-open";
  import IconPlus from "@lucide/svelte/icons/plus";
  import IconRefresh from "@lucide/svelte/icons/refresh-cw";
  import IconLoader from "@lucide/svelte/icons/loader-circle";
  import IconAlert from "@lucide/svelte/icons/triangle-alert";
  import IconX from "@lucide/svelte/icons/x";
  import type { PatternListItem, WikiReadResult } from "$lib/types";
  import { WorkspaceIdSchema } from "$shared/contracts/workspaces.js";

  // 渲染前身份收窄：路由 params zod 已过滤非法值；此处 parse 只做 branded 类型
  // 收窄（page.params 原始投影是 string）。
  const { wsId } = $derived(page.params as { wsId?: string });
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

  // 离开视图时复位（下次进入不携带旧 scope 的投影）。
  $effect(() => {
    return () => resetWiki();
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
</script>

<div class="flex h-full flex-col overflow-y-auto p-5">
  <header class="flex shrink-0 items-start justify-between gap-3 border-b border-border pb-4">
    <div class="min-w-0">
      <div class="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          class="h-8 w-8 shrink-0"
          title="Back to workspaces"
          aria-label="Back to workspaces"
          onclick={() => void goto("/workspaces")}
        >
          <IconArrowLeft class="h-4 w-4" />
        </Button>
        <h1 class="truncate text-lg font-semibold">Wiki</h1>
        {#if scope === "~"}
          <Badge variant="secondary" class="text-xs">~ global</Badge>
        {:else}
          <Badge variant="secondary" class="text-xs">workspace</Badge>
        {/if}
      </div>
      <p class="mt-0.5 text-xs text-muted-foreground">
        Persistent notes for {scopeLabel} — fragments collected here feed skill evolution.
      </p>
    </div>
    <div class="flex shrink-0 items-center gap-1.5">
      <Button
        variant="ghost"
        size="icon"
        class="h-9 w-9"
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
      <Button size="sm" onclick={openForm}>
        <IconPlus class="h-4 w-4" />
        Add fragment
      </Button>
    </div>
  </header>

  <div class="mx-auto mt-5 w-full max-w-3xl space-y-4">
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
