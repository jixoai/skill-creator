<!--
  ui/textarea 的测试 stub（evaluating-dashboard）：真组件走 bits-ui 同族包装
  （node_modules .svelte 被 vitest 外置）；本 stub 保持 bind:value + 原生
  textarea 契约（id/rows/placeholder 透传），供 case 编辑器 prompt 断言。
-->
<script lang="ts">
  let {
    value = $bindable(""),
    class: klass = "",
    placeholder,
    id,
    rows,
  }: {
    value?: string;
    class?: string;
    placeholder?: string;
    id?: string;
    rows?: number;
  } = $props();
</script>

<textarea class={klass} {placeholder} {id} {rows} bind:value data-stub="textarea"></textarea>
