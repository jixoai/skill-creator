<!--
  ui/input 的测试 stub（WS5 走查 B 回归测试）：真组件走 bits-ui 同族的样式包装
  （node_modules .svelte 被 vitest 外置化）；本 stub 保持 bind:value + 原生
  input 契约，供 FileBrowser 挂载后草稿字段断言。
-->
<script lang="ts">
  let {
    value = $bindable(""),
    class: klass = "",
    placeholder,
  }: {
    value?: string;
    class?: string;
    placeholder?: string;
  } = $props();
</script>

<input class={klass} {placeholder} bind:value />
