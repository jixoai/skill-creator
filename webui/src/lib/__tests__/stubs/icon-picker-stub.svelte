<!--
  测试 stub（Track B）：IconPicker 引 @lucide/svelte 的 .svelte 图标，root
  vitest 管线不编译 node_modules 下的 .svelte——以本 stub 替换，接口签名与
  真组件一致（icon/provider/label/catalogIcons/disabled/onPick）。
-->
<script lang="ts">
  interface Props {
    icon?: string | null;
    provider: string;
    label?: string;
    catalogIcons?: Array<{ provider: string; icon: string }>;
    disabled?: boolean;
    onPick: (icon: string | undefined) => void;
  }
  let {
    icon = null,
    provider,
    label = "",
    catalogIcons = [],
    disabled = false,
    onPick,
  }: Props = $props();
</script>

<button
  type="button"
  aria-label="Icon picker stub for {provider}"
  data-stub-icon={icon ?? ""}
  data-stub-label={label}
  {disabled}
  onclick={() => onPick(undefined)}
>
  icon
</button>
