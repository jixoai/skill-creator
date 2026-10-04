<script lang="ts">
  let { content, final }: { content: string; final: boolean } = $props();
</script>

<div data-markdown-final={final}>{content}</div>
