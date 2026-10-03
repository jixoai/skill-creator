<!--
  ui/badge 的测试 stub：真组件 → bits-ui/tailwind 变体链（node_modules 内
  .svelte 被 vitest 外置化）；本 stub 保持 Badge 的最小可渲染契约（children
  snippet + class 透传），供 dashboard 挂载测试。
-->
<script lang="ts">
  import type { Snippet } from "svelte";
  let {
    children,
    class: klass = "",
  }: {
    children?: Snippet;
    class?: string;
  } = $props();
</script>

<span class={klass}>{@render children?.()}</span>
