<!--
  用户原始需求 [2026-09-08]（tasks 3.3）：「配置投影：model/preset/permission/approval
  policy 面板（ask/never 语义沿用）」。
  正交意图：
  1. agent.settings.* 投影：model provider/model、preset、approval policy 的行内
     编辑；rejected/错误可区分（红条 + code）。
  妥协声明：凭据值永不显示（后端只回 configured 状态）；写凭据不在面板首期。
-->
<script lang="ts">
  import IconRefresh from "@lucide/svelte/icons/refresh-cw";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import {
    agentRuntimeConfig,
    loadAgentSettings,
    updateAgentSettings,
  } from "$lib/stores/agent.svelte";

  let rejection = $state<string | null>(null);

  const presetOptions = ["deterministic", "live"] as const;
  const policyOptions = ["ask", "never"] as const;

  const view = $derived(agentRuntimeConfig.view);

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
</script>

<div class="space-y-2 border-b border-border bg-muted/20 px-3 py-2.5 text-xs">
  <div class="flex items-center justify-between">
    <span class="font-medium">Runtime config</span>
    <button
      class="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-foreground"
      aria-label="Reload config"
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
    <label class="block space-y-1">
      <span class="text-[11px] text-muted-foreground">Provider / model</span>
      <div class="flex gap-1.5">
        <Input
          class="h-7 flex-1 text-xs"
          aria-label="Provider"
          value={view.settings.model.provider}
          readonly
        />
        <Input
          class="h-7 flex-1 text-xs"
          aria-label="Model"
          value={view.settings.model.model}
          readonly
        />
      </div>
      <span class="text-[10px] text-muted-foreground">
        Model follows the Manager settings preset; edit the preset to change the route.
      </span>
    </label>

    <div class="space-y-1">
      <span class="text-[11px] text-muted-foreground">LLM preset</span>
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
      <span class="text-[11px] text-muted-foreground">Approval policy</span>
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

    <div class="text-[10px] text-muted-foreground">
      Available providers:
      {#each view.providers as provider, index (provider.provider)}
        {index > 0 ? "·" : ""}{provider.provider}{provider.configured ? "" : " (not set)"}
      {/each}
    </div>
  {:else if agentRuntimeConfig.loading}
    <div class="text-[11px] text-muted-foreground">Loading…</div>
  {:else}
    <div class="text-[11px] text-muted-foreground">Config unavailable</div>
  {/if}

  {#if agentRuntimeConfig.error}
    <div class="text-[11px] text-destructive" role="alert">{agentRuntimeConfig.error}</div>
  {/if}
  {#if rejection}
    <div class="text-[11px] text-destructive" role="alert">{rejection}</div>
  {/if}
</div>
