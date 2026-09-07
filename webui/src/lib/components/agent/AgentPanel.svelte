<!--
  用户原始需求 [2026-09-08]：「我们可以简单理解成，我们在 skill creator 的右侧
  嵌入了一个聊天对话框。」
  正交意图：
  1. shell 级右栏 drawer：≥720px 常驻侧栏（w-[440px]），<720px 单屏覆盖；
     跨 tab 存活（挂载于 +layout，状态在 module store）。
  2. 对话流：帧视图项分组渲染（turn/status/user/assistant/tool/approval）；
     断线与错误可见。
  3. composer：textarea 发送（Enter 提交 / Shift+Enter 换行）+ 取消按钮。
  妥协声明：无。
-->
<script lang="ts">
  import IconX from "@lucide/svelte/icons/x";
  import IconPlus from "@lucide/svelte/icons/plus";
  import IconSettings from "@lucide/svelte/icons/settings";
  import IconSend from "@lucide/svelte/icons/send";
  import IconStop from "@lucide/svelte/icons/square";
  import { Button } from "$lib/components/ui/button";
  import { Textarea } from "$lib/components/ui/textarea";
  import {
    agentPanel,
    agentSession,
    agentSessionsList,
    cancelAgentSession,
    createAgentSession,
    loadAgentSessions,
    pollAgentStream,
    selectAgentSession,
    sendAgentPrompt,
    setAgentPanelOpen,
  } from "$lib/stores/agent.svelte";
  import AgentApprovalCard from "./AgentApprovalCard.svelte";
  import AgentConfigSection from "./AgentConfigSection.svelte";
  import AgentToolRow from "./AgentToolRow.svelte";

  let composerText = $state("");
  let showConfig = $state(false);
  let scrollBody = $state<HTMLElement | null>(null);

  // 新帧到达时滚动到底（用户向上翻阅时不打扰：接近底部才跟随）。
  $effect(() => {
    void agentSession.items.length;
    void agentSession.status;
    const body = scrollBody;
    if (!body) return;
    const nearBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 160;
    if (nearBottom) {
      queueMicrotask(() => {
        body.scrollTop = body.scrollHeight;
      });
    }
  });

  function submit(): void {
    const text = composerText.trim();
    if (text.length === 0 || agentSession.sending) return;
    composerText = "";
    void sendAgentPrompt(text);
  }

  function onComposerKeydown(event: KeyboardEvent): void {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }
</script>

<svelte:window
  onkeydown={(event) => {
    if (event.key === "Escape" && agentPanel.open) setAgentPanelOpen(false);
  }}
/>

<aside
  class="flex h-full w-full flex-col border-l border-border bg-background min-[720px]:w-[440px]"
  aria-label="Agent panel"
>
  <header class="flex items-center gap-1 border-b border-border px-2 py-1.5">
    <span class="px-1 text-xs font-medium text-muted-foreground">Agent</span>
    <select
      class="h-7 min-w-0 flex-1 rounded-md border border-border bg-transparent px-2 text-xs"
      aria-label="Session"
      value={agentSession.sessionId ?? ""}
      onchange={(event) => selectAgentSession(event.currentTarget.value)}
    >
      {#if agentSessionsList.sessions.length === 0}
        <option value="">No sessions</option>
      {/if}
      {#each agentSessionsList.sessions as session (session.sessionId)}
        <option value={session.sessionId}>
          {session.title || session.sessionId.slice(0, 18)}
          ({session.status})
        </option>
      {/each}
    </select>
    <button
      class="flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      title="New session"
      aria-label="New session"
      onclick={() => void createAgentSession()}
    >
      <IconPlus class="h-4 w-4" />
    </button>
    <button
      class="flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      title="Runtime config"
      aria-label="Runtime config"
      aria-pressed={showConfig}
      onclick={() => {
        showConfig = !showConfig;
        if (showConfig) void import("$lib/stores/agent.svelte").then((m) => m.loadAgentSettings());
      }}
    >
      <IconSettings class="h-4 w-4" />
    </button>
    <button
      class="flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      title="Close panel"
      aria-label="Close panel"
      onclick={() => setAgentPanelOpen(false)}
    >
      <IconX class="h-4 w-4" />
    </button>
  </header>

  {#if showConfig}
    <AgentConfigSection />
  {/if}

  <div bind:this={scrollBody} class="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3 py-2">
    {#if !agentSession.sessionId}
      <div class="flex h-full flex-col items-center justify-center gap-3 text-center">
        <p class="max-w-[280px] text-xs text-muted-foreground">
          Start a session to chat with the Skill Creator agent. Skills are managed through the
          Manager capability tools.
        </p>
        <Button size="sm" onclick={() => void createAgentSession()}>New session</Button>
      </div>
    {:else}
      {#each agentSession.items as item (item.seq)}
        {#if item.kind === "turn"}
          <div class="flex items-center gap-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            <span class="h-px flex-1 bg-border"></span>
            {item.label}
            <span class="h-px flex-1 bg-border"></span>
          </div>
        {:else if item.kind === "status"}
          <div class="px-1 text-[11px] text-muted-foreground">{item.text}</div>
        {:else if item.kind === "user"}
          <div class="ml-auto max-w-[85%] rounded-lg bg-primary/10 px-2.5 py-1.5 text-xs whitespace-pre-wrap">
            {item.text}
          </div>
        {:else if item.kind === "assistant"}
          <div class="max-w-[92%] rounded-lg border border-border px-2.5 py-1.5 text-xs whitespace-pre-wrap">
            {item.text}
          </div>
        {:else if item.kind === "tool"}
          <AgentToolRow toolName={item.toolName} phase={item.phase} payload={item.payload} />
        {:else if item.kind === "approval"}
          <AgentApprovalCard seq={item.seq} questions={item.questions} resolved={item.resolved} />
        {/if}
      {/each}
      {#if agentSession.status === "running"}
        <div class="px-1 text-[11px] text-muted-foreground" role="status">working…</div>
      {/if}
    {/if}
  </div>

  {#if agentSession.error}
    <div class="border-t border-destructive/30 bg-destructive/8 px-3 py-1.5 text-xs text-destructive" role="alert">
      {agentSession.error}
    </div>
  {/if}

  <footer class="border-t border-border p-2">
    <div class="flex items-end gap-1.5">
      <Textarea
        rows={2}
        placeholder={agentSession.sessionId ? "Message the agent…" : "Create a session first"}
        disabled={!agentSession.sessionId}
        bind:value={composerText}
        onkeydown={onComposerKeydown}
        class="min-h-0 flex-1 resize-none text-xs"
      />
      <div class="flex flex-col gap-1">
        <Button
          size="icon"
          class="h-7 w-7"
          aria-label="Send message"
          title="Send (Enter)"
          disabled={!agentSession.sessionId || composerText.trim().length === 0 || agentSession.sending}
          onclick={submit}
        >
          <IconSend class="h-3.5 w-3.5" />
        </Button>
        <Button
          size="icon"
          variant="outline"
          class="h-7 w-7"
          aria-label="Cancel current activity"
          title="Cancel"
          disabled={!agentSession.sessionId || agentSession.status !== "running"}
          onclick={() => void cancelAgentSession()}
        >
          <IconStop class="h-3 w-3" />
        </Button>
      </div>
    </div>
  </footer>
</aside>
