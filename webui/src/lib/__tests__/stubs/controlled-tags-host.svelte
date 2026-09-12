<!--
  测试 host（Track B1）：ModelTagsInput 是受控组件（selected 由父级持有、
  onchange 重建回填）。真实父级是 NewRouteTab/RouteTabContent 的 $state 数组；
  本 host 以同构 $state 承载，供组件级单测验证受控往返（Enter → onchange →
  父级回填 → chip 渲染）。
-->
<script lang="ts">
  import ModelTagsInput from "../../components/settings/ModelTagsInput.svelte";

  let {
    initial = [],
    candidates = [],
    onchangeLog = undefined,
  }: {
    initial?: string[];
    candidates?: Array<{ id: string; name?: string; image?: boolean }>;
    onchangeLog?: (next: string[]) => void;
  } = $props();

  // svelte-ignore state_referenced_locally -- 初值快照是有意的（host 只在挂载时
  // 采用 initial，后续由 ModelTagsInput 的 onchange 驱动）。
  let selected = $state([...initial]);
</script>

<div data-testid="host">
  <ModelTagsInput
    {selected}
    {candidates}
    onchange={(next) => {
      selected = [...next];
      onchangeLog?.(next);
    }}
  />
  <span data-testid="selected-json">{JSON.stringify(selected)}</span>
</div>
