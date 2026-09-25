<!--
  测试 harness（skill-wiki-maintainer 1.6）：为 WikiScopeView 注入 shell router
  上下文（params.wsId），使组件级 DOM 测试无需挂载整个 AppShell。wsId 缺省 =
  无路由参数（视图兜底 Global scope）。match 使用合法的 no-match 变体——
  useParams 只读 params，不消费 match 本体。
-->
<script lang="ts">
  import { setRouterContext, type RouterContextValue } from "$lib/shell/portal-context.svelte";
  import WikiScopeView from "../WikiScopeView.svelte";

  let { wsId }: { wsId?: string } = $props();

  // 每次挂载固定一次路由参数（测试不驱动上下文内导航；重挂载即换 scope）。
  // svelte-ignore state_referenced_locally — 初始化快照即测试意图。
  const context: RouterContextValue = {
    match: { kind: "no-match", reason: "no-route" },
    // svelte-ignore state_referenced_locally
    params: wsId === undefined ? undefined : { wsId },
    // svelte-ignore state_referenced_locally
    search: wsId === undefined ? undefined : {},
    chain: [],
  };
  setRouterContext(() => context);
</script>

<WikiScopeView />
