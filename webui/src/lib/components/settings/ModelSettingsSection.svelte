<!--
  设置面 Model 分区（add-agent-settings-modes 迭代三 2026-09-11 重写）。
  用户原始需求 [2026-09-11]：「我现在连配个模型都觉得很麻烦。」
  正交意图：
  1. 活动模型：跨路由模型下拉（provider · model）+ 可选 effort；选定即生效。
  2. 模型路由：预设卡（Anthropic 兼容网关 / 本地网关）两三字段建路由，daemon
     桥接 DSH 官方热面（$DSH_HOME/settings.yaml llm-pi-ai: 段 + .credentials.yaml）
     ——路由与 key 即时生效，无需重启。
  3. 凭据：只写输入（存/清），configured 徽章；值任何时刻不回流。
-->
<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import {
    DSH_MODEL_PROVIDER_PRESETS_CN,
    DSH_MODEL_PROVIDER_PRESETS_STANDARD,
    type DshModelProviderPreset,
    type DshModelRoute,
  } from "$shared/contracts/dsh-runtime.js";
  import {
    agentRuntimeConfig,
    clearAgentCredential,
    setAgentCredential,
    updateAgentSettings,
  } from "$lib/stores/agent.svelte";

  let rejection = $state<string | null>(null);
  /** 模型草稿（视图变化后重置；save 成功后与视图对齐）。 */
  let model = $state("");
  let reasoningEffort = $state("");
  /** 只写凭据草稿（存成功即清空；值任何时刻不回流视图）。 */
  let apiKeyDraft = $state("");
  /** 新路由表单（预设填充；空 = 收起）。 */
  let routeFormOpen = $state(false);
  let routeName = $state("");
  let routeBaseURL = $state("");
  let routeModels = $state("");
  let routeApi = $state("anthropic-messages");

  const view = $derived(agentRuntimeConfig.view);
  $effect(() => {
    const selection = view?.settings.model;
    model = selection ? `${selection.provider}::${selection.model}` : "";
    reasoningEffort = selection?.reasoningEffort ?? "";
    apiKeyDraft = "";
  });

  /** 活动模型选项：路由模型全集 + 当前选择（可能来自 env 路由）保底。 */
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
      options.unshift({
        value: `${selection.provider}::${selection.model}`,
        label: `${selection.provider} · ${selection.model} (current route)`,
      });
    }
    return options;
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

  async function apply(patch: Parameters<typeof updateAgentSettings>[0]): Promise<void> {
    const result = await updateAgentSettings(patch);
    if (!result) return;
    rejection =
      result.outcome === "rejected"
        ? `${result.code}: ${result.detail}`
        : result.outcome === "error"
          ? result.message
          : null;
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

  /** 目录预设：pi-ai 装配目录内 provider（协议/baseURL/模型已对齐，只需 key）。 */
  function applyPreset(preset: DshModelProviderPreset): void {
    routeFormOpen = true;
    routeName = preset.provider;
    routeBaseURL = preset.baseURL;
    routeModels = preset.models.slice(0, 4).join(", ");
    routeApi = preset.api;
  }

  /** 本地 Anthropic 兼容网关（开发/自建）。 */
  function presetLocal(): void {
    routeFormOpen = true;
    routeName = "local-gateway";
    routeBaseURL = "http://localhost:20002/anthropic";
    routeModels = "glm-5.3-flash";
    routeApi = "anthropic-messages";
  }

  async function saveRoute(): Promise<void> {
    const provider = routeName.trim();
    const baseURL = routeBaseURL.trim();
    const models = routeModels
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id.length > 0);
    if (provider.length === 0 || baseURL.length === 0 || models.length === 0) {
      rejection = "Route needs a name, a base URL, and at least one model id.";
      return;
    }
    const route: DshModelRoute = {
      provider,
      api: routeApi.trim() || "anthropic-messages",
      baseURL,
      models: models.map((id) => ({ id })),
    };
    const routes = view?.settings.modelRoutes ?? [];
    if (routes.some((existing) => existing.provider === provider)) {
      rejection = `Route "${provider}" already exists.`;
      return;
    }
    await apply({ modelRoutes: [...routes, route] });
    routeFormOpen = false;
    routeName = "";
    routeBaseURL = "";
    routeModels = "";
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
      Routes and keys apply immediately — hot-reloaded into the kernel.
    </p>
  </div>

  {#if view}
    <section class="space-y-1.5" aria-label="Active model">
      <span class="text-[11px] font-medium text-muted-foreground">Active model</span>
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
        <label class="space-y-0.5">
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
        <div class="flex gap-1.5">
          <Button
            size="sm"
            variant="outline"
            class="h-6 px-2 text-[10px]"
            onclick={() => presetLocal()}
          >
            + Local
          </Button>
          <Button
            size="sm"
            variant="outline"
            class="h-6 px-2 text-[10px]"
            onclick={() => (routeFormOpen = true)}
          >
            + Custom
          </Button>
        </div>
      </div>
      <div class="space-y-1">
        <p class="text-[10px] text-muted-foreground">
          Ready-to-use providers (pi-ai catalog — add, then paste a key):
        </p>
        <div class="flex flex-wrap gap-1">
          {#each [...DSH_MODEL_PROVIDER_PRESETS_CN, ...DSH_MODEL_PROVIDER_PRESETS_STANDARD] as preset (preset.provider)}
            <button
              class="rounded-md border border-border px-1.5 py-0.5 text-[10px] transition-colors hover:border-primary/50 hover:text-primary"
              title={`${preset.baseURL} · key: ${preset.envHint}`}
              disabled={agentRuntimeConfig.updating}
              onclick={() => applyPreset(preset)}
            >
              {preset.label}
            </button>
          {/each}
        </div>
      </div>
      {#each view.settings.modelRoutes as route (route.provider)}
        <div class="flex items-center gap-2 rounded-md border border-border p-2">
          <div class="min-w-0 flex-1">
            <p class="truncate text-xs font-medium">{route.provider}</p>
            <p class="truncate text-[10px] text-muted-foreground">
              {route.baseURL} · {route.models.map((entry) => entry.id).join(", ")}
            </p>
          </div>
          <button
            class="text-[10px] text-muted-foreground transition-colors hover:text-destructive"
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
          No custom routes yet — add one above (Anthropic-compatible endpoint).
        </p>
      {/each}

      {#if routeFormOpen}
        <div class="space-y-1.5 rounded-md border border-border bg-muted/20 p-2">
          <div class="grid grid-cols-2 gap-1.5">
            <label class="space-y-0.5">
              <span class="text-[10px] text-muted-foreground">Route name</span>
              <Input class="h-7 text-xs" aria-label="Route name" bind:value={routeName} />
            </label>
            <label class="space-y-0.5">
              <span class="text-[10px] text-muted-foreground">Models (comma-separated)</span>
              <Input class="h-7 text-xs" aria-label="Route models" bind:value={routeModels} />
            </label>
          </div>
          <div class="grid grid-cols-[1fr_150px] gap-1.5">
            <label class="space-y-0.5">
              <span class="text-[10px] text-muted-foreground">Base URL</span>
              <Input class="h-7 text-xs" aria-label="Route base URL" bind:value={routeBaseURL} />
            </label>
            <label class="space-y-0.5">
              <span class="text-[10px] text-muted-foreground">API protocol</span>
              <Input class="h-7 text-xs" aria-label="Route api" bind:value={routeApi} />
            </label>
          </div>
          <div class="flex justify-end gap-1.5">
            <Button
              size="sm"
              variant="ghost"
              class="h-7 px-2 text-xs"
              onclick={() => (routeFormOpen = false)}
            >
              Cancel
            </Button>
            <Button size="sm" class="h-7 px-2.5 text-xs" onclick={() => void saveRoute()}
              >Save route</Button
            >
          </div>
        </div>
      {/if}
    </section>

    <section class="space-y-1.5" aria-label="Provider credential">
      <div class="flex items-center justify-between gap-2">
        <span class="text-[11px] font-medium text-muted-foreground"
          >API key for {keyTarget || "provider"}</span
        >
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
