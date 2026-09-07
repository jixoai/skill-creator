<!--
  用户原始需求 [2026-09-08]（tasks 3.2）：「工具行（展开输入/结果）」。
  正交意图：
  1. 工具调用/结果行：toolName + 相位徽标；payload 以折叠 JSON 呈现（展开查看
     输入/结果——不可信内容仅作文本展示，不渲染 HTML）。
  妥协声明：无。
-->
<script lang="ts">
  import IconChevronRight from "@lucide/svelte/icons/chevron-right";

  let {
    toolName,
    phase,
    payload,
  }: {
    toolName: string;
    phase: "call" | "result";
    payload?: unknown;
  } = $props();

  let expanded = $state(false);

  const payloadText = $derived.by(() => {
    if (payload === undefined || payload === null) return "";
    try {
      return JSON.stringify(payload, null, 2);
    } catch {
      return String(payload);
    }
  });
</script>

<div class="rounded-md border border-border bg-muted/30 text-[11px]">
  <button
    class="flex w-full items-center gap-1.5 px-2 py-1 text-left"
    aria-expanded={expanded}
    onclick={() => (expanded = !expanded)}
  >
    <IconChevronRight class="h-3 w-3 shrink-0 transition-transform {expanded ? 'rotate-90' : ''}" />
    <span class="shrink-0 font-mono">{toolName}</span>
    <span
      class="rounded px-1 text-[10px] uppercase {phase === 'call'
        ? 'bg-primary/10 text-primary'
        : 'bg-muted text-muted-foreground'}"
    >
      {phase}
    </span>
  </button>
  {#if expanded && payloadText}
    <pre class="max-h-48 overflow-auto border-t border-border px-2 py-1 font-mono text-[10px] whitespace-pre-wrap">{payloadText}</pre>
  {/if}
</div>
