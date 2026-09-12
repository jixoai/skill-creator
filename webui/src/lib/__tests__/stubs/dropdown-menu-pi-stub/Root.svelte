<!--
  测试 stub（per-instance dropdown）：共享态 stub（dropdown-menu-stub）以模块级
  单例表达开合，一屏多菜单时互相串扰；本三件套（Root/Trigger/Content）以 context
  携带实例级 open（并经 $bindable 与组件的 bind:open 双向同步），供同屏存在
  模式 chip + model chip 的组件测试使用。
-->
<script lang="ts">
  // svelte 外置解析默认命中 server 导出（见 svelte-client.ts 同款说明），setContext
  // 必须直连 client 入口与被测组件同运行时，否则 lifecycle_outside_component。
  // @ts-expect-error -- 无类型声明的运行时直连；正确性由组件测试本身证明
  import { setContext } from "../../../../../node_modules/svelte/src/index-client.js";

  let {
    children,
    open = $bindable(false),
  }: {
    children?: import("svelte").Snippet;
    open?: boolean;
  } = $props();

  const state = $state({ open });
  setContext("dropdown-menu-pi", {
    isOpen: (): boolean => state.open,
    toggle: (): void => {
      state.open = !state.open;
      open = state.open;
    },
  });
</script>

<div data-stub="dropdown-root">{@render children?.()}</div>
