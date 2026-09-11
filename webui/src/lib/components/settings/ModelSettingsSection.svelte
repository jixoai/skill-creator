<!--
  设置面 Model 分区（迭代四 2026-09-11 重写：全量目录画廊）。
  用户原始需求 [2026-09-11]：「直接基于 models.generated.js 去提供可用提供商
  （记住提供 filter）……每个小卡片显示 icon、title、url。选中后可以进一步配置
  可用模型。Custom 档也非常重要。」
  正交意图：
  1. 全量 provider 画廊（agent.models.catalog = pi-ai 装配目录投影）：搜索过滤 +
     卡片（字母头像/title/baseURL/模型数）。
  2. 选中 provider → 模型 checkbox 配置 → 保存进 modelRoutes（桥接 DSH 热面）。
  3. Custom/Local 保留为基础档；活动模型 + 只写 key 面不变。
-->
<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import ModelTagsInput from "./ModelTagsInput.svelte";
  import type { DshModelRoute, ModelProviderCatalogEntry } from "$shared/contracts/dsh-runtime.js";
  import {
    agentRuntimeConfig,
    clearAgentCredential,
    setAgentCredential,
    updateAgentSettings,
  } from "$lib/stores/agent.svelte";
  import { getRpc } from "$lib/stores/connection.svelte";
  import { createRequestGenerationGate } from "$lib/stores/request-generation.js";
  import { getConnectionGeneration } from "$lib/stores/connection.svelte";

  let rejection = $state<string | null>(null);
  /** 加路由成功提示（引导粘 key）。 */
  let routeAddedFor = $state<string | null>(null);
  let keySection = $state<HTMLElement | null>(null);
  let model = $state("");
  let reasoningEffort = $state("");
  let apiKeyDraft = $state("");

  /** 画廊：目录 + 过滤 + 选中 + 勾选模型。 */
  let catalog = $state<{ providers: ModelProviderCatalogEntry[] } | null>(null);
  let catalogError = $state<string | null>(null);
  let catalogLoading = $state(false);
  let filter = $state("");
  let selected = $state<ModelProviderCatalogEntry | null>(null);
  let selectedModels = $state<Set<string>>(new Set());

  /** Custom/Local 表单。 */
  let routeFormOpen = $state(false);
  let routeName = $state("");
  let routeBaseURL = $state("");
  let routeApi = $state("anthropic-messages");
  let routeModels = $state<string[]>([]);

  const catalogGate = createRequestGenerationGate(getConnectionGeneration);

  const view = $derived(agentRuntimeConfig.view);
  $effect(() => {
    const selection = view?.settings.model;
    model = selection ? `${selection.provider}::${selection.model}` : "";
    reasoningEffort = selection?.reasoningEffort ?? "";
    apiKeyDraft = "";
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

  /** Custom 表单的补全候选：routeName 命中目录 provider 时用该家模型，否则空。 */
  const customCandidates = $derived.by(() => {
    const name = routeName.trim();
    const entry = catalog?.providers.find((provider) => provider.provider === name);
    return entry?.models ?? [];
  });

  const filtered = $derived.by(() => {
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

  const modelOptions = $derived.by(() => {
    const options: Array<{ value: string; label: string }> = [];
    for (const route of view?.settings.modelRoutes ?? []) {
      for (const entry of route.models) {
        options.push({
          value: `${route.provider}::${entry.id}`,
          label: `${route.provider} · ${entry.id}`,
        });
      }
    }
    const selection = view?.settings.model;
    if (
      selection &&
      !options.some((option) => option.value === `${selection.provider}::${selection.model}`)
    ) {
      // 引用不在 Routes 表的路由（env 注入等）：如实标注来源，不伪装成可选路由。
      options.unshift({
        value: `${selection.provider}::${selection.model}`,
        label: `${selection.provider} · ${selection.model} (outside Routes)`,
      });
    }
    return options;
  });

  /** 活动模型引用了 Routes 之外的路由（env 注入）→ 下拉警示。 */
  const activeOutsideRoutes = $derived.by(() => {
    if (!view || !model.includes("::")) return false;
    const [provider] = model.split("::");
    return !(view.settings.modelRoutes ?? []).some((route) => route.provider === provider);
  });

  const modelDirty = $derived(
    view !== null &&
      ((model || "") !== `${view.settings.model.provider}::${view.settings.model.model}` ||
        (reasoningEffort || "") !== (view.settings.model.reasoningEffort ?? "")),
  );

  const keyTarget = $derived.by(() => model.split("::")[0] ?? "");
  const credentialConfigured = $derived(
    view?.providers.find((item) => item.provider === keyTarget)?.configured ?? false,
  );

  /** 该 provider 已有路由（画廊卡片 Added 徽标 + route 行 key 状态用）。 */
  function routeOf(provider: string): DshModelRoute | undefined {
    return (view?.settings.modelRoutes ?? []).find((route) => route.provider === provider);
  }

  /** 卡片头像底色（provider id 确定性色相）。 */
  function avatarHue(provider: string): number {
    let hash = 0;
    for (const ch of provider) hash = (hash * 31 + ch.charCodeAt(0)) % 360;
    return hash;
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

  async function saveModel(): Promise<void> {
    if (!modelDirty || !model.includes("::")) return;
    const [provider, modelId] = model.split("::");
    await apply({
      model: {
        provider,
        model: modelId,
        ...(reasoningEffort.trim().length > 0 ? { reasoningEffort: reasoningEffort.trim() } : {}),
      },
    });
  }

  function selectProvider(entry: ModelProviderCatalogEntry): void {
    selected = entry;
    const picks = [...entry.models]
      .sort((a, b) => Number(b.image) - Number(a.image))
      .slice(0, 4)
      .map((m) => m.id);
    selectedModels = new Set(picks);
  }

  async function saveSelectedRoute(): Promise<void> {
    const entry = selected;
    if (!entry || selectedModels.size === 0) {
      rejection = "Pick at least one model for this route.";
      return;
    }
    const routes = view?.settings.modelRoutes ?? [];
    if (routes.some((existing) => existing.provider === entry.provider)) {
      rejection = `Route "${entry.provider}" already exists.`;
      return;
    }
    const route: DshModelRoute = {
      provider: entry.provider,
      api: entry.api,
      baseURL: entry.baseURL,
      models: entry.models.filter((m) => selectedModels.has(m.id)).map((m) => ({ id: m.id })),
    };
    if (await apply({ modelRoutes: [...routes, route] })) {
      model = `${entry.provider}::${[...selectedModels][0]}`;
      selected = null;
      routeAddedFor = entry.label;
      keySection?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  async function saveCustomRoute(): Promise<void> {
    const provider = routeName.trim();
    const baseURL = routeBaseURL.trim();
    const ids = routeModels;
    if (provider.length === 0 || !/^https?:\/\//.test(baseURL) || ids.length === 0) {
      rejection = "Custom route needs a name, an http(s) base URL, and model ids.";
      return;
    }
    const routes = view?.settings.modelRoutes ?? [];
    if (routes.some((existing) => existing.provider === provider)) {
      rejection = `Route "${provider}" already exists.`;
      return;
    }
    const route: DshModelRoute = {
      provider,
      api: routeApi.trim() || "anthropic-messages",
      baseURL,
      models: ids.map((id) => ({ id })),
    };
    if (await apply({ modelRoutes: [...routes, route] })) {
      routeFormOpen = false;
      routeName = "";
      routeBaseURL = "";
      routeModels = [];
    }
  }

  async function removeRoute(provider: string): Promise<void> {
    const routes = (view?.settings.modelRoutes ?? []).filter(
      (route) => route.provider !== provider,
    );
    await apply({ modelRoutes: routes });
  }

  async function saveCredential(): Promise<void> {
    const key = apiKeyDraft.trim();
    if (keyTarget.length === 0 || key.length === 0) return;
    const result = await setAgentCredential(keyTarget, key);
    if (!result) return;
    if (result.outcome === "rejected") {
      rejection = `${result.code}: ${result.detail}`;
      return;
    }
    apiKeyDraft = "";
    rejection = null;
  }
</script>

<div class="space-y-4">
  <div>
    <h3 class="text-sm font-medium">Model</h3>
    <p class="mt-0.5 text-[11px] text-muted-foreground">
      Changes apply immediately to your agent sessions — no restart needed.
    </p>
  </div>

  {#if view}
    <section class="space-y-1.5" aria-label="Active model">
      <span class="text-[11px] font-medium text-muted-foreground">Active model</span>
      {#if (view.settings.modelRoutes ?? []).length === 0}
        <p class="text-[10px] text-muted-foreground">
          No routes yet — pick a provider under “Add a route” below, or use + Custom.
        </p>
      {/if}
      {#if activeOutsideRoutes}
        <p class="text-[10px] text-amber-600">
          Current model rides a route outside this list (env-provided); pick a route below to move
          it under management.
        </p>
      {/if}
      <div class="grid grid-cols-[1fr_140px] gap-1.5">
        <label class="space-y-0.5">
          <span class="text-[10px] text-muted-foreground">Model</span>
          <select
            class="h-8 w-full rounded-md border border-border bg-background px-2 text-xs"
            aria-label="Model"
            bind:value={model}
            disabled={agentRuntimeConfig.updating}
          >
            {#each modelOptions as option (option.value)}
              <option value={option.value}>{option.label}</option>
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
            placeholder="default"
            bind:value={reasoningEffort}
            disabled={agentRuntimeConfig.updating}
          />
        </label>
      </div>
      <div class="flex justify-end">
        <Button
          size="sm"
          class="h-7 px-2.5 text-xs"
          disabled={!modelDirty || agentRuntimeConfig.updating}
          onclick={() => void saveModel()}
        >
          Apply model
        </Button>
      </div>
    </section>

    <section class="space-y-1.5" aria-label="Model routes">
      <div class="flex items-center justify-between">
        <span class="text-[11px] font-medium text-muted-foreground">Routes</span>
        <Button
          size="sm"
          variant="outline"
          class="h-6 px-2 text-[10px]"
          onclick={() => {
            selected = null;
            routeFormOpen = true;
          }}
        >
          + Custom
        </Button>
      </div>
      {#each view.settings.modelRoutes as route (route.provider)}
        {@const routeIcon = catalog?.providers.find((p2) => p2.provider === route.provider)?.icon}
        {@const keyReady = view.providers.some(
          (p2) => p2.provider === route.provider && p2.configured,
        )}
        <div class="flex items-center gap-2 rounded-md border border-border p-2">
          {#if routeIcon}
            <img src={routeIcon} alt="" class="h-5 w-5 shrink-0 object-contain dark:invert" />
          {/if}
          <div class="min-w-0 flex-1">
            <p class="truncate text-xs font-medium">{route.provider}</p>
            <p
              class="truncate text-[10px] text-muted-foreground"
              title={route.models.map((entry) => entry.id).join(", ")}
            >
              {route.baseURL.replace(/^https?:\/\//, "")} · {route.models
                .slice(0, 2)
                .map((entry) => entry.id)
                .join(", ")}{route.models.length > 2 ? ` +${route.models.length - 2} more` : ""}
            </p>
          </div>
          <button
            class="shrink-0 rounded px-1 text-[9px] underline decoration-dotted underline-offset-2 transition-colors {keyReady
              ? 'bg-primary/10 text-primary'
              : 'bg-amber-500/15 text-amber-600 hover:bg-amber-500/25'}"
            title={keyReady ? "API key configured" : "API key missing — click to add it below"}
            aria-label="Key status for {route.provider}"
            onclick={() => {
              model = `${route.provider}::${route.models[0]?.id ?? ""}`;
              keySection?.scrollIntoView({ behavior: "smooth", block: "center" });
            }}
          >
            {keyReady ? "key ✓" : "add key →"}
          </button>
          <button
            class="shrink-0 text-[10px] text-muted-foreground transition-colors hover:text-destructive"
            aria-label="Remove route {route.provider}"
            disabled={agentRuntimeConfig.updating}
            onclick={() => void removeRoute(route.provider)}
          >
            Remove
          </button>
        </div>
      {:else}
        <p
          class="rounded-md border border-dashed border-border p-2 text-center text-[10px] text-muted-foreground"
        >
          No routes yet — pick a provider below, or add a Local/Custom one.
        </p>
      {/each}
    </section>

    <section class="space-y-1.5" aria-label="Provider gallery">
      <div class="flex items-center justify-between gap-2">
        <div>
          <span class="text-[11px] font-medium text-muted-foreground">Add a route</span>
          <p class="text-[10px] text-muted-foreground">
            Click a provider to add it with its catalog models ({catalog?.providers.length ?? 0}
            providers, from models.dev).
          </p>
        </div>
        <Input
          class="h-7 w-44 shrink-0 text-xs"
          aria-label="Filter providers"
          placeholder="Filter providers…"
          bind:value={filter}
        />
      </div>
      {#if catalogError}
        <p class="text-[10px] text-destructive" role="alert">{catalogError}</p>
      {:else if catalog === null}
        <p class="py-3 text-center text-[10px] text-muted-foreground">Loading catalog…</p>
      {:else if selected}
        <div
          class="flex max-h-[52vh] flex-col gap-1.5 rounded-md border border-border bg-muted/20 p-2"
        >
          <div class="flex shrink-0 items-start justify-between gap-2">
            <div class="min-w-0">
              <p class="truncate text-xs font-medium">{selected.label}</p>
              <p class="truncate text-[10px] text-muted-foreground">{selected.baseURL}</p>
            </div>
            <button
              class="shrink-0 text-[10px] text-muted-foreground hover:text-foreground"
              aria-label="Back to gallery"
              onclick={() => (selected = null)}
            >
              Back
            </button>
          </div>
          <div class="min-h-0 flex-1 overflow-y-auto pr-1">
            <ModelTagsInput
              selected={[...selectedModels]}
              candidates={selected.models}
              placeholder="Pick models for this route…"
              onchange={(next) => (selectedModels = new Set(next))}
            />
            {#if routeOf(selected.provider)}
              <p class="mt-1.5 text-[10px] text-amber-600">
                A route for this provider already exists — adding again will be rejected.
              </p>
            {/if}
          </div>
          <div class="flex shrink-0 items-center justify-between border-t border-border pt-1.5">
            <span class="text-[10px] text-muted-foreground">{selectedModels.size} selected</span>
            <Button
              size="sm"
              class="h-7 px-2.5 text-xs"
              disabled={selectedModels.size === 0 || agentRuntimeConfig.updating}
              onclick={() => void saveSelectedRoute()}
            >
              Add route
            </Button>
          </div>
        </div>
      {:else}
        <div class="grid max-h-64 grid-cols-1 gap-1.5 overflow-y-auto pr-1 min-[520px]:grid-cols-2">
          {#each filtered as entry (entry.provider)}
            <button
              class="flex items-center gap-2 rounded-md border border-border p-2 text-left transition-colors hover:border-primary/50 hover:bg-primary/5"
              title={`${entry.baseURL} · ${entry.api}`}
              onclick={() => selectProvider(entry)}
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
                {#if routeOf(entry.provider)}
                  <span class="rounded bg-primary/10 px-1 text-[9px] text-primary">Added ✓</span>
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
          {#if filtered.length === 0}
            <p class="col-span-full py-3 text-center text-[10px] text-muted-foreground">
              No providers match “{filter}”.
            </p>
          {/if}
        </div>
      {/if}

      {#if routeFormOpen}
        <div class="space-y-1.5 rounded-md border border-border bg-muted/20 p-2">
          <div class="grid grid-cols-2 gap-1.5">
            <label class="space-y-0.5">
              <span class="text-[10px] text-muted-foreground">Route name</span>
              <Input class="h-7 text-xs" aria-label="Route name" bind:value={routeName} />
            </label>
            <label class="space-y-0.5">
              <span class="text-[10px] text-muted-foreground">API protocol</span>
              <Input class="h-7 text-xs" aria-label="Route api" bind:value={routeApi} />
            </label>
          </div>
          <label class="block space-y-0.5">
            <span class="text-[10px] text-muted-foreground">Base URL</span>
            <Input class="h-7 text-xs" aria-label="Route base URL" bind:value={routeBaseURL} />
          </label>
          <label class="block space-y-0.5">
            <span class="text-[10px] text-muted-foreground">Models</span>
            <ModelTagsInput
              selected={routeModels}
              candidates={customCandidates}
              placeholder="Add model id…"
              onchange={(next) => (routeModels = next)}
            />
          </label>
          <div class="flex justify-end gap-1.5">
            <Button
              size="sm"
              variant="ghost"
              class="h-7 px-2 text-xs"
              onclick={() => (routeFormOpen = false)}
            >
              Cancel
            </Button>
            <Button size="sm" class="h-7 px-2.5 text-xs" onclick={() => void saveCustomRoute()}>
              Save route
            </Button>
          </div>
        </div>
      {/if}
    </section>

    <section
      class="space-y-1.5 rounded-md border p-2 {routeAddedFor
        ? 'border-primary/50 bg-primary/5'
        : 'border-transparent'}"
      aria-label="Provider credential"
      bind:this={keySection}
    >
      {#if routeAddedFor}
        <p class="text-[11px] font-medium text-primary">
          Route “{routeAddedFor}” added — paste its API key to finish connecting.
        </p>
      {/if}
      <div class="flex items-center justify-between gap-2">
        <span class="text-[11px] font-medium text-muted-foreground">
          API key for {keyTarget || "provider"}
        </span>
        {#if credentialConfigured}
          <span
            class="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary"
            aria-label="Credential configured"
          >
            configured
          </span>
        {/if}
      </div>
      <div class="flex gap-1.5">
        <Input
          class="h-8 flex-1 text-xs"
          type="password"
          autocomplete="off"
          aria-label="API key (write-only)"
          placeholder={credentialConfigured ? "stored — enter to replace" : "not set"}
          bind:value={apiKeyDraft}
          disabled={agentRuntimeConfig.updating || keyTarget.length === 0}
        />
        <Button
          size="sm"
          class="h-8 px-2.5 text-xs"
          disabled={agentRuntimeConfig.updating || apiKeyDraft.trim().length === 0}
          onclick={() => void saveCredential()}
        >
          Save key
        </Button>
        {#if credentialConfigured}
          <Button
            size="sm"
            variant="outline"
            class="h-8 px-2.5 text-xs"
            disabled={agentRuntimeConfig.updating}
            onclick={() => void clearAgentCredential(keyTarget)}
          >
            Clear
          </Button>
        {/if}
      </div>
      <span class="text-[10px] text-muted-foreground">
        Keys are stored locally (0600), never echoed back, and apply immediately.
      </span>
    </section>
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
</div>
