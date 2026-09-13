<!-- 测试 stub（dialog Title）：纯渲染 children。 -->
<script lang="ts">
  let { children }: { children?: import("svelte").Snippet } = $props();
</script>

<div data-stub="dialog-title">{@render children?.()}</div>
