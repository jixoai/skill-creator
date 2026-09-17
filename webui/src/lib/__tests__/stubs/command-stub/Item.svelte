<!-- 测试 stub（command Item）：选中 = 写 Root value + 调 onSelect（bits-ui 契约）。 -->
<script lang="ts">
  import { selectCommandItem } from "../command-stub-state";
  let {
    value = "",
    onSelect,
    forceMount,
    children,
  }: {
    value?: string;
    onSelect?: () => void;
    forceMount?: boolean;
    children?: import("svelte").Snippet;
  } = $props();
</script>

<button
  type="button"
  data-stub="command-item"
  data-value={value}
  data-force-mount={forceMount}
  onclick={() => {
    selectCommandItem(value);
    onSelect?.();
  }}
>
  {@render children?.()}
</button>
