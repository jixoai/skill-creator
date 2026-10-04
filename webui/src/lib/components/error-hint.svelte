<script lang="ts">
  /**
   * 原始需求 [2026-10-05]（Owner 裁决，webui-i18n-bilingual task 4.5 δ 线）：
   * 「客观留存这个错误，是调试的关键，但是可以辅助一些 i18n 的比较宽泛的翻译」。
   * 正交意图：[1] 错误状态文本公共面：宽泛家族提示主显 + 原文次行（弱化但不
   * 隐藏）；分类未命中 = 原文原样单行（零降级）。原文是调试关键，永不丢弃。
   */
  import { t } from "$lib/i18n";
  import { classifyErrorHint } from "$lib/i18n/error-hints.js";

  /** 原始错误文本（daemon 透传原文，唯一真相）。 */
  let { error, class: cls = "" }: { error: string; class?: string } = $props();

  const hintKey = $derived(classifyErrorHint(error));
</script>

{#if hintKey}
  <p class="break-words {cls}" data-error-hint>{t(hintKey)}</p>
  <p class="mt-0.5 break-words opacity-70 {cls}" data-error-raw>{error}</p>
{:else}
  <p class="break-words {cls}" data-error-raw>{error}</p>
{/if}
