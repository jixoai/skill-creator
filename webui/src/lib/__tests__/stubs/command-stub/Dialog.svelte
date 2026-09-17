<!--
  测试 stub（command Dialog/Root）：$bindable open 门控渲染；value 建模 bits-ui
  Root 契约——仅由 Item 选中写入（经 command-stub-state），与输入文本无关。
-->
<script lang="ts">
  import { registerCommandRootValue } from "../command-stub-state";
  let {
    open = $bindable(false),
    value = $bindable(""),
    children,
  }: {
    open?: boolean;
    value?: string;
    children?: import("svelte").Snippet;
  } = $props();

  $effect(() => {
    registerCommandRootValue((next) => (value = next));
    return () => registerCommandRootValue(null);
  });
</script>

{#if open}
  <div data-stub="command-dialog" data-value={value}>{@render children?.()}</div>
{/if}
