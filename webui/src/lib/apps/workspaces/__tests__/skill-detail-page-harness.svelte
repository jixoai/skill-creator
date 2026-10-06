<!--
  测试 harness（skill-detail-page.dom.test）：为 SkillDetailPage 注入 shell router
  上下文（params 三元组 + search.from），使页面级 DOM 测试无需挂载整个 AppShell。
  search 快照固定一次（测试内导航经 navAdapter 捕获断言，不驱动上下文重放）。
-->
<script lang="ts">
  import { setRouterContext, type RouterContextValue } from "$lib/shell/portal-context.svelte";
  import SkillDetailPage from "../SkillDetailPage.svelte";

  let {
    wsId,
    providerId,
    skillId,
    search = {},
  }: {
    wsId: string;
    providerId: string;
    skillId: string;
    search?: Record<string, unknown>;
  } = $props();

  // svelte-ignore state_referenced_locally — 初始化快照即测试意图。
  const context: RouterContextValue = {
    match: { kind: "no-match", reason: "no-route" },
    // svelte-ignore state_referenced_locally
    params: { wsId, providerId, skillId },
    // svelte-ignore state_referenced_locally
    search,
    chain: [],
  };
  setRouterContext(() => context);
</script>

<SkillDetailPage />
