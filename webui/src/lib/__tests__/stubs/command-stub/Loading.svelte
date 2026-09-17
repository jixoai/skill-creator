<!-- 测试 stub（command Loading）：纯渲染 children。 -->
<script lang="ts">
  let { children }: { children?: import("svelte").Snippet } = $props();
</script>

<div data-stub="command-loading">{@render children?.()}</div>
