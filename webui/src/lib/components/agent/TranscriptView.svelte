<!--
  用户原始需求 [2026-09-08]：「我们可以简单理解成，我们在 skill creator 的右侧
  嵌入了一个聊天对话框。」——2026-09-12 redesign §3.2/§3.3：转录流行渲染器集合
  从 AgentPanel 机械拆出（行为零变化），AgentPanel 收敛为容器。
  正交意图：
  1. 转录流（§3.2 DisclosureRow 语法，原子类在 agent-flow.css）：TurnDivider /
     TurnEnd 药丸 / UserMessage（附件上·气泡·hover 操作行下）/ AssistantMessage
     （全宽无气泡 markstream，htmlPolicy=escape 不变）/ ThinkingRow（流式自动
     展开+末行摘要扫光，定稿收起+首行摘要）/ ToolRow（AgentToolRow）/ 审批卡 /
     ModeRow / TurnStatus（Working 扫光 + 15s 计时）；空会话态 = 模式选择卡
     （R12-B 6/8：选择 pendingMode，不 eager 建会话）。
  2. 滚动跟随（增高前贴底判定 + ResizeObserver）与 back-to-bottom FAB（>200px）；
     copy → check 1s 反馈；edit 回填 / resend（append-only 语义，§4.3）。
  妥协声明：katex/mermaid/stream-diffs 为可选 peer，未安装时回退纯文本块；
     ModeRow 无 per-mode 图标目录（以文字标签表达，语义不变）。
-->
<script lang="ts">
  import IconCopy from "@lucide/svelte/icons/copy";
  import IconCheck from "@lucide/svelte/icons/check";
  import IconPen from "@lucide/svelte/icons/pen-line";
  import IconRefresh from "@lucide/svelte/icons/refresh-cw";
  import IconSparkles from "@lucide/svelte/icons/sparkles";
  import IconFile from "@lucide/svelte/icons/file";
  import IconImage from "@lucide/svelte/icons/image";
  import IconArrowDown from "@lucide/svelte/icons/arrow-down";
  import IconBot from "@lucide/svelte/icons/bot";
  import { showToast } from "$lib/toast.svelte";
  import { agentSession, sendAgentPrompt } from "$lib/stores/agent.svelte";
  import { beginComposerEdit } from "$lib/stores/agent-composer.svelte";
  import { DSH_AGENT_MODES } from "$shared/contracts/dsh-runtime.js";
  import AgentApprovalCard from "./AgentApprovalCard.svelte";
  import AgentToolRow from "./AgentToolRow.svelte";
  import DisclosureRow from "./DisclosureRow.svelte";
  import { formatTokens, formatElapsed } from "./format";
  import MarkdownRender from "markstream-svelte";
  import "markstream-svelte/index.css";
  import "./agent-flow.css";

  let scrollBody = $state<HTMLElement | null>(null);
  /** 折叠态行（thinking/tool）的 per-seq 展开表（streaming 态强制开）。 */
  let openItems = $state<Record<number, boolean>>({});
  /** copy → check 1s 反馈的行 seq。 */
  let copiedSeq = $state<number | null>(null);
  /** 距底 >200px 时显示 back-to-bottom FAB。 */
  let awayFromBottom = $state(false);

  // 新帧到达时滚动到底（用户向上翻阅时不打扰）。markstream batch 渲染会在帧
  // 落地后继续长高气泡，且单个代码块的一次性增高可超过 160px 跟随门，故判定
  // 改用「增高前是否贴底」：贴底即钉住，手动上滚（scrollTop 变小）自然脱离。
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
      awayFromBottom = body.scrollHeight - body.scrollTop - body.clientHeight > 200;
    };
    follow();
    const observer = new ResizeObserver(follow);
    for (const child of body.children) observer.observe(child);
    return () => observer.disconnect();
  });

  /** TurnStatus 计时（§3.2）：15s 后出现并每秒跳动（reduced-motion 由 .sweep 降级）。 */
  let workingSeconds = $state(0);
  $effect(() => {
    if (agentSession.status !== "running") {
      workingSeconds = 0;
      return;
    }
    const tick = (): void => {
      const started = agentSession.turnStartedAt
        ? Date.parse(agentSession.turnStartedAt)
        : Number.NaN;
      workingSeconds = Number.isFinite(started) ? Math.max(0, (Date.now() - started) / 1000) : 0;
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  });

  async function copyText(text: string, seq: number): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      copiedSeq = seq;
      setTimeout(() => {
        if (copiedSeq === seq) copiedSeq = null;
      }, 1000);
    } catch {
      showToast("Copy failed — clipboard unavailable.");
    }
  }

  function editIntoComposer(text: string): void {
    // §4.3：编辑重发不截断历史（append-only）——注记条 + placeholder 由 editing 态表达。
    beginComposerEdit(text);
    document
      .querySelector<HTMLTextAreaElement>('aside[aria-label="Agent panel"] textarea')
      ?.focus();
  }

  function retryPrompt(text: string): void {
    if (agentSession.sending) return;
    void sendAgentPrompt(text);
  }

  /** 最新一条 user / assistant 项 seq（操作行常显依据，§3.2）。 */
  const lastUserSeq = $derived.by(() => {
    for (let i = agentSession.items.length - 1; i >= 0; i--) {
      const item = agentSession.items[i];
      if (item?.kind === "user") return item.seq;
    }
    return null;
  });
  const lastAssistantSeq = $derived.by(() => {
    for (let i = agentSession.items.length - 1; i >= 0; i--) {
      const item = agentSession.items[i];
      if (item?.kind === "assistant") return item.seq;
    }
    return null;
  });

  /** thinking 摘要：流式 = 末行；定稿 = 首行（dsh 语义）。 */
  function thinkingSummary(text: string, streaming: boolean): string {
    const trimmed = text.trim();
    if (trimmed.length === 0) return "";
    const lines = trimmed.split("\n").filter((line) => line.trim().length > 0);
    if (lines.length === 0) return "";
    const line = streaming ? lines[lines.length - 1]! : lines[0]!;
    return line.length > 96 ? `${line.slice(0, 96)}…` : line;
  }

  /** ModeRow 术语（PM 修复 5）：原始 id 经 DSH_AGENT_MODES 映射显示名（free→General），
   * 未知 id 回退原文。 */
  function modeLabel(id: string): string {
    return DSH_AGENT_MODES.find((entry) => entry.id === id)?.label ?? id;
  }

  /** TurnEnd 药丸内容（§3.2）：↑ in / ↓ out / 时长（缺项跳过）。 */
  function turnEndPills(item: {
    usage?: { inputTokens: number; outputTokens: number };
    elapsedMs?: number;
  }): string[] {
    return [
      item.usage ? `↑ ${formatTokens(item.usage.inputTokens)}` : "",
      item.usage ? `↓ ${formatTokens(item.usage.outputTokens)}` : "",
      item.elapsedMs !== undefined ? formatElapsed(item.elapsedMs) : "",
    ].filter((part) => part.length > 0);
  }

  function toggleItem(seq: number): void {
    openItems = { ...openItems, [seq]: !(openItems[seq] ?? false) };
  }

  function backToBottom(): void {
    const body = scrollBody;
    if (body) body.scrollTop = body.scrollHeight;
  }
</script>

<div class="relative min-h-0 flex-1">
  <div
    bind:this={scrollBody}
    class="h-full overflow-y-auto px-4 py-3"
    onscroll={(event) => {
      const body = event.currentTarget;
      awayFromBottom = body.scrollHeight - body.scrollTop - body.clientHeight > 200;
    }}
  >
    {#if !agentSession.sessionId}
      <!-- 空态 = 模式选择卡（R12-B 6/8）：点击只改 pendingMode 选择（与 composer
           模式 chip 同一数据源，双向同步，默认 General）；会话由首条消息惰性创建。 -->
      <div class="flex h-full flex-col items-center justify-center gap-3 text-center">
        <p class="max-w-[280px] text-xs text-muted-foreground">
          Pick a way to work with your skill library:
        </p>
        <div class="w-full max-w-[300px] space-y-1.5">
          {#each DSH_AGENT_MODES as entry (entry.id)}
            <button
              type="button"
              class="w-full rounded-md border p-2 text-left transition-colors {agentSession.pendingMode ===
              entry.id
                ? 'border-primary/60 bg-primary/5'
                : 'border-border hover:border-primary/50 hover:bg-primary/5'}"
              aria-pressed={agentSession.pendingMode === entry.id}
              disabled={agentSession.sending}
              onclick={() => (agentSession.pendingMode = entry.id)}
            >
              <span class="flex items-center gap-1 text-xs font-medium">{entry.label}</span>
              <span class="mt-0.5 block text-[10px] leading-snug text-muted-foreground">
                {entry.description}
              </span>
            </button>
          {/each}
        </div>
      </div>
    {:else}
      {#each agentSession.items as item (item.seq)}
        {#if item.kind === "turn"}
          <!-- TurnDivider（§3.2）：hairline + 12px muted uppercase 标签 + hairline。 -->
          <div
            class="flow-item flex h-6 items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground"
          >
            <span class="h-px flex-1 bg-border"></span>
            {item.label ?? "Turn"}
            <span class="h-px flex-1 bg-border"></span>
          </div>
        {:else if item.kind === "turn-end"}
          <!-- TurnEnd 药丸行（§3.2）：↑ in · ↓ out · 时长；reason 进 title。 -->
          <div class="flow-item flex h-5 items-center gap-1.5" title={item.reason}>
            {#if turnEndPills(item).length > 0}
              <span class="turn-pill">{turnEndPills(item).join(" · ")}</span>
            {:else}
              <span class="turn-pill">{item.reason}</span>
            {/if}
          </div>
        {:else if item.kind === "mode"}
          <!-- ModeRow（§3.2）：24px 居中 + 两侧 hairline（无 chevron）；标签走目录映射
               （free→General），未知 id 回退原文（PM 修复 5）。 -->
          <div
            class="flow-item flex h-6 items-center gap-2 text-xs text-muted-foreground"
            role="separator"
            aria-label={`Mode switched from ${modeLabel(item.from)} to ${modeLabel(item.to)}`}
          >
            <span class="h-px flex-1 bg-border"></span>
            <span class="rounded bg-muted px-1 text-[10px] uppercase">mode</span>
            {modeLabel(item.from)} → {modeLabel(item.to)}
            <span class="h-px flex-1 bg-border"></span>
          </div>
        {:else if item.kind === "status"}
          <div class="flow-item px-1 text-[11px] text-muted-foreground">{item.text}</div>
        {:else if item.kind === "note"}
          <!-- 系统动作注记（auto-compact）：与 mode 分隔行同语法，居中 + 两侧 hairline。 -->
          <div
            class="flow-item flex h-6 items-center gap-2 px-3 text-[10px] text-muted-foreground"
            role="note"
          >
            <span class="h-px flex-1 bg-border"></span>
            <span class="rounded bg-muted px-1 text-[10px] uppercase">compact</span>
            <span class="truncate">{item.text}</span>
            <span class="h-px flex-1 bg-border"></span>
          </div>
        {:else if item.kind === "subagent"}
          <!-- 子代理 spawn 行（dsh-alpha-native-subagents）：与 note 同居中语法，
               agent 图标 + label + 模式 chip；settlement 经 user-text 回流对话流。 -->
          <div
            class="flow-item flex h-6 items-center gap-2 px-3 text-[10px] text-muted-foreground"
            role="status"
            aria-label={`Subagent spawned: ${item.label} (${item.mode})`}
          >
            <span class="h-px flex-1 bg-border"></span>
            <IconBot class="h-3 w-3 shrink-0" aria-hidden="true" />
            <span class="rounded bg-muted px-1 uppercase">agent</span>
            <span class="truncate">{item.label}</span>
            <span class="rounded bg-primary/10 px-1 text-primary">{item.mode}</span>
            <span class="h-px flex-1 bg-border"></span>
          </div>
        {:else if item.kind === "user"}
          <!-- UserMessage（§3.2）：附件行在气泡上方（justify-end）；气泡下方 hover
               操作行（copy/edit/resend），最新一条常显；copy → check 1s。 -->
          <div class="flow-item group/msg ml-auto max-w-[85%]">
            {#if item.images && item.images.length > 0}
              <div class="mb-1 flex flex-wrap justify-end gap-1">
                {#each item.images as src, index (index)}
                  <img
                    {src}
                    alt=""
                    class="h-16 w-16 rounded-xl border border-border object-cover"
                  />
                {/each}
              </div>
            {/if}
            {#if item.files && item.files.length > 0}
              <div class="mb-1 flex flex-wrap justify-end gap-1">
                {#each item.files as name, index (index)}
                  <!-- 回放对称 chip（PM 修复 3）：无 thumb 的图片附件与文件 chip 同视觉
                       语言，图标分型（IconImage vs IconFile）。 -->
                  <span
                    class="flex items-center gap-1 rounded-md border border-border bg-muted/40 px-1.5 py-0.5 text-[10px]"
                  >
                    {#if item.imageChipNames?.includes(name)}
                      <IconImage
                        class="h-3 w-3 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                    {:else}
                      <IconFile class="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
                    {/if}
                    <span class="max-w-40 truncate">{name}</span>
                  </span>
                {/each}
              </div>
            {/if}
            {#if item.text.length > 0}
              <div
                class="bubble-user max-h-40 overflow-y-auto px-3.5 py-2 text-[13px] leading-5 whitespace-pre-wrap"
              >
                {item.text}
              </div>
            {/if}
            <div
              class="mt-0.5 flex h-5 justify-end gap-0.5 transition-opacity {item.seq ===
              lastUserSeq
                ? 'opacity-100'
                : 'opacity-0 group-hover/msg:opacity-100 focus-within:opacity-100'}"
              role="toolbar"
              aria-label="Message actions"
            >
              <button
                type="button"
                class="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                title="Copy"
                aria-label="Copy message"
                onclick={() => void copyText(item.text, item.seq)}
              >
                {#if copiedSeq === item.seq}
                  <IconCheck class="h-3.5 w-3.5 text-primary" />
                {:else}
                  <IconCopy class="h-3.5 w-3.5" />
                {/if}
              </button>
              <button
                type="button"
                class="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                title="Edit & resend — resends as a new message, keeps history"
                aria-label="Edit and resend — resends as a new message, keeps history"
                onclick={() => editIntoComposer(item.text)}
              >
                <IconPen class="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                class="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
                title="Resend — keeps history"
                aria-label="Resend message — keeps history"
                disabled={agentSession.sending}
                onclick={() => retryPrompt(item.text)}
              >
                <IconRefresh class="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        {:else if item.kind === "reasoning"}
          <!-- ThinkingRow（§3.2）：流式自动展开 + 末行摘要（扫光）；定稿收起 +
             首行摘要。展开体 11px muted pre-wrap max-h-48 内滚。 -->
          <div class="flow-item">
            <DisclosureRow
              icon={IconSparkles}
              title="Thinking"
              summary={thinkingSummary(item.text, item.streaming)}
              open={item.streaming ? true : (openItems[item.seq] ?? false)}
              running={item.streaming}
              onToggle={() => toggleItem(item.seq)}
            />
            {#if item.streaming || openItems[item.seq]}
              <div
                class="mt-1 max-h-48 overflow-y-auto rounded-md px-2 pb-1 text-[11px] leading-relaxed whitespace-pre-wrap text-muted-foreground"
              >
                {item.text}
              </div>
            {/if}
          </div>
        {:else if item.kind === "assistant"}
          <!-- AssistantMessage（§3.2）：全宽无气泡 13px/20 markstream（htmlPolicy=
               escape 不变；密度覆写见 scoped style）。操作脚标 = 下方 20px icon 行
               （copy；hover/最新常显）。usage 不在此渲染（归 TurnEnd 药丸）。 -->
          <div class="flow-item group/msg max-w-full">
            <div class="ms-md msg-body max-w-full [&_a]:text-primary">
              <MarkdownRender content={item.text} htmlPolicy="escape" final={!item.streaming} />
            </div>
            <div
              class="mt-0.5 flex h-5 gap-0.5 transition-opacity {item.seq === lastAssistantSeq
                ? 'opacity-100'
                : 'opacity-0 group-hover/msg:opacity-100 focus-within:opacity-100'}"
              role="toolbar"
              aria-label="Message actions"
            >
              <button
                type="button"
                class="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                title="Copy"
                aria-label="Copy message"
                onclick={() => void copyText(item.text, item.seq)}
              >
                {#if copiedSeq === item.seq}
                  <IconCheck class="h-3.5 w-3.5 text-primary" />
                {:else}
                  <IconCopy class="h-3.5 w-3.5" />
                {/if}
              </button>
            </div>
          </div>
        {:else if item.kind === "tool"}
          <AgentToolRow
            toolName={item.toolName}
            argsText={item.argsText}
            result={item.result}
            phase={item.phase}
            running={item.phase === "calling" && agentSession.status === "running"}
            startedAt={item.startedAt}
            endedAt={item.endedAt}
          />
        {:else if item.kind === "approval"}
          <div class="flow-item">
            <AgentApprovalCard seq={item.seq} questions={item.questions} resolved={item.resolved} />
          </div>
        {/if}
      {/each}
      {#if agentSession.status === "running"}
        <!-- TurnStatus（§3.2）：扫光「Working」；15s 后追加计时（1s tick）。 -->
        <div class="flow-item flex h-6 items-center" role="status">
          <span class="sweep rounded-md px-1 text-xs text-muted-foreground">
            Working{workingSeconds >= 15 ? ` · ${Math.floor(workingSeconds)}s` : ""}
          </span>
        </div>
      {/if}
    {/if}
  </div>
  {#if awayFromBottom && agentSession.sessionId}
    <!-- back-to-bottom FAB（§3.1）：上滚脱离贴底 >200px 时浮现于转录右上。 -->
    <button
      type="button"
      class="absolute top-3 right-3 z-10 flex h-7 w-7 items-center justify-center rounded-full border border-border bg-popover text-muted-foreground shadow-md transition-colors hover:text-foreground"
      title="Back to bottom"
      aria-label="Back to bottom"
      onclick={backToBottom}
    >
      <IconArrowDown class="h-3.5 w-3.5" />
    </button>
  {/if}
</div>

<style>
  /* markstream 密度收敛：库默认 16px/IBM Plex/clamp 文档级标题，且 Tailwind
     preflight 将 ul/ol 重置为无 marker；scoped 双类选择器稳定压过库内单类规则。
     基字号由 .msg-body（13px/20px）承载（§0 密度基调：转录正文 13px）。 */
  .ms-md :global(.markstream-svelte) {
    font-family: inherit;
    font-size: inherit;
    line-height: 1.55;
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
