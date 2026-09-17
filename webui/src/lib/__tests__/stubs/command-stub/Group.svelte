<!-- 测试 stub（command Group）：纯渲染 children（heading/value/forceMount 透传忽略）。 -->
<script lang="ts">
  let {
    children,
    heading,
    value,
    forceMount,
  }: {
    children?: import("svelte").Snippet;
    heading?: string;
    value?: string;
    forceMount?: boolean;
  } = $props();
</script>

<div
  data-stub="command-group"
  data-heading={heading}
  data-value={value}
  data-force-mount={forceMount}
>
  {@render children?.()}
</div>
