<!--
  设置面 Model 分区（add-agent-settings-modes 迭代：自 AgentConfigSection 迁入）。
  用户原始需求 [2026-09-08]：「要支持模型配置，参考 DSH 官方的 webui 的配置逻辑。」
  正交意图：
  1. 模型配置（DSH ModelSelection UX 移植）：provider/model/reasoningEffort 草稿
     编辑 + 只写凭据（存/清，视图只回 configured 徽章）；跨字段校验由服务端
     revision 围栏裁决（rejected 带 code 显示）。
  妥协声明：provider 目录为 datalist（当前 + 已配凭据），不做 DSH 的
  llm.listProviders 端点发现——本产品路由面小（design D4）。
-->
<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import {
    agentRuntimeConfig,
    clearAgentCredential,
    setAgentCredential,
    updateAgentSettings,
  } from "$lib/stores/agent.svelte";

  let rejection = $state<string | null>(null);
  /** 模型草稿（视图变化后重置；save 成功后与视图对齐）。 */
  let provider = $state("");
  let model = $state("");
  let reasoningEffort = $state("");
  /** 只写凭据草稿（存成功即清空；值任何时刻不回流视图）。 */
  let apiKeyDraft = $state("");

  const view = $derived(agentRuntimeConfig.view);
  /** 草稿与视图同步（load/外部刷新后重置一次；草稿状态不被本 effect 读取）。 */
  $effect(() => {
    const selection = view?.settings.model;
    provider = selection?.provider ?? "";
    model = selection?.model ?? "";
    reasoningEffort = selection?.reasoningEffort ?? "";
    apiKeyDraft = "";
  });

  const modelDirty = $derived(
    view !== null &&
      ((provider || "") !== view.settings.model.provider ||
        (model || "") !== view.settings.model.model ||
        (reasoningEffort || "") !== (view.settings.model.reasoningEffort ?? "")),
  );

  /** provider datalist：当前选择 + 已配凭据 provider（去重）。 */
  const providerOptions = $derived.by(() => {
    const names = new Set<string>();
    if (view) {
      names.add(view.settings.model.provider);
      for (const item of view.providers) names.add(item.provider);
    }
    names.delete("");
    return [...names];
  });

  const credentialConfigured = $derived(
    view?.providers.find((item) => item.provider === (provider || "").trim())?.configured ?? false,
  );

  async function saveModel(): Promise<void> {
    if (!modelDirty) return;
    const result = await updateAgentSettings({
      model: {
        provider: (provider || "").trim(),
        model: (model || "").trim(),
        ...(reasoningEffort.trim().length > 0 ? { reasoningEffort: reasoningEffort.trim() } : {}),
      },
    });
    if (!result) return;
    rejection =
      result.outcome === "rejected"
        ? `${result.code}: ${result.detail}`
        : result.outcome === "error"
          ? result.message
          : null;
  }

  async function saveCredential(): Promise<void> {
    const target = (provider || "").trim();
    const key = apiKeyDraft.trim();
    if (target.length === 0 || key.length === 0) return;
    const result = await setAgentCredential(target, key);
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
      The route every agent session uses for its next turn.
    </p>
  </div>

  {#if view}
    <section class="space-y-1.5" aria-label="Model configuration">
      <div class="grid grid-cols-2 gap-1.5">
        <label class="space-y-0.5">
          <span class="text-[10px] text-muted-foreground">Provider</span>
          <Input
            class="h-8 text-xs"
            aria-label="Provider"
            list="settings-provider-options"
            bind:value={provider}
            disabled={agentRuntimeConfig.updating}
          />
          <datalist id="settings-provider-options">
            {#each providerOptions as name (name)}
              <option value={name}></option>
            {/each}
          </datalist>
        </label>
        <label class="space-y-0.5">
          <span class="text-[10px] text-muted-foreground">Model</span>
          <Input
            class="h-8 text-xs"
            aria-label="Model"
            bind:value={model}
            disabled={agentRuntimeConfig.updating}
          />
        </label>
      </div>
      <label class="block space-y-0.5">
        <span class="text-[10px] text-muted-foreground">
          Reasoning effort (optional, provider-defined)
        </span>
        <Input
          class="h-8 text-xs"
          aria-label="Reasoning effort"
          placeholder="provider default"
          bind:value={reasoningEffort}
          disabled={agentRuntimeConfig.updating}
        />
      </label>
      <div class="flex justify-end">
        <Button
          size="sm"
          class="h-7 px-2.5 text-xs"
          disabled={!modelDirty || agentRuntimeConfig.updating}
          onclick={() => void saveModel()}
        >
          Save model
        </Button>
      </div>
    </section>

    <section class="space-y-1.5" aria-label="Provider credential">
      <div class="flex items-center justify-between gap-2">
        <span class="text-[11px] font-medium text-muted-foreground">
          API key for {provider || "provider"}
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
          disabled={agentRuntimeConfig.updating || (provider || "").trim().length === 0}
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
            onclick={() => void clearAgentCredential((provider || "").trim())}
          >
            Clear
          </Button>
        {/if}
      </div>
      <span class="text-[10px] text-muted-foreground">
        Keys are stored locally (0600) and never echoed back.
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
