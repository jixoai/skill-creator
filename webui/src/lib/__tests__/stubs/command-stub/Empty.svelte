<!-- 测试 stub（command Empty）：纯渲染 children。 -->
<script lang="ts">
  let { children }: { children?: import("svelte").Snippet } = $props();
</script>

<div data-stub="command-empty">{@render children?.()}</div>
