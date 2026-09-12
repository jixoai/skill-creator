<!--
  测试 stub（R7 8.7 + R10）：ModelListItem 的受控宿主——把 onchange 回填进 $state
  model 再传回（模拟真实父级的受控往返）；data-testid="model-json" 暴露当前态供
  断言。R10 追加 dirty / initialExpanded 直通（折叠行小圆点与挂载展开测试）。
-->
<script lang="ts">
  import ModelListItem from "$lib/components/settings/ModelListItem.svelte";
  import type { ModelCandidate, RouteModelEntry } from "$lib/components/settings/model-fields.js";

  let {
    initial,
    candidates = [],
    routeModels = [],
    api = "anthropic-messages",
    baseURL = "http://localhost:20002/anthropic",
    provider = "",
    apiKeyConfigured = false,
    formKey = "",
    dirty = false,
    initialExpanded = false,
    onchangeLog,
    onvalidityLog,
    onremoveLog,
  }: {
    initial: Record<string, unknown>;
    candidates?: ModelCandidate[];
    routeModels?: RouteModelEntry[];
    api?: string;
    baseURL?: string;
    provider?: string;
    apiKeyConfigured?: boolean;
    formKey?: string;
    dirty?: boolean;
    initialExpanded?: boolean;
    onchangeLog: (next: RouteModelEntry) => void;
    onvalidityLog: (valid: boolean) => void;
    onremoveLog: () => void;
  } = $props();

  // 测试宿主：initial 仅作初值（挂载时捕获一次是本 stub 的语义）。
  // svelte-ignore state_referenced_locally
  let model = $state<Record<string, unknown>>(initial);
</script>

<span data-testid="model-json" class="hidden">{JSON.stringify(model)}</span>
<ModelListItem
  model={model as RouteModelEntry}
  {candidates}
  {routeModels}
  {api}
  {baseURL}
  {provider}
  {apiKeyConfigured}
  {formKey}
  {dirty}
  {initialExpanded}
  onchange={(next) => {
    model = next;
    onchangeLog(next);
  }}
  onremove={onremoveLog}
  onvalidity={onvalidityLog}
/>
