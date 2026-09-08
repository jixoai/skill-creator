<!--
  用户原始需求 [2026-09-08]：「我们可以简单理解成，我们在 skill creator 的右侧
  嵌入了一个聊天对话框。」
  正交意图：
  1. shell 级右栏 drawer：≥720px 常驻侧栏（w-[440px]），<720px 单屏覆盖；
     跨 tab 存活（挂载于 +layout，状态在 module store）。
  2. 对话流：帧视图项分组渲染（turn/status/user/assistant/tool/approval/mode）；
     断线与错误可见；assistant 文本经 markstream-svelte 增量渲染（流式优化：
     内容增长只重解析尾部、不完整 markdown 容错、离屏节点延迟），HTML 策略
     锁定 escape——模型输出零 HTML 直通。
  3. composer 与模式：textarea 发送（Enter 提交 / Shift+Enter 换行）；停止按钮
     仅在 turn 运行中出现，图标按钮带 44px 外扩命中区；header 模式 chip 切换
     当前会话模式（add-agent-settings-modes；running 拒绝）。
  妥协声明：katex/mermaid/stream-diffs 为可选 peer，未安装时回退纯文本块。
-->
<script lang="ts">
  import IconX from "@lucide/svelte/icons/x";
  import IconPlus from "@lucide/svelte/icons/plus";
  import IconSend from "@lucide/svelte/icons/send";
  import IconStop from "@lucide/svelte/icons/square";
  import IconChevron from "@lucide/svelte/icons/chevron-right";
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
    setAgentSessionMode,
  } from "$lib/stores/agent.svelte";
  import { DSH_AGENT_MODES, type DshAgentMode } from "$shared/contracts/dsh-runtime.js";
  import AgentApprovalCard from "./AgentApprovalCard.svelte";
  import AgentToolRow from "./AgentToolRow.svelte";
  import MarkdownRender from "markstream-svelte";
  import "markstream-svelte/index.css";

  let composerText = $state("");
  let scrollBody = $state<HTMLElement | null>(null);

  // 新帧到达时滚动到底（用户向上翻阅时不打扰）。markstream batch 渲染会在帧
  // 落地后继续长高气泡，且单个代码块的一次性增高可超过 160px 跟随门，故判定
  // 改用「增高前是否贴底」：贴底即钉住，手动上滚（ scrollTop 变小）自然脱离。
  let lastContentHeight = 0;
  $effect(() => {
    void agentSession.items.length;
    void agentSession.status;
    const body = scrollBody;
    if (!body) return;
    const follow = (): void => {
      const wasNearBottom = lastContentHeight - body.scrollTop - body.clientHeight < 160;
      lastContentHeight = body.scrollHeight;
      if (wasNearBottom || body.scrollHeight - body.scrollTop - body.clientHeight < 160) {
        body.scrollTop = body.scrollHeight;
      }
    };
    follow();
    const observer = new ResizeObserver(follow);
    for (const child of body.children) observer.observe(child);
    return () => observer.disconnect();
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

  /** 当前会话在列表中的完整身份（select 的 title 提示）。 */
  const selectedSessionTitle = $derived.by(() => {
    const summary = agentSessionsList.sessions.find(
      (item) => item.sessionId === agentSession.sessionId,
    );
    return summary ? `${summary.title || summary.sessionId} (${summary.status})` : undefined;
  });
</script>

<svelte:window
  onkeydown={(event) => {
    // 有模态（设置面等）打开时 Esc 归模态所有，不连带收起面板。
    if (event.key === "Escape" && agentPanel.open && !document.querySelector("[role='dialog']")) {
      setAgentPanelOpen(false);
    }
  }}
/>

<aside
  class="flex h-full w-full flex-col border-l border-border bg-background min-[720px]:w-[440px]"
  aria-label="Agent panel"
>
  <header class="flex items-center gap-1 border-b border-border px-2 py-1.5">
    <span class="px-1 text-xs font-medium text-muted-foreground">Agent</span>
    <!-- 选项文本刻意短化（原生 select 无省略号，长文本会被硬裁）；完整身份走
         title 提示。 -->
    <select
      class="h-8 min-w-0 flex-1 rounded-md border border-border bg-transparent px-2 py-0 text-xs"
      aria-label="Session"
      title={selectedSessionTitle}
      value={agentSession.sessionId ?? ""}
      onchange={(event) => selectAgentSession(event.currentTarget.value)}
    >
      {#if agentSessionsList.sessions.length === 0}
        <option value="">No sessions</option>
      {/if}
      {#each agentSessionsList.sessions as session (session.sessionId)}
        <option value={session.sessionId}>
          {session.title || session.sessionId.slice(0, 14)}
          {session.status === "disposed" ? "· ended" : `· ${session.status}`}
        </option>
      {/each}
    </select>
    <!-- 会话模式 chip（DSH preset chip UX 移植；切换 = setMode RPC：running 拒绝，
         idle 切换后下一次 prompt 以新模式复活）。 -->
    <select
      class="h-8 w-[6.5rem] rounded-md border border-border bg-transparent px-1.5 py-0 text-xs"
      aria-label="Session mode"
      title={agentSession.status === "running"
        ? "Switch modes after the current turn ends"
        : "Switch this session's mode"}
      disabled={!agentSession.sessionId || agentSession.status === "running"}
      value={agentSession.mode ?? ""}
      onchange={(event) => void setAgentSessionMode(event.currentTarget.value as DshAgentMode)}
    >
      {#each DSH_AGENT_MODES as entry (entry.id)}
        <option value={entry.id}>
          {entry.label}{entry.tokenHeavy ? " (heavy)" : ""}
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
      class="relative flex h-8 w-8 items-center justify-center rounded text-muted-foreground transition-colors after:absolute after:-inset-1.5 after:content-[''] hover:bg-muted hover:text-foreground"
      title="Close panel"
      aria-label="Close panel"
      onclick={() => setAgentPanelOpen(false)}
    >
      <IconX class="h-4 w-4" />
    </button>
  </header>

  <div bind:this={scrollBody} class="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-2">
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
        {:else if item.kind === "mode"}
          <div
            class="flex items-center gap-2 py-1 text-[11px] text-muted-foreground"
            role="separator"
            aria-label={`Mode switched from ${item.from} to ${item.to}`}
          >
            <span class="h-px flex-1 bg-border"></span>
            <span class="rounded bg-muted px-1 text-[10px] uppercase">mode</span>
            {item.from} → {item.to}
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
        {:else if item.kind === "reasoning"}
          <!-- thinking 折叠面：默认收起；流式时摘要带进行指示，终帧后可展开回看。 -->
          <details class="group rounded-md border border-border/70 bg-muted/20">
            <summary
              class="flex cursor-pointer list-none items-center gap-1 px-2 py-1 text-[11px] text-muted-foreground select-none [&::-webkit-details-marker]:hidden"
            >
              <IconChevron class="h-3 w-3 transition-transform group-open:rotate-90" />
              Thinking
              {#if item.streaming}<span class="animate-pulse">…</span>{/if}
            </summary>
            <div
              class="max-h-48 overflow-y-auto whitespace-pre-wrap px-2 pb-1.5 text-[11px] leading-relaxed text-muted-foreground"
            >
              {item.text}
            </div>
          </details>
        {:else if item.kind === "assistant"}
          <!-- markstream 增量渲染：内容增长只重解析尾部、不完整 fence/强调容错、
               离屏节点延迟；htmlPolicy=escape 锁死模型输出的 HTML 直通（与既有
               XSS 不变量一致）。流式态 final=false——增量期间不闭合的 markdown
               结构按流式容错渲染；终帧到达后置 true 收敛。密度覆写在下方 scoped
               style：库默认面向文档页（16px/IBM Plex/clamp 巨标题），且 Tailwind
               preflight 会剥掉列表 marker，须收敛回 12px 面板排版。 -->
          <div
            class="ms-md rounded-lg border border-border px-2.5 py-1.5 text-xs [&_a]:text-primary"
          >
            <MarkdownRender content={item.text} htmlPolicy="escape" final={!item.streaming} />
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

<style>
  /* markstream 密度收敛：库默认 16px/IBM Plex/clamp 文档级标题，且 Tailwind
     preflight 将 ul/ol 重置为无 marker；scoped 双类选择器稳定压过库内单类规则。 */
  .ms-md :global(.markstream-svelte) {
    font-family: inherit;
    font-size: inherit;
    line-height: 1.6;
  }

  .ms-md :global(.markstream-svelte h1),
  .ms-md :global(.markstream-svelte h2),
  .ms-md :global(.markstream-svelte h3),
  .ms-md :global(.markstream-svelte h4),
  .ms-md :global(.markstream-svelte h5),
  .ms-md :global(.markstream-svelte h6) {
    margin: 0.75em 0 0.35em;
    line-height: 1.3;
    font-weight: 600;
    letter-spacing: 0;
  }

  .ms-md :global(.markstream-svelte h1) {
    font-size: 1.25em;
  }

  .ms-md :global(.markstream-svelte h2) {
    font-size: 1.15em;
  }

  .ms-md :global(.markstream-svelte h3) {
    font-size: 1.05em;
  }

  .ms-md :global(.markstream-svelte h4),
  .ms-md :global(.markstream-svelte h5),
  .ms-md :global(.markstream-svelte h6) {
    font-size: 1em;
  }

  .ms-md :global(.markstream-svelte p) {
    margin: 0.4em 0;
  }

  .ms-md :global(.markstream-svelte ul) {
    list-style: disc;
    padding-inline-start: 1.25em;
    margin: 0.4em 0;
  }

  .ms-md :global(.markstream-svelte ol) {
    list-style: decimal;
    padding-inline-start: 1.35em;
    margin: 0.4em 0;
  }

  .ms-md :global(.markstream-svelte li) {
    margin: 0.15em 0;
  }

  /* task list：checkbox 即状态标记，去掉 bullet 避免双重标记。 */
  .ms-md :global(.markstream-svelte ul:has(input[type="checkbox"])) {
    list-style: none;
    padding-inline-start: 0.5em;
  }
</style>
