<!--
  测试 stub（command Input）：输入文本契约——input 元素经 bind:value 上行，
  与 Root 的选中值通道分离（走查 P1 的绑定目标即此处）。
-->
<script lang="ts">
  let {
    value = $bindable(""),
    placeholder,
  }: {
    value?: string;
    placeholder?: string;
  } = $props();
</script>

<input data-slot="command-input" bind:value {placeholder} />
