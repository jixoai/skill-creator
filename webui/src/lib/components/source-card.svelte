<!--
  用户原始需求 [2026-07-27]：「每个源卡片展示 label、description、缓存的技能数、上次扫描固定的 commit 摘要。」
  正交意图：
    1. 以高密度卡片形式呈现一条精选/用户源的摘要 + 扫描元数据。
    2. 投影内置/用户徽标、删除按钮（仅用户源）与 Scan 触发回调。
-->
<script lang="ts">
  import type { ScanSummary } from "$lib/stores/scan-summary.svelte";
  import { cn } from "$lib/utils";
  import IconTrash from "@lucide/svelte/icons/trash-2";
  import IconExternal from "@lucide/svelte/icons/external-link";

  /** 卡片展示的源标识、徽标与回调。 */
  let {
    label,
    description,
    builtIn,
    gitUrl,
    homepage,
    scanSummary,
    stale,
    onscan,
    onremove,
  }: {
    /** 源标题。 */
    label: string;
    /** 一句话描述。 */
    description: string;
    /** 是否为内置精选源（不可删除）。 */
    builtIn: boolean;
    /** 源 https git URL（用于卡片 fallback 显示）。 */
    gitUrl: string;
    /** 可选主页链接。 */
    homepage?: string;
    /** 当前会话内的扫描摘要；未扫描为 `undefined`。 */
    scanSummary?: ScanSummary;
    /** 缓存是否过时（UI hint）。 */
    stale?: boolean;
    /** 点击 "Scan" 的回调。 */
    onscan: () => void;
    /** 用户源删除回调（仅用户源传入）。 */
    onremove?: () => void;
  } = $props();
</script>

<article
  class="flex h-full flex-col gap-2 rounded-lg border border-border bg-card p-3 text-left transition-colors hover:border-primary/40"
>
  <header class="flex items-start gap-2">
    <div class="min-w-0 flex-1">
      <div class="flex items-center gap-1.5">
        <h3 class="truncate text-sm font-medium text-foreground">{label}</h3>
        <span
          class={cn(
            "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium",
            builtIn ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
          )}
        >
          {builtIn ? "Built-in" : "Custom"}
        </span>
      </div>
      <p class="mt-0.5 line-clamp-2 text-[11px] leading-4 text-muted-foreground">
        {description || gitUrl}
      </p>
    </div>
  </header>

  <dl
    class="mt-auto flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground"
  >
    {#if scanSummary}
      <span>{scanSummary.skillCount} skills</span>
      <span class="font-mono">{scanSummary.commitPrefix}</span>
      {#if stale}
        <span class="text-amber-600 dark:text-amber-400">stale · rescan for latest</span>
      {/if}
    {:else}
      <span class="italic">Not scanned yet</span>
    {/if}
  </dl>

  <footer class="flex shrink-0 items-center gap-2">
    <button
      type="button"
      onclick={onscan}
      class="inline-flex h-7 items-center rounded-md bg-primary px-2.5 text-[11px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
    >
      Scan
    </button>
    {#if homepage}
      <a
        href={homepage}
        target="_blank"
        rel="noreferrer noopener"
        class="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 text-[11px] text-muted-foreground transition-colors hover:bg-muted/50"
        aria-label={`Open ${label} homepage`}
      >
        <IconExternal class="h-3 w-3" />
        Home
      </a>
    {/if}
    {#if !builtIn && onremove}
      <button
        type="button"
        onclick={onremove}
        class="ml-auto inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
        aria-label={`Remove ${label}`}
      >
        <IconTrash class="h-3.5 w-3.5" />
      </button>
    {/if}
  </footer>
</article>
