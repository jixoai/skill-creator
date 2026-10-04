<!--
  Switch 的测试 stub（webui-i18n-bilingual 4.2）：真组件走 bits-ui（node_modules
  内 .svelte 被 vitest 外置化）；本 stub 保持同 props 契约（checked/onCheckedChange/
  aria-label 透传），供 GeneralSettingsSection 语言行测试挂载。
-->
<script lang="ts">
  let {
    checked = false,
    onCheckedChange,
    ...rest
  }: {
    checked?: boolean;
    onCheckedChange?: (checked: boolean) => void;
    [key: string]: unknown;
  } = $props();
</script>

<button
  type="button"
  role="switch"
  aria-checked={checked}
  {...rest}
  onclick={() => onCheckedChange?.(!checked)}
>
  switch
</button>
