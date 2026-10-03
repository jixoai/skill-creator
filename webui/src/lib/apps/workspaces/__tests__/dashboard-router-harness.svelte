<!--
  测试 harness（skills-dashboard 1.3/1.7）：为 SkillsDashboard 注入 shell router
  上下文（params.wsId + search），使组件级 DOM 测试无需挂载整个 AppShell。
  search 快照固定一次（测试内导航经 navAdapter 捕获断言，不驱动上下文重放）。
-->
<script lang="ts">
  import { setRouterContext, type RouterContextValue } from "$lib/shell/portal-context.svelte";
  import SkillsDashboard from "../SkillsDashboard.svelte";

  let {
    wsId,
    search = {},
  }: {
    wsId: string;
    search?: Record<string, unknown>;
  } = $props();

  // svelte-ignore state_referenced_locally — 初始化快照即测试意图。
  const context: RouterContextValue = {
    match: { kind: "no-match", reason: "no-route" },
    // svelte-ignore state_referenced_locally
    params: { wsId },
    // svelte-ignore state_referenced_locally
    search,
    chain: [],
  };
  setRouterContext(() => context);
</script>

<SkillsDashboard />
