<!--
  右栏 tab overview 搜索面板（skills-agent-page-zcode-parity 3.1）。
  用户原始需求 [2026-10-04]（design §3）：「通过 tab overview 搜索、查看最近关闭
  并恢复」。
  正交意图：
    [1] 搜索 + 排序：标题/资源键/类型标签三域打分（panel-tabs.ts 移植
        sidePaneTabSearch.ts 的 120/90/70/40/20/1 档），多词 AND、稳定名次。
    [2] 分组：Open tabs（行内关闭）/ Recently closed（点击重开）；空结果显示
        noResults。
    [3] 相对时间标签（打开于/关闭于；打开期间 60s 重算——ZCode SidePaneTabOverview
        同款节拍）。
  妥协声明：ZCode 用 cmdk（Command 键盘导航）+ Radix Popover；本仓无 popover 原语，
  等价自绘（输入框 + 列表 + 外点/Escape 关闭；行内键盘导航后置——差异裁决记录于
  change 报告）。
  ZCode 引用：app-shell/SidePaneTabOverview.tsx:29。
-->
<script lang="ts">
  import IconChevronsDown from "@lucide/svelte/icons/chevrons-down";
  import IconX from "@lucide/svelte/icons/x";
  import { panelTabIcon } from "./panel-tab-icon.js";
  import {
    buildPanelTabSearchFields,
    filterAndRankPanelTabSearchItems,
    formatPanelTabRelativeTime,
    getPanelTabSearchHint,
    getPanelTabTitle,
    getPanelTabTypeLabel,
    normalizePanelTabSearchQuery,
    type ExtensionPanelTab,
    type RecentClosedPanelTab,
  } from "./panel-tabs.js";

  let {
    tabs,
    activeTabId,
    recentClosedTabs,
    onActivateTab,
    onCloseTab,
    onReopenClosedTab,
  }: {
    tabs: ExtensionPanelTab[];
    activeTabId: string;
    recentClosedTabs: RecentClosedPanelTab[];
    onActivateTab: (tabId: string) => void;
    onCloseTab: (tabId: string) => void;
    onReopenClosedTab: (tabId: string) => void;
  } = $props();

  let open = $state(false);
  let query = $state("");
  let containerEl = $state<HTMLElement | null>(null);
  let inputEl = $state<HTMLInputElement | null>(null);
  let now = $state(Date.now());

  $effect(() => {
    if (!open) return;
    inputEl?.focus();
    const interval = setInterval(() => {
      now = Date.now();
    }, 60_000);
    return () => clearInterval(interval);
  });

  function close(): void {
    open = false;
    query = "";
  }

  function onWindowPointerDown(event: PointerEvent): void {
    if (!open) return;
    if (
      containerEl !== null &&
      event.target instanceof Node &&
      !containerEl.contains(event.target)
    ) {
      close();
    }
  }

  interface OverviewRow {
    id: string;
    tab: ExtensionPanelTab;
    title: string;
    timeLabel: string;
    searchFields: ReturnType<typeof buildPanelTabSearchFields>;
  }

  const openRows = $derived.by(() => {
    const rows: OverviewRow[] = tabs.map((tab) => ({
      id: tab.id,
      tab,
      title: getPanelTabTitle(tab),
      timeLabel: formatPanelTabRelativeTime(tab.openedAt, now),
      searchFields: buildPanelTabSearchFields(
        getPanelTabTitle(tab),
        getPanelTabSearchHint(tab),
        getPanelTabTypeLabel(tab),
      ),
    }));
    return filterAndRankPanelTabSearchItems(rows, normalizePanelTabSearchQuery(query));
  });

  const recentRows = $derived.by(() => {
    const rows: OverviewRow[] = recentClosedTabs.map((item) => ({
      id: item.tab.id,
      tab: item.tab,
      title: getPanelTabTitle(item.tab),
      timeLabel: formatPanelTabRelativeTime(item.closedAt, now),
      searchFields: buildPanelTabSearchFields(
        getPanelTabTitle(item.tab),
        getPanelTabSearchHint(item.tab),
        getPanelTabTypeLabel(item.tab),
      ),
    }));
    return filterAndRankPanelTabSearchItems(rows, normalizePanelTabSearchQuery(query));
  });

  const hasAnyResult = $derived(openRows.length > 0 || recentRows.length > 0);

  /** 输入框 Enter = 激活榜首（open 优先，其次最近关闭重开）。 */
  function onInputKeydown(event: KeyboardEvent): void {
    if (event.key !== "Enter" && event.key !== "Escape") return;
    event.preventDefault();
    if (event.key === "Escape") {
      close();
      return;
    }
    if (openRows.length > 0) {
      onActivateTab(openRows[0].id);
      close();
    } else if (recentRows.length > 0) {
      onReopenClosedTab(recentRows[0].id);
      close();
    }
  }
</script>

<svelte:window onpointerdown={onWindowPointerDown} />

<div bind:this={containerEl} class="relative flex h-full items-center">
  <button
    type="button"
    class="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
    aria-label="Search tabs"
    aria-expanded={open}
    aria-haspopup="dialog"
    onclick={() => (open = !open)}
  >
    <IconChevronsDown class="h-3.5 w-3.5" aria-hidden="true" />
  </button>
  {#if open}
    <div
      class="absolute top-full left-0 z-50 mt-1 flex w-72 flex-col gap-0 overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-md"
      role="dialog"
      aria-label="Search tabs"
    >
      <div class="border-b border-border p-1.5">
        <input
          bind:this={inputEl}
          bind:value={query}
          type="text"
          class="h-7 w-full rounded-sm bg-transparent px-1.5 text-[11px] outline-none placeholder:text-muted-foreground"
          placeholder="Search tabs"
          onkeydown={onInputKeydown}
        />
      </div>
      <div class="max-h-80 overflow-y-auto p-1">
        {#if !hasAnyResult}
          <p class="px-2 py-4 text-center text-[11px] text-muted-foreground">No tabs found</p>
        {:else}
          {#if openRows.length > 0}
            <p class="px-2 pt-1.5 pb-1 text-[10px] font-medium text-muted-foreground">Open tabs</p>
            {#each openRows as row (row.id)}
              {@const Icon = panelTabIcon(row.tab.type)}
              <div
                class="flex min-h-8 items-center gap-2 rounded px-2 text-[11px] {row.id ===
                activeTabId
                  ? 'bg-muted'
                  : 'hover:bg-accent'}"
              >
                <button
                  type="button"
                  class="flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-none"
                  onclick={() => {
                    onActivateTab(row.id);
                    close();
                  }}
                >
                  <Icon class="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span class="min-w-0 flex-1 truncate font-medium">{row.title}</span>
                  <span class="shrink-0 text-muted-foreground">{row.timeLabel}</span>
                </button>
                <button
                  type="button"
                  class="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-70 transition-opacity hover:bg-muted hover:text-foreground hover:opacity-100 focus-visible:opacity-100"
                  aria-label="Close {row.title}"
                  onclick={(event) => {
                    event.stopPropagation();
                    onCloseTab(row.id);
                  }}
                >
                  <IconX class="h-3 w-3" aria-hidden="true" />
                </button>
              </div>
            {/each}
          {/if}
          {#if recentRows.length > 0}
            <p class="px-2 pt-2 pb-1 text-[10px] font-medium text-muted-foreground">
              Recently closed
            </p>
            {#each recentRows as row (row.id)}
              {@const Icon = panelTabIcon(row.tab.type)}
              <button
                type="button"
                class="flex min-h-8 w-full items-center gap-2 rounded px-2 text-left text-[11px] hover:bg-accent focus-visible:outline-none"
                onclick={() => {
                  onReopenClosedTab(row.id);
                  close();
                }}
              >
                <Icon class="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span class="min-w-0 flex-1 truncate font-medium">{row.title}</span>
                <span class="shrink-0 text-muted-foreground">{row.timeLabel}</span>
              </button>
            {/each}
          {/if}
        {/if}
      </div>
    </div>
  {/if}
</div>
