<!--
  单路由完整编辑面（redesign-model-tabs-and-agent-panel S1；R7 8.2/8.6/8.7 重写）。
  用户原始需求 [2026-09-12]：「一个 tab 承载一条 DshModelRoute 的全部横向」；
  「颜色与 Letter 分离：图标（含无图标）、头像颜色（iconColor）、Letter 文字
  （iconLetter）三个独立控制」；「api 从自由输入改为 Select（DSH_ROUTE_API_PROTOCOLS），
  预设路径同字段预填可改」；「Models 区重构为模型 list-item 列表 + Add model，
  每条目全字段 + 连接测试；effort 数据源 = 当前模型的 efforts ?? 自由输入」。
  正交意图：
  1. 六块布局：Identity（图标三控制 + 只读路由名 + key pill）/ Credential（折叠
     pill ↔ 展开写入盒）/ Endpoint（baseURL + api Select 脏态显式 Save）/ Models
     （ModelListItem 列表 + dirty Save + validity 门）/ Active（活动路由全形态 vs
     紧凑形态）/ Danger+Preset（右对齐行）。
  2. 写路径：icon/iconColor/iconLetter/models 走 updateAgentSettings({modelRoutes})
     全量补丁；key 走 setAgentCredential/clear 旁路（值永不回流）；活动模型走
     settings.model 单例。
  3. 数据源派生：Active effort 建议词 = 当前模型 efforts（无硬编码数组）；
     ModelListItem 补全池 = 全供应商目录并集（model-fields.catalogModelCandidates）。
  妥协声明：路由名只读——provider 名 = 凭据 env 映射键（dshRouteApiKeyEnv），
  改名等于换身份需重粘 key，以「复制重建」覆盖改名需求（design §7）。
-->
<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import IconPicker from "./IconPicker.svelte";
  import ModelListItem from "./ModelListItem.svelte";
  import { routeAvatarColor, routeLetter, resolveRouteIcon } from "./route-icon.js";
  import { routeDisplayLabel } from "./route-naming.js";
  import { catalogModelCandidates, type RouteModelEntry } from "./model-fields.js";
  import { saveProviderPreset } from "$lib/stores/provider-presets.svelte";
  import {
    agentRuntimeConfig,
    clearAgentCredential,
    setAgentCredential,
    updateAgentSettings,
  } from "$lib/stores/agent.svelte";
  import { showToast } from "$lib/toast.svelte";
  import {
    DSH_ROUTE_API_PROTOCOLS,
    type DshModelRoute,
    type ModelProviderCatalogEntry,
  } from "$shared/contracts/dsh-runtime.js";

  interface Props {
    route: DshModelRoute;
    catalog: { providers: ModelProviderCatalogEntry[] } | null;
    /** 新建引导：挂载即展开凭据盒并聚焦；完成后经 onCredentialFocused 清除。 */
    autoFocusCredential?: boolean;
    onCredentialFocused?: () => void;
    /** 请求移除（确认对话框由分区持有——tab 条 Delete 键与本按钮共用一条路径）。 */
    onremove?: () => void;
  }

  let {
    route,
    catalog,
    autoFocusCredential = false,
    onCredentialFocused,
    onremove,
  }: Props = $props();

  const DEFAULT_API = "anthropic-messages";

  const view = $derived(agentRuntimeConfig.view);
  const routes = $derived(view?.settings.modelRoutes ?? []);
  /** 全路由模型并集（effort 候选自派生源：用户已配置 efforts 的并集，B2）。 */
  const allRouteModels = $derived(
    routes.flatMap((existing) =>
      existing.models.map((model) => ({ id: model.id, efforts: model.efforts })),
    ),
  );
  const catalogEntry = $derived(
    catalog?.providers.find((entry) => entry.provider === route.provider),
  );
  const catalogIconList = $derived(
    (catalog?.providers ?? []).flatMap((entry) =>
      entry.icon ? [{ provider: entry.provider, icon: entry.icon }] : [],
    ),
  );
  const modelCandidates = $derived(catalogModelCandidates(catalog));
  const routeIcon = $derived(resolveRouteIcon(route, catalogEntry));
  const displayName = $derived(routeDisplayLabel(route, catalog));
  const avatarLetter = $derived(routeLetter(route, displayName));
  const avatarColor = $derived(routeAvatarColor(route));
  const keyReady = $derived(
    view?.providers.some((p) => p.provider === route.provider && p.configured) ?? false,
  );
  const isActiveRoute = $derived(view !== null && view.settings.model.provider === route.provider);

  /** Endpoint 草稿（显式 Save；tab 切换经分区 {#key} 重挂载自然重置）。 */
  // svelte-ignore state_referenced_locally
  let baseURLDraft = $state(route.baseURL);
  // svelte-ignore state_referenced_locally
  let apiDraft = $state(route.api ?? catalogEntry?.api ?? DEFAULT_API);
  /** Models 草稿（dirty-gated Save；条目字段见 ModelListItem）。 */
  // svelte-ignore state_referenced_locally
  let modelsDraft = $state<RouteModelEntry[]>(route.models.map((entry) => ({ ...entry })));
  // svelte-ignore state_referenced_locally
  let modelsValid = $state<boolean[]>(route.models.map(() => true));
  /** 活动模型草稿（挂载时初始化一次；避免无关补丁回写打断编辑中草稿）。 */
  const initialSelection = agentRuntimeConfig.view?.settings.model;
  // svelte-ignore state_referenced_locally
  let modelDraft = $state(
    initialSelection && initialSelection.provider === route.provider
      ? initialSelection.model
      : (route.models[0]?.id ?? ""),
  );
  // svelte-ignore state_referenced_locally
  let effortDraft = $state(
    initialSelection && initialSelection.provider === route.provider
      ? (initialSelection.reasoningEffort ?? "")
      : "",
  );
  let apiKeyDraft = $state("");
  // svelte-ignore state_referenced_locally
  let credOpen = $state(autoFocusCredential);
  // svelte-ignore state_referenced_locally
  let addedHint = $state(autoFocusCredential);
  let credInput = $state<HTMLInputElement | null>(null);
  let rejection = $state<string | null>(null);
  let presetSaved = $state(false);
  let endpointSaved = $state(false);
  let collapseTimer: ReturnType<typeof setTimeout> | null = null;
  let presetTimer: ReturnType<typeof setTimeout> | null = null;
  let endpointTimer: ReturnType<typeof setTimeout> | null = null;

  const modelOptions = $derived.by(() => {
    const ids = modelsDraft.map((entry) => entry.id).filter((id) => id.length > 0);
    if (isActiveRoute && view !== null && !ids.includes(view.settings.model.model)) {
      ids.unshift(view.settings.model.model);
    }
    return ids;
  });
  /** Active effort 建议词 = 当前模型的 efforts（数据源派生，无硬编码数组）。 */
  const effortSuggestions = $derived(
    modelsDraft.find((entry) => entry.id === modelDraft)?.efforts ?? [],
  );
  const endpointDirty = $derived(
    baseURLDraft.trim() !== route.baseURL ||
      apiDraft !== (route.api ?? catalogEntry?.api ?? DEFAULT_API),
  );
  const modelsDirty = $derived(JSON.stringify(modelsDraft) !== JSON.stringify(route.models));
  const modelsAllValid = $derived(modelsValid.every((flag) => flag));
  const modelDirty = $derived(
    view !== null &&
      isActiveRoute &&
      ((modelDraft || "") !== view.settings.model.model ||
        (effortDraft || "") !== (view.settings.model.reasoningEffort ?? "")),
  );

  // 凭据盒展开即聚焦（新建引导与 pill 点击共用；autoFocus 路径同时清除分区挂起标记）。
  $effect(() => {
    if (credOpen && credInput !== null) {
      credInput.focus();
      if (autoFocusCredential) onCredentialFocused?.();
    }
  });

  $effect(() => {
    return () => {
      if (collapseTimer !== null) clearTimeout(collapseTimer);
      if (presetTimer !== null) clearTimeout(presetTimer);
      if (endpointTimer !== null) clearTimeout(endpointTimer);
    };
  });

  /** 全量补丁本路由（其余路由原样透传）；结果投影为 rejection。 */
  async function patchRoute(next: DshModelRoute): Promise<boolean> {
    if (view === null) return false;
    const result = await updateAgentSettings({
      modelRoutes: routes.map((existing) =>
        existing.provider === route.provider ? next : existing,
      ),
    });
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

  /** icon/iconColor/iconLetter/iconSuppressed = undefined 表示清除覆盖（回退
   * 目录图标/确定性色相/首字母/不抑制）。iconSuppressed = true 表示显式无图标
   * （目录 provider 也能选 Letter 头像；codex R7 B3）。 */
  async function applyIdentity(patch: {
    icon?: string;
    iconColor?: string;
    iconLetter?: string;
    iconSuppressed?: boolean;
  }): Promise<void> {
    await patchRoute({ ...route, ...patch });
  }

  async function saveEndpoint(): Promise<void> {
    const baseURL = baseURLDraft.trim();
    if (!/^https?:\/\//.test(baseURL)) {
      rejection = "Custom route needs an http(s) base URL.";
      return;
    }
    const ok = await patchRoute({ ...route, baseURL, api: apiDraft });
    if (!ok) return;
    // 保存确认：1.5s 绿色 Saved ✓；组件卸载清 timer。
    endpointSaved = true;
    if (endpointTimer !== null) clearTimeout(endpointTimer);
    endpointTimer = setTimeout(() => (endpointSaved = false), 1500);
  }

  /** Models dirty Save（R7 8.7：全量补丁，条目级编辑/校验在 ModelListItem）。 */
  async function saveModels(): Promise<void> {
    if (!modelsDirty || !modelsAllValid || modelsDraft.length === 0) return;
    await patchRoute({ ...route, models: modelsDraft.map((entry) => ({ ...entry })) });
  }

  function setModelAt(index: number, next: RouteModelEntry): void {
    modelsDraft = modelsDraft.map((entry, i) => (i === index ? next : entry));
  }

  function setModelValidity(index: number, valid: boolean): void {
    if (modelsValid[index] === valid) return;
    modelsValid = modelsValid.map((flag, i) => (i === index ? valid : flag));
  }

  function removeModel(index: number): void {
    modelsDraft = modelsDraft.filter((_, i) => i !== index);
    modelsValid = modelsValid.filter((_, i) => i !== index);
  }

  function addModel(): void {
    modelsDraft = [...modelsDraft, { id: "" }];
    modelsValid = [...modelsValid, false];
  }

  function toggleCredential(): void {
    credOpen = !credOpen;
    if (!credOpen) addedHint = false;
  }

  async function saveCredential(): Promise<void> {
    const key = apiKeyDraft.trim();
    if (key.length === 0) return;
    const result = await setAgentCredential(route.provider, key);
    if (!result) return;
    if (result.outcome === "rejected") {
      rejection = `${result.code}: ${result.detail}`;
      return;
    }
    apiKeyDraft = "";
    rejection = null;
    addedHint = false;
    if (collapseTimer !== null) clearTimeout(collapseTimer);
    collapseTimer = setTimeout(() => (credOpen = false), 800);
  }

  async function clearCredential(): Promise<void> {
    await clearAgentCredential(route.provider);
  }

  async function saveModel(): Promise<void> {
    if (!modelDirty || modelDraft.length === 0) return;
    const result = await updateAgentSettings({
      model: {
        provider: route.provider,
        model: modelDraft,
        ...(effortDraft.trim().length > 0 ? { reasoningEffort: effortDraft.trim() } : {}),
      },
    });
    if (!result) return;
    if (result.outcome === "rejected") {
      rejection = `${result.code}: ${result.detail}`;
      return;
    }
    if (result.outcome === "error") {
      rejection = result.message;
      return;
    }
    rejection = null;
  }

  /** 非活动路由一步切换全局活动模型（真相单例；tab 条下划线随 view 迁移）。 */
  async function setActive(modelId: string): Promise<void> {
    if (modelId.length === 0) return;
    const result = await updateAgentSettings({
      model: { provider: route.provider, model: modelId },
    });
    if (!result) return;
    if (result.outcome === "rejected") {
      rejection = `${result.code}: ${result.detail}`;
      return;
    }
    if (result.outcome === "error") {
      rejection = result.message;
      return;
    }
    rejection = null;
    showToast(`Active model → ${route.provider} · ${modelId}`);
  }

  function saveAsPreset(): void {
    saveProviderPreset({
      provider: route.provider,
      label: displayName,
      api: apiDraft,
      baseURL: route.baseURL,
      models: route.models.map((entry) => entry.id),
      ...(route.icon ? { icon: route.icon } : {}),
      ...(route.iconColor ? { iconColor: route.iconColor } : {}),
      ...(route.iconLetter ? { iconLetter: route.iconLetter } : {}),
      ...(route.iconSuppressed ? { iconSuppressed: true } : {}),
    });
    presetSaved = true;
    if (presetTimer !== null) clearTimeout(presetTimer);
    presetTimer = setTimeout(() => (presetSaved = false), 1000);
  }
</script>

<div class="space-y-3">
  <!-- 块 1 · Identity（图标 + 颜色 + Letter 三控制） -->
  <div class="flex items-start gap-2">
    <IconPicker
      icon={routeIcon}
      letter={avatarLetter}
      color={avatarColor}
      provider={route.provider}
      label={displayName}
      catalogIcons={catalogIconList}
      disabled={agentRuntimeConfig.updating}
      onPick={(icon) => void applyIdentity({ icon, iconSuppressed: false })}
      onSuppress={() => void applyIdentity({ icon: undefined, iconSuppressed: true })}
      onColor={(iconColor) => void applyIdentity({ iconColor })}
      onLetter={(iconLetter) => void applyIdentity({ iconLetter })}
    />
    <div class="min-w-0 flex-1">
      <p
        class="truncate text-sm font-semibold"
        title="{displayName} ({route.provider}) — route name keys the credential mapping; duplicate this route to rename it."
      >
        {displayName}
      </p>
      <p class="mt-0.5 truncate text-[10px] text-muted-foreground" title={route.baseURL}>
        {route.provider} · {route.baseURL.replace(/^https?:\/\//, "")} · {route.models.length}
        {route.models.length === 1 ? "model" : "models"}
      </p>
    </div>
    <button
      type="button"
      class="mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] transition-colors {keyReady
        ? 'bg-primary/10 text-primary'
        : 'bg-amber-500/15 text-amber-700 hover:bg-amber-500/25'}"
      title={keyReady
        ? "API key configured — click to replace it"
        : "API key missing — click to add it"}
      aria-label="Key status for {route.provider}"
      onclick={toggleCredential}
    >
      {keyReady ? "key ✓" : "add key →"}
    </button>
  </div>

  <!-- 块 2 · Credential（默认折叠为 Identity 行的 pill） -->
  {#if credOpen}
    <section class="space-y-1.5 rounded-md border border-border p-2" aria-label="Credential">
      {#if addedHint}
        <p class="text-[11px] font-medium text-primary">
          Route “{route.provider}” added — paste its API key to finish connecting.
        </p>
      {/if}
      <div class="flex gap-1.5">
        <Input
          class="h-8 flex-1 text-xs"
          type="password"
          autocomplete="off"
          aria-label="API key (write-only)"
          placeholder={keyReady ? "stored — enter to replace" : "not set"}
          ref={credInput}
          bind:value={apiKeyDraft}
          disabled={agentRuntimeConfig.updating}
        />
        <Button
          size="sm"
          class="h-8 px-2.5 text-xs"
          disabled={agentRuntimeConfig.updating || apiKeyDraft.trim().length === 0}
          onclick={() => void saveCredential()}
        >
          Save key
        </Button>
        {#if keyReady}
          <Button
            size="sm"
            variant="outline"
            class="h-8 px-2.5 text-xs"
            disabled={agentRuntimeConfig.updating}
            onclick={() => void clearCredential()}
          >
            Clear
          </Button>
        {/if}
      </div>
      <span class="text-[10px] text-muted-foreground">
        Keys are stored locally (0600), never echoed back, and apply immediately.
      </span>
    </section>
  {/if}

  <!-- 块 3 · Endpoint（baseURL + api Select；脏态显式 Save） -->
  <section class="space-y-1.5 rounded-md border border-border p-2" aria-label="Endpoint">
    <div class="flex items-center justify-between">
      <span class="text-[11px] font-medium text-muted-foreground">Endpoint</span>
      {#if endpointSaved}
        <span
          class="text-[10px] font-medium text-primary"
          data-endpoint-saved="true"
          aria-live="polite"
        >
          Saved ✓
        </span>
      {/if}
    </div>
    <div class="flex gap-1.5">
      <Input
        class="h-8 flex-1 font-mono text-xs"
        aria-label="Base URL"
        placeholder="https://api.example.com/v1"
        bind:value={baseURLDraft}
        disabled={agentRuntimeConfig.updating}
      />
      <Button
        size="sm"
        class="h-8 shrink-0 px-2.5 text-xs"
        disabled={!endpointDirty || agentRuntimeConfig.updating}
        onclick={() => void saveEndpoint()}
      >
        Save
      </Button>
    </div>
    <label class="block space-y-0.5">
      <span class="text-[10px] text-muted-foreground">API protocol</span>
      <select
        class="h-8 w-full rounded-md border border-border bg-background px-2 text-xs"
        aria-label="API protocol"
        bind:value={apiDraft}
        disabled={agentRuntimeConfig.updating}
      >
        {#each DSH_ROUTE_API_PROTOCOLS as protocol (protocol)}
          <option value={protocol}>{protocol}</option>
        {/each}
      </select>
    </label>
  </section>

  <!-- 块 4 · Models（ModelListItem 列表 + dirty Save；R7 8.7） -->
  <section class="space-y-1.5" aria-label="Models">
    <div class="flex items-center justify-between">
      <span class="text-[11px] font-medium text-muted-foreground">Models</span>
      <div class="flex items-center gap-1.5">
        {#if modelsDraft.length === 0}
          <span class="text-[10px] text-amber-700">A route needs at least one model id.</span>
        {/if}
        <Button
          size="sm"
          variant="ghost"
          class="h-6 px-2 text-[11px]"
          disabled={agentRuntimeConfig.updating}
          onclick={addModel}
        >
          + Add model
        </Button>
        <Button
          size="sm"
          class="h-6 px-2.5 text-[11px]"
          disabled={!modelsDirty ||
            !modelsAllValid ||
            modelsDraft.length === 0 ||
            agentRuntimeConfig.updating}
          onclick={() => void saveModels()}
        >
          Save
        </Button>
      </div>
    </div>
    <div class="space-y-1.5">
      {#each modelsDraft as entry, index (index)}
        <ModelListItem
          model={entry}
          candidates={modelCandidates}
          routeModels={allRouteModels}
          api={apiDraft}
          baseURL={baseURLDraft.trim()}
          provider={route.provider}
          apiKeyConfigured={keyReady}
          disabled={agentRuntimeConfig.updating}
          onchange={(next) => setModelAt(index, next)}
          onremove={() => removeModel(index)}
          onvalidity={(valid) => setModelValidity(index, valid)}
        />
      {/each}
    </div>
  </section>

  <!-- 块 5 · Active model -->
  <section aria-label="Active model">
    {#if isActiveRoute}
      <div class="space-y-1.5 rounded-md border border-primary/30 bg-primary/5 p-2">
        <div class="flex items-center justify-between">
          <span class="text-[11px] font-medium text-muted-foreground">Active model</span>
          <span class="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
            Active route
          </span>
        </div>
        <div class="grid grid-cols-[1fr_140px] gap-1.5">
          <label class="space-y-0.5">
            <span class="text-[10px] text-muted-foreground">Model</span>
            <select
              class="h-8 w-full rounded-md border border-border bg-background px-2 text-xs"
              aria-label="Model"
              bind:value={modelDraft}
              disabled={agentRuntimeConfig.updating}
            >
              {#each modelOptions as id (id)}
                <option value={id}>{id}</option>
              {/each}
            </select>
          </label>
          <label
            class="space-y-0.5"
            title="Provider-specific reasoning effort (optional, e.g. low / medium / high)"
          >
            <span class="text-[10px] text-muted-foreground">Effort</span>
            <Input
              class="h-8 text-xs"
              aria-label="Reasoning effort"
              placeholder={effortSuggestions.length > 0 ? effortSuggestions.join(" / ") : "effort"}
              list="active-effort-suggestions"
              bind:value={effortDraft}
              disabled={agentRuntimeConfig.updating}
            />
            <datalist id="active-effort-suggestions">
              {#each effortSuggestions as suggestion (suggestion)}
                <option value={suggestion}></option>
              {/each}
            </datalist>
          </label>
        </div>
        <div class="flex justify-end">
          <Button
            size="sm"
            class="h-7 px-2.5 text-xs"
            disabled={!modelDirty || agentRuntimeConfig.updating}
            onclick={() => void saveModel()}
          >
            Apply
          </Button>
        </div>
      </div>
    {:else}
      <div class="space-y-1.5 rounded-md border border-border p-2">
        <span class="text-[11px] font-medium text-muted-foreground">Active model</span>
        <div class="flex flex-wrap gap-1">
          {#each route.models as entry (entry.id)}
            <span
              class="group/chip flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px]"
            >
              {entry.id}
              <button
                type="button"
                class="text-primary opacity-0 transition-opacity group-hover/chip:opacity-100"
                aria-label="Use {entry.id} as the active model"
                disabled={agentRuntimeConfig.updating}
                onclick={() => void setActive(entry.id)}
              >
                Use
              </button>
            </span>
          {/each}
        </div>
        <div class="flex items-center justify-between gap-2">
          <span class="text-[10px] text-muted-foreground">
            Make this route the active model source.
          </span>
          <Button
            size="sm"
            class="h-7 shrink-0 px-2.5 text-xs"
            disabled={route.models.length === 0 || agentRuntimeConfig.updating}
            onclick={() => void setActive(route.models[0]?.id ?? "")}
          >
            Set active
          </Button>
        </div>
      </div>
    {/if}
  </section>

  {#if rejection}
    <p class="text-xs text-destructive" role="alert">{rejection}</p>
  {/if}

  <!-- 块 6 · Danger / Preset -->
  <div class="flex items-center justify-end gap-1.5 border-t border-border pt-2">
    <Button
      size="sm"
      variant="ghost"
      class="h-6 px-2 text-[11px]"
      disabled={agentRuntimeConfig.updating}
      onclick={saveAsPreset}
    >
      {presetSaved ? "Saved ✓" : "Save as preset"}
    </Button>
    <Button
      size="sm"
      variant="ghost"
      class="h-6 px-2 text-[11px] text-destructive hover:text-destructive"
      disabled={agentRuntimeConfig.updating}
      onclick={() => onremove?.()}
    >
      Remove route
    </Button>
  </div>
</div>
