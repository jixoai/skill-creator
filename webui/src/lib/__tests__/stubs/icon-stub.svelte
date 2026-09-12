<!--
  测试 stub（Track B）：@lucide/svelte 图标是 node_modules 下的 .svelte 文件，
  root vitest 管线不编译；组件测试以本空壳替换（class 透传，无视觉语义）。
-->
<script lang="ts">
  let { class: className, ...rest }: { class?: string } = $props();
</script>

<span data-testid="icon-stub" class={className} aria-hidden="true" {...rest}></span>
