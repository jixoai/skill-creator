<!-- 测试 stub（command List）：纯渲染 children。 -->
<script lang="ts">
  let { children }: { children?: import("svelte").Snippet } = $props();
</script>

<div data-stub="command-list">{@render children?.()}</div>
