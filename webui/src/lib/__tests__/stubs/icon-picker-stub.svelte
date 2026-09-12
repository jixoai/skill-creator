<!--
  测试 stub（Track B / R7）：IconPicker 引 @lucide/svelte 的 .svelte 图标，root
  vitest 管线不编译 node_modules 下的 .svelte——以本 stub 替换，接口签名与真组件
  一致（icon/letter/color/provider/label/catalogIcons/disabled/onPick/onColor/
  onLetter）。
-->
<script lang="ts">
  interface Props {
    icon?: string | null;
    letter?: string;
    color?: string;
    provider: string;
    label?: string;
    catalogIcons?: Array<{ provider: string; icon: string }>;
    disabled?: boolean;
    onPick: (icon: string | undefined) => void;
    onColor?: (color: string | undefined) => void;
    onLetter?: (letter: string | undefined) => void;
  }
  let {
    icon = null,
    letter = "",
    color = "",
    provider,
    label = "",
    catalogIcons = [],
    disabled = false,
    onPick,
    onColor,
    onLetter,
  }: Props = $props();
</script>

<button
  type="button"
  aria-label="Icon picker stub for {provider}"
  data-stub-icon={icon ?? ""}
  data-stub-label={label}
  data-stub-letter={letter}
  data-stub-color={color}
  {disabled}
  onclick={() => onPick(undefined)}
>
  icon
</button>
