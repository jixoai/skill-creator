<!--
  测试 stub（dialog Root）：bits-ui dialog 不可编译（node_modules .svelte）；
  本 Root 以 $bindable open 门控渲染（关闭 = 无内容），children 直渲。
-->
<script lang="ts">
  // svelte 外置解析默认命中 server 导出（见 svelte-client.ts 同款说明），必须
  // 直连 client 入口与被测组件同运行时。
  // @ts-expect-error -- 无类型声明的运行时直连；正确性由组件测试本身证明
  import { setContext } from "../../../../../node_modules/svelte/src/index-client.js";

  let {
    children,
    open = $bindable(false),
  }: {
    children?: import("svelte").Snippet;
    open?: boolean;
  } = $props();

  setContext("dialog-open", {
    isOpen: (): boolean => open,
    close: (): void => {
      open = false;
    },
  });
</script>

{#if open}
  <div data-stub="dialog-root">{@render children?.()}</div>
{/if}
