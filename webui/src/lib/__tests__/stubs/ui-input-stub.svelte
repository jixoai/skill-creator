<!--
  ui/input 的测试 stub（WS5 走查 B 回归测试）：真组件走 bits-ui 同族的样式包装
  （node_modules 内 .svelte 被 vitest 外置化）；本 stub 保持 bind:value + 原生
  input 契约，供 FileBrowser 挂载后草稿字段断言。
  修订 [2026-10-03]（evaluating-dashboard）：rest props 透传（aria-label 等
  a11y 属性落到真实 DOM，供 case 编辑器按 aria 定位断言控件）。
-->
<script lang="ts">
  let {
    value = $bindable(""),
    class: klass = "",
    placeholder,
    ...rest
  }: {
    value?: string;
    class?: string;
    placeholder?: string;
    [key: string]: unknown;
  } = $props();
</script>

<input class={klass} {placeholder} bind:value {...rest} />
