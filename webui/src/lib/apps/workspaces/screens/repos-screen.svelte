<!--
  用户原始需求 [2026-07-27]（RepositoryHome 迁入 dashboard，skills-dashboard
  design §4）：「Repository home Tab 呈现 Discover 体验：搜索 + 精选源卡片 +
  用户源 + 最近扫描。」
  迁移修订 [2026-10-03]（skills-dashboard 1.5）：路由迁 /w/:wsId/skills?screen=repos
  （源过滤参数 reposQ，与主屏技能搜索 q 分道）；Scan 实例 → 子路由
  /w/:wsId/skills/repos/scan/:sourceId；文案出生即 i18n（C 类面）。
  正交意图：
  1. 卡片数据来自 repository.sources.list RPC（不缓存跨渲染周期、不写 localStorage）。
  2. 搜索纯客户端过滤；未提交文本是组件局部 $state，提交后走 URL ?reposQ=。
  3. 点源卡片 Scan → 打开 scan 实例子路由（RepositoryScan 用 sourceId 反查 gitUrl）。
-->
<script lang="ts">
  import { goto } from "$app/navigation";
  import { useSearch, goById } from "$lib/shell";
  import SourceCard from "$lib/components/source-card.svelte";
  import ConfirmDialog from "$lib/components/confirm-dialog.svelte";
  import ErrorHint from "$lib/components/error-hint.svelte";
  import { showErrorToast, showToast } from "$lib/toast.svelte";
  import { requireRpc } from "$lib/stores/connection.svelte";
  import { t } from "$lib/i18n";
  import {
    addSource,
    loadSources,
    removeSource,
    repositorySourcesState,
  } from "$lib/stores/repository-sources.svelte";
  import { getScanSummary, isScanSummaryStale } from "$lib/stores/scan-summary.svelte";
  import type { WorkspaceId } from "$shared/contracts/workspaces.js";

  type DashboardSearch = {
    screen?: "skills" | "agents" | "repos";
    provider?: string;
    q?: string;
    reposQ?: string;
    skill?: string;
    view?: "list" | "detail";
    duplicates?: "1";
  };

  let { wsId }: { wsId: WorkspaceId } = $props();

  const getSearch = useSearch<DashboardSearch>();
  const search = $derived(getSearch?.() ?? {});

  // 已提交的源过滤来自 URL（刷新可恢复）；与主屏技能搜索 q 互不干扰。
  const committedQuery = $derived(search.reposQ?.trim() ?? "");

  // 未提交的输入文本是瞬时 UI（组件局部 $state）；与 URL 后退/前进同步。
  let draft = $state("");
  $effect(() => {
    draft = committedQuery;
  });

  // screen 渲染时按需拉取源列表（不缓存跨渲染周期、不写 localStorage）。
  $effect(() => {
    void loadSources();
  });

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

  // 新增自定义源表单（瞬时 $state；提交经 RPC；https-only 由 server 契约裁决）。
  let adding = $state(false);
  let newLabel = $state("");
  let newUrl = $state("");
  let newDescription = $state("");
  let addError = $state<string | null>(null);
  let addBusy = $state(false);

  function setRepoSearch(value: string, mode: "REPLACE" | "PUSH"): void {
    goById(
      "workspaces.provider",
      { wsId },
      { ...search, screen: "repos", reposQ: value.trim() || undefined },
      mode,
    );
  }

  function openScan(sourceId: string): void {
    // 通过 sourceId 进入扫描实例；RepositoryScan 用 sourceId 反查 gitUrl 触发首扫。
    void goto(`/w/${wsId}/skills/repos/scan/${encodeURIComponent(sourceId)}`);
  }

  /** Open repo（Owner 2026-10-05）：经 daemon ext-opener 以系统默认浏览器打开
   * 源仓库页（https 闸 server-owned；headless 自带 spawn 降级）。 */
  async function openRepoHomepage(homepage: string): Promise<void> {
    try {
      await requireRpc().daemon.openExternal({ url: homepage });
    } catch (error) {
      showErrorToast(error instanceof Error ? error.message : String(error));
    }
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
      addError = t("reposScreen.addRequired");
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

  // 移除用户源：confirm 对话框 + busy 锁 + toast 终态（失败不再静默）。
  let removingSource = $state<{ id: string; label: string } | null>(null);
  let removeOpen = $state(false);
  let removeBusy = $state(false);

  function requestRemove(id: string, label: string): void {
    removingSource = { id, label };
    removeOpen = true;
  }

  $effect(() => {
    if (!removeOpen) removingSource = null;
  });

  async function confirmRemove(): Promise<void> {
    const source = removingSource;
    if (!source) return;
    removeBusy = true;
    try {
      const removed = await removeSource(source.id);
      if (removed) {
        removeOpen = false;
        showToast(t("reposScreen.removedSource", { label: source.label }));
      }
    } catch (error) {
      showErrorToast(error instanceof Error ? error.message : String(error));
    } finally {
      removeBusy = false;
    }
  }
</script>

<section class="screen" data-screen="repos" aria-label={t("reposScreen.aria")}>
  <header class="shrink-0 border-b border-border px-4 py-3">
    <div class="flex min-w-0 items-center gap-2">
      <h2 class="min-w-0 truncate text-sm font-semibold">{t("reposScreen.title")}</h2>
      <div class="ml-auto">
        <button
          type="button"
          onclick={openAdd}
          class="inline-flex h-7 shrink-0 items-center rounded-md border border-border px-2.5 text-xs font-medium transition-colors hover:bg-muted/50"
        >
          {t("reposScreen.addSource")}
        </button>
      </div>
    </div>
    <p class="mt-0.5 text-xs text-muted-foreground">{t("reposScreen.subtitle")}</p>
    <input
      type="search"
      bind:value={draft}
      oninput={(event) => setRepoSearch(draft, "REPLACE")}
      onkeydown={(event) => {
        if (event.key === "Enter") setRepoSearch(draft, "PUSH");
      }}
      placeholder={t("reposScreen.filterPlaceholder")}
      class="mt-2 h-7 w-full min-w-0 rounded-md border border-border bg-background px-3 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={t("reposScreen.filterAria")}
    />
  </header>
  <div class="screen-body px-3 py-3">
    <section class="space-y-2.5" aria-label={t("reposScreen.discoverAria")}>
      {#if repositorySourcesState.loading}
        <p class="py-6 text-center text-xs text-muted-foreground">
          {t("reposScreen.loadingSources")}
        </p>
      {:else if repositorySourcesState.error}
        <div class="py-6 text-center text-xs text-destructive">
          <ErrorHint error={repositorySourcesState.error} />
        </div>
      {:else if filteredSources.length === 0}
        <p class="py-6 text-center text-xs text-muted-foreground">
          {t("reposScreen.noSources", { query: committedQuery })}
        </p>
      {:else}
        <div class="grid grid-cols-1 gap-2.5">
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
              onopenrepo={() => void openRepoHomepage(source.homepage!)}
              onremove={source.builtIn ? undefined : () => requestRemove(source.id, source.label)}
            />
          {/each}
        </div>
      {/if}
    </section>

    {#if recentScans.length > 0}
      <!-- 分组标题化（批评处置 P2）：screen 面板自身已是卡——外层再包
           border/bg 盒即双层卡中卡；降为纯分组标题 + 行 hover，视觉单层。 -->
      <section class="mt-4" aria-label={t("reposScreen.recentScans")}>
        <h3 class="px-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {t("reposScreen.recentScans")}
        </h3>
        <ul class="mt-1 space-y-0.5">
          {#each recentScans as recent (recent.id)}
            <li>
              <button
                type="button"
                onclick={() => openScan(recent.id)}
                class="flex min-h-9 w-full items-center justify-between rounded px-2 py-1 text-left text-xs transition-colors hover:bg-muted/60"
              >
                <span class="truncate font-medium text-foreground">{recent.label}</span>
                <span class="ml-2 shrink-0 text-muted-foreground tabular-nums">
                  {t("reposScreen.scanCount", { count: recent.summary?.skillCount ?? 0 })}
                </span>
              </button>
            </li>
          {/each}
        </ul>
      </section>
    {/if}
  </div>
</section>

{#if adding}
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
    <div class="w-full max-w-md rounded-lg border border-border bg-background p-4 shadow-lg">
      <h2 class="text-sm font-semibold">{t("reposScreen.addTitle")}</h2>
      <p class="mt-0.5 text-xs text-muted-foreground">{t("reposScreen.addBody")}</p>
      <div class="mt-3 space-y-2">
        <label class="block text-xs">
          <span class="text-muted-foreground">{t("reposScreen.addLabel")}</span>
          <input
            bind:value={newLabel}
            class="mt-1 h-8 w-full rounded-md border border-border bg-background px-2 text-sm"
            placeholder={t("reposScreen.addLabelPlaceholder")}
          />
        </label>
        <label class="block text-xs">
          <span class="text-muted-foreground">{t("reposScreen.addUrl")}</span>
          <input
            bind:value={newUrl}
            class="mt-1 h-8 w-full rounded-md border border-border bg-background px-2 font-mono text-xs"
            placeholder="https://github.com/me/skills.git"
          />
        </label>
        <label class="block text-xs">
          <span class="text-muted-foreground">{t("reposScreen.addDescription")}</span>
          <input
            bind:value={newDescription}
            class="mt-1 h-8 w-full rounded-md border border-border bg-background px-2 text-sm"
            placeholder={t("reposScreen.addDescriptionPlaceholder")}
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
          class="h-9 rounded-md border border-border px-3 text-xs hover:bg-muted/50"
        >
          {t("common.cancel")}
        </button>
        <button
          type="button"
          onclick={() => void submitAdd()}
          disabled={addBusy}
          class="h-9 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {addBusy ? t("reposScreen.adding") : t("reposScreen.addConfirm")}
        </button>
      </div>
    </div>
  </div>
{/if}

<ConfirmDialog
  bind:open={removeOpen}
  title={t("reposScreen.removeTitle")}
  description={removingSource ? t("reposScreen.removeBody", { label: removingSource.label }) : ""}
  confirmLabel={t("reposScreen.removeConfirm")}
  busy={removeBusy}
  onConfirm={() => void confirmRemove()}
/>
