<!--
  统一建路由体验（redesign-model-tabs-and-agent-panel S1，design §2.4）。
  用户原始需求 [2026-09-12]：「NewTab = 预设选择页与空白表单是同一表单的两个
  入口态。Provider 预设与 Custom 不是两种配置类型，而是同一份 Custom 表单的
  『预填』与『空白』两种起始态。」
  正交意图：
  1. pick 态：搜索 + 2 列卡片网格（目录全量 + 「Your presets」本地分组置顶、
     hover × 删除；已建路由的目录卡 Added ✓ 置灰）——旧画廊逻辑整体搬入。
  2. form 态：与 RouteTabContent 同一字段集的新建语境（IconPicker / Route name /
     Base URL / 自定义必填 api / Models tags），Add route 校验通过启用；
     成功即 onadded（分区选中新 tab 并引导粘 key）。
  3. 预填源三态：目录条目（top-4 image 优先模型）、本地 preset（全量）、seed
     （env 注入的活动 provider 名——「active outside tabs」chip 的落点）。
-->
<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import IconPicker from "./IconPicker.svelte";
  import ModelTagsInput from "./ModelTagsInput.svelte";
  import { avatarHue } from "./route-icon.js";
  import {
    deleteProviderPreset,
    loadProviderPresets,
    providerPresets,
    type LocalProviderPreset,
  } from "$lib/stores/provider-presets.svelte";
  import { agentRuntimeConfig, updateAgentSettings } from "$lib/stores/agent.svelte";
  import type { DshModelRoute, ModelProviderCatalogEntry } from "$shared/contracts/dsh-runtime.js";

  interface Props {
    catalog: { providers: ModelProviderCatalogEntry[] } | null;
    catalogError: string | null;
    catalogLoading: boolean;
    initialMode: "pick" | "form";
    /** form 态预填（env 活动路由的 provider 名 + 模型）。 */
    seed?: { provider: string; models?: string[] } | null;
    onadded: (provider: string) => void;
    /** 退出 NewTab（零路由时 pick 态的返回口；有路由时点任意 tab 即退出）。 */
    onclose?: () => void;
  }

  let {
    catalog,
    catalogError,
    catalogLoading,
    initialMode,
    seed = null,
    onadded,
    onclose,
  }: Props = $props();

  // svelte-ignore state_referenced_locally
  let mode = $state<"pick" | "form">(initialMode);
  let filter = $state("");
  let searchInput = $state<HTMLInputElement | null>(null);

  /** form 草稿（预设/空白/seed 三种起点共享同一字段集）。 */
  // svelte-ignore state_referenced_locally
  let draftProvider = $state(seed?.provider ?? "");
  let draftIcon = $state<string | undefined>(undefined);
  let draftBaseURL = $state("");
  let draftApi = $state("anthropic-messages");
  // svelte-ignore state_referenced_locally
  let draftModels = $state<string[]>(seed?.models ? [...seed.models] : []);
  let urlTouched = $state(false);
  let nameTouched = $state(false);
  let modelsTouched = $state(false);
  let rejection = $state<string | null>(null);

  const view = $derived(agentRuntimeConfig.view);
  const routes = $derived(view?.settings.modelRoutes ?? []);
  const catalogIconList = $derived(
    (catalog?.providers ?? []).flatMap((entry) =>
      entry.icon ? [{ provider: entry.provider, icon: entry.icon }] : [],
    ),
  );
  const providerName = $derived(draftProvider.trim());
  const duplicate = $derived(
    providerName.length > 0 && routes.some((route) => route.provider === providerName),
  );
  const catalogMatch = $derived(
    catalog?.providers.find((entry) => entry.provider === providerName),
  );
  const customCandidates = $derived(catalogMatch?.models ?? []);
  const urlValid = $derived(/^https?:\/\//.test(draftBaseURL.trim()));
  const apiNeeded = $derived(catalogMatch === undefined);
  const canSubmit = $derived(
    providerName.length > 0 &&
      !duplicate &&
      urlValid &&
      draftModels.length > 0 &&
      (!apiNeeded || draftApi.trim().length > 0) &&
      !agentRuntimeConfig.updating,
  );

  const filteredProviders = $derived.by(() => {
    const needle = filter.trim().toLowerCase();
    const providers = catalog?.providers ?? [];
    if (needle.length === 0) return providers;
    return providers.filter(
      (entry) =>
        entry.label.toLowerCase().includes(needle) ||
        entry.provider.toLowerCase().includes(needle) ||
        entry.baseURL.toLowerCase().includes(needle),
    );
  });

  const filteredPresets = $derived.by(() => {
    const needle = filter.trim().toLowerCase();
    if (needle.length === 0) return providerPresets.list;
    return providerPresets.list.filter(
      (preset) =>
        preset.label.toLowerCase().includes(needle) ||
        preset.provider.toLowerCase().includes(needle) ||
        preset.baseURL.toLowerCase().includes(needle),
    );
  });

  // 挂载：加载本地 presets + pick 态聚焦搜索框。
  // loadProviderPresets 同步写 + 读 providerPresets.list——放进 $effect 会构成
  // 「effect 读写同一状态」死循环（effect_update_depth_exceeded，组件僵死：
  // Enter 不提交、按钮不响应）。组件初始化体是非响应上下文，此处直调安全
  // （B1 根因修复，回归见 __tests__/model-settings-b1.test.ts）。
  loadProviderPresets();
  $effect(() => {
    if (mode === "pick") searchInput?.focus();
  });

  function enterForm(): void {
    mode = "form";
    urlTouched = false;
    nameTouched = false;
    modelsTouched = false;
    rejection = null;
  }

  function startFromCatalog(entry: ModelProviderCatalogEntry): void {
    draftProvider = entry.provider;
    draftIcon = entry.icon ?? undefined;
    draftBaseURL = entry.baseURL;
    draftApi = entry.api;
    draftModels = [...entry.models]
      .sort((a, b) => Number(b.image) - Number(a.image))
      .slice(0, 4)
      .map((model) => model.id);
    enterForm();
  }

  function startFromPreset(preset: LocalProviderPreset): void {
    draftProvider = preset.provider;
    draftIcon = preset.icon;
    draftBaseURL = preset.baseURL;
    draftApi = preset.api ?? "anthropic-messages";
    draftModels = [...preset.models];
    enterForm();
  }

  function startFromScratch(): void {
    draftProvider = "";
    draftIcon = undefined;
    draftBaseURL = "";
    draftApi = "anthropic-messages";
    draftModels = [];
    enterForm();
  }

  /**
   * 目录条目的 contextWindow（B7）：catalog schema 的同名字段由并行任务补齐，
   * 这里做 optional 读取（类型断言 + runtime 收窄），编译与运行都不依赖它存在；
   * 手输路径（不在目录内）自然保持 undefined。
   */
  function catalogContextWindow(id: string): number | undefined {
    const entry = catalogMatch?.models.find((model) => model.id === id) as
      | { contextWindow?: unknown }
      | undefined;
    const value = entry?.contextWindow;
    return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
  }

  async function addRoute(): Promise<void> {
    if (!canSubmit) return;
    const route: DshModelRoute = {
      provider: providerName,
      baseURL: draftBaseURL.trim(),
      api: catalogMatch ? catalogMatch.api : draftApi.trim() || "anthropic-messages",
      models: draftModels.map((id) => {
        const contextWindow = catalogContextWindow(id);
        return contextWindow === undefined ? { id } : { id, contextWindow };
      }),
      ...(draftIcon ? { icon: draftIcon } : {}),
    };
    const result = await updateAgentSettings({ modelRoutes: [...routes, route] });
    if (!result) return;
    if (result.outcome === "rejected") {
      rejection = `${result.code}: ${result.detail}`;
      return;
    }
    if (result.outcome === "error") {
      rejection = result.message;
      return;
    }
    onadded(route.provider);
  }
</script>

{#if mode === "pick"}
  <div class="space-y-2">
    <div class="flex items-center gap-2">
      <Input
        class="h-8 flex-1 text-xs"
        aria-label="Search providers"
        placeholder="Search providers…"
        ref={searchInput}
        bind:value={filter}
      />
      {#if routes.length === 0 && onclose}
        <Button
          size="sm"
          variant="ghost"
          class="h-8 shrink-0 px-2 text-[11px]"
          onclick={() => onclose?.()}
        >
          Cancel
        </Button>
      {/if}
      <Button
        size="sm"
        variant="ghost"
        class="h-8 shrink-0 px-2 text-[11px]"
        onclick={startFromScratch}
      >
        Start from scratch →
      </Button>
    </div>

    {#if catalogError}
      <p class="text-[10px] text-destructive" role="alert">{catalogError}</p>
    {:else if catalog === null}
      <p class="py-3 text-center text-[10px] text-muted-foreground">
        {catalogLoading ? "Loading catalog…" : "Catalog unavailable."}
      </p>
    {:else}
      <div class="max-h-[52vh] space-y-2 overflow-y-auto pr-1">
        {#if filteredPresets.length > 0}
          <div class="space-y-1">
            <span class="text-[10px] font-medium text-muted-foreground">Your presets</span>
            <div class="grid grid-cols-1 gap-1.5 min-[520px]:grid-cols-2">
              {#each filteredPresets as preset (preset.provider)}
                <div class="group relative">
                  <button
                    type="button"
                    class="flex w-full items-center gap-2 rounded-md border border-border p-2 text-left transition-colors hover:border-primary/50 hover:bg-primary/5"
                    title={preset.baseURL}
                    onclick={() => startFromPreset(preset)}
                  >
                    {#if preset.icon}
                      <img
                        src={preset.icon}
                        alt=""
                        class="h-7 w-7 shrink-0 rounded-md bg-background object-contain p-0.5 dark:invert"
                      />
                    {:else}
                      <span
                        class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold text-white"
                        style="background: hsl({avatarHue(preset.provider)} 55% 45%)"
                        aria-hidden="true"
                      >
                        {preset.label.slice(0, 1).toUpperCase()}
                      </span>
                    {/if}
                    <span class="min-w-0 flex-1">
                      <span class="block truncate text-xs font-medium">{preset.label}</span>
                      <span class="block truncate text-[10px] text-muted-foreground">
                        {preset.baseURL.replace(/^https?:\/\//, "")}
                      </span>
                    </span>
                    <span
                      class="mr-0.5 shrink-0 rounded bg-muted px-1 text-[9px] text-muted-foreground"
                      title="{preset.models.length} saved models"
                    >
                      {preset.models.length}
                    </span>
                  </button>
                  <button
                    type="button"
                    class="absolute right-1 top-1 hidden rounded bg-popover/80 p-0.5 text-muted-foreground hover:text-destructive group-hover:block"
                    aria-label="Delete preset {preset.label}"
                    onclick={() => deleteProviderPreset(preset.provider)}
                  >
                    ×
                  </button>
                </div>
              {/each}
            </div>
          </div>
        {/if}

        <div class="space-y-1">
          <span class="text-[10px] font-medium text-muted-foreground">
            Catalog ({catalog.providers.length} providers, from models.dev)
          </span>
          <div class="grid grid-cols-1 gap-1.5 min-[520px]:grid-cols-2">
            {#each filteredProviders as entry (entry.provider)}
              {@const exists = routes.some((route) => route.provider === entry.provider)}
              <button
                type="button"
                class="flex w-full items-center gap-2 rounded-md border border-border p-2 text-left transition-colors hover:border-primary/50 hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-border disabled:hover:bg-transparent"
                title={`${entry.baseURL} · ${entry.api}`}
                disabled={exists}
                onclick={() => startFromCatalog(entry)}
              >
                {#if entry.icon}
                  <img
                    src={entry.icon}
                    alt=""
                    class="h-7 w-7 shrink-0 rounded-md bg-background object-contain p-0.5 dark:invert"
                  />
                {:else}
                  <span
                    class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold text-white"
                    style="background: hsl({avatarHue(entry.provider)} 55% 45%)"
                    aria-hidden="true"
                  >
                    {entry.label.slice(0, 1).toUpperCase()}
                  </span>
                {/if}
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-xs font-medium">{entry.label}</span>
                  <span class="block truncate text-[10px] text-muted-foreground">
                    {entry.baseURL.replace(/^https?:\/\//, "")}
                  </span>
                </span>
                <span class="mr-0.5 flex shrink-0 items-center gap-1">
                  {#if exists}
                    <span class="rounded bg-primary/10 px-1 text-[9px] text-primary">
                      Added ✓
                    </span>
                  {/if}
                  <span
                    class="rounded bg-muted px-1 text-[9px] text-muted-foreground"
                    title="{entry.models.length} models in catalog"
                  >
                    {entry.models.length}
                  </span>
                </span>
              </button>
            {/each}
            {#if filteredProviders.length === 0}
              <p class="col-span-full py-3 text-center text-[10px] text-muted-foreground">
                No providers match “{filter}”.
              </p>
            {/if}
          </div>
        </div>
      </div>
    {/if}
  </div>
{:else}
  <div class="space-y-3">
    <!-- 1 · Identity -->
    <div class="flex items-center gap-2">
      <IconPicker
        icon={draftIcon ?? catalogMatch?.icon ?? null}
        provider={providerName || "route"}
        label={catalogMatch?.label ?? providerName}
        catalogIcons={catalogIconList}
        disabled={agentRuntimeConfig.updating}
        onPick={(icon) => (draftIcon = icon)}
      />
      <label class="min-w-0 flex-1 space-y-0.5">
        <span class="text-[10px] text-muted-foreground">Route name</span>
        <Input
          class="h-8 text-xs"
          aria-label="Route name"
          placeholder="my-provider"
          bind:value={draftProvider}
          disabled={agentRuntimeConfig.updating}
          onblur={() => (nameTouched = true)}
        />
      </label>
    </div>
    {#if duplicate}
      <p class="text-[10px] text-amber-700" role="alert">
        Route “{providerName}” already exists.
      </p>
    {:else if nameTouched && providerName.length === 0}
      <p class="text-[10px] text-amber-700" role="alert">Custom route needs a name.</p>
    {/if}

    <!-- 2 · Endpoint -->
    <label class="block space-y-0.5">
      <span class="text-[10px] text-muted-foreground">Base URL</span>
      <Input
        class="h-8 font-mono text-xs"
        aria-label="Base URL"
        placeholder="https://api.example.com/v1"
        bind:value={draftBaseURL}
        disabled={agentRuntimeConfig.updating}
        onblur={() => (urlTouched = true)}
      />
    </label>
    {#if urlTouched && !urlValid}
      <p class="text-[10px] text-amber-700" role="alert">Custom route needs an http(s) base URL.</p>
    {/if}
    {#if apiNeeded}
      <label class="block space-y-0.5">
        <span class="text-[10px] text-muted-foreground">
          API protocol (custom route — not in catalog)
        </span>
        <Input
          class="h-8 text-xs"
          aria-label="API protocol"
          placeholder="anthropic-messages"
          list="new-route-api-candidates"
          bind:value={draftApi}
          disabled={agentRuntimeConfig.updating}
        />
        <datalist id="new-route-api-candidates">
          {#each [...new Set((catalog?.providers ?? []).map((entry) => entry.api))] as candidate}
            <option value={candidate}></option>
          {/each}
        </datalist>
      </label>
    {/if}

    <!-- 3 · Models -->
    <label class="block space-y-0.5">
      <span class="text-[10px] text-muted-foreground">Models</span>
      <ModelTagsInput
        selected={draftModels}
        candidates={customCandidates}
        placeholder="Add model id…"
        disabled={agentRuntimeConfig.updating}
        onchange={(next) => {
          draftModels = next;
          modelsTouched = true;
        }}
      />
    </label>
    {#if draftModels.length === 0 && modelsTouched}
      <p class="text-[10px] text-amber-700" role="alert">Custom route needs model ids.</p>
    {/if}

    {#if rejection}
      <p class="text-xs text-destructive" role="alert">{rejection}</p>
    {/if}

    <!-- 4 · 底部动作 -->
    <div class="flex items-center justify-between border-t border-border pt-2">
      <Button size="sm" variant="ghost" class="h-7 px-2 text-xs" onclick={() => (mode = "pick")}>
        Back
      </Button>
      <Button
        size="sm"
        class="h-7 px-2.5 text-xs"
        disabled={!canSubmit}
        onclick={() => void addRoute()}
      >
        Add route
      </Button>
    </div>
  </div>
{/if}
