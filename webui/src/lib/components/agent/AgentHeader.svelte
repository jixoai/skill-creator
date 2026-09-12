<!--
  用户原始需求 [2026-09-08]：「右侧嵌入了一个聊天对话框」——2026-09-12 redesign
  §3.1/§3.3：header 从 AgentPanel 机械拆出（40px：会话 select、新会话、关闭），
  行为零变化；AgentPanel 收敛为容器（drawer 编排 + 数据接线）。
  修订 [2026-09-12]（R12-B 7/8）：+ 按钮仅在 session 态显示；点击 + 不再
  eager 建会话，而是回到 New Session 空态（会话创建只发生在首条消息）。
  正交意图：
    [1] 会话身份行：Agent 标签 + 会话 select（短化选项 + title 完整身份）+
       会话态专属的新会话按钮 + 关闭按钮（8px 外扩命中区沿用）。
  妥协声明：原生 select 会话选择器保留（design §7：无省略号问题已有 title 兜底）。
-->
<script lang="ts">
  import IconX from "@lucide/svelte/icons/x";
  import IconPlus from "@lucide/svelte/icons/plus";
  import {
    agentSession,
    agentSessionsList,
    beginNewAgentSession,
    selectAgentSession,
    setAgentPanelOpen,
  } from "$lib/stores/agent.svelte";

  /** 当前会话在列表中的完整身份（select 的 title 提示）。 */
  const selectedSessionTitle = $derived.by(() => {
    const summary = agentSessionsList.sessions.find(
      (item) => item.sessionId === agentSession.sessionId,
    );
    return summary ? `${summary.title || summary.sessionId} (${summary.status})` : undefined;
  });
</script>

<header class="flex h-10 shrink-0 items-center gap-1 border-b border-border px-2">
  <span class="px-1 text-xs font-medium text-muted-foreground">Agent</span>
  <!-- 选项文本刻意短化（原生 select 无省略号，长文本会被硬裁）；完整身份走
       title 提示（design §7 妥协：本轮不换自定义下拉）。 -->
  <select
    class="h-8 min-w-0 flex-1 rounded-md border border-border bg-transparent px-2 py-0 text-xs"
    aria-label="Session"
    title={selectedSessionTitle}
    value={agentSession.sessionId ?? ""}
    onchange={(event) => selectAgentSession(event.currentTarget.value)}
  >
    {#if agentSession.sessionId === null}
      <option value="">New session…</option>
    {/if}
    {#if agentSessionsList.sessions.length === 0 && agentSession.sessionId !== null}
      <option value="">No sessions</option>
    {/if}
    {#each agentSessionsList.sessions as session (session.sessionId)}
      <option value={session.sessionId}>
        {session.title || session.sessionId.slice(0, 14)}
        {session.status === "disposed" ? "· ended" : `· ${session.status}`}
      </option>
    {/each}
  </select>
  <!-- New Session 入口（R12-B 7/8）：仅 session 态显示；点击 = 回到 New Session
       空态（不建会话——首条消息才建）。图标按钮统一 8px 外扩命中区（视觉 32px
       + after 16px = 44px，窄屏覆盖模式达标）。 -->
  {#if agentSession.sessionId}
    <button
      type="button"
      class="relative flex h-8 w-8 items-center justify-center rounded text-muted-foreground transition-colors after:absolute after:-inset-1.5 after:content-[''] hover:bg-muted hover:text-foreground"
      title="New session"
      aria-label="New session"
      onclick={() => beginNewAgentSession()}
    >
      <IconPlus class="h-4 w-4" />
    </button>
  {/if}
  <button
    type="button"
    class="relative flex h-8 w-8 items-center justify-center rounded text-muted-foreground transition-colors after:absolute after:-inset-1.5 after:content-[''] hover:bg-muted hover:text-foreground"
    title="Close panel"
    aria-label="Close panel"
    onclick={() => setAgentPanelOpen(false)}
  >
    <IconX class="h-4 w-4" />
  </button>
</header>
