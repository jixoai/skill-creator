<!--
  用户原始需求 [2026-09-08]：「我们可以简单理解成，我们在 skill creator 的右侧
  嵌入了一个聊天对话框。」
  正交意图：
  1. shell 级右栏 drawer：≥720px 常驻侧栏（w-[440px]），<720px 单屏覆盖；
     跨 tab 存活（挂载于 +layout，状态在 module store）。
  2. 对话流：帧视图项分组渲染（turn/status/user/assistant/tool/approval）；
     断线与错误可见；assistant 文本经 renderSkillBody 以 GFM 呈现（无 HTML 直通）。
  3. composer：textarea 发送（Enter 提交 / Shift+Enter 换行）；停止按钮仅在
     turn 运行中出现，图标按钮带 44px 外扩命中区。
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
  import { renderSkillBody } from "$lib/render-skill-md";

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
      class="h-8 min-w-0 flex-1 rounded-md border border-border bg-transparent px-2 py-0 text-xs"
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
    <!-- 图标按钮统一 8px 外扩命中区（视觉 32px + after 16px = 44px，窄屏覆盖模式达标）。 -->
    <button
      class="relative flex h-8 w-8 items-center justify-center rounded text-muted-foreground transition-colors after:absolute after:-inset-1.5 after:content-[''] hover:bg-muted hover:text-foreground"
      title="New session"
      aria-label="New session"
      onclick={() => void createAgentSession()}
    >
      <IconPlus class="h-4 w-4" />
    </button>
    <button
      class="relative flex h-8 w-8 items-center justify-center rounded text-muted-foreground transition-colors after:absolute after:-inset-1.5 after:content-[''] hover:bg-muted hover:text-foreground {showConfig
        ? 'bg-muted text-foreground'
        : ''}"
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
      class="relative flex h-8 w-8 items-center justify-center rounded text-muted-foreground transition-colors after:absolute after:-inset-1.5 after:content-[''] hover:bg-muted hover:text-foreground"
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
          <div
            class="flex items-center gap-2 py-1 text-[11px] uppercase tracking-wide text-muted-foreground"
          >
            <span class="h-px flex-1 bg-border"></span>
            {item.label}
            <span class="h-px flex-1 bg-border"></span>
          </div>
        {:else if item.kind === "status"}
          <div class="px-1 text-[11px] text-muted-foreground">{item.text}</div>
        {:else if item.kind === "user"}
          <div
            class="ml-auto max-w-[85%] rounded-lg bg-primary/10 px-2.5 py-1.5 text-xs whitespace-pre-wrap"
          >
            {item.text}
          </div>
        {:else if item.kind === "assistant"}
          <!-- markdown 渲染：模型回复按 GFM 呈现（renderSkillBody 关闭 HTML 直通并
               兜底剥 script；文本级排版样式在此收敛，避免裸 `**`/反引号）。 -->
          <div
            class="max-w-[92%] space-y-1 rounded-lg border border-border px-2.5 py-1.5 text-xs [&_a]:text-primary [&_a]:underline [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:font-mono [&_code]:text-[11px] [&_h1]:text-sm [&_h1]:font-semibold [&_h2]:text-[13px] [&_h2]:font-semibold [&_li]:my-0.5 [&_ol]:list-decimal [&_ol]:pl-4 [&_p]:my-1 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-muted [&_pre]:p-2 [&_pre]:font-mono [&_pre]:text-[11px] [&_ul]:list-disc [&_ul]:pl-4"
          >
            {@html renderSkillBody(item.text)}
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

  {#if agentSession.promptError ?? agentSession.error}
    <div
      class="border-t border-destructive/30 bg-destructive/8 px-3 py-1.5 text-xs text-destructive"
      role="alert"
    >
      {agentSession.promptError ?? agentSession.error}
    </div>
  {/if}

  <footer class="border-t border-border p-2">
    <div class="flex items-end gap-1.5">
      <Textarea
        rows={2}
        maxlength={20000}
        placeholder={agentSession.sessionId ? "Message the agent…" : "Create a session first"}
        disabled={!agentSession.sessionId}
        bind:value={composerText}
        onkeydown={onComposerKeydown}
        class="min-h-0 flex-1 resize-none text-xs"
      />
      <div class="flex items-end gap-1 pb-0.5">
        <Button
          size="icon"
          class="relative h-8 w-8 after:absolute after:-inset-1.5 after:content-['']"
          aria-label="Send message"
          title="Send (Enter)"
          disabled={!agentSession.sessionId ||
            composerText.trim().length === 0 ||
            agentSession.sending}
          onclick={submit}
        >
          <IconSend class="h-3.5 w-3.5" />
        </Button>
        {#if agentSession.status === "running"}
          <Button
            size="icon"
            variant="outline"
            class="relative h-8 w-8 after:absolute after:-inset-1.5 after:content-['']"
            aria-label="Cancel current activity"
            title="Cancel current activity"
            onclick={() => void cancelAgentSession()}
          >
            <IconStop class="h-3 w-3" />
          </Button>
        {/if}
      </div>
    </div>
  </footer>
</aside>
