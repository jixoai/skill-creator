<!--
  Agent 页右扩展面板（skills-agent-page 1.5）：panelTabs 三页。
  用户原始需求 [2026-10-03]（design §5）：「[Agent 终端][审批][卡]……panelTabs
  按会话上下文自动切换（新审批到达 → 审批 tab 角标）；用户手动切换优先（会话
  内记忆）」。
  正交意图：
    [1] Agent 终端流：transcript 帧 tool_call（bash 族）只读回放视图——数据源
        = agentSession.items 的 tool 行（零新 RPC），行渲染复用 AgentToolRow。
    [2] 审批：agent.proposals.* 统一审批面（extension-panel watch store 轮询
        投影）；决定卡复用 AgentProposalCard（approve/reject 直连 RPC）。
    [3] 卡片：工具结果携带的 ui:// 卡（沙箱 iframe 渲染沿用 AgentCard）——
        从 tool 行 result 经最小 Zod 收窄提取（畸形退化空）。
    [4] tab 切换语义：手动点击优先（会话内记忆 manualTab）；自动切换只在无
        手动记忆时生效（新审批到达 → approvals + 角标）。
  妥协声明：无。
-->
<script lang="ts">
  import { z } from "zod";
  import IconSquareTerminal from "@lucide/svelte/icons/square-terminal";
  import IconBadgeCheck from "@lucide/svelte/icons/badge-check";
  import IconIdCard from "@lucide/svelte/icons/id-card";
  import { t } from "$lib/i18n";
  import { agentSession } from "$lib/stores/agent.svelte";
  import AgentToolRow from "$lib/components/agent/AgentToolRow.svelte";
  import AgentProposalCard from "$lib/components/agent/AgentProposalCard.svelte";
  import AgentCard from "$lib/components/agent/AgentCard.svelte";
  import {
    extensionPanel,
    setExtensionTabManual,
    startExtensionPanelWatch,
    stopExtensionPanelWatch,
    type ExtensionPanelTab,
  } from "./extension-panel.svelte.js";

  startExtensionPanelWatch();
  $effect(() => {
    return () => stopExtensionPanelWatch();
  });

  const tabs: Array<{ id: ExtensionPanelTab; label: string; icon: typeof IconSquareTerminal }> = [
    { id: "terminal-narrative", label: t("extensionPanel.tabTerminal"), icon: IconSquareTerminal },
    { id: "approvals", label: t("extensionPanel.tabApprovals"), icon: IconBadgeCheck },
    { id: "cards", label: t("extensionPanel.tabCards"), icon: IconIdCard },
  ];

  /** 内核工具行的 bash 族判定（Agent 终端流过滤面；bash/pwsh 覆盖模式矩阵）。 */
  function isShellTool(toolName: string): boolean {
    const normalized = toolName.toLowerCase();
    return normalized.includes("bash") || normalized.includes("shell");
  }

  const shellToolItems = $derived(
    agentSession.items.filter((item) => item.kind === "tool" && isShellTool(item.toolName)),
  );

  /** ui:// 卡引用提取面（与 AgentToolRow 的消费 schema 同形；畸形 → null）。 */
  const UiCardRefSchema = z.object({
    uiCard: z.object({ resourceUri: z.string().min(1), title: z.string().optional() }),
  });
  const ResultEnvelopeSchema = z.object({ content: z.array(z.unknown()).optional() }).loose();

  interface CardEntry {
    seq: number;
    resourceUri: string;
    title: string;
  }

  function uiCardOf(payload: unknown): { resourceUri: string; title?: string } | null {
    const direct = UiCardRefSchema.safeParse(payload);
    if (direct.success) return direct.data.uiCard;
    const envelope = ResultEnvelopeSchema.safeParse(payload);
    if (!envelope.success || envelope.data.content === undefined) return null;
    for (const block of envelope.data.content) {
      const nested = UiCardRefSchema.safeParse(block);
      if (nested.success) return nested.data.uiCard;
    }
    return null;
  }

  const cardEntries = $derived.by(() => {
    const entries: CardEntry[] = [];
    for (const item of agentSession.items) {
      if (item.kind !== "tool" || item.result === undefined) continue;
      const card = uiCardOf(item.result);
      if (card !== null) {
        entries.push({
          seq: item.seq,
          resourceUri: card.resourceUri,
          title: card.title ?? card.resourceUri,
        });
      }
    }
    return entries;
  });

  const pendingProposals = $derived(
    (extensionPanel.proposals ?? []).filter((proposal) => proposal.status === "pending"),
  );
  const decidedProposals = $derived(
    (extensionPanel.proposals ?? []).filter((proposal) => proposal.status !== "pending"),
  );
</script>

<aside
  class="flex h-full flex-col bg-background"
  aria-label={t("extensionPanel.panelAria")}
  data-extension-panel="true"
>
  <div class="flex h-9 shrink-0 items-stretch border-b border-border" role="tablist">
    {#each tabs as tab (tab.id)}
      {@const Icon = tab.icon}
      <button
        type="button"
        role="tab"
        aria-selected={extensionPanel.activeTab === tab.id}
        class="relative flex min-w-0 flex-1 items-center justify-center gap-1 px-1 text-[11px] transition-colors {extensionPanel.activeTab ===
        tab.id
          ? 'border-b-2 border-primary font-medium text-primary'
          : 'border-b-2 border-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground'}"
        onclick={() => setExtensionTabManual(tab.id)}
      >
        <Icon class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span class="truncate">{tab.label}</span>
        {#if tab.id === "approvals" && extensionPanel.approvalsBadge > 0}
          <span
            class="ml-0.5 flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-semibold text-primary-foreground"
          >
            {extensionPanel.approvalsBadge}
          </span>
        {/if}
      </button>
    {/each}
  </div>

  <div class="min-h-0 flex-1 overflow-y-auto" role="tabpanel">
    {#if extensionPanel.activeTab === "terminal-narrative"}
      <div class="flex flex-col gap-1 p-2">
        {#if shellToolItems.length === 0}
          <p class="px-1 py-3 text-xs text-muted-foreground">{t("extensionPanel.terminalEmpty")}</p>
        {:else}
          {#each shellToolItems as item (item.seq)}
            {#if item.kind === "tool"}
              <AgentToolRow
                toolName={item.toolName}
                argsText={item.argsText}
                result={item.result}
                phase={item.phase}
                running={item.phase === "calling" && agentSession.status === "running"}
                startedAt={item.startedAt}
                endedAt={item.endedAt}
              />
            {/if}
          {/each}
        {/if}
      </div>
    {:else if extensionPanel.activeTab === "approvals"}
      <div class="flex flex-col gap-2 p-2">
        {#if extensionPanel.error}
          <div class="px-1 text-xs text-destructive" role="alert">{extensionPanel.error}</div>
        {/if}
        {#if pendingProposals.length === 0 && decidedProposals.length === 0}
          <p class="px-1 py-3 text-xs text-muted-foreground">
            {t("extensionPanel.approvalsEmpty")}
          </p>
        {/if}
        {#each pendingProposals as proposal (proposal.id)}
          <AgentProposalCard
            proposalId={proposal.id}
            capability={proposal.capability ?? proposal.kind}
            input={proposal.payload}
            status={proposal.status}
          />
        {/each}
        {#if decidedProposals.length > 0}
          <div class="px-1 pt-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            {t("extensionPanel.decidedHeader")}
          </div>
          {#each decidedProposals.slice(0, 10) as proposal (proposal.id)}
            <AgentProposalCard
              proposalId={proposal.id}
              capability={proposal.capability ?? proposal.kind}
              input={proposal.payload}
              status={proposal.status}
            />
          {/each}
        {/if}
      </div>
    {:else}
      <div class="flex flex-col gap-2 p-2">
        {#if cardEntries.length === 0}
          <p class="px-1 py-3 text-xs text-muted-foreground">{t("extensionPanel.cardsEmpty")}</p>
        {:else}
          {#each cardEntries as entry (entry.seq)}
            <AgentCard resourceUri={entry.resourceUri} title={entry.title} />
          {/each}
        {/if}
      </div>
    {/if}
  </div>
</aside>
