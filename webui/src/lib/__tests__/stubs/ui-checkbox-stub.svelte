<!--
  ui/checkbox 的测试 stub（evaluating-dashboard）：真组件 → bits-ui
  （node_modules 内 .svelte 被 vitest 外置）；本 stub 保持 bindable checked +
  onCheckedChange 契约（原生 checkbox 转发），供 Run 确认弹层的 case 勾选断言。
-->
<script lang="ts">
  let {
    checked = $bindable(false),
    onCheckedChange,
    class: klass = "",
  }: {
    checked?: boolean;
    onCheckedChange?: (checked: boolean) => void;
    class?: string;
  } = $props();

  function handleChange(event: Event): void {
    checked = (event.currentTarget as HTMLInputElement).checked;
    onCheckedChange?.(checked);
  }
</script>

<input type="checkbox" class={klass} {checked} onchange={handleChange} data-stub="checkbox" />
