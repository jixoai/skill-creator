<!--
  用户原始需求 [2026-09-08]：「新增设置面板。要支持模型配置，参考 DSH 官方的 webui
  的配置逻辑。你可以把他那套 UI 移植过来。」（add-agent-settings-modes）
  正交意图：
  1. 模型配置（DSH ModelSelection UX 移植）：provider/model/reasoningEffort 草稿
     编辑 + 只写凭据（存/清，视图只回 configured 徽章）；跨字段校验由服务端
     revision 围栏裁决（rejected 带 code 显示）。
  2. 默认模式：四模式卡（shared DSH_AGENT_MODES 目录，单一事实源；free 卡明示
     token 成本）。
  3. 行为：LLM preset 与 approval policy 的行内切换（ask/never 语义沿用）。
  妥协声明：provider 目录为 datalist（当前 + 已配凭据），不做 DSH 的
  llm.listProviders 端点发现——本产品路由面小（design D4）。
-->
<script lang="ts">
  import IconRefresh from "@lucide/svelte/icons/refresh-cw";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { DSH_AGENT_MODES } from "$shared/contracts/dsh-runtime.js";
  import {
    agentRuntimeConfig,
    clearAgentCredential,
    loadAgentSettings,
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

  const presetOptions = ["deterministic", "live"] as const;
  const policyOptions = ["ask", "never"] as const;

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

  async function apply(patch: Parameters<typeof updateAgentSettings>[0]): Promise<void> {
    const result = await updateAgentSettings(patch);
    if (!result) return;
    if (result.outcome === "rejected") {
      rejection = `${result.code}: ${result.detail}`;
    } else if (result.outcome === "error") {
      rejection = result.message;
    } else {
      rejection = null;
    }
  }

  async function saveModel(): Promise<void> {
    if (!modelDirty) return;
    await apply({
      model: {
        provider: (provider || "").trim(),
        model: (model || "").trim(),
        ...(reasoningEffort.trim().length > 0 ? { reasoningEffort: reasoningEffort.trim() } : {}),
      },
    });
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

<div
  class="max-h-[60vh] space-y-3 overflow-y-auto border-b border-border bg-muted/20 px-3 py-2.5 text-xs"
>
  <div class="flex items-center justify-between">
    <span class="font-medium">Settings</span>
    <button
      class="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-foreground"
      aria-label="Reload settings"
      title="Reload"
      onclick={() => {
        rejection = null;
        void loadAgentSettings();
      }}
    >
      <IconRefresh class="h-3.5 w-3.5" />
    </button>
  </div>

  {#if view}
    <!-- 模型配置（DSH webui Models 面 UX 移植：整段草稿 + 一次保存）。 -->
    <section class="space-y-1.5" aria-label="Model configuration">
      <span class="text-[11px] font-medium text-muted-foreground">Model</span>
      <div class="grid grid-cols-2 gap-1.5">
        <label class="space-y-0.5">
          <span class="text-[10px] text-muted-foreground">Provider</span>
          <Input
            class="h-7 text-xs"
            aria-label="Provider"
            list="agent-provider-options"
            bind:value={provider}
            disabled={agentRuntimeConfig.updating}
          />
          <datalist id="agent-provider-options">
            {#each providerOptions as name (name)}
              <option value={name}></option>
            {/each}
          </datalist>
        </label>
        <label class="space-y-0.5">
          <span class="text-[10px] text-muted-foreground">Model</span>
          <Input
            class="h-7 text-xs"
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
          class="h-7 text-xs"
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

      <div class="space-y-1 rounded-md border border-border bg-background/60 p-2">
        <div class="flex items-center justify-between gap-2">
          <span class="text-[11px] text-muted-foreground">
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
            class="h-7 flex-1 text-xs"
            type="password"
            autocomplete="off"
            aria-label="API key (write-only)"
            placeholder={credentialConfigured ? "stored — enter to replace" : "not set"}
            bind:value={apiKeyDraft}
            disabled={agentRuntimeConfig.updating || (provider || "").trim().length === 0}
          />
          <Button
            size="sm"
            class="h-7 px-2.5 text-xs"
            disabled={agentRuntimeConfig.updating || apiKeyDraft.trim().length === 0}
            onclick={() => void saveCredential()}
          >
            Save key
          </Button>
          {#if credentialConfigured}
            <Button
              size="sm"
              variant="outline"
              class="h-7 px-2.5 text-xs"
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
      </div>
    </section>

    <!-- 默认模式（新会话继承；当前会话经 header 的模式 chip 切换）。 -->
    <section class="space-y-1.5" aria-label="Default mode">
      <span class="text-[11px] font-medium text-muted-foreground">
        Default mode (new sessions)
      </span>
      <div class="grid grid-cols-2 gap-1.5">
        {#each DSH_AGENT_MODES as entry (entry.id)}
          <button
            class="rounded-md border p-2 text-left transition-colors {view.settings.defaultMode ===
            entry.id
              ? 'border-primary bg-primary/10'
              : 'border-border hover:bg-muted'}"
            aria-pressed={view.settings.defaultMode === entry.id}
            disabled={agentRuntimeConfig.updating}
            onclick={() => void apply({ defaultMode: entry.id })}
          >
            <span class="flex items-center gap-1 font-medium">
              {entry.label}
              {#if entry.tokenHeavy}
                <span class="rounded bg-amber-500/15 px-1 text-[9px] text-amber-600">
                  token-heavy
                </span>
              {/if}
            </span>
            <span class="mt-0.5 block text-[10px] leading-snug text-muted-foreground">
              {entry.description}
            </span>
          </button>
        {/each}
      </div>
    </section>

    <!-- 行为（dsh-kernel-rebase task 3.3 既有语义保留）。 -->
    <section class="space-y-1.5" aria-label="Behavior">
      <span class="text-[11px] font-medium text-muted-foreground">Behavior</span>
      <div class="space-y-1">
        <span class="text-[10px] text-muted-foreground">LLM preset</span>
        <div class="flex gap-1.5">
          {#each presetOptions as preset (preset)}
            <button
              class="flex-1 rounded-md border px-2 py-1 transition-colors {view.settings.preset ===
              preset
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border hover:bg-muted'}"
              aria-pressed={view.settings.preset === preset}
              disabled={agentRuntimeConfig.updating}
              onclick={() => void apply({ preset })}
            >
              {preset}
            </button>
          {/each}
        </div>
      </div>
      <div class="space-y-1">
        <span class="text-[10px] text-muted-foreground">Approval policy</span>
        <div class="flex gap-1.5">
          {#each policyOptions as policy (policy)}
            <button
              class="flex-1 rounded-md border px-2 py-1 transition-colors {view.settings.permissions
                .approvalPolicy === policy
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border hover:bg-muted'}"
              aria-pressed={view.settings.permissions.approvalPolicy === policy}
              disabled={agentRuntimeConfig.updating}
              onclick={() => void apply({ permissions: { approvalPolicy: policy } })}
            >
              {policy}
            </button>
          {/each}
        </div>
      </div>
    </section>
  {:else if agentRuntimeConfig.loading}
    <div class="text-[11px] text-muted-foreground">Loading…</div>
  {:else}
    <div class="text-[11px] text-muted-foreground">Settings unavailable</div>
  {/if}

  {#if agentRuntimeConfig.error}
    <div class="text-[11px] text-destructive" role="alert">{agentRuntimeConfig.error}</div>
  {/if}
  {#if rejection}
    <div class="text-[11px] text-destructive" role="alert">{rejection}</div>
  {/if}
</div>
