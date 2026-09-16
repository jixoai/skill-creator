<!--
  统一建路由体验（redesign-model-tabs-and-agent-panel S1；R7 8.4/8.5/8.6/8.7 重写）。
  用户原始需求 [2026-09-12]：「NewTab = 预设选择页与空白表单是同一表单的两个
  入口态」；「已添加的 provider 可继续添加：slug `${provider}-${n}`（n 从 2 起），
  label `${目录label} (1)`、`(2)`…（apiKeyEnv 随新 slug 派生，凭据各自独立）」；
  「api 从自由输入改为 Select（DSH_ROUTE_API_PROTOCOLS）」；「模型补全源 = 全部
  已知供应商的模型并集（Set 去重、排序；手输仍允许任意 id）」；「Models 区重构为
  模型 list-item 列表（含连接测试）」。
  用户原始需求 [2026-09-12 R10]：「@cf/... 这明显是无效的」（补全池当前草案
  provider 置顶、跨 provider 剔命名空间 id）；「Add model 默认 efforts 三档
  Low/High/Max」。
  用户原始需求 [2026-09-12 R14-A]：「你现在 New 和 Edit 还是两个独立的。两个
  应该是一样的。在 New 选中某个预设后，等于立刻添加了这个预设。这时候就已经
  可以删除和保存了。」
  正交意图：
  1. pick 态：搜索 + 2 列卡片网格（目录全量 + 「Your presets」本地分组置顶、
     hover × 删除）；已建路由的目录卡显示 Added ✓（×N 计数）。卡片点击 =
     立即建路由（编号 slug；目录卡带 top-4 image 优先模型 catalogEntryDefaults
     富预填，preset 卡全量 + 默认三档 efforts），成功即 onadded 进编辑态；
     rejected/error 留在 pick 态内联报错。不再有「pick → form → Add」三段流。
  2. form 态（仅 Start from scratch 与 env seed 两个入口）：与 RouteTabContent
     同一字段集的新建语境（IconPicker 三控制 / Route name / Base URL / api
     Select / key 输入 / ModelListItem 列表），Create route 校验通过启用；
     R13 key 先落存失败治理沿用；成功即 onadded（分区选中新 tab 并引导粘 key）。
  3. 建路由源三态：目录条目（编号 slug + top-4 image 优先模型，catalogEntryDefaults
     富预填：name/contextWindow/inputTypes/maxOutputTokens/outputTypes/efforts 三档）、
     本地 preset（全量 + 默认三档 + icon 三控制/iconSuppressed 原样）、seed（env
     注入的活动 provider 名——唯一仍走 form 预填的目录外路径）。
-->
<script lang="ts">
  import IconEye from "@lucide/svelte/icons/eye";
  import IconEyeOff from "@lucide/svelte/icons/eye-off";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import IconPicker from "./IconPicker.svelte";
  import ModelListItem from "./ModelListItem.svelte";
  import { hueAvatarColor, routeLetter } from "./route-icon.js";
  import { nextRouteSlug, numberedSlugParts, routeDisplayLabel } from "./route-naming.js";
  import {
    catalogEntryDefaults,
    catalogModelCandidates,
    DEFAULT_MODEL_EFFORTS,
    type RouteModelEntry,
  } from "./model-fields.js";
  import {
    deleteProviderPreset,
    loadProviderPresets,
    providerPresets,
    type LocalProviderPreset,
  } from "$lib/stores/provider-presets.svelte";
  import {
    agentRuntimeConfig,
    setAgentCredential,
    updateAgentSettings,
  } from "$lib/stores/agent.svelte";
  import {
    DSH_ROUTE_API_PROTOCOLS,
    type DshModelRoute,
    type ModelProviderCatalogEntry,
  } from "$shared/contracts/dsh-runtime.js";

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

  const DEFAULT_API = "anthropic-messages";

  // svelte-ignore state_referenced_locally
  let mode = $state<"pick" | "form">(initialMode);
  let filter = $state("");
  let searchInput = $state<HTMLInputElement | null>(null);

  /** form 草稿（预设/空白/seed 三种起点共享同一字段集）。 */
  // svelte-ignore state_referenced_locally
  let draftProvider = $state(seed?.provider ?? "");
  let draftIcon = $state<string | undefined>(undefined);
  let draftIconColor = $state<string | undefined>(undefined);
  let draftIconLetter = $state<string | undefined>(undefined);
  /** 显式无图标（preset 应用；codex R7 B3 的 iconSuppressed 草稿态）。 */
  let draftIconSuppressed = $state<boolean | undefined>(undefined);
  let draftBaseURL = $state("");
  /** R13：路由级 key 草稿（表单起点即可填；测试直传，add 成功后落凭据存储）。 */
  let formKeyText = $state("");
  let formKeyVisible = $state(false);
  const formKey = $derived(formKeyText.trim());
  // svelte-ignore state_referenced_locally
  let draftApi = $state(DEFAULT_API);
  // svelte-ignore state_referenced_locally
  let draftModels = $state<RouteModelEntry[]>(
    seed?.models ? seed.models.map((id) => seedModelEntry(id)) : [],
  );
  // svelte-ignore state_referenced_locally
  let draftModelsValid = $state<boolean[]>(seed?.models ? seed.models.map(() => true) : []);
  let urlTouched = $state(false);
  let nameTouched = $state(false);
  let rejection = $state<string | null>(null);

  const view = $derived(agentRuntimeConfig.view);
  const routes = $derived(view?.settings.modelRoutes ?? []);
  const catalogIconList = $derived(
    (catalog?.providers ?? []).flatMap((entry) =>
      entry.icon ? [{ provider: entry.provider, icon: entry.icon }] : [],
    ),
  );
  const providerName = $derived(draftProvider.trim());
  /** 补全池（R10-1）：草案 provider（编号 slug 归一 base）命中目录时其模型置顶
   * （含命名空间 id），其余供应商剔除命名空间 id；未定名 = 纯净化并集。 */
  const modelCandidates = $derived(
    catalogModelCandidates(catalog, numberedSlugParts(providerName)?.base ?? providerName),
  );
  const displayName = $derived(routeDisplayLabel({ provider: providerName }, catalog));
  const draftLetter = $derived(
    routeLetter({ provider: providerName, iconLetter: draftIconLetter }, displayName),
  );
  const draftColor = $derived(draftIconColor ?? hueAvatarColor(providerName || "route"));
  /** 图标草案回退：目录基础 provider 的图标（scratch 后手输既有 provider 名时对齐）；
   * iconSuppressed = true 时抑制一切回退（显式无图标，走 Letter 头像）。 */
  const draftIconEffective = $derived.by(() => {
    if (draftIconSuppressed === true) return null;
    if (draftIcon !== undefined) return draftIcon;
    const base = numberedSlugParts(providerName)?.base ?? providerName;
    return catalog?.providers.find((entry) => entry.provider === base)?.icon ?? null;
  });
  /** effort 补全数据源（codex R7 B2）：已存路由 + 当前草案的模型并集。 */
  const allRouteModels = $derived([...routes.flatMap((route) => route.models), ...draftModels]);
  const duplicate = $derived(
    providerName.length > 0 && routes.some((route) => route.provider === providerName),
  );
  const urlValid = $derived(/^https?:\/\//.test(draftBaseURL.trim()));
  const modelsAllValid = $derived(
    draftModelsValid.length === draftModels.length && draftModelsValid.every((flag) => flag),
  );
  const canSubmit = $derived(
    providerName.length > 0 &&
      !duplicate &&
      urlValid &&
      draftModels.length > 0 &&
      modelsAllValid &&
      !agentRuntimeConfig.updating,
  );
  /** 草案 provider 的已存凭据（首个副本未保存也能测连接；编号副本无 key 走提示）。 */
  const apiKeyConfigured = $derived(
    view?.providers.some((p) => p.provider === providerName && p.configured) ?? false,
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

  /** 该目录 provider 的已建副本数（含编号 slug；Added ✓ ×N 徽标）。 */
  function copyCount(provider: string): number {
    return routes.filter(
      (route) =>
        route.provider === provider || numberedSlugParts(route.provider)?.base === provider,
    ).length;
  }

  /** seed 模型条目：目录同 id 模型走 catalogEntryDefaults（R10-3/4/5 富预填，
   * B7 contextWindow 语义包含在内）；未命中 = 裸 id + 默认三档 efforts。 */
  function seedModelEntry(id: string): RouteModelEntry {
    const base = numberedSlugParts(seed?.provider ?? "")?.base ?? seed?.provider ?? "";
    const model = catalog?.providers
      .find((entry) => entry.provider === base)
      ?.models.find((entry) => entry.id === id);
    return model !== undefined
      ? catalogEntryDefaults(model)
      : { id, efforts: [...DEFAULT_MODEL_EFFORTS] };
  }

  // 挂载：加载本地 presets + pick 态聚焦搜索框。
  // loadProviderPresets 同步写 + 读 providerPresets.list——放进 $effect 会构成
  // 「effect 读写同一状态」死循环（effect_update_depth_exceeded，组件僵死）。
  // 组件初始化体是非响应上下文，此处直调安全（B1 根因修复）。
  loadProviderPresets();
  $effect(() => {
    if (mode === "pick") searchInput?.focus();
  });

  /** scratch 进入 form 态（R14-A 后 form 的唯一入口之一；env seed 走 initialMode）。 */
  function startFromScratch(): void {
    draftProvider = "";
    draftIcon = undefined;
    draftIconColor = undefined;
    draftIconLetter = undefined;
    draftIconSuppressed = undefined;
    draftBaseURL = "";
    draftApi = DEFAULT_API;
    draftModels = [];
    draftModelsValid = [];
    mode = "form";
    urlTouched = false;
    nameTouched = false;
    rejection = null;
  }

  /** 立即建路由尾段（R14-A：pick 卡与 form Create route 共用）：null（断线/
   * 代次失效）静默返回；rejected/error 投影 rejection 并留在当前态；成功
   * onadded（分区选中新 tab 进编辑态）。 */
  async function createRoute(route: DshModelRoute): Promise<void> {
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

  /** 目录卡点击 = 立即添加（R14-A）：编号 slug（R7 8.4：已添加可再加，zai →
   * zai-2）+ 目录 baseURL/api/icon + top-4 image 优先模型富预填。 */
  async function createFromCatalog(entry: ModelProviderCatalogEntry): Promise<void> {
    if (agentRuntimeConfig.updating) return;
    const route: DshModelRoute = {
      provider: nextRouteSlug(entry.provider, routes),
      baseURL: entry.baseURL,
      api: entry.api,
      models: [...entry.models]
        .sort((a, b) => Number(b.image) - Number(a.image))
        .slice(0, 4)
        .map((model) => catalogEntryDefaults(model)),
      ...(entry.icon ? { icon: entry.icon } : {}),
    };
    await createRoute(route);
  }

  /** 本地 preset 卡点击 = 立即添加（R14-A）：全量模型 + 默认三档 efforts；
   * icon 三控制与显式无图标（iconSuppressed）原样进路由。 */
  async function createFromPreset(preset: LocalProviderPreset): Promise<void> {
    if (agentRuntimeConfig.updating) return;
    const route: DshModelRoute = {
      provider: nextRouteSlug(preset.provider, routes),
      baseURL: preset.baseURL,
      api: preset.api ?? DEFAULT_API,
      models: preset.models.map((id) => ({ id, efforts: [...DEFAULT_MODEL_EFFORTS] })),
      ...(preset.icon ? { icon: preset.icon } : {}),
      ...(preset.iconColor ? { iconColor: preset.iconColor } : {}),
      ...(preset.iconLetter ? { iconLetter: preset.iconLetter } : {}),
      ...(preset.iconSuppressed ? { iconSuppressed: true } : {}),
    };
    await createRoute(route);
  }

  function setModelAt(index: number, next: RouteModelEntry): void {
    draftModels = draftModels.map((entry, i) => (i === index ? next : entry));
  }

  function setModelValidity(index: number, valid: boolean): void {
    if (draftModelsValid[index] === valid) return;
    draftModelsValid = draftModelsValid.map((flag, i) => (i === index ? valid : flag));
  }

  function removeModel(index: number): void {
    draftModels = draftModels.filter((_, i) => i !== index);
    draftModelsValid = draftModelsValid.filter((_, i) => i !== index);
  }

  /** 新增条目（R10-5）：efforts 默认三档写入草稿（Create route 持久化）；空 id 展开态。 */
  function addModel(): void {
    draftModels = [...draftModels, { id: "", efforts: [...DEFAULT_MODEL_EFFORTS] }];
    draftModelsValid = [...draftModelsValid, false];
  }

  async function addRoute(): Promise<void> {
    if (!canSubmit) return;
    // R13 codex P1：key 先落存——失败（rejected/断线 null）→ 内联错误 + 留在表单，
    // 不创建路由。成功后路由创建失败会留下孤立凭据（无害：slug 未被引用，重加
    // 同 slug 直接复用）。
    if (formKey.length > 0) {
      // undefined/null（RPC 替换或异常被上游吞掉）同按失败治理——绝不静默成功。
      const credResult = await setAgentCredential(providerName, formKey);
      if (credResult == null || credResult.outcome === "rejected") {
        rejection =
          credResult == null
            ? "Could not save the API key — connection unavailable. The route was not created."
            : `${credResult.code}: ${credResult.detail}`;
        return;
      }
    }
    const route: DshModelRoute = {
      provider: providerName,
      baseURL: draftBaseURL.trim(),
      api: draftApi,
      models: draftModels.map((entry) => ({ ...entry })),
      ...(draftIcon ? { icon: draftIcon } : {}),
      ...(draftIconColor ? { iconColor: draftIconColor } : {}),
      ...(draftIconLetter ? { iconLetter: draftIconLetter } : {}),
      ...(draftIconSuppressed ? { iconSuppressed: true } : {}),
    };
    await createRoute(route);
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

    {#if rejection}
      <!-- R14-A：pick 卡立即建路由失败（rejected/error）留在 pick 态内联报错。 -->
      <p class="text-xs text-destructive" role="alert">{rejection}</p>
    {/if}

    {#if catalogError}
      <p class="text-[10px] text-destructive" role="alert">{catalogError}</p>
    {:else if catalog === null}
      <p class="py-3 text-center text-[10px] text-muted-foreground">
        {catalogLoading ? "Loading catalog…" : "Catalog unavailable."}
      </p>
    {:else}
      <!-- C2 滚动所有权：画廊自然流式——滚动只属于 Model 分区的 tab 内容容器
           （52vh 独立滚容器与 Dialog 高度上限不联动，曾出双滚条）。 -->
      <div class="space-y-2">
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
                    disabled={agentRuntimeConfig.updating}
                    onclick={() => void createFromPreset(preset)}
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
                        style="background: {preset.iconColor ?? hueAvatarColor(preset.provider)}"
                        aria-hidden="true"
                      >
                        {routeLetter(
                          { provider: preset.provider, iconLetter: preset.iconLetter },
                          preset.label,
                        )}
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
              {@const copies = copyCount(entry.provider)}
              {@const cardTitle =
                copies > 0
                  ? `${entry.baseURL} · ${entry.api} · ${copies} copies added — click to add another`
                  : `${entry.baseURL} · ${entry.api}`}
              <button
                type="button"
                class="flex w-full items-center gap-2 rounded-md border border-border p-2 text-left transition-colors hover:border-primary/50 hover:bg-primary/5"
                title={cardTitle}
                disabled={agentRuntimeConfig.updating}
                onclick={() => void createFromCatalog(entry)}
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
                    style="background: {hueAvatarColor(entry.provider)}"
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
                  {#if copies > 0}
                    <span
                      class="rounded bg-primary/10 px-1 text-[9px] text-primary"
                      title="{copies} cop{copies === 1
                        ? 'y'
                        : 'ies'} of this provider already added — you can add another"
                    >
                      Added ✓{copies > 1 ? ` ×${copies}` : ""}
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
    <!-- 1 · Identity（图标三控制 + Route name） -->
    <div class="flex items-center gap-2">
      <IconPicker
        icon={draftIconEffective}
        letter={draftLetter}
        color={draftColor}
        provider={providerName || "route"}
        label={displayName}
        catalogIcons={catalogIconList}
        disabled={agentRuntimeConfig.updating}
        onPick={(icon) => {
          draftIcon = icon;
          // 选图标 = 解除抑制（与 RouteTabContent 的 applyIdentity 语义一致）。
          draftIconSuppressed = undefined;
        }}
        onSuppress={() => (draftIconSuppressed = true)}
        onColor={(iconColor) => (draftIconColor = iconColor)}
        onLetter={(iconLetter) => (draftIconLetter = iconLetter)}
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

    <!-- 2 · Endpoint（baseURL + api Select 统一字段） -->
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
    <label class="block space-y-0.5">
      <span class="text-[10px] text-muted-foreground">API protocol</span>
      <select
        class="h-8 w-full rounded-md border border-border bg-background px-2 text-xs"
        aria-label="API protocol"
        bind:value={draftApi}
        disabled={agentRuntimeConfig.updating}
      >
        {#each DSH_ROUTE_API_PROTOCOLS as protocol (protocol)}
          <option value={protocol}>{protocol}</option>
        {/each}
      </select>
    </label>

    <!-- R13：路由级 API key 从表单起点即可填写（用户：「一开始就要能填写，否则
         无法做 api-test」）——password + eye；连接测试优先直传此值；Create route
         成功后写入凭据存储。 -->
    <div class="block space-y-0.5">
      <span class="text-[10px] text-muted-foreground">API key</span>
      <div class="relative">
        <Input
          class="h-8 pr-9 text-xs"
          type={formKeyVisible ? "text" : "password"}
          autocomplete="off"
          aria-label="API key"
          placeholder={apiKeyConfigured ? "stored — this key overrides for add & test" : "API key"}
          bind:value={formKeyText}
          disabled={agentRuntimeConfig.updating}
        />
        <button
          type="button"
          class="absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground transition-colors after:absolute after:-inset-2.5 after:content-[''] hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
          aria-label={formKeyVisible ? "Hide API key" : "Show API key"}
          aria-pressed={formKeyVisible}
          title={formKeyVisible ? "Hide API key" : "Show API key"}
          disabled={agentRuntimeConfig.updating}
          onmousedown={(event) => event.preventDefault()}
          onclick={() => (formKeyVisible = !formKeyVisible)}
        >
          {#if formKeyVisible}
            <IconEyeOff class="h-3.5 w-3.5" aria-hidden="true" />
          {:else}
            <IconEye class="h-3.5 w-3.5" aria-hidden="true" />
          {/if}
        </button>
      </div>
    </div>

    <!-- 3 · Models（ModelListItem 列表；R7 8.7） -->
    <div class="space-y-1.5">
      <div class="flex items-center justify-between">
        <span class="text-[10px] font-medium text-muted-foreground">Models</span>
        <Button
          size="sm"
          variant="ghost"
          class="h-6 px-2 text-[11px]"
          disabled={agentRuntimeConfig.updating}
          onclick={addModel}
        >
          + Add model
        </Button>
      </div>
      {#if draftModels.length === 0}
        <p
          class="rounded-md border border-dashed p-2 text-center text-[10px] text-muted-foreground"
        >
          No models yet — add one to enable the route.
        </p>
      {/if}
      <div class="space-y-1.5">
        {#each draftModels as entry, index (index)}
          <ModelListItem
            model={entry}
            candidates={modelCandidates}
            routeModels={allRouteModels}
            api={draftApi}
            baseURL={draftBaseURL.trim()}
            provider={providerName}
            {apiKeyConfigured}
            {formKey}
            disabled={agentRuntimeConfig.updating}
            initialExpanded={entry.id === ""}
            onchange={(next) => setModelAt(index, next)}
            onremove={() => removeModel(index)}
            onvalidity={(valid) => setModelValidity(index, valid)}
          />
        {/each}
      </div>
    </div>

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
        Create route
      </Button>
    </div>
  </div>
{/if}
