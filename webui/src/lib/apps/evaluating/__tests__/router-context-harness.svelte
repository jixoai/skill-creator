<!--
  测试 harness（evaluating-dashboard）：为 EvaluatingOverview / EvaluatingDetail
  注入 shell router 上下文（三段路由 params），使组件级 DOM 测试无需挂载整个
  AppShell。view="overview" 只带 wsId；view="detail" 带 wsId/providerId/skillId
  三段。match 使用合法 no-match 变体——useParams 只读 params，不消费 match 本体。
-->
<script lang="ts">
  import { setRouterContext, type RouterContextValue } from "$lib/shell/portal-context.svelte";
  import EvaluatingOverview from "../EvaluatingOverview.svelte";
  import EvaluatingDetail from "../EvaluatingDetail.svelte";

  let {
    view,
    wsId,
    providerId,
    skillId,
  }: {
    view: "overview" | "detail";
    wsId: string;
    providerId?: string;
    skillId?: string;
  } = $props();

  // 每次挂载固定一次路由参数（重挂载即换身份；测试不驱动上下文内导航）。
  // svelte-ignore state_referenced_locally — 初始化快照即测试意图。
  const context: RouterContextValue = {
    match: { kind: "no-match", reason: "no-route" },
    // svelte-ignore state_referenced_locally
    params:
      view === "overview"
        ? { wsId }
        : { wsId, providerId: providerId ?? "", skillId: skillId ?? "" },
    // svelte-ignore state_referenced_locally
    search: undefined,
    chain: [],
  };
  setRouterContext(() => context);
</script>

{#if view === "overview"}
  <EvaluatingOverview />
{:else}
  <EvaluatingDetail />
{/if}
