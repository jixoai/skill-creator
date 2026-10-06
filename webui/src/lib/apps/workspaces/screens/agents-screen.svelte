<!--
  用户原始需求 [2026-10-02]（skills-dashboard design §3）：「provider 卡片列表：
  agent 名 / root 路径 / skill 计数 / 可写性徽标；点击 = 主屏 provider 筛选联动
  （chips 选中态同步）」。
  修订 [2026-10-06]（skills-tabs-redesign 批 4，design Δ5 路径 1 收窄）：卡片 →
  高密度诊断行（20-30+ provider 一屏可扫）：initials 标识 + label + mono 路径 +
  available/writable 徽标 + skillCount——只用现有投影字段；上方搜索过滤
  （label/path 子串，本地 $state 不进 URL——q 键归 Skills 屏全文检索）+
  可写|只读两组 sticky 分组头 + 组计数 + 搜索空态。
  正交意图：
  1. provider catalog 投影（workspace.list 数据源，无新 RPC）：分组行渲染
     （含不可用条目——「Not found on disk」；可写性徽标以在盘为前提，P2-9）。
  2. 行主体点击 → 主屏 provider chip 筛选联动（?provider= 选中态同源，toggle
     语义保留）；行尾 Insights 入口 → /w/:wsId/skills/insights/:providerId
     ——两个独立可聚焦操作，键盘/触摸互不侵接。
  3. 【禁做】（Δ5 假数据禁令）：健康度百分比、finding 短标、任何 per-provider
     聚合——投影只有 id/label/path/available/writable/skillCount。
-->
<script lang="ts">
  import { useSearch, goById } from "$lib/shell";
  import { workspaceState } from "$lib/store.svelte";
  import { t } from "$lib/i18n";
  import type {
    ProviderId,
    WorkspaceId,
    WorkspaceProvider,
  } from "$shared/contracts/workspaces.js";
  import { Badge } from "$lib/components/ui/badge";
  import IconArrowRight from "@lucide/svelte/icons/arrow-right";
  import IconGraph from "@lucide/svelte/icons/network";
  import IconSearch from "@lucide/svelte/icons/search";
  import IconShieldOff from "@lucide/svelte/icons/shield-off";
  import IconX from "@lucide/svelte/icons/x";

  type DashboardSearch = {
    tab?: "skills" | "agents" | "repos";
    provider?: ProviderId;
    q?: string;
    skill?: string;
    view?: "list" | "detail";
    duplicates?: "1";
  };

  let { wsId }: { wsId: WorkspaceId } = $props();

  const getSearch = useSearch<DashboardSearch>();
  const search = $derived(getSearch?.() ?? {});
  const providerFilter = $derived(search.provider ?? null);

  /** 当前 ws 的 provider catalog 投影（workspace.list 全局态；+layout 首载）。 */
  const providers = $derived(
    workspaceState.workspaces.find((ws) => ws.id === wsId)?.providers ?? [],
  );

  const totalSkills = $derived(
    providers.reduce((sum, provider) => sum + (provider.skillCount ?? 0), 0),
  );

  // ---- 搜索窗口（客户端子串过滤；本地态，跨 Tab 不泄漏） ----
  let query = $state("");
  let searchInputEl = $state<HTMLInputElement | null>(null);
  const normalizedQuery = $derived(query.trim().toLowerCase());
  const searching = $derived(normalizedQuery.length > 0);

  function matchesQuery(provider: WorkspaceProvider): boolean {
    if (!searching) return true;
    return (
      provider.label.toLowerCase().includes(normalizedQuery) ||
      (provider.path ?? "").toLowerCase().includes(normalizedQuery)
    );
  }

  const filteredProviders = $derived(providers.filter(matchesQuery));

  /** 组内扫描序：在盘前置、label/id 码点序（确定性，不依赖 ICU locale）。 */
  function scanOrder(list: WorkspaceProvider[]): WorkspaceProvider[] {
    return [...list].sort((left, right) => {
      if (left.available !== right.available) return left.available ? -1 : 1;
      if (left.label !== right.label) return left.label < right.label ? -1 : 1;
      return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
    });
  }

  const writableGroup = $derived(
    scanOrder(filteredProviders.filter((provider) => provider.writable)),
  );
  const readonlyGroup = $derived(
    scanOrder(filteredProviders.filter((provider) => !provider.writable)),
  );

  function clearSearch(): void {
    query = "";
    searchInputEl?.focus();
  }

  /** 行标识 initials：词首码点（多词取前两词，否则首两个码点）；确定性，无图标伪造。 */
  function initialsOf(label: string): string {
    const words = label.trim().split(/\s+/).filter(Boolean);
    if (words.length >= 2) {
      return (Array.from(words[0]!)[0]! + Array.from(words[1]!)[0]!).toUpperCase();
    }
    return Array.from(words[0] ?? "")
      .slice(0, 2)
      .join("")
      .toUpperCase();
  }

  function filterByProvider(providerId: ProviderId): void {
    goById(
      "workspaces.provider",
      { wsId },
      {
        ...search,
        tab: undefined,
        provider: providerFilter === providerId ? undefined : providerId,
        // 切 provider = 回主屏列表态：skill/view 一并清空（走查 14-fix——detail
        // 态点卡片曾残留无身份 ?view=detail，主屏落空白详情位）。
        skill: undefined,
        view: undefined,
      },
    );
  }

  function viewFindings(providerId: ProviderId): void {
    goById("workspaces.insights", { wsId, providerId }, {});
  }
</script>

{#snippet agentRow(provider: WorkspaceProvider)}
  <div
    class="agents-row flex items-stretch border-b border-border/70 {providerFilter === provider.id
      ? 'bg-accent/60'
      : ''}"
    data-testid="agents-row"
    data-provider-id={provider.id}
  >
    <!-- 操作 1（行主体）：跳 Skills Tab 带 provider 筛选（toggle）。 -->
    <button
      type="button"
      class="agents-row-main flex min-w-0 flex-1 items-center gap-2.5 py-1.5 pl-4 text-left transition-colors hover:bg-muted/50"
      aria-pressed={providerFilter === provider.id}
      onclick={() => filterByProvider(provider.id)}
      title={provider.path ?? provider.label}
    >
      <span class="agents-avatar shrink-0" aria-hidden="true">{initialsOf(provider.label)}</span>
      <span class="flex min-w-0 flex-1 flex-col gap-px">
        <span class="flex min-w-0 items-center gap-1.5">
          <span class="agents-label min-w-0 truncate">{provider.label}</span>
          <!-- 可写性徽标（2.2 处置批 P2-9）：磁盘缺失（!available）行不给
               writable/readonly 徽标——目录不存在时「可写」是未经检验的断言；
               缺失语义由下方「Not found on disk」行独自承担。 -->
          {#if provider.available}
            {#if provider.writable}
              <Badge variant="outline" class="shrink-0 text-[10px]">
                {t("agentsScreen.writable")}
              </Badge>
            {:else}
              <Badge variant="outline" class="shrink-0 text-[10px]">
                <IconShieldOff class="h-3 w-3" />
                {t("agentsScreen.readonly")}
              </Badge>
            {/if}
          {/if}
          {#if providerFilter === provider.id}
            <span
              class="shrink-0 text-[10px] font-medium uppercase tracking-wide text-primary"
            >
              {t("agentsScreen.filtered")}
            </span>
          {/if}
        </span>
        {#if !provider.available}
          <span class="agents-path">{t("agentsScreen.notFound")}</span>
        {:else if provider.path}
          <span class="agents-path">{provider.path}</span>
        {/if}
      </span>
      <span class="agents-count mr-1 shrink-0 {provider.skillCount === 0 ? 'opacity-50' : ''}">
        <span class="sr-only">{t("agentsScreen.skillsCountAria", { count: provider.skillCount })}</span>
        <span aria-hidden="true">{provider.skillCount}</span>
      </span>
    </button>
    <!-- 操作 2（行尾）：Insights 独立可聚焦入口——与行主体互不嵌套。 -->
    <button
      type="button"
      class="agents-row-action flex shrink-0 items-center gap-1 border-l border-border/50 px-2.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      onclick={() => viewFindings(provider.id)}
      aria-label={t("agentsScreen.insightsAction")}
      title={t("agentsScreen.insightsAction")}
      data-testid="agents-row-action"
    >
      <IconGraph class="h-3.5 w-3.5 shrink-0" />
      <!-- 窄屏图标态收敛单位：文字 + 箭头同包裹（纯 span 可被组件 CSS 作用域
           命中；图标组件边界类不可作用域）。 -->
      <span class="agents-action-extra flex min-w-0 items-center gap-1">
        <span class="agents-action-text whitespace-nowrap">
          {t("agentsScreen.insightsAction")}
        </span>
        <IconArrowRight class="h-3 w-3 shrink-0" aria-hidden="true" />
      </span>
    </button>
  </div>
{/snippet}

<section class="screen" data-screen="agents" aria-label={t("agentsScreen.aria")}>
  <header class="shrink-0 border-b border-border px-4 py-3">
    <div class="flex min-w-0 items-center gap-2">
      <h2 class="min-w-0 truncate text-sm font-semibold">{t("agentsScreen.title")}</h2>
      <Badge variant="secondary" class="tabular-nums">{totalSkills}</Badge>
    </div>
    <p class="mt-0.5 text-xs text-muted-foreground">{t("agentsScreen.subtitle")}</p>
  </header>
  {#if providers.length === 0}
    <div class="screen-body">
      <p class="px-4 py-6 text-xs text-muted-foreground">{t("agentsScreen.empty")}</p>
    </div>
  {:else}
    <div class="shrink-0 border-b border-border/70 px-4 py-2">
      <div class="relative">
        <IconSearch
          class="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
        />
        <input
          bind:this={searchInputEl}
          bind:value={query}
          type="text"
          class="agents-search-input h-7 w-full min-w-0 rounded-md border border-input bg-input/20 pl-7 pr-8 text-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
          placeholder={t("agentsScreen.searchPlaceholder")}
          aria-label={t("agentsScreen.searchAria")}
          data-testid="agents-search"
        />
        {#if searching}
          <button
            type="button"
            class="agents-search-clear absolute right-1 top-1/2 flex -translate-y-1/2 items-center justify-center rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label={t("agentsScreen.clearSearch")}
            onclick={clearSearch}
            data-testid="agents-search-clear"
          >
            <IconX class="h-3.5 w-3.5" />
          </button>
        {/if}
      </div>
      {#if searching}
        <p
          class="mt-1.5 text-[11px] tabular-nums text-muted-foreground"
          data-testid="agents-showing"
        >
          {t("agentsScreen.showingOf", { visible: filteredProviders.length, total: providers.length })}
        </p>
      {/if}
    </div>
    <div class="screen-body">
      {#if filteredProviders.length === 0}
        <div class="px-4 py-6" data-testid="agents-search-empty">
          <p class="text-xs text-muted-foreground">
            {t("agentsScreen.searchEmpty", { query: query.trim() })}
          </p>
          <button
            type="button"
            class="mt-2 flex min-h-7 items-center rounded-md px-2 text-xs text-primary transition-colors hover:bg-muted"
            onclick={clearSearch}
          >
            {t("agentsScreen.clearSearch")}
          </button>
        </div>
      {:else}
        {#if writableGroup.length > 0}
          <section
            class="agents-group"
            aria-label={t("agentsScreen.groupWritable")}
            data-testid="agents-group-writable"
          >
            <div class="agents-group-head">
              <span>{t("agentsScreen.groupWritable")}</span>
              <span class="tabular-nums">{writableGroup.length}</span>
            </div>
            {#each writableGroup as provider (provider.id)}
              {@render agentRow(provider)}
            {/each}
          </section>
        {/if}
        {#if readonlyGroup.length > 0}
          <section
            class="agents-group"
            aria-label={t("agentsScreen.groupReadonly")}
            data-testid="agents-group-readonly"
          >
            <div class="agents-group-head">
              <span>{t("agentsScreen.groupReadonly")}</span>
              <span class="tabular-nums">{readonlyGroup.length}</span>
            </div>
            {#each readonlyGroup as provider (provider.id)}
              {@render agentRow(provider)}
            {/each}
          </section>
        {/if}
      {/if}
    </div>
  {/if}
</section>

<style>
  /* 分组头：screen-body 滚动容器内 sticky（组上下文随扫读常驻）。 */
  .agents-group-head {
    position: sticky;
    top: 0;
    z-index: 10;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 5px 16px 4px;
    background: var(--background, #fff);
    border-bottom: 1px solid var(--border, #e5e7eb);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted-foreground, #71717a);
  }

  /* 诊断行密度：标识 + 两行身份列（label/mono path）+ 计数；主/尾操作纵向
     分隔（border-l），行主体与行尾各自独立命中区。 */
  .agents-row-main {
    min-height: 40px;
  }
  .agents-avatar {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border-radius: 7px;
    background: var(--muted, #f4f4f5);
    color: var(--foreground, #18181b);
    font-size: 10.5px;
    font-weight: 650;
    letter-spacing: 0.02em;
  }
  .agents-label {
    font-size: 12.5px;
    font-weight: 550;
    color: var(--foreground, #18181b);
  }
  .agents-path {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--mono, ui-monospace, monospace);
    font-size: 10.5px;
    color: var(--muted-foreground, #71717a);
  }
  .agents-count {
    min-width: 2ch;
    text-align: right;
    font-size: 11px;
    color: var(--muted-foreground, #71717a);
    font-variant-numeric: tabular-nums;
  }
  .agents-row-action {
    min-height: 40px;
  }

  /* 窄屏（与 TabsHeader 栈切换共享 692px 容器真相源）：行/动作触达 ≥44px
     （AGENTS §7.2）；Insights 收敛为图标态（aria-label 承担可访问名称），
     与行主体命中区互不侵接。 */
  @container dashboard (width < 692px) {
    .agents-search-input {
      min-height: 44px;
    }
    .agents-search-clear {
      min-width: 44px;
      min-height: 44px;
      margin: -8px -10px -8px -6px;
    }
    .agents-row-main {
      min-height: 44px;
      padding-left: 12px;
    }
    .agents-row-action {
      min-height: 44px;
      min-width: 44px;
      justify-content: center;
      padding: 0 10px;
    }
    .agents-action-extra {
      display: none;
    }
  }
</style>
