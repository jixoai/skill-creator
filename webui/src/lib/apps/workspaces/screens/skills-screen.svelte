<!--
  用户原始需求 [2026-10-02]（skills-dashboard design §2）：「直接展示所有的 skill
  ……跨 provider 平铺列表 + skills.search 全文搜索 + provider 筛选 chip +
  duplicates 标记」。
  修订 [2026-10-06]（skills-tabs-redesign 批 2，design.md Δ1/Δ3 定稿）：数据面
  切换 skills.listCanonical 唯一 name 分组投影——「Skills 默认不得出现重复
  skill-name」（Owner 落地注意 2）：默认一行一组 + ×N 副本徽标 + 两量纲计数明示
  （技能组/安装副本，禁止单数字推导）；chips/搜索/启停作用于组代表；行点击进入
  SkillDetail 独立路由（?from= 携带列表态，回程经状态对象重组）；master-detail
  耦合面板退役（detail 归独立路由页）。
  正交意图：
  1. 分组列表数据面：skills.listCanonical（q 组级预过滤 + nextCursor load-more），
     store 纪律 = latest-request-wins + 连接代次门（dashboard-canonical store）。
  2. 筛选与计数投影（ε 线计数收敛）：provider chips（组代表口径 facet 计数；
     All 不带数）+ duplicates-only 开关（组内同内容 ≥2 副本）+ header 主显两量纲
     （groupCount/copyCount 服务端全量；可见组数 < 总量才叠加「显示 N / 共 M」
     窗口式表达）。
  3. skills.search 补全式搜索：非空 q 去抖触发 BM25 检索，命中投影到当前 ws
     作用域；q 包含式未覆盖的模糊命中以补全条呈现（点击落位或改写 q）。
  4. 虚拟化窗口：>200 行时简单窗口化（computeDashboardWindow 纯数学；只减 DOM）。
  5. detail 导航：行点击 → workspaces.skillDetail（representative target 三元组
     进路径）+ ?from= 快照；显式回程经 handoff 完整还原滚动/焦点/已载页数。
-->
<script lang="ts">
  import { untrack } from "svelte";
  import { useSearch, goById } from "$lib/shell";
  import { connectionState } from "$lib/store.svelte";
  import {
    openSkillSearchConfig,
    SEARCH_DEBOUNCE_MS,
    searchSkills,
    searchState,
    resetSkillSearch,
  } from "$lib/store.svelte";
  import {
    dashboardCanonicalState,
    canonicalProviderChips,
    filterCanonicalGroups,
    loadDashboardCanonical,
    loadMoreDashboardCanonical,
    resetDashboardCanonical,
  } from "$lib/stores/dashboard-canonical.svelte";
  import {
    computeDashboardWindow,
    DASHBOARD_ROW_HEIGHT,
    DASHBOARD_VIRTUALIZE_THRESHOLD,
  } from "$lib/stores/dashboard-skills.svelte";
  import {
    consumeSkillsListRestore,
    encodeListStateParam,
    type SkillsListState,
  } from "../skill-detail-route.js";
  import { t } from "$lib/i18n";
  import type { ProviderId, WorkspaceId } from "$shared/contracts/workspaces.js";
  import type { SkillId } from "$shared/contracts/skills.js";
  import ErrorHint from "$lib/components/error-hint.svelte";
  import DashboardFooter from "./dashboard-footer.svelte";
  import IconCrosshair from "@lucide/svelte/icons/crosshair";
  import IconFile from "@lucide/svelte/icons/file-text";
  import IconLayers from "@lucide/svelte/icons/layers";
  import IconLoader from "@lucide/svelte/icons/loader-circle";
  import IconPause from "@lucide/svelte/icons/circle-pause";
  import IconSearch from "@lucide/svelte/icons/search";
  import IconSliders from "@lucide/svelte/icons/sliders-horizontal";
  import IconSparkles from "@lucide/svelte/icons/sparkles";
  import IconFilter from "@lucide/svelte/icons/filter";

  type DashboardSearch = {
    tab?: "skills" | "agents" | "repos";
    provider?: ProviderId;
    q?: string;
    duplicates?: "1";
  };

  /** props：屏容器身份（wsId 决定数据面与 Global 页脚）；search 经 router 上下文。 */
  let { wsId }: { wsId: WorkspaceId } = $props();

  const getSearch = useSearch<DashboardSearch>();
  const search = $derived(getSearch?.() ?? {});
  const providerFilter = $derived(search.provider ?? null);
  const query = $derived(search.q ?? "");
  const duplicatesOnly = $derived(search.duplicates === "1");

  // 搜索输入草稿（瞬时 UI）：去抖后提交 URL（REPLACE，避免每键历史堆积）。
  let draftQuery = $state("");
  $effect(() => {
    draftQuery = query;
  });
  let commitTimer: ReturnType<typeof setTimeout> | null = null;
  function onSearchInput(value: string): void {
    draftQuery = value;
    if (commitTimer) clearTimeout(commitTimer);
    commitTimer = setTimeout(() => {
      commitTimer = null;
      setSearch({ q: draftQuery.trim() || undefined });
    }, 250);
  }
  $effect(() => {
    return () => {
      if (commitTimer) clearTimeout(commitTimer);
    };
  });

  // 过滤菜单状态（收尾项 1）：duplicates 开关 + search config 入口。
  let filterMenuOpen = $state(false);
  // 点击外部关闭菜单。
  $effect(() => {
    if (!filterMenuOpen) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (
        !target.closest('[aria-label="' + t("skillsWorkspace.skillsScreen.filterMenu") + '"]') &&
        !target.closest('[role="menu"]')
      ) {
        filterMenuOpen = false;
      }
    };
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  });

  /** URL search patch（保留其余键；undefined 键删除）。 */
  function setSearch(
    patch: Partial<DashboardSearch>,
    action: "PUSH" | "REPLACE" = "REPLACE",
  ): void {
    goById("workspaces.provider", { wsId }, { ...search, ...patch }, action);
  }

  // ---- 数据面（listCanonical：q 组级预过滤 + cursor 分段） ----

  $effect(() => {
    void loadDashboardCanonical(wsId, query.trim());
  });

  // 重连自愈（FD-14 复盘，2026-10-05 批评环实锤恢复）：快速重导航时
  // listCanonical 先于 WS 就绪抢跑失败（其余 RPC 晚于连接成功）——store 的
  // connection owner generation 只作废旧响应、不重发失败的首载；此 effect
  // 是该竞态的唯一自愈器（错误态 + 空行 → 转 connected 即重发当前数据面）。
  let lastConnectionStatus = $state(connectionState.status);
  $effect(() => {
    const status = connectionState.status;
    const was = untrack(() => lastConnectionStatus);
    lastConnectionStatus = status;
    if (was === "connected" || status !== "connected") return;
    if (
      untrack(() => dashboardCanonicalState.error) !== null &&
      untrack(() => dashboardCanonicalState.groups.length) === 0
    ) {
      void loadDashboardCanonical(
        wsId,
        untrack(() => query.trim()),
      );
    }
  });

  // 路由离开回收（列表态 + 全局检索态——命令面板等消费方各持自己的生命周期）。
  $effect(() => {
    return () => {
      untrack(() => {
        resetDashboardCanonical();
        resetSkillSearch();
      });
    };
  });

  // ---- skills.search 补全式检索（BM25；q 非空去抖触发） ----

  $effect(() => {
    const q = query.trim();
    if (!q) return;
    const timer = setTimeout(() => void searchSkills(q), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  });

  /** 检索态是否属于当前查询（全局单例可能被命令面板接管）。 */
  const searchFresh = $derived(searchState.query === query.trim());

  /** ws 作用域的模糊命中（installations 含当前 ws）。 */
  const scopedSearchResults = $derived(
    searchState.results.filter((result) =>
      result.installations.some((installation) => installation.workspaceId === wsId),
    ),
  );

  /** 补全条 = BM25 命中中、q 包含式列表未覆盖的名字（模糊增益才是增量信息）。 */
  const completionNames = $derived.by(() => {
    if (!query.trim() || !searchFresh || searchState.searching) return [];
    const loadedNames = new Set(
      dashboardCanonicalState.groups.map((group) => group.name.toLowerCase()),
    );
    const names: string[] = [];
    for (const result of scopedSearchResults) {
      if (loadedNames.has(result.name.toLowerCase())) continue;
      names.push(result.name);
      if (names.length >= 5) break;
    }
    return names;
  });

  const searchFallbackError = $derived(!query.trim() || !searchFresh ? null : searchState.error);

  // ---- 筛选投影（纯函数） ----

  const providerChips = $derived(
    canonicalProviderChips(dashboardCanonicalState.providers, dashboardCanonicalState.groups),
  );
  // 零计数 chips 折叠（2.2 处置批 P2-2）：非零前置（store 排序），零计数收进
  // 「+N providers」溢出项；选中的零计数 chip 强制露出（筛选态不被折叠隐藏）。
  const nonZeroChips = $derived(providerChips.filter((chip) => chip.count > 0));
  const zeroChips = $derived(providerChips.filter((chip) => chip.count === 0));
  let zeroChipsExpanded = $state(false);
  const zeroChipsVisible = $derived(
    zeroChipsExpanded || zeroChips.some((chip) => chip.providerId === providerFilter),
  );
  const visibleGroups = $derived(
    filterCanonicalGroups(dashboardCanonicalState.groups, {
      providerId: providerFilter,
      duplicatesOnly,
    }),
  );

  // ---- 虚拟化窗口（>200 行时只渲染可见切片） ----

  let listScrollEl = $state<HTMLDivElement | null>(null);
  let scrollTop = $state(0);
  let viewportPx = $state(0);

  // 启用判定锚定「已载组数（groups）」且为 >=（loadMore 抖动修复 θ4 同族）：
  // 阈值 == 首页 limit —— 存在 nextCursor 的首页必满 200 组，初始提交即启用；
  // 续页追加只会更大、永不跨档，追加时窗口起点不动、新行只入窗口尾。
  const virtualized = $derived(
    dashboardCanonicalState.groups.length >= DASHBOARD_VIRTUALIZE_THRESHOLD,
  );
  const visibleWindow = $derived(
    computeDashboardWindow(visibleGroups.length, scrollTop, viewportPx),
  );

  function onListScroll(): void {
    if (!listScrollEl) return;
    scrollTop = listScrollEl.scrollTop;
    viewportPx = listScrollEl.clientHeight;
  }

  // 行集/容器变化时重测视口（jsdom clientHeight=0 → fallback 页大小）。
  $effect(() => {
    visibleGroups.length;
    if (listScrollEl) viewportPx = listScrollEl.clientHeight;
  });

  const renderedGroups = $derived(
    virtualized ? visibleGroups.slice(visibleWindow.start, visibleWindow.end) : visibleGroups,
  );
  const spacerTopPx = $derived(virtualized ? visibleWindow.start * DASHBOARD_ROW_HEIGHT : 0);
  const spacerBottomPx = $derived(
    virtualized ? (visibleGroups.length - visibleWindow.end) * DASHBOARD_ROW_HEIGHT : 0,
  );

  // ---- detail 导航（workspaces.skillDetail + ?from= 列表态快照） ----

  /** 已载页数（load-more 段数；from= 回程按此补拉）。 */
  let pagesLoaded = $state(1);
  $effect(() => {
    // q 变化 = 首载重置；loadMore 自增。以「同 key 下已发生的手动追加」计数。
    void dashboardCanonicalState.key;
    pagesLoaded = 1;
  });

  /** 当前列表态快照（行点击时编码进 ?from=）。 */
  function currentListState(): SkillsListState {
    return {
      tab: "skills",
      q: query,
      provider: providerFilter,
      dup: duplicatesOnly,
      page: pagesLoaded,
      scroll: listScrollEl?.scrollTop ?? 0,
      sel: null, // 由调用方填代表 id
      file: "",
    };
  }

  function openDetail(providerId: ProviderId, skillId: SkillId): void {
    goById(
      "workspaces.skillDetail",
      { wsId, providerId, skillId },
      { from: encodeListStateParam({ ...currentListState(), sel: skillId }) },
      "PUSH",
    );
  }

  /** 补全条点击：优先落位已载组（跨 provider 名字匹配）；未载则改写 q 服务端重查。 */
  function selectCompletion(name: string): void {
    const group = dashboardCanonicalState.groups.find((entry) => entry.name === name);
    if (group) {
      openDetail(group.representative.providerId, group.representative.skillId);
    } else {
      setSearch({ q: name });
    }
  }

  // ---- 回程还原（detail 显式返回 → handoff 完整还原滚动/焦点/已载页数） ----
  // consume 键在数据就绪后执行（首载未 commit 时 stash 留存，加载完成/恢复后
  // 消费；wsId 变化重发数据面时随行重评，跨 ws 残留 stash 由 wsId 守卫丢弃）。

  let filterInputEl = $state<HTMLInputElement | null>(null);

  $effect(() => {
    if (dashboardCanonicalState.loading || dashboardCanonicalState.error !== null) return;
    if (dashboardCanonicalState.key === null) return;
    const pending = consumeSkillsListRestore(wsId);
    if (!pending) return;
    void (async () => {
      // 补拉 from.page 页（首页已载；每页 ≥1 组才继续——游标缺失即止）。
      for (let loaded = 1; loaded < pending.page; loaded += 1) {
        if (dashboardCanonicalState.nextCursor === null) break;
        const added = await loadMoreDashboardCanonical();
        pagesLoaded += 1;
        if (added === 0) break;
      }
      // DOM 提交后落位：滚动恢复 + 焦点行恢复（FD-11 同族双 RAF 确认）。
      // 虚拟窗口随 scrollTop 重算的补丁可能晚于双 RAF——追加一次 60ms 幂等
      // 重试（已聚焦 sel 行则跳过；仍缺行回退搜索框）。
      const focusSelRow = (): void => {
        if (document.activeElement?.getAttribute("data-skill-id") === pending.sel) return;
        if (!pending.sel) {
          filterInputEl?.focus();
          return;
        }
        const row = document.querySelector<HTMLButtonElement>(
          `button[data-skill-id="${CSS.escape(pending.sel)}"]`,
        );
        if (row) {
          row.scrollIntoView({ block: "center" });
          row.focus();
        } else {
          filterInputEl?.focus();
        }
      };
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (listScrollEl && pending.scroll > 0) listScrollEl.scrollTop = pending.scroll;
          focusSelRow();
        });
        setTimeout(focusSelRow, 60);
      });
    })();
  });

  const listCount = $derived(visibleGroups.length);
  /** ε 线两量纲计数（Δ1）：技能组 / 安装副本分开明示（服务端 (wsId,q) 全量，
   *  分页无关；禁止单数字推导）。可见组数 < 总量（筛选/分页窗口）才叠加
   *  「显示 N / 共 M」窗口式表达。 */
  const headerCountText = $derived.by(() => {
    const { groupCount, copyCount } = dashboardCanonicalState;
    if (listCount < groupCount) {
      return t("skillsWorkspace.skillsScreen.showingGroupsCopies", {
        visible: listCount,
        groups: groupCount,
        copies: copyCount,
      });
    }
    return t("skillsWorkspace.skillsScreen.groupsCopies", {
      groups: groupCount,
      copies: copyCount,
    });
  });

  // F2 错误态视觉自洽：定义 listFailed，header 搜索/过滤/chips 失败态灰。
  const listFailed = $derived(
    dashboardCanonicalState.error !== null && dashboardCanonicalState.groups.length === 0,
  );

  // FD-20 Load more 反馈：按钮区 1.5s 瞬时文案（避免自动滚动打断用户）。
  let loadMoreFeedback = $state<string | null>(null);
  async function handleLoadMore(): Promise<void> {
    const addedCount = await loadMoreDashboardCanonical();
    if (addedCount > 0) {
      pagesLoaded += 1;
      loadMoreFeedback = t("skillsWorkspace.skillsScreen.loadedMore", { count: addedCount });
      setTimeout(() => {
        loadMoreFeedback = null;
      }, 1500);
    }
  }
</script>

<section class="screen skills-screen" data-screen="skills" aria-label={t("skillsScreen.aria")}>
  <header class="shrink-0 border-b border-border px-4 py-3">
    <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5">
      <h2 class="min-w-0 truncate text-sm font-semibold">{t("skillsScreen.title")}</h2>
      {#if dashboardCanonicalState.loading || searchState.searching}
        <IconLoader
          class="h-3 w-3 shrink-0 animate-spin text-muted-foreground"
          title={t("skillsScreen.refreshing")}
        />
      {:else}
        <span class="text-sm font-medium tabular-nums text-foreground">{headerCountText}</span>
      {/if}
      <div
        class="relative ml-auto flex shrink-0 items-center gap-1 {listFailed
          ? 'opacity-50 pointer-events-none'
          : ''}"
      >
        <button
          type="button"
          class="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label={t("skillsWorkspace.skillsScreen.filterMenu")}
          title={t("skillsWorkspace.skillsScreen.filterMenu")}
          aria-expanded={filterMenuOpen}
          onclick={() => (filterMenuOpen = !filterMenuOpen)}
        >
          <IconFilter class="h-3.5 w-3.5" />
        </button>
        {#if filterMenuOpen}
          <div
            class="absolute right-0 top-8 z-10 min-w-[200px] rounded-md border border-border bg-popover p-1 shadow-md"
            role="menu"
          >
            <button
              type="button"
              class="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs transition-colors hover:bg-accent"
              role="menuitemcheckbox"
              aria-checked={duplicatesOnly}
              onclick={() => {
                setSearch({ duplicates: duplicatesOnly ? undefined : "1" });
                filterMenuOpen = false;
              }}
            >
              <span
                class="flex h-4 w-4 items-center justify-center rounded-sm border {duplicatesOnly
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-input'}"
              >
                {#if duplicatesOnly}
                  <svg
                    class="h-3 w-3"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="3"
                    viewBox="0 0 24 24"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                {/if}
              </span>
              <span class="flex-1 text-left"
                >{t("skillsWorkspace.skillsScreen.sameContentOnly")}</span
              >
            </button>
            <button
              type="button"
              class="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs transition-colors hover:bg-accent"
              role="menuitem"
              onclick={() => {
                filterMenuOpen = false;
                void openSkillSearchConfig();
              }}
            >
              <IconSliders class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span class="flex-1 text-left">{t("skillsWorkspace.skillsScreen.searchConfig")}</span>
            </button>
          </div>
        {/if}
      </div>
    </div>
    <div class="relative mt-2 {listFailed ? 'opacity-50 pointer-events-none' : ''}">
      <IconSearch
        class="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
      />
      <input
        bind:this={filterInputEl}
        class="h-7 w-full min-w-0 rounded-md border border-input bg-input/20 pl-7 pr-3 text-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
        placeholder={t("skillsScreen.searchPlaceholder")}
        aria-label={t("skillsScreen.searchAria")}
        value={draftQuery}
        oninput={(e) => onSearchInput((e.currentTarget as HTMLInputElement).value)}
      />
    </div>
    {#if searchFallbackError}
      <p class="mt-1.5 text-xs text-destructive" role="alert" data-testid="search-fallback">
        {t("skillsScreen.searchUnavailable")}
        {searchFallbackError}
      </p>
    {/if}
    <!-- provider chips：组代表口径 facet 计数（Δ1 批 2：chips 作用于组代表）。
         All chip 不带计数（ε 线收敛）。单行横滚（走查 13-fix）+ 零计数折叠
         （2.2 处置批 P2-2）机制保留。 -->
    <div
      class="chips-row mt-2 flex gap-1.5 {listFailed ? 'opacity-50 pointer-events-none' : ''}"
      role="group"
      aria-label={t("skillsScreen.chipsAria")}
    >
      <button
        type="button"
        class="flex min-h-7 items-center gap-1 rounded-full border px-2.5 text-xs transition-colors
          {providerFilter === null
          ? 'border-primary/60 bg-primary/10 font-medium text-foreground'
          : 'border-border/70 text-muted-foreground hover:bg-muted/50'}"
        aria-pressed={providerFilter === null}
        onclick={() => setSearch({ provider: undefined })}
      >
        {t("skillsScreen.chipAll")}
      </button>
      {#each nonZeroChips as chip (chip.providerId)}
        <button
          type="button"
          class="flex min-h-7 max-w-full items-center gap-1 rounded-full border px-2.5 text-xs transition-colors
            {providerFilter === chip.providerId
            ? 'border-primary/60 bg-primary/10 font-medium text-foreground'
            : 'border-border/70 text-muted-foreground hover:bg-muted/50'}"
          aria-pressed={providerFilter === chip.providerId}
          title={chip.providerId}
          onclick={() =>
            setSearch({
              provider: providerFilter === chip.providerId ? undefined : chip.providerId,
            })}
        >
          <span class="truncate">{chip.label}</span>
          <span class="tabular-nums opacity-70">{chip.count}</span>
        </button>
      {/each}
      {#if zeroChips.length > 0}
        <button
          type="button"
          class="flex min-h-7 shrink-0 items-center gap-1 rounded-full border border-dashed border-border/70 px-2.5 text-xs text-muted-foreground transition-colors hover:bg-muted/50"
          aria-expanded={zeroChipsVisible}
          title={zeroChips.map((chip) => chip.providerId).join(", ")}
          data-testid="zero-providers-overflow"
          onclick={() => (zeroChipsExpanded = !zeroChipsExpanded)}
        >
          {zeroChipsVisible
            ? t("skillsScreen.hideEmptyProviders")
            : t("skillsScreen.moreProviders", { count: zeroChips.length })}
        </button>
        {#if zeroChipsVisible}
          {#each zeroChips as chip (chip.providerId)}
            <button
              type="button"
              class="flex min-h-7 max-w-full items-center gap-1 rounded-full border px-2.5 text-xs transition-colors
                {providerFilter === chip.providerId
                ? 'border-primary/60 bg-primary/10 font-medium text-foreground'
                : 'border-border/70 text-muted-foreground hover:bg-muted/50'}"
              aria-pressed={providerFilter === chip.providerId}
              title={chip.providerId}
              onclick={() =>
                setSearch({
                  provider: providerFilter === chip.providerId ? undefined : chip.providerId,
                })}
            >
              <span class="truncate">{chip.label}</span>
              <span class="tabular-nums opacity-70">{chip.count}</span>
            </button>
          {/each}
        {/if}
      {/if}
    </div>
  </header>

  {#if completionNames.length > 0}
    <!-- 补全条：BM25 模糊命中且 q 包含式未覆盖（design §2「top-N 延迟补全式」）。
         FD-04 区分已载/未载图标：已载=定位（Crosshair），未载=搜索（Search）。 -->
    <div class="shrink-0 border-b border-border px-4 py-2" data-testid="search-completions">
      <p class="flex items-center gap-1.5 text-xs text-muted-foreground">
        <IconSparkles class="h-3.5 w-3.5" aria-hidden="true" />
        {t("skillsScreen.completionHeading")}
      </p>
      <ul class="mt-1 flex flex-wrap gap-1.5">
        {#each completionNames as name (name)}
          {@const isLoaded = dashboardCanonicalState.groups.some((g) => g.name === name)}
          <li>
            <button
              type="button"
              class="flex min-h-7 items-center gap-1 rounded-full border border-dashed border-border px-2.5 text-xs transition-colors hover:bg-muted/50"
              title={isLoaded
                ? t("skillsWorkspace.skillsScreen.completionLoaded")
                : t("skillsWorkspace.skillsScreen.completionSearch")}
              onclick={() => selectCompletion(name)}
            >
              {#if isLoaded}
                <IconCrosshair class="h-3 w-3" aria-hidden="true" />
              {:else}
                <IconSearch class="h-3 w-3" aria-hidden="true" />
              {/if}
              {name}
            </button>
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  <!-- 列表面（detail 归独立路由：本屏满幅单列，不再有 master-detail 双 pane）。 -->
  <div
    bind:this={listScrollEl}
    class="min-h-0 flex-1 overflow-y-auto overscroll-contain"
    onscroll={onListScroll}
    data-testid="skills-list"
  >
    {#if listFailed}
      <div class="flex flex-col items-start gap-2 px-4 py-6 text-xs text-destructive">
        <ErrorHint error={dashboardCanonicalState.error!} />
        <button
          class="underline underline-offset-2"
          onclick={() => void loadDashboardCanonical(wsId, query.trim())}
        >
          {t("common.retry")}
        </button>
      </div>
    {:else if dashboardCanonicalState.loading}
      <p class="flex items-center gap-2 px-4 py-6 text-xs text-muted-foreground" role="status">
        <IconLoader class="h-3.5 w-3.5 animate-spin" />
        {t("skillsScreen.loading")}
      </p>
    {:else if visibleGroups.length === 0}
      <p class="px-4 py-6 text-xs text-muted-foreground">
        {query.trim() ? t("skillsScreen.noMatch") : t("skillsScreen.empty")}
      </p>
    {:else}
      {#if spacerTopPx > 0}
        <div style="height:{spacerTopPx}px" aria-hidden="true"></div>
      {/if}
      {#each renderedGroups as group (group.name)}
        {@const representative = group.representative}
        {@const allUnavailable = group.groupMeta.allUnavailable}
        {@const copyCount = group.groupMeta.copyCount}
        <!-- 行高统一 75px（border-box，与 DASHBOARD_ROW_HEIGHT 常量严格一致）：
             虚拟化 spacer 位移按常量计算，行高不统一即窗口错位 + 追加抖动。 -->
        <button
          type="button"
          data-skill-id={representative.skillId}
          data-group-name={group.name}
          onclick={() => openDetail(representative.providerId, representative.skillId)}
          aria-disabled={allUnavailable}
          class="flex h-[75px] w-full items-start gap-2.5 overflow-hidden border-b border-border/70 px-3 py-2.5 text-left transition-colors
            {allUnavailable
            ? 'opacity-50 text-muted-foreground'
            : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'}"
        >
          {#if representative.disabled}
            <IconPause class="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          {:else}
            <IconFile class="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          {/if}
          <span class="min-w-0 flex-1">
            <span class="flex items-center gap-2 leading-5">
              <span class="truncate text-[13px] font-medium text-foreground">{group.name}</span>
              <span
                class="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground"
                title={representative.provider}
              >
                {representative.provider}
              </span>
              {#if representative.disabled}
                <span
                  class="shrink-0 text-xs uppercase tracking-wide text-amber-600 dark:text-amber-400"
                >
                  {t("skillsScreen.disabledRow")}
                </span>
              {/if}
              {#if copyCount > 1}
                <!-- ×N 副本徽标（Δ1）：组代表口径的安装副本数；aria 语义可访问。 -->
                <span
                  class="inline-flex shrink-0 items-center gap-0.5 text-xs text-muted-foreground/80"
                  title={t("skillsWorkspace.skillsScreen.copiesBadge", { count: copyCount })}
                  aria-label={t("skillsWorkspace.skillsScreen.copiesBadge", { count: copyCount })}
                  role="img"
                  data-testid="copies-badge"
                >
                  <IconLayers class="h-3 w-3" aria-hidden="true" />
                  <span class="tabular-nums">×{copyCount}</span>
                </span>
              {/if}
              {#if allUnavailable}
                <span
                  class="shrink-0 text-xs uppercase tracking-wide text-muted-foreground/70"
                  title={t("skillsWorkspace.skillsScreen.allCopiesUnavailable")}
                >
                  {t("skillsWorkspace.skillsScreen.allCopiesUnavailable")}
                </span>
              {/if}
            </span>
            <!-- clamp 元素禁配 block：Tailwind 输出序 .block 在 .line-clamp-*
                 之后，display:block 覆盖 -webkit-box 使 clamp 失效。
                 FD-24 行高/clamp 微调：leading-[18px] 给两行完整空间，不动 75px。 -->
            <span class="mt-0.5 line-clamp-2 text-xs leading-[18px]">
              {group.description || t("skillsScreen.noDescription")}
            </span>
          </span>
        </button>
      {/each}
      {#if spacerBottomPx > 0}
        <div style="height:{spacerBottomPx}px" aria-hidden="true"></div>
      {/if}
      {#if dashboardCanonicalState.nextCursor}
        <div class="flex justify-center px-4 py-3">
          <button
            type="button"
            class="flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-xs transition-colors hover:bg-muted/50 disabled:opacity-50"
            disabled={dashboardCanonicalState.loadingMore || loadMoreFeedback !== null}
            onclick={handleLoadMore}
            data-testid="load-more"
          >
            {#if dashboardCanonicalState.loadingMore}
              <IconLoader class="h-3.5 w-3.5 animate-spin" />
            {/if}
            {loadMoreFeedback ?? t("skillsScreen.loadMore")}
          </button>
        </div>
      {/if}
    {/if}
  </div>

  {#if wsId === "~"}
    <!-- Global 页脚：库快照行（冒烟锚点 en 逐字）+ self-skill banner + 导入管理。 -->
    <DashboardFooter wsId="~" />
  {/if}
</section>

<style>
  /* provider chips 单行横滚（走查 13-fix）：不换行 + overflow-x + 内滚不冒泡——
     header 高度与 provider 数量解耦（detail 面板退役后列表满幅，横滚机制不变）。
     滚动条残段根治（修复批 2 P2-4）：隐藏原生滚动条（scrollbar-width + WebKit
     伪元素双面），「可滚」affordance 交给边缘渐隐 mask。mask 渐变区正好落在
     容器自有 16px inline padding 上（负 margin 抵消对位）——未滚动/滚到底时
     chip 不被裁，滚动中滑出的 chip 渐隐。 */
  .chips-row {
    flex-wrap: nowrap;
    overflow-x: auto;
    scrollbar-width: none;
    overscroll-behavior-x: contain;
    padding-inline: 16px;
    margin-inline: -16px;
    /* FD-06 chips affordance 增强：右侧 mask 收紧到 8px + 末尾半枚 chip 裁切暗示。 */
    -webkit-mask-image: linear-gradient(
      to right,
      transparent 0,
      #000 16px,
      #000 calc(100% - 8px),
      transparent 100%
    );
    mask-image: linear-gradient(
      to right,
      transparent 0,
      #000 16px,
      #000 calc(100% - 8px),
      transparent 100%
    );
  }
  .chips-row::-webkit-scrollbar {
    display: none;
  }
  /* 窄容器触达地板（r2 评图 TOP5，master-detail 栈切换退役后保留 chips 面）：
     窄容器下 chips 视觉 28px 低于 44px 点击区要求（AGENTS §7.2）——::after
     外扩 8px 命中区，视觉尺寸不变。阈值与 SkillsDashboard 单列降档共享 692px
     真相源（同容器名 dashboard）。 */
  @container dashboard (width < 692px) {
    .chips-row button {
      position: relative;
    }
    .chips-row button::after {
      content: "";
      position: absolute;
      inset: -8px;
    }
  }
</style>
