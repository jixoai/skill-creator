<!--
  用户原始需求 [2026-09-08]（tasks 3.2）：「工具行（展开输入/结果）」。
  正交意图：
  1. 工具调用/结果行：toolName + 相位徽标；payload 以折叠 JSON 呈现（展开查看
     输入/结果——不可信内容仅作文本展示，不渲染 HTML）。
  妥协声明：无。
-->
<script lang="ts">
  import IconChevronRight from "@lucide/svelte/icons/chevron-right";
  import AgentCard from "./AgentCard.svelte";
  import AgentProposalCard from "./AgentProposalCard.svelte";

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

  /** propose 结果（task 4.4）：kind "proposed" 的 mutation proposal 待审批卡。 */
  const proposed = $derived.by(() => {
    if (phase !== "result") return null;
    const text = payloadText;
    if (!text.startsWith("{")) return null;
    try {
      const parsed = JSON.parse(text) as {
        kind?: string;
        proposalId?: unknown;
        capability?: unknown;
        status?: unknown;
      };
      if (parsed.kind !== "proposed" || typeof parsed.proposalId !== "string") return null;
      return {
        proposalId: parsed.proposalId,
        capability: typeof parsed.capability === "string" ? parsed.capability : toolName,
        status: typeof parsed.status === "string" ? parsed.status : "pending",
      };
    } catch {
      return null;
    }
  });

  /**
   * tool-result 的 uiCard 引用（task 4.2）：dsh-mcp-client 的结果投影可能包一层
   * content blocks；两处都尝试解析（payload 直书或 content[].text 内嵌 JSON）。
   */
  const uiCard = $derived.by(() => {
    if (phase !== "result") return null;
    const candidates: unknown[] = [payload];
    if (typeof payload === "object" && payload !== null) {
      const content = (payload as { content?: unknown }).content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (typeof (block as { text?: unknown })?.text === "string") {
            candidates.push((block as { text: string }).text);
          }
        }
      }
    }
    for (const candidate of candidates) {
      if (typeof candidate !== "string") continue;
      try {
        const parsed = JSON.parse(candidate) as { uiCard?: unknown };
        const card = parsed.uiCard as
          | { resourceUri?: unknown; title?: unknown }
          | undefined;
        if (typeof card?.resourceUri === "string") {
          return {
            resourceUri: card.resourceUri,
            title: typeof card.title === "string" ? card.title : "Card",
          };
        }
      } catch {
        // 非 JSON 文本：跳过。
      }
    }
    return null;
  });
</script>

<div class="rounded-md border border-border bg-muted/30 text-[11px]">
  {#if proposed}
    <AgentProposalCard
      proposalId={proposed.proposalId}
      capability={proposed.capability}
      input={payload}
      status={proposed.status}
    />
  {:else if uiCard}
    <AgentCard resourceUri={uiCard.resourceUri} title={uiCard.title} />
  {/if}
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
