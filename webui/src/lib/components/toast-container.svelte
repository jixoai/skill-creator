<script lang="ts">
  /**
   * 原始需求 [2026-07-14]：「目的是以人为本，要让小白到各行各业到专业工程师用起来都舒心」。
   * 修订 [2026-10-05]（Owner 裁决，webui-i18n-bilingual task 4.5 δ 线）：
   * 错误 toast 叠加宽泛人话提示（主显）+ 原文次行/title（调试关键，永不丢弃）。
   * 正交意图：[1] 渲染全局 toast 队列；[2] 提供 action 与关闭操作；
   * [3] error 变体分层渲染：classifyErrorHint 未命中 = 原文原样（零降级）。
   */
  import { toasts, dismissToast } from "$lib/toast.svelte";
  import { t } from "$lib/i18n";
  import { classifyErrorHint } from "$lib/i18n/error-hints.js";
  import IconX from "@lucide/svelte/icons/x";
</script>

<div
  class="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2"
  aria-live="polite"
  aria-relevant="additions text"
>
  {#each toasts as toast (toast.id)}
    {@const hintKey = toast.error === true ? classifyErrorHint(toast.message) : null}
    <div
      class="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-md border border-border bg-popover px-4 py-2.5 text-sm"
      data-toast-error={toast.error === true || undefined}
      title={hintKey ? toast.message : undefined}
    >
      <span class="flex min-w-0 flex-1 flex-col gap-0.5">
        {#if hintKey}
          <span class="text-foreground" data-error-hint>{t(hintKey)}</span>
          <span class="break-all text-xs text-muted-foreground" data-error-raw>{toast.message}</span
          >
        {:else if toast.error === true}
          <span class="text-foreground" data-error-raw>{toast.message}</span>
        {:else}
          <span class="text-foreground">{toast.message}</span>
        {/if}
      </span>
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
        aria-label={t("toast.dismiss")}
        title={t("toast.dismiss")}
        onclick={() => dismissToast(toast.id)}
      >
        <IconX class="h-3.5 w-3.5" />
      </button>
    </div>
  {/each}
</div>
