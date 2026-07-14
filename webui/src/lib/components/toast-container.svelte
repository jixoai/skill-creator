<script lang="ts">
  /**
   * 原始需求 [2026-07-14]：「目的是以人为本，要让小白到各行各业到专业工程师用起来都舒心」。
   * 正交意图：[1] 渲染全局 toast 队列；[2] 提供 action 与关闭操作。
   */
  import { toasts, dismissToast } from "$lib/toast.svelte";
  import IconX from "@lucide/svelte/icons/x";
</script>

<div
  class="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2"
  aria-live="polite"
  aria-relevant="additions text"
>
  {#each toasts as toast (toast.id)}
    <div
      class="pointer-events-auto flex items-center gap-3 rounded-md border border-border bg-popover px-4 py-2.5 text-sm"
    >
      <span class="flex-1 text-foreground">{toast.message}</span>
      {#if toast.action}
        <button
          class="text-xs font-medium text-primary hover:underline"
          onclick={() => {
            toast.action!.run();
            dismissToast(toast.id);
          }}
        >
          {toast.action.label}
        </button>
      {/if}
      <button
        class="text-muted-foreground hover:text-foreground"
        aria-label="Dismiss notification"
        title="Dismiss notification"
        onclick={() => dismissToast(toast.id)}
      >
        <IconX class="h-3.5 w-3.5" />
      </button>
    </div>
  {/each}
</div>
