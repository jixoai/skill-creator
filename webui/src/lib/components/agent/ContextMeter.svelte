<!--
  用户原始需求 [2026-09-12]（redesign §3.4）：「ContextMeter（14px SVG 环：
  lastUsage.inputTokens / contextWindow；缺省 128k 常量；点击弹用量面板：
  in/out/capacity + compact 按钮——原上下文条的 compact 迁入此处，语义不变）」。
  正交意图：
  1. 上下文占用环 + 用量 popover：环随 lastUsage 变化（75%+ amber 提示，不自动
     compact——手动 compact 保留，design §7）；compact 走 sendAgentPrompt("/compact")
     既有路径（running/sending 置灰）。分母优先取 settings.modelRoutes 命中的
     contextWindow（PM 修复 1：真实分母），命不中回退 131072 并在容量行标注
     assumed 128k。
  妥协声明：inputTokens 是近似上下文占用（无 cache 命中细分，design §7）。
-->
<script module lang="ts">
  import type { DshStewardSettingsView } from "$shared/contracts/dsh-runtime.js";

  /**
   * settings → 上下文窗口（PM 修复 1）：settings.model 的 provider 在
   * modelRoutes 命中路由后按 model id 取 contextWindow；任何一步不命中返回
   * null（调用方回退 131072 并标注 assumed）。纯函数，供单测。
   */
  export function contextWindowOfView(view: DshStewardSettingsView | null): number | null {
    if (!view) return null;
    const { provider, model } = view.settings.model;
    const route = view.settings.modelRoutes.find((entry) => entry.provider === provider);
    if (!route) return null;
    return route.models.find((entry) => entry.id === model)?.contextWindow ?? null;
  }
</script>

<script lang="ts">
  import { agentRuntimeConfig, agentSession, sendAgentPrompt } from "$lib/stores/agent.svelte";
  import { formatTokens } from "./format";

  /** 回退上下文窗口常量（131072 = 128k；路由 contextWindow 未命中时使用并标注）。 */
  const CONTEXT_WINDOW = 131_072;

  let open = $state(false);
  let container = $state<HTMLElement | null>(null);

  const usage = $derived(agentSession.lastUsage);
  const resolvedCapacity = $derived(contextWindowOfView(agentRuntimeConfig.view));
  const capacity = $derived(resolvedCapacity ?? CONTEXT_WINDOW);
  const fillRatio = $derived.by(() => {
    if (!usage) return 0;
    return Math.min(1, Math.max(0, usage.inputTokens / capacity));
  });
  const percent = $derived(Math.round(fillRatio * 100));
  const warn = $derived(percent >= 75);
  /** SVG 环几何：14px 视窗，r=5，stroke 2.5（对比度修复）；dasharray 驱动进度弧。 */
  const circumference = 2 * Math.PI * 5;
  const dash = $derived(`${(fillRatio * circumference).toFixed(2)} ${circumference.toFixed(2)}`);

  const tooltip = $derived(
    usage
      ? `${percent}% of context used · last turn ${formatTokens(usage.inputTokens)} in / ${formatTokens(usage.outputTokens)} out`
      : "No turns yet — context usage appears after the first turn",
  );

  function compact(): void {
    if (agentSession.sending || agentSession.status === "running") return;
    // 内核 /compact 命令（daemon 端分流，不进 LLM）。
    open = false;
    void sendAgentPrompt("/compact");
  }

  function onWindowPointerDown(event: PointerEvent): void {
    if (!open) return;
    if (container !== null && event.target instanceof Node && !container.contains(event.target)) {
      open = false;
    }
  }
</script>

<svelte:window onpointerdown={onWindowPointerDown} />

<div bind:this={container} class="relative">
  <button
    type="button"
    class="relative flex h-8 w-8 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
    aria-label="Context usage"
    title={tooltip}
    aria-expanded={open}
    disabled={!agentSession.sessionId}
    onclick={() => (open = !open)}
  >
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <circle cx="7" cy="7" r="5" fill="none" stroke-width="2.5" class="stroke-muted-foreground/40"
      ></circle>
      <circle
        cx="7"
        cy="7"
        r="5"
        fill="none"
        stroke-width="2.5"
        stroke-linecap="round"
        class={warn ? "stroke-amber-500" : "stroke-primary"}
        stroke-dasharray={dash}
        transform="rotate(-90 7 7)"
      ></circle>
    </svg>
  </button>
  {#if open}
    <div
      role="dialog"
      aria-label="Context usage details"
      class="absolute right-0 bottom-full z-20 mb-1.5 w-56 rounded-lg border border-border bg-popover p-2.5 text-xs shadow-md"
    >
      <div class="mb-1.5 text-[11px] font-medium text-muted-foreground">Context</div>
      {#if usage}
        <div class="flex items-center justify-between">
          <span>Used</span>
          <span class="tabular-nums {warn ? 'text-amber-600 dark:text-amber-400' : ''}">
            {percent}%
          </span>
        </div>
        <div class="mt-0.5 flex items-center justify-between text-muted-foreground">
          <span>Last turn</span>
          <span class="tabular-nums">
            ↑ {formatTokens(usage.inputTokens)} · ↓ {formatTokens(usage.outputTokens)}
          </span>
        </div>
        <div class="mt-0.5 flex items-center justify-between text-muted-foreground">
          <span>Capacity</span>
          <span class="tabular-nums">
            {formatTokens(capacity)}{resolvedCapacity === null ? " · assumed 128k" : ""}
          </span>
        </div>
      {:else}
        <div class="text-muted-foreground">No turns yet.</div>
      {/if}
      <button
        type="button"
        class="mt-2 w-full rounded-md border border-border px-2 py-1 text-[11px] transition-colors hover:bg-muted disabled:opacity-50"
        title="Compact the conversation history (kernel /compact)"
        disabled={agentSession.sending ||
          agentSession.status === "running" ||
          !agentSession.sessionId}
        onclick={compact}
      >
        compact
      </button>
    </div>
  {/if}
</div>
