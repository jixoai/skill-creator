<!--
  用户原始需求 [2026-09-12]（redesign §3.2）：「通用行语法（dsh 语法移植）：
  [icon 14px] 标题 [·] 摘要，行高 24px（h-6），hover 整行 bg-muted/50 rounded-md
  + chevron 显形（可折叠行），运行态 = .sweep 扫光」。
  正交意图：
  1. DisclosureRow 24px 语法原子：thinking/tool/tasks 共用的折叠行骨架
     （PRODUCT_MODEL §8 交互原则 1），结构样式在 agent-flow.css。
  妥协声明：无。
-->
<script lang="ts">
  import IconChevron from "@lucide/svelte/icons/chevron-right";
  import type { Component } from "svelte";

  let {
    icon: Icon,
    title,
    summary = "",
    open = false,
    running = false,
    error = false,
    onToggle,
  }: {
    icon: Component<{ class?: string }>;
    title: string;
    summary?: string;
    open?: boolean;
    /** 运行态：摘要文字加扫光（唯一运行 affordance，无 spinner/pulse）。 */
    running?: boolean;
    /** 错误态：名后红点（tool 行 phase=error）。 */
    error?: boolean;
    onToggle: () => void;
  } = $props();
</script>

<button
  type="button"
  class="disclosure-row"
  data-open={open}
  aria-expanded={open}
  title={summary.length > 0 ? `${title} · ${summary}` : title}
  onclick={onToggle}
>
  <span class="flex items-center justify-center text-muted-foreground" aria-hidden="true">
    <Icon class="h-3.5 w-3.5" />
  </span>
  <span class="flex items-center gap-1 overflow-hidden">
    <span class="max-w-40 truncate text-left font-medium text-foreground">{title}</span>
    {#if error}
      <span
        class="h-1.5 w-1.5 shrink-0 rounded-full bg-destructive"
        title="Tool error"
        aria-label="Tool error"
      ></span>
    {/if}
  </span>
  <span class="text-center text-muted-foreground/70" aria-hidden="true">·</span>
  <span class="disclosure-summary {running ? 'sweep' : ''}">{summary}</span>
  <IconChevron class="disclosure-chevron h-3.5 w-3.5 shrink-0 text-muted-foreground" />
</button>
