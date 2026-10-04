<!--
  ui/button 的测试 stub（WS5 走查 B 回归测试）：真组件 → bits-ui（node_modules
  内 .svelte 被 vitest 外置化）；本 stub 保持 Button 组件的最小可渲染契约
  （children snippet + 原生 button 透传），供 CreatorWorkspace 挂载测试。
-->
<script lang="ts">
  import type { Snippet } from "svelte";
  let {
    children,
    onclick,
    disabled = false,
    class: klass = "",
    title,
    "aria-label": ariaLabel,
    "aria-expanded": ariaExpanded,
  }: {
    children?: Snippet;
    onclick?: (event: MouseEvent) => void;
    disabled?: boolean;
    class?: string;
    title?: string;
    "aria-label"?: string;
    "aria-expanded"?: boolean;
  } = $props();
</script>

<button
  type="button"
  class={klass}
  {onclick}
  {disabled}
  {title}
  aria-label={ariaLabel}
  aria-expanded={ariaExpanded}
>
  {@render children?.()}
</button>
