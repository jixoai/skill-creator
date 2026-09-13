<!-- 测试 stub（dialog Description）：纯渲染 children。 -->
<script lang="ts">
  let { children }: { children?: import("svelte").Snippet } = $props();
</script>

<div data-stub="dialog-description">{@render children?.()}</div>
