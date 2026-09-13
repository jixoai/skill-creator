<!-- 测试 stub（dialog Footer）：纯渲染 children。 -->
<script lang="ts">
  let { children }: { children?: import("svelte").Snippet } = $props();
</script>

<div data-stub="dialog-footer">{@render children?.()}</div>
