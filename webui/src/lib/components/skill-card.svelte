<script lang="ts">
  /**
   * 原始需求 [2026-07-14]：「这需要你的导航功能足够清晰简单」。
   * 修订 [2026-09-18]（用户走查裁决）：同内容技能以 symlink 式小角标呈现在行内，
   * 不再占据 WorkspacesHome 整屏区块。
   * 正交意图：
   * 1. 以高密度、可扫描形式呈现技能摘要。
   * 2. 投影技能启停与选中状态。
   * 3. 同源角标：内容与其他安装完全相同的技能行上给出 Finder symlink 式箭头标识。
   */
  import type { SkillMetadata } from "$lib/types";
  import { cn } from "$lib/utils";
  import IconFile from "@lucide/svelte/icons/file-text";
  import IconPause from "@lucide/svelte/icons/circle-pause";
  import IconSameContent from "@lucide/svelte/icons/arrow-up-right";

  /** 技能列表项的摘要数据、选择状态与触发回调。 */
  let {
    skill,
    selected = false,
    sameContentCount = 0,
    onclick,
  }: {
    skill: SkillMetadata;
    selected?: boolean;
    /** 内容与本技能完全相同的其他安装数（重复组成员数 - 1）。 */
    sameContentCount?: number;
    onclick?: () => void;
  } = $props();

  const sameContentLabel = $derived(
    `Same content as ${sameContentCount} other ${sameContentCount === 1 ? "installation" : "installations"}`,
  );
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
    <IconFile class="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
  {/if}
  <span class="min-w-0 flex-1">
    <span class="flex items-center gap-2">
      <span class="truncate text-[13px] font-medium text-foreground">{skill.name}</span>
      {#if skill.disabled}
        <span class="shrink-0 text-xs uppercase tracking-wide text-amber-600 dark:text-amber-400"
          >disabled</span
        >
      {/if}
      {#if sameContentCount > 0}
        <span
          class="inline-flex shrink-0 items-center gap-0.5 text-xs text-muted-foreground/80"
          title={sameContentLabel}
        >
          <IconSameContent class="h-3 w-3" aria-hidden="true" />
          <span class="tabular-nums">{sameContentCount}</span>
        </span>
      {/if}
    </span>
    {#if skill.description}
      <span class="mt-0.5 line-clamp-2 text-xs leading-4">{skill.description}</span>
    {:else}
      <span class="mt-0.5 line-clamp-2 text-xs italic leading-4 text-muted-foreground/70"
        >No description</span
      >
    {/if}
  </span>
</button>
