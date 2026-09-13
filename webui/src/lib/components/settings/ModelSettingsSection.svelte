<!--
  设置面 Model 分区（redesign-model-tabs-and-agent-panel S1 重写：tabs 化）。
  用户原始需求 [2026-09-12]：「ModelSettingsSection 里不再有『画廊 / Routes 列表 /
  Custom 表单』三块混排。画廊只活在 NewTab 的 pick 态里；Routes 列表被 tab 条取代；
  Custom 表单与 tab 内容是同一组件的两个实例化（新建态 vs 编辑态）。」
  正交意图：
  1. tab 条：每条 settings.modelRoutes 一个 tab（16px 图标三级回退 + 12px 名 +
     key 缺失 amber 点 + 活动路由 primary 下划线）；横滚（滚轮纵转横 + 两侧渐隐
     mask），固定 + New；←/→ 焦点移动，Delete 触发删除确认。
  2. 组件路由：RouteTabContent（选中路由）/ NewRouteTab（pick|form 两态）/
  空态 onboarding；tab 选中是纯视图状态，永不写 settings。
  3. 目录与警示：catalog RPC 代次门加载（沿旧逻辑，供 tabs/NewTab/IconPicker 共
  享）；活动模型悬空于 Routes 外（env 注入）→ amber chip + 说明行，点击跳 NewTab
  预填 provider 名。
-->
<script lang="ts">
  import { tick } from "svelte";
  import { Button } from "$lib/components/ui/button";
  import ConfirmDialog from "$lib/components/confirm-dialog.svelte";
  import NewRouteTab from "./NewRouteTab.svelte";
  import RouteTabContent from "./RouteTabContent.svelte";
  import { isLetterAvatar, resolveRouteIcon, routeAvatarColor, routeLetter } from "./route-icon.js";
  import { routeDisplayLabel } from "./route-naming.js";
  import { agentRuntimeConfig, updateAgentSettings } from "$lib/stores/agent.svelte";
  import { getConnectionGeneration, getRpc } from "$lib/stores/connection.svelte";
  import { createRequestGenerationGate } from "$lib/stores/request-generation.js";
  import type { ModelProviderCatalogEntry } from "$shared/contracts/dsh-runtime.js";

  /** 选中 tab（null = NewTab 视图或空态）；纯视图状态。 */
  let selected = $state<string | null>(null);
  let newOpen = $state(false);
  let newInitialMode = $state<"pick" | "form">("pick");
  let newSeed = $state<{ provider: string; models?: string[] } | null>(null);
  /** NewRouteTab 挂载代次（每次打开 +1，保证 seed/mode 重新实例化）。 */
  let newTabSession = $state(0);
  /** 新建成功后的粘 key 引导标记（RouteTabContent 消费后清除）。 */
  let pendingKeyFocus = $state<string | null>(null);
  let removeTarget = $state<string | null>(null);
  let removeOpen = $state(false);
  let removing = $state(false);
  let rejection = $state<string | null>(null);

  /** 画廊目录（一次加载；失败可由下一轮 open 重试）。 */
  let catalog = $state<{ providers: ModelProviderCatalogEntry[] } | null>(null);
  let catalogError = $state<string | null>(null);
  let catalogLoading = $state(false);

  const catalogGate = createRequestGenerationGate(getConnectionGeneration);

  const view = $derived(agentRuntimeConfig.view);
  const routes = $derived(view?.settings.modelRoutes ?? []);
  const selectedRoute = $derived(routes.find((route) => route.provider === selected));
  /** 活动模型引用了 Routes 之外的 provider（env 注入）→ tab 条右端 amber 警示。 */
  const activeOutsideRoutes = $derived(
    view !== null && !routes.some((route) => route.provider === view.settings.model.provider),
  );

  // 选中态归一：路由消失回退首 tab；NewTab 打开时不动选中。
  $effect(() => {
    if (newOpen) return;
    if (selected !== null && !routes.some((route) => route.provider === selected)) {
      selected = null;
    }
    if (selected === null && routes.length > 0) selected = routes[0]!.provider;
  });

  // 打开 Model 分区即拉目录（一次；失败可由下一轮 open 重试）。
  $effect(() => {
    if (catalog === null && catalogError === null && !catalogLoading) void loadCatalog();
  });

  async function loadCatalog(): Promise<void> {
    const request = catalogGate.issue();
    catalogLoading = true;
    try {
      const rpc = getRpc();
      if (!rpc) {
        catalogError = "daemon not connected";
        return;
      }
      const result = await rpc.agent.models.catalog({});
      if (!request.isCurrent()) return;
      catalog = result;
      catalogError = null;
    } catch (error) {
      if (!request.isCurrent()) return;
      catalogError = error instanceof Error ? error.message : String(error);
    } finally {
      if (request.isCurrent()) catalogLoading = false;
    }
  }

  async function apply(patch: Parameters<typeof updateAgentSettings>[0]): Promise<boolean> {
    const result = await updateAgentSettings(patch);
    if (!result) return false;
    if (result.outcome === "rejected") {
      rejection = `${result.code}: ${result.detail}`;
      return false;
    }
    if (result.outcome === "error") {
      rejection = result.message;
      return false;
    }
    rejection = null;
    return true;
  }

  function openNew(
    mode: "pick" | "form",
    seed: { provider: string; models?: string[] } | null = null,
  ): void {
    newSeed = seed;
    newInitialMode = mode;
    newTabSession += 1;
    newOpen = true;
    selected = null;
  }

  /** NewRouteTab 成功落库：选中新 tab 并挂起粘 key 引导。 */
  async function onRouteAdded(provider: string): Promise<void> {
    newOpen = false;
    selected = provider;
    pendingKeyFocus = provider;
    // 新 tab 滚入视野（PM 修复 6b）：等 DOM 更新出 tab 按钮后，横滚容器内
    // nearest 对齐 + smooth；tabRefs 已按 provider 建索引。
    await tick();
    tabRefs[provider]?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }

  /** env 活动路由收编入口：NewTab form 态预填 provider 名 + 当前模型。 */
  function addEnvActiveRoute(): void {
    if (!view) return;
    openNew("form", {
      provider: view.settings.model.provider,
      models: [view.settings.model.model],
    });
  }

  /** 打开删除确认（tab 条 Delete 键与 RouteTabContent 的 Remove 按钮共用）。 */
  function requestRemove(provider: string | null | undefined): void {
    if (!provider) return;
    removeTarget = provider;
    removeOpen = true;
  }

  async function confirmRemove(): Promise<void> {
    const target = removeTarget;
    if (target === null) return;
    removing = true;
    const ok = await apply({ modelRoutes: routes.filter((route) => route.provider !== target) });
    removing = false;
    if (ok) {
      removeOpen = false;
      removeTarget = null;
    }
  }

  // ---- tab 条横滚（滚轮纵转横，non-passive 才能消费 deltaY）----
  let stripEl = $state<HTMLElement | null>(null);
  let canLeft = $state(false);
  let canRight = $state(false);
  let tabRefs = $state<Record<string, HTMLButtonElement | null>>({});

  function refreshScrollState(): void {
    const el = stripEl;
    if (!el) {
      canLeft = false;
      canRight = false;
      return;
    }
    canLeft = el.scrollLeft > 0;
    canRight = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
  }

  $effect(() => {
    const el = stripEl;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      el.scrollLeft += event.deltaY;
      event.preventDefault();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    const observer = new ResizeObserver(() => refreshScrollState());
    observer.observe(el);
    refreshScrollState();
    return () => {
      el.removeEventListener("wheel", onWheel);
      observer.disconnect();
    };
  });
  // 路由数量变化后重算渐隐 mask（effect 在 DOM 更新后运行）。
  $effect(() => {
    void routes.length;
    void catalog;
    refreshScrollState();
  });

  function onTabKeydown(event: KeyboardEvent, index: number): void {
    if (routes.length === 0) return;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const delta = event.key === "ArrowLeft" ? -1 : 1;
      const next = (index + delta + routes.length) % routes.length;
      tabRefs[routes[next]!.provider]?.focus();
    } else if (event.key === "Delete") {
      event.preventDefault();
      requestRemove(routes[index]?.provider);
    }
  }
</script>

<div class="flex h-full min-h-0 flex-col space-y-3">
  <div class="flex items-start justify-between gap-2">
    <div>
      <h3 class="text-sm font-medium">Model</h3>
      <p class="mt-0.5 text-[11px] text-muted-foreground">
        Changes apply immediately to your agent sessions — no restart needed.
      </p>
    </div>
    {#if activeOutsideRoutes && view}
      <button
        type="button"
        class="mt-0.5 shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-700 transition-colors hover:bg-amber-500/25"
        title="The active model ({view.settings.model
          .provider}) rides an env-provided route with no tab — click to add it as a route."
        onclick={addEnvActiveRoute}
      >
        active outside tabs
      </button>
    {/if}
  </div>
</div>
{#if activeOutsideRoutes && view}
  <p class="text-[10px] text-amber-700">
    {view.settings.model.provider} · {view.settings.model.model} (outside Routes) — env-provided; add
    it as a route to manage it here.
  </p>
{/if}

{#if view}
  <!-- tab 条：横滚区 + 固定 + New -->
  <div class="flex items-stretch gap-1 border-b border-border">
    <div class="relative min-w-0 flex-1">
      <div
        class="tab-scroll flex h-9 items-stretch overflow-x-auto"
        bind:this={stripEl}
        onscroll={refreshScrollState}
        role="tablist"
        aria-label="Model routes"
      >
        {#each routes as route, index (route.provider)}
          {@const entry = catalog?.providers.find((p) => p.provider === route.provider)}
          {@const icon = resolveRouteIcon(route, entry)}
          {@const displayLabel = routeDisplayLabel(route, catalog)}
          {@const letter = routeLetter(route, displayLabel)}
          {@const keyReady = view.providers.some(
            (p) => p.provider === route.provider && p.configured,
          )}
          {@const ownsActive = view.settings.model.provider === route.provider}
          <button
            type="button"
            role="tab"
            aria-selected={!newOpen && selected === route.provider}
            class="relative flex h-9 shrink-0 items-center gap-1.5 px-2 text-xs font-medium transition-colors hover:bg-muted/50 {!newOpen &&
            selected === route.provider
              ? 'text-foreground'
              : 'text-muted-foreground hover:text-foreground'}"
            title="{displayLabel} ({route.provider}){ownsActive ? ' · active route' : ''}"
            bind:this={tabRefs[route.provider]}
            onclick={() => {
              selected = route.provider;
              newOpen = false;
            }}
            onkeydown={(event) => onTabKeydown(event, index)}
          >
            {#if icon}
              <span class="relative inline-flex shrink-0">
                <!-- 图标着色（codex R7 B3）：iconColor 以 color-mix 柔化底瓦作用于图片图标。 -->
                <span
                  class="flex h-4 w-4 items-center justify-center rounded"
                  style="background: color-mix(in srgb, {routeAvatarColor(route)} 18%, transparent)"
                  aria-hidden="true"
                >
                  <img
                    src={icon}
                    alt=""
                    class="h-3.5 w-3.5 object-contain {isLetterAvatar(icon) ? '' : 'dark:invert'}"
                  />
                </span>
                {#if !keyReady}
                  <span
                    class="absolute -right-1 -top-0.5 h-1 w-1 rounded-full bg-amber-500"
                    title="API key missing"
                  ></span>
                {/if}
              </span>
            {:else}
              <span
                class="relative inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-[8px] font-semibold text-white"
                style="background: {routeAvatarColor(route)}"
                aria-hidden="true"
              >
                {letter}
                {#if !keyReady}
                  <span
                    class="absolute -right-1 -top-0.5 h-1 w-1 rounded-full bg-amber-500"
                    title="API key missing"
                  ></span>
                {/if}
              </span>
            {/if}
            <span class="max-w-[120px] truncate">{displayLabel}</span>
            <!-- R16 用户裁决：活动路由标记从下划线改为 badge。 -->
            {#if ownsActive}
              <span
                class="rounded bg-primary/10 px-1 py-px text-[9px] font-medium leading-tight text-primary"
                title="Active model's route">active</span
              >
            {/if}
          </button>
        {/each}
      </div>
      {#if canLeft}
        <span
          class="pointer-events-none absolute inset-y-0 left-0 w-2 bg-gradient-to-r from-background to-transparent"
          aria-hidden="true"
        ></span>
      {/if}
      {#if canRight}
        <span
          class="pointer-events-none absolute inset-y-0 right-0 w-2 bg-gradient-to-l from-background to-transparent"
          aria-hidden="true"
        ></span>
      {/if}
    </div>
    <button
      type="button"
      class="h-7 shrink-0 self-center rounded px-2 text-[11px] font-medium transition-colors {newOpen
        ? 'bg-primary/10 text-primary'
        : 'text-muted-foreground hover:bg-muted hover:text-foreground'}"
      onclick={() => (routes.length === 0 ? openNew("form") : openNew("pick"))}
    >
      + New
    </button>
  </div>

  <!-- tab 内容（R16：页面主体自滚——tab 条固定在外，滚动只发生在此容器内）。 -->
  <div class="min-h-0 flex-1 overflow-y-auto pr-0.5">
    {#if newOpen}
      {#key newTabSession}
        <NewRouteTab
          {catalog}
          {catalogError}
          {catalogLoading}
          initialMode={newInitialMode}
          seed={newSeed}
          onadded={onRouteAdded}
          onclose={() => (newOpen = false)}
        />
      {/key}
    {:else if selectedRoute}
      {#key selectedRoute.provider}
        <RouteTabContent
          route={selectedRoute}
          {catalog}
          autoFocusCredential={pendingKeyFocus === selectedRoute.provider}
          onCredentialFocused={() => (pendingKeyFocus = null)}
          onremove={() => requestRemove(selectedRoute?.provider)}
        />
      {/key}
    {:else}
      <!-- 空态 onboarding（不是旧画廊） -->
      <div
        class="flex flex-col items-center gap-2.5 rounded-md border border-dashed p-6 text-center"
      >
        <p class="text-xs font-medium">Add your first model route</p>
        <p class="max-w-[320px] text-[10px] leading-snug text-muted-foreground">
          Pick a provider from the catalog (models.dev mirror) with its models, or point at any
          custom OpenAI/Anthropic-compatible endpoint.
        </p>
        <div class="mt-1 flex gap-2">
          <Button
            size="sm"
            variant="outline"
            class="h-8 px-3 text-xs"
            onclick={() => openNew("pick")}
          >
            Browse providers
          </Button>
          <Button size="sm" class="h-8 px-3 text-xs" onclick={() => openNew("form")}>
            Custom endpoint
          </Button>
        </div>
      </div>
    {/if}
  </div>
{:else if agentRuntimeConfig.loading}
  <div class="text-xs text-muted-foreground">Loading…</div>
{:else}
  <div class="text-xs text-muted-foreground">Model settings unavailable</div>
{/if}

{#if agentRuntimeConfig.error}
  <div class="text-xs text-destructive" role="alert">{agentRuntimeConfig.error}</div>
{/if}
{#if rejection}
  <div class="text-xs text-destructive" role="alert">{rejection}</div>
{/if}

<ConfirmDialog
  bind:open={removeOpen}
  title="Remove route"
  description="Remove the “{removeTarget ??
    ''}” route? Its stored key is kept; if it held the active model, that reference is left outside Routes."
  busy={removing}
  onConfirm={() => void confirmRemove()}
/>

<style>
  /* 横滚区隐藏滚动条（tab 溢出策略：横滚 + 渐隐 mask，不换行不折叠）。 */
  .tab-scroll {
    scrollbar-width: none;
  }
  .tab-scroll::-webkit-scrollbar {
    display: none;
  }
</style>
