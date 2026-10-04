<!--
  四种起步方向（模式卡词条面退化）：只向 composer 注入 slash command 文本，
  不切换全局或当前会话模式。Agent 空态与 Creator capture 卡共享这一组候选。
-->
<script module lang="ts">
  import type { MessageKey } from "$lib/i18n";

  export const AGENT_START_DIRECTIONS = [
    {
      id: "general",
      command: "/general",
      labelKey: "agentStartDirections.general",
      commandKey: "agentStartDirections.generalCommand",
    },
    {
      id: "create",
      command: "/create",
      labelKey: "agentStartDirections.create",
      commandKey: "agentStartDirections.createCommand",
    },
    {
      id: "manage",
      command: "/manage",
      labelKey: "agentStartDirections.manage",
      commandKey: "agentStartDirections.manageCommand",
    },
    {
      id: "explore",
      command: "/explore",
      labelKey: "agentStartDirections.explore",
      commandKey: "agentStartDirections.exploreCommand",
    },
  ] as const satisfies ReadonlyArray<{
    id: string;
    command: string;
    labelKey: MessageKey;
    commandKey: MessageKey;
  }>;

  export type AgentStartDirection = (typeof AGENT_START_DIRECTIONS)[number];
</script>

<script lang="ts">
  import { t } from "$lib/i18n";

  let {
    onSelect,
    compact = false,
  }: {
    onSelect: (command: string) => void;
    compact?: boolean;
  } = $props();
</script>

<div
  class="flex flex-wrap items-center justify-center gap-1.5"
  role="group"
  aria-label={t("agentStartDirections.title")}
  data-agent-start-directions="true"
>
  {#each AGENT_START_DIRECTIONS as direction (direction.id)}
    <button
      type="button"
      class="relative flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground transition-colors after:absolute after:-inset-1 after:content-[''] hover:border-primary/40 hover:bg-muted hover:text-foreground"
      title={t(direction.commandKey)}
      aria-label={`${t(direction.labelKey)} ${t(direction.commandKey)}`}
      data-start-direction={direction.command}
      onclick={() => onSelect(direction.command)}
    >
      <span class="font-medium text-foreground/80">{t(direction.labelKey)}</span>
      {#if !compact}
        <kbd class="font-mono text-[10px] text-muted-foreground/70">{t(direction.commandKey)}</kbd>
      {/if}
    </button>
  {/each}
</div>
