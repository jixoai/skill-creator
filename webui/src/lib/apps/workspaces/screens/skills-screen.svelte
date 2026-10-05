<!--
  用户原始需求 [2026-10-02]（skills-dashboard design §2）：「直接展示所有的 skill
  ……跨 provider 平铺列表 + skills.search 全文搜索 + provider 筛选 chip +
  duplicates 标记」。
  正交意图：
  1. 平铺列表数据面：skills.listWorkspace（q 服务端预过滤 + nextCursor load-more），
     store 纪律 = latest-request-wins + 连接代次门（dashboard-skills store）。
  2. 筛选与计数投影（ε 线计数收敛，2026-10-05「少即是多」）：provider chips
     （per-provider facet 计数；All 不带数——已载行数与 header 窗口语义完全冗余）
     + duplicates-only 开关（纯函数投影，URL search 是唯一真相源）+ header 主显
     workspace 技能总量（providers 摘要聚合，q/分页无关；可见行数不等时以
     「显示 N / 共 M」窗口式表达——一屏至多两种数字语义，每个数字带名词）。
  3. skills.search 补全式搜索：非空 q 去抖触发 BM25 检索，命中投影到当前 ws
     作用域；q 包含式未覆盖的模糊命中以补全条呈现（点击落位或改写 q）。
  4. 虚拟化窗口：>200 行时简单窗口化（computeDashboardWindow 纯数学；只减 DOM）。
  5. master-detail：详情恢复身份 = ?provider=&skill= 双参数（skillId 是
     per-provider digest）；窄屏（dashboard 命名容器 < 692px，与网格单列降档
     同源阈值）?view=detail push 切换。
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
    dashboardSkillsState,
    dashboardProviderCounts,
    dashboardDuplicateCounts,
    dashboardDuplicatesTruncated,
    filterDashboardRows,
    loadDashboardSkills,
    loadMoreDashboardSkills,
    resetDashboardSkills,
    computeDashboardWindow,
    DASHBOARD_ROW_HEIGHT,
    DASHBOARD_VIRTUALIZE_THRESHOLD,
  } from "$lib/stores/dashboard-skills.svelte";
  import { loadSkillDuplicates, skillDuplicatesState } from "$lib/stores/skills.svelte";
  import { t } from "$lib/i18n";
  import type { ProviderId, WorkspaceId } from "$shared/contracts/workspaces.js";
  import type { SkillId } from "$shared/contracts/skills.js";
  import { Badge } from "$lib/components/ui/badge";
  import ErrorHint from "$lib/components/error-hint.svelte";
  import SkillDetailPanel from "$lib/components/skills/skill-detail-panel.svelte";
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
    screen?: "skills" | "agents" | "repos";
    provider?: ProviderId;
    q?: string;
    skill?: SkillId;
    view?: "list" | "detail";
    duplicates?: "1";
  };

  /** props：屏容器身份（wsId 决定数据面与 Global 页脚）；search 经 router 上下文。 */
  let { wsId }: { wsId: WorkspaceId } = $props();

  const getSearch = useSearch<DashboardSearch>();
  const search = $derived(getSearch?.() ?? {});
  const providerFilter = $derived(search.provider ?? null);
  const query = $derived(search.q ?? "");
  const duplicatesOnly = $derived(search.duplicates === "1");
  const selectedSkillId = $derived(search.skill ?? null);
  const viewMode = $derived(search.view ?? "list");

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

  // ---- 数据面（listWorkspace：q 预过滤 + cursor 分段） ----

  $effect(() => {
    void loadDashboardSkills(wsId, query.trim());
  });

  // 重连自愈（FD-14 复盘，2026-10-05 批评环实锤恢复）：快速重导航时
  // listWorkspace 先于 WS 就绪抢跑失败（其余 RPC 晚于连接成功）——store 的
  // connection owner generation 只作废旧响应、不重发失败的首载；此 effect
  // 是该竞态的唯一自愈器（错误态 + 空行 → 转 connected 即重发当前数据面）。
  let lastConnectionStatus = $state(connectionState.status);
  $effect(() => {
    const status = connectionState.status;
    const was = untrack(() => lastConnectionStatus);
    lastConnectionStatus = status;
    if (was === "connected" || status !== "connected") return;
    if (
      untrack(() => dashboardSkillsState.error) !== null &&
      untrack(() => dashboardSkillsState.rows.length) === 0
    ) {
      void loadDashboardSkills(
        wsId,
        untrack(() => query.trim()),
      );
    }
  });

  // 路由离开回收（列表态 + 全局检索态——命令面板等消费方各持自己的生命周期）。
  $effect(() => {
    return () => {
      untrack(() => {
        resetDashboardSkills();
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
    const loadedNames = new Set(dashboardSkillsState.rows.map((row) => row.name.toLowerCase()));
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
    dashboardProviderCounts(dashboardSkillsState.providers, dashboardSkillsState.rows),
  );
  // 零计数 chips 折叠（2.2 处置批 P2-2）：非零前置（store 排序），零计数收进
  // 「+N providers」溢出项；选中的零计数 chip 强制露出（筛选态不被折叠隐藏）。
  const nonZeroChips = $derived(providerChips.filter((chip) => chip.count > 0));
  const zeroChips = $derived(providerChips.filter((chip) => chip.count === 0));
  let zeroChipsExpanded = $state(false);
  const zeroChipsVisible = $derived(
    zeroChipsExpanded || zeroChips.some((chip) => chip.providerId === providerFilter),
  );
  const duplicateCounts = $derived.by(() => {
    // 全量组已载（truncated 提示后的 skills.duplicates 查询）→ 以全量接管过滤。
    if (skillDuplicatesState.groups.length > 0) {
      const counts = new Map<SkillId, number>();
      for (const group of skillDuplicatesState.groups) {
        for (const member of group.members) counts.set(member.id, group.members.length - 1);
      }
      return counts;
    }
    return dashboardDuplicateCounts(dashboardSkillsState.duplicates);
  });
  const duplicatesTruncated = $derived(
    dashboardDuplicatesTruncated(dashboardSkillsState.duplicates),
  );
  const visibleRows = $derived(
    filterDashboardRows(
      dashboardSkillsState.rows,
      { providerId: providerFilter, duplicatesOnly },
      duplicateCounts,
    ),
  );

  // 全量重复组（truncated 提示的查询面）：连接建立后单发一次（显式 latch）。
  let duplicatesStarted = false;
  $effect(() => {
    if (duplicatesStarted || connectionState.status !== "connected") return;
    duplicatesStarted = true;
    void loadSkillDuplicates();
  });
  const fullDuplicatesLoaded = $derived(skillDuplicatesState.groups.length > 0);

  /** 详情身份：?provider=&skill= 双参数；skill 无 provider 时从已载行兜底归属。 */
  const detailIdentity = $derived.by(() => {
    if (!selectedSkillId) return null;
    const provider =
      providerFilter ??
      dashboardSkillsState.rows.find((row) => row.id === selectedSkillId)?.providerId ??
      null;
    if (!provider) return null;
    return { workspaceId: wsId, providerId: provider, skillId: selectedSkillId };
  });

  // 窄屏栈切换生效判定（修复批 2 P1-2）：?view=detail 只有在详情身份有效时才
  // 隐藏列表面——无身份的残留 view=detail 落回列表态，两 pane 永不全隐。
  const detailVisible = $derived(viewMode === "detail" && detailIdentity !== null);

  // ---- 虚拟化窗口（>200 行时只渲染可见切片） ----

  let listScrollEl = $state<HTMLDivElement | null>(null);
  let scrollTop = $state(0);
  let viewportPx = $state(0);

  // 启用判定锚定「已载行数（rows）」且为 >=（loadMore 抖动修复 θ4）：阈值 ==
  // 首页 limit —— 存在 nextCursor 的首页必满 200 行，初始提交即启用；续页追加
  // 只会更大、永不跨档，追加时窗口起点不动、新行只入窗口尾（DOM 增量，无重建）。
  // 旧判定 `visibleRows.length > threshold` 在 200→201 追加瞬间切换渲染模式，
  // 整列 DOM 换成 spacer + 窗口，可视行被销毁 = Owner 观察到的抖动 + 滚动跳变。
  const virtualized = $derived(dashboardSkillsState.rows.length >= DASHBOARD_VIRTUALIZE_THRESHOLD);
  const visibleWindow = $derived(computeDashboardWindow(visibleRows.length, scrollTop, viewportPx));

  function onListScroll(): void {
    if (!listScrollEl) return;
    scrollTop = listScrollEl.scrollTop;
    viewportPx = listScrollEl.clientHeight;
  }

  // 行集/容器变化时重测视口（jsdom clientHeight=0 → fallback 页大小）。
  $effect(() => {
    visibleRows.length;
    if (listScrollEl) viewportPx = listScrollEl.clientHeight;
  });

  const renderedRows = $derived(
    virtualized ? visibleRows.slice(visibleWindow.start, visibleWindow.end) : visibleRows,
  );
  const spacerTopPx = $derived(virtualized ? visibleWindow.start * DASHBOARD_ROW_HEIGHT : 0);
  const spacerBottomPx = $derived(
    virtualized ? (visibleRows.length - visibleWindow.end) * DASHBOARD_ROW_HEIGHT : 0,
  );

  // ---- master-detail 导航 ----

  let filterInputEl = $state<HTMLInputElement | null>(null);
  // detail→list 迁移时恢复触发行焦点（渲染 flush 内落位，见 ProviderView 同族注释）。
  let pendingFocusSkillId: string | null = null;

  function selectRow(providerId: ProviderId, skillId: SkillId): void {
    setSearch({ provider: providerId, skill: skillId, view: "detail" }, "PUSH");
  }

  function backToList(): void {
    pendingFocusSkillId = selectedSkillId ?? null;
    setSearch({ view: "list" }, "PUSH");
  }

  let previousViewMode: "list" | "detail" = "list";
  $effect(() => {
    const mode = viewMode;
    const wasDetail = untrack(() => previousViewMode);
    const restoreSkillId = untrack(() => pendingFocusSkillId);
    previousViewMode = mode;
    if (mode !== "list" || wasDetail !== "detail" || !restoreSkillId) return;
    pendingFocusSkillId = null;
    // FD-11 焦点恢复加固：先 scrollIntoView 确保行在窗口内，再 focus（RAF 二帧确认）。
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const row = document.querySelector<HTMLButtonElement>(
          `button[data-skill-id="${CSS.escape(restoreSkillId)}"]`,
        );
        if (row) {
          row.scrollIntoView({ block: "center" });
          row.focus();
        } else {
          filterInputEl?.focus();
        }
      });
    });
  });

  /** 补全条点击：优先落位已载行（含跨 provider 名字匹配）；未载则改写 q 服务端重查。 */
  function selectCompletion(name: string): void {
    const row = dashboardSkillsState.rows.find((entry) => entry.name === name);
    if (row) {
      selectRow(row.providerId, row.id);
    } else {
      setSearch({ q: name });
    }
  }

  const listCount = $derived(visibleRows.length);
  /** ε 线计数收敛——屏上唯一主显口径：workspace 技能总量（server provider 摘要
   *  聚合；q 无关、分页无关——「到底有多少技能」不再被渲染窗口/分页上限冒充）。 */
  const workspaceSkillTotal = $derived(
    dashboardSkillsState.providers.reduce((total, provider) => total + provider.skillCount, 0),
  );
  /** header 计数文案：总量主显（单复数由 key 承担）；可见行数 < 总量（筛选/分页/
   *  检索窗口）才出现第二个数字，以「显示 N / 共 M」窗口式表达——一屏至多两种
   *  数字语义，每个数字带明确名词。 */
  const headerCountText = $derived.by(() => {
    if (listCount < workspaceSkillTotal) {
      return t("skillsScreen.showingOf", { visible: listCount, total: workspaceSkillTotal });
    }
    // 防御：providers 摘要缺席/落后于已载行时以可见行数兜底（不显虚假小总量）。
    const count = Math.max(listCount, workspaceSkillTotal);
    return count === 1
      ? t("skillsScreen.totalCountOne", { count })
      : t("skillsScreen.totalCount", { count });
  });

  // F2 错误态视觉自洽：定义 listFailed，header 搜索/过滤/chips 失败态灰。
  const listFailed = $derived(
    dashboardSkillsState.error !== null && dashboardSkillsState.rows.length === 0,
  );

  // FD-20 Load more 反馈：按钮区 1.5s 瞬时文案（避免自动滚动打断用户）。
  let loadMoreFeedback = $state<string | null>(null);
  async function handleLoadMore(): Promise<void> {
    const addedCount = await loadMoreDashboardSkills();
    if (addedCount > 0) {
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
      {#if dashboardSkillsState.loading || searchState.searching}
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
            class="absolute right-0 top-8 z-50 min-w-[200px] rounded-md border border-border bg-popover p-1 shadow-md"
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
    <!-- provider chips：per-provider facet 计数（联动 Agents screen 的选中态真相）。
         All chip 不带计数（ε 线收敛）：已载行数与 header 窗口数字完全冗余。
         单行横滚（走查 13-fix）：真实目录 76 chips wrap 九行会把 master-detail 挤到
         0px——不换行、横向内滚，header 高度退回单行。零计数折叠（2.2 处置批
         P2-2）：非零 chips 前置，零计数收进「+N providers」溢出项按需展开。 -->
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
              skill: undefined,
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
                  skill: undefined,
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

  {#if duplicatesOnly && duplicatesTruncated}
    <p class="shrink-0 border-b border-border px-4 py-2 text-xs text-muted-foreground">
      {t("skillsScreen.duplicatesTruncated")}
      {#if !fullDuplicatesLoaded}
        <button class="underline underline-offset-2" onclick={() => void loadSkillDuplicates()}>
          {t("skillsScreen.duplicatesLoadAll")}
        </button>
      {/if}
    </p>
  {/if}

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
          {@const isLoaded = dashboardSkillsState.rows.some((r) => r.name === name)}
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

  <!-- 窄屏栈切换的隐藏类只落在 pane 上（修复批 2 P1-2）：类落在
       .skills-master-detail 自身时，隐藏类与容器查询在同一元素上互相不可见
       （450px 盲区）。栈切换阈值统一到 dashboard 命名容器的 692px 单列降档
       （批评处置 P2）：单列容器（Agent 面板开启 / 620px 窄窗）下列表满宽、
       点行 push 详情（?view=detail 机制不变），不再出现 560-691px 区间的
       「dashboard 已单列、master-detail 仍双栏挤压」。 -->
  <div class="skills-master-detail flex min-h-0 flex-1">
    <!-- 列表面（窄屏 ?view=detail 且详情身份有效时隐藏） -->
    <div
      class="skills-list-pane flex min-h-0 w-[min(340px,45%)] shrink-0 flex-col {detailVisible
        ? 'list-hidden'
        : ''}"
    >
      <div
        bind:this={listScrollEl}
        class="min-h-0 flex-1 overflow-y-auto overscroll-contain"
        onscroll={onListScroll}
        data-testid="skills-list"
      >
        {#if listFailed}
          <div class="flex flex-col items-start gap-2 px-4 py-6 text-xs text-destructive">
            <ErrorHint error={dashboardSkillsState.error!} />
            <button
              class="underline underline-offset-2"
              onclick={() => void loadDashboardSkills(wsId, query.trim())}
            >
              {t("common.retry")}
            </button>
          </div>
        {:else if dashboardSkillsState.loading}
          <p class="flex items-center gap-2 px-4 py-6 text-xs text-muted-foreground" role="status">
            <IconLoader class="h-3.5 w-3.5 animate-spin" />
            {t("skillsScreen.loading")}
          </p>
        {:else if visibleRows.length === 0}
          <p class="px-4 py-6 text-xs text-muted-foreground">
            {query.trim() ? t("skillsScreen.noMatch") : t("skillsScreen.empty")}
          </p>
        {:else}
          {#if spacerTopPx > 0}
            <div style="height:{spacerTopPx}px" aria-hidden="true"></div>
          {/if}
          {#each renderedRows as row (`${row.providerId}:${row.id}`)}
            {@const sameContent = duplicateCounts.get(row.id) ?? 0}
            <!-- 行高统一 75px（border-box，与 DASHBOARD_ROW_HEIGHT 常量严格一致）：
                 虚拟化 spacer 位移按常量计算，行高不统一即窗口错位 + 追加抖动
                 （1 行描述 ~59px / 2 行描述 ~75px 的自然高差被钉平）。 -->
            <button
              type="button"
              data-skill-id={row.id}
              aria-pressed={detailIdentity?.skillId === row.id}
              onclick={() => selectRow(row.providerId, row.id)}
              class="flex h-[75px] w-full items-start gap-2.5 overflow-hidden border-b border-border/70 px-3 py-2.5 text-left transition-colors
                {detailIdentity?.skillId === row.id
                ? 'bg-accent text-foreground'
                : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'}"
            >
              {#if row.disabled}
                <IconPause class="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              {:else}
                <IconFile class="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              {/if}
              <span class="min-w-0 flex-1">
                <span class="flex items-center gap-2 leading-5">
                  <span class="truncate text-[13px] font-medium text-foreground">{row.name}</span>
                  <span
                    class="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground"
                    title={row.provider}
                  >
                    {row.provider}
                  </span>
                  {#if row.disabled}
                    <span
                      class="shrink-0 text-xs uppercase tracking-wide text-amber-600 dark:text-amber-400"
                    >
                      {t("skillsScreen.disabledRow")}
                    </span>
                  {/if}
                  {#if sameContent > 0}
                    <!-- F4 副本徽标可访问语义：加 aria-label + role="img"，视觉不动。 -->
                    <span
                      class="inline-flex shrink-0 items-center gap-0.5 text-xs text-muted-foreground/80"
                      title={sameContent === 1
                        ? t("skillsScreen.sameContentOne", { count: sameContent })
                        : t("skillsScreen.sameContentMany", { count: sameContent })}
                      aria-label={sameContent === 1
                        ? t("skillsScreen.sameContentOne", { count: sameContent })
                        : t("skillsScreen.sameContentMany", { count: sameContent })}
                      role="img"
                    >
                      <IconLayers class="h-3 w-3" aria-hidden="true" />
                      <span class="tabular-nums">{sameContent}</span>
                    </span>
                  {/if}
                </span>
                <!-- clamp 元素禁配 block：Tailwind 输出序 .block 在 .line-clamp-*
                     之后，display:block 覆盖 -webkit-box 使 clamp 失效。
                     FD-24 行高/clamp 微调：leading-[18px] 给两行完整空间，不动 75px。 -->
                <span class="mt-0.5 line-clamp-2 text-xs leading-[18px]">
                  {row.description || t("skillsScreen.noDescription")}
                </span>
              </span>
            </button>
          {/each}
          {#if spacerBottomPx > 0}
            <div style="height:{spacerBottomPx}px" aria-hidden="true"></div>
          {/if}
          {#if dashboardSkillsState.nextCursor}
            <div class="flex justify-center px-4 py-3">
              <button
                type="button"
                class="flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-xs transition-colors hover:bg-muted/50 disabled:opacity-50"
                disabled={dashboardSkillsState.loadingMore || loadMoreFeedback !== null}
                onclick={handleLoadMore}
                data-testid="load-more"
              >
                {#if dashboardSkillsState.loadingMore}
                  <IconLoader class="h-3.5 w-3.5 animate-spin" />
                {/if}
                {loadMoreFeedback ?? t("skillsScreen.loadMore")}
              </button>
            </div>
          {/if}
        {/if}
      </div>
    </div>

    <!-- 详情面（宽屏右滑入；窄屏 ?view=detail push——design §2 master-detail） -->
    <div
      class="skills-detail-pane flex min-h-0 min-w-0 flex-1 flex-col border-l border-border {detailVisible
        ? ''
        : 'detail-hidden'}"
    >
      {#if detailIdentity}
        <SkillDetailPanel
          target={{ workspaceId: wsId, providerId: detailIdentity.providerId }}
          skillId={detailIdentity.skillId}
          onBack={backToList}
          isNarrowScreen={detailVisible}
        />
      {:else}
        <!-- 空占位保持中性（r2 评图修正）：错误与 Retry 单实例归列表列拥有，
             详情占位不重复渲染同错误（同因双报是状态噪音）。 -->
        <div
          class="m-auto flex flex-col items-center justify-center gap-2 px-8 py-10 text-center text-muted-foreground {listFailed
            ? 'opacity-50'
            : ''}"
        >
          <IconFile class="h-6 w-6" />
          <p class="text-sm font-medium text-foreground">{t("skillsScreen.selectSkill")}</p>
          <p class="max-w-xs text-xs">{t("skillsScreen.selectSkillBody")}</p>
        </div>
      {/if}
    </div>
  </div>

  {#if wsId === "~"}
    <!-- Global 页脚：库快照行（冒烟锚点 en 逐字）+ self-skill banner + 导入管理。 -->
    <DashboardFooter wsId="~" />
  {/if}
</section>

<style>
  .skills-list-pane {
    min-width: 0;
  }
  .skills-detail-pane {
    min-width: 0;
  }
  /* provider chips 单行横滚（走查 13-fix）：不换行 + overflow-x + 内滚不冒泡——
     header 高度与 provider 数量解耦，master-detail 不再被挤塌。
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
  /* 窄屏栈切换（?view 参数驱动）：查询绑定 dashboard 命名容器（.dashboard-shell，
     SkillsDashboard 单列降档同源阈值 692px）——master-detail 与网格降档共享同一
     断点真相源（批评处置 P2：620px 下 dashboard 已单列而 master-detail 仍双栏）。
     宽屏两类都渲染——master-detail 并列，隐藏类 inert（ProviderView 同族样板）。
     隐藏类仍必须落在 pane 上（修复批 2 P1-2 的 450px 盲区教训）。 */
  @container dashboard (width < 692px) {
    .list-hidden,
    .detail-hidden {
      display: none;
    }
    /* 栈式下列表满宽（索引条的窄宽只服务并列形态）。 */
    .skills-list-pane {
      width: 100%;
    }
    /* 触达地板（r2 评图 TOP5）：窄容器下 chips 视觉 28px 低于 44px 点击区
       要求（AGENTS §7.2）——::after 外扩 8px 命中区，视觉尺寸不变。 */
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
