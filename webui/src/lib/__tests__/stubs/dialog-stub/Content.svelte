<!-- 测试 stub（dialog Content）：纯渲染 children。 -->
<script lang="ts">
  let { children }: { children?: import("svelte").Snippet } = $props();
</script>

<div data-stub="dialog-content">{@render children?.()}</div>
