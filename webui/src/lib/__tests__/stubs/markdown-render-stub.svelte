<!--
  测试 stub：markstream-svelte 渲染链路在 AgentPanel 组件 mount 测试中以纯文本
  投影隔离（库体量大且与被测的草稿/编排语义无关）。
-->
<script lang="ts">
  let { content = "" }: { content?: string } = $props();
</script>

<div data-stub="markdown-render">{content}</div>
