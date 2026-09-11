<!--
  设置面 Agent 分区（add-agent-settings-modes 迭代：自 AgentConfigSection 迁入）。
  正交意图：
  1. 默认模式：四模式卡（shared DSH_AGENT_MODES 目录，单一事实源；free 卡明示
     token 成本）——新会话继承；当前会话经面板 header 的模式 chip 切换。
  2. 行为：LLM preset 与 approval policy 的行内切换（ask/never 语义沿用）。
-->
<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import { DSH_AGENT_MODES } from "$shared/contracts/dsh-runtime.js";
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

<div class="space-y-4">
  <div>
    <h3 class="text-sm font-medium">Agent</h3>
    <p class="mt-0.5 text-[11px] text-muted-foreground">
      Defaults for new sessions; the panel header switches an existing session's mode.
    </p>
  </div>

  {#if view}
    <section class="space-y-1.5" aria-label="Default mode">
      <span class="text-[11px] font-medium text-muted-foreground">Default mode</span>
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
            <span class="flex items-center gap-1 font-medium">{entry.label}</span>
            <span class="mt-0.5 block text-[10px] leading-snug text-muted-foreground">
              {entry.description}
            </span>
          </button>
        {/each}
      </div>
    </section>

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
    <div class="text-xs text-muted-foreground">Loading…</div>
  {:else}
    <div class="flex items-center justify-between gap-2 text-xs text-muted-foreground">
      Agent settings unavailable
      <Button size="sm" class="h-7 px-2.5 text-xs" onclick={() => void loadAgentSettings()}>
        Retry
      </Button>
    </div>
  {/if}

  {#if rejection}
    <div class="text-xs text-destructive" role="alert">{rejection}</div>
  {/if}
</div>
