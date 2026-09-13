<!-- 测试 stub（dialog Header）：纯渲染 children。 -->
<script lang="ts">
  let { children }: { children?: import("svelte").Snippet } = $props();
</script>

<div data-stub="dialog-header">{@render children?.()}</div>
