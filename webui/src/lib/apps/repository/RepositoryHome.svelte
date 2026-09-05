<!--
  用户原始需求 [2026-07-27]：「Repository home Tab 呈现 Discover 体验：搜索 + 精选源卡片 + 用户源 + 最近扫描。」
  正交意图：
    1. 卡片数据来自 repository.sources.list RPC（不缓存跨渲染周期、不写 localStorage）。
    2. 搜索纯客户端过滤；未提交文本是组件局部 $state，提交后走 URL search ?q=。
    3. 点源卡片 Scan → 打开 /repository/scan/<sourceId> 实例 Tab。
  妥协声明：home 与 scan 共用一个 entry activity AppShell（Shell 当前每 App 渲染一个 entry）。
-->
<script lang="ts">
  import { goto } from "$app/navigation";
  import SourceCard from "$lib/components/source-card.svelte";
  import { useSearch } from "$lib/shell";
  import {
    addSource,
    loadSources,
    removeSource,
    repositorySourcesState,
  } from "$lib/stores/repository-sources.svelte";
  import {
    getScanSummary,
    isScanSummaryStale,
    recordScanSummary,
  } from "$lib/stores/scan-summary.svelte";

  const getSearch = useSearch<{ q?: string }>();

  // 已提交的搜索过滤来自 URL（视图状态真相源，刷新可恢复）。
  const committedQuery = $derived(getSearch?.()?.q?.trim() ?? "");

  // 未提交的输入文本是瞬时 UI（组件局部 $state）；与 URL 后退/前进同步。
  let draft = $state("");
  $effect(() => {
    draft = committedQuery;
  });

  // home Tab 渲染时按需拉取源列表（不缓存跨渲染周期、不写 localStorage）。
  $effect(() => {
    void loadSources();
  });

  // 卡片合并视图：curated ∪ user。
  const sources = $derived([
    ...repositorySourcesState.builtIn.map((entry) => ({
      id: entry.id,
      label: entry.label,
      description: entry.description,
      gitUrl: entry.gitUrl,
      homepage: entry.homepage,
      builtIn: true,
    })),
    ...repositorySourcesState.user.map((entry) => ({
      id: entry.id,
      label: entry.label,
      description: entry.description,
      gitUrl: entry.gitUrl,
      homepage: undefined,
      builtIn: false,
    })),
  ]);

  // 纯客户端过滤（不跨源检索技能正文）。
  const filteredSources = $derived.by(() => {
    const q = committedQuery.toLowerCase();
    if (!q) return sources;
    return sources.filter(
      (s) => s.label.toLowerCase().includes(q) || s.description.toLowerCase().includes(q),
    );
  });

  // 最近扫描（当前会话作用域）：从扫描摘要缓存派生，按时间倒序。
  const recentScans = $derived.by(() => {
    const items: { id: string; label: string; summary: ReturnType<typeof getScanSummary> }[] = [];
    for (const source of sources) {
      const summary = getScanSummary(source.id);
      if (summary) items.push({ id: source.id, label: source.label, summary });
    }
    items.sort((a, b) => (b.summary?.scannedAt ?? 0) - (a.summary?.scannedAt ?? 0));
    return items.slice(0, 5);
  });

  // 新增自定义源表单（瞬时 $state；提交经 RPC）。
  let adding = $state(false);
  let newLabel = $state("");
  let newUrl = $state("");
  let newDescription = $state("");
  let addError = $state<string | null>(null);
  let addBusy = $state(false);

  function commitQuery(next: string): void {
    const trimmed = next.trim();
    const search = trimmed ? `?q=${encodeURIComponent(trimmed)}` : "";
    const target = `/repository${search}`;
    // REPLACE 避免每次按键都堆积历史；提交（blur/Enter）时用 PUSH。
    void goto(target, { replaceState: true });
  }

  function submitQuery(): void {
    const trimmed = draft.trim();
    const search = trimmed ? `?q=${encodeURIComponent(trimmed)}` : "";
    void goto(`/repository${search}`);
  }

  function openScan(sourceId: string): void {
    // 通过 sourceId 进入扫描实例；RepositoryScan 用 sourceId 反查 gitUrl 触发首扫。
    void goto(`/repository/scan/${encodeURIComponent(sourceId)}`);
  }

  function openAdd(): void {
    adding = true;
    newLabel = "";
    newUrl = "";
    newDescription = "";
    addError = null;
  }

  async function submitAdd(): Promise<void> {
    const label = newLabel.trim();
    const gitUrl = newUrl.trim();
    if (!label || !gitUrl) {
      addError = "Label and Git URL are required.";
      return;
    }
    addBusy = true;
    addError = null;
    try {
      const added = await addSource({
        label,
        gitUrl,
        description: newDescription.trim() || undefined,
      });
      if (added) {
        adding = false;
      }
    } catch (error) {
      addError = error instanceof Error ? error.message : String(error);
    } finally {
      addBusy = false;
    }
  }

  async function handleRemove(sourceId: string, label: string): Promise<void> {
    if (!confirm(`Remove custom source "${label}"?`)) return;
    try {
      await removeSource(sourceId);
    } catch (error) {
      // 错误已由 store 投影；这里仅吞掉导航副作用。
      console.error(error);
    }
  }
</script>

<div class="flex h-full flex-col overflow-y-auto p-5">
  <header class="flex shrink-0 items-center gap-3 border-b border-border pb-4">
    <div class="min-w-0 flex-1">
      <h1 class="text-lg font-semibold">Discover skills</h1>
      <p class="mt-0.5 text-xs text-muted-foreground">
        Browse curated and custom skill repositories, then scan to install.
      </p>
    </div>
    <button
      type="button"
      onclick={openAdd}
      class="inline-flex h-8 shrink-0 items-center rounded-md border border-border px-3 text-xs font-medium transition-colors hover:bg-muted/50"
    >
      Add source
    </button>
  </header>

  <div class="mx-auto mt-4 w-full max-w-4xl flex-1 space-y-4">
    <div class="flex items-center gap-2">
      <input
        type="search"
        bind:value={draft}
        oninput={() => commitQuery(draft)}
        onkeydown={(event) => {
          if (event.key === "Enter") submitQuery();
        }}
        placeholder="Filter sources by name or description…"
        class="h-9 w-full rounded-md border border-border bg-background px-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="Filter sources"
      />
    </div>

    {#if repositorySourcesState.loading}
      <p class="py-8 text-center text-xs text-muted-foreground">Loading sources…</p>
    {:else if repositorySourcesState.error}
      <p class="py-8 text-center text-xs text-destructive">{repositorySourcesState.error}</p>
    {:else if filteredSources.length === 0}
      <p class="py-8 text-center text-xs text-muted-foreground">
        No sources match “{committedQuery}”.
      </p>
    {:else}
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {#each filteredSources as source (source.id)}
          <SourceCard
            label={source.label}
            description={source.description}
            gitUrl={source.gitUrl}
            homepage={source.homepage}
            builtIn={source.builtIn}
            scanSummary={getScanSummary(source.id)}
            stale={isScanSummaryStale(getScanSummary(source.id))}
            onscan={() => openScan(source.id)}
            onremove={source.builtIn ? undefined : () => handleRemove(source.id, source.label)}
          />
        {/each}
      </div>
    {/if}

    {#if recentScans.length > 0}
      <section class="rounded-lg border border-border bg-muted/20 p-3">
        <h2 class="text-xs font-medium text-muted-foreground">Recent scans</h2>
        <ul class="mt-2 space-y-1">
          {#each recentScans as recent (recent.id)}
            <li>
              <button
                type="button"
                onclick={() => openScan(recent.id)}
                class="flex w-full items-center justify-between rounded px-2 py-1 text-left text-xs transition-colors hover:bg-muted/60"
              >
                <span class="truncate font-medium text-foreground">{recent.label}</span>
                <span class="ml-2 shrink-0 text-muted-foreground">
                  {recent.summary?.skillCount ?? 0} skills
                </span>
              </button>
            </li>
          {/each}
        </ul>
      </section>
    {/if}
  </div>
</div>

{#if adding}
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
    <div class="w-full max-w-md rounded-lg border border-border bg-background p-4 shadow-lg">
      <h2 class="text-sm font-semibold">Add custom source</h2>
      <p class="mt-0.5 text-xs text-muted-foreground">
        Paste an <code class="font-mono">https</code> Git URL. It persists across restarts.
      </p>
      <div class="mt-3 space-y-2">
        <label class="block text-xs">
          <span class="text-muted-foreground">Label</span>
          <input
            bind:value={newLabel}
            class="mt-1 h-8 w-full rounded-md border border-border bg-background px-2 text-sm"
            placeholder="My skills repo"
          />
        </label>
        <label class="block text-xs">
          <span class="text-muted-foreground">Git URL (https only)</span>
          <input
            bind:value={newUrl}
            class="mt-1 h-8 w-full rounded-md border border-border bg-background px-2 font-mono text-xs"
            placeholder="https://github.com/me/skills.git"
          />
        </label>
        <label class="block text-xs">
          <span class="text-muted-foreground">Description (optional)</span>
          <input
            bind:value={newDescription}
            class="mt-1 h-8 w-full rounded-md border border-border bg-background px-2 text-sm"
            placeholder="What kind of skills?"
          />
        </label>
        {#if addError}
          <p class="text-xs text-destructive">{addError}</p>
        {/if}
      </div>
      <div class="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onclick={() => (adding = false)}
          class="h-8 rounded-md border border-border px-3 text-xs hover:bg-muted/50"
        >
          Cancel
        </button>
        <button
          type="button"
          onclick={submitAdd}
          disabled={addBusy}
          class="h-8 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {addBusy ? "Adding…" : "Add"}
        </button>
      </div>
    </div>
  </div>
{/if}
