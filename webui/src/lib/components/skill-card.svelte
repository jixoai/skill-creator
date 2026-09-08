<script lang="ts">
  /**
   * 原始需求 [2026-07-14]：「这需要你的导航功能足够清晰简单」。
   * 正交意图：
   * 1. 以高密度、可扫描形式呈现技能摘要。
   * 2. 投影技能启停与选中状态。
   */
  import type { SkillMetadata } from "$lib/types";
  import { cn } from "$lib/utils";
  import IconFile from "@lucide/svelte/icons/file-text";
  import IconPause from "@lucide/svelte/icons/circle-pause";

  /** 技能列表项的摘要数据、选择状态与触发回调。 */
  let {
    skill,
    selected = false,
    onclick,
  }: {
    skill: SkillMetadata;
    selected?: boolean;
    onclick?: () => void;
  } = $props();
</script>

<button
  type="button"
  data-skill-id={skill.id}
  {onclick}
  aria-pressed={selected}
  class={cn(
    "group flex min-h-14 w-full items-start gap-2.5 border-b border-border/70 px-3 py-2.5 text-left transition-colors",
    selected
      ? "bg-accent text-foreground"
      : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
  )}
>
  {#if skill.disabled}
    <span title="Disabled (paused)" class="shrink-0">
      <IconPause class="mt-0.5 h-4 w-4 text-amber-600 dark:text-amber-400" />
    </span>
  {:else}
    <IconFile class="mt-0.5 h-4 w-4 shrink-0 text-primary" />
  {/if}
  <span class="min-w-0 flex-1">
    <span class="flex items-center gap-2">
      <span class="truncate text-[13px] font-medium text-foreground">{skill.name}</span>
      {#if skill.disabled}
        <span
          class="shrink-0 text-[10px] uppercase tracking-wide text-amber-600 dark:text-amber-400"
          >disabled</span
        >
      {/if}
    </span>
    <span class="mt-0.5 line-clamp-2 text-[11px] leading-4"
      >{skill.description || "No description"}</span
    >
  </span>
</button>
