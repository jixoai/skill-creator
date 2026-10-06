<!--
  测试 harness（skills-tabs-redesign 批 4）：为 agents-screen 注入 shell router
  上下文（params.wsId + search 快照），使 Agents Tab 组件级 DOM 测试无需挂载
  整个 SkillsDashboard。search 固定一次（导航经 navAdapter 捕获断言）。
-->
<script lang="ts">
  import { setRouterContext, type RouterContextValue } from "$lib/shell/portal-context.svelte";
  import { WorkspaceIdSchema, type WorkspaceId } from "$shared/contracts/workspaces.js";
  import AgentsScreen from "../screens/agents-screen.svelte";

  let {
    wsId,
    search = {},
  }: {
    wsId: string;
    search?: Record<string, unknown>;
  } = $props();

  // svelte-ignore state_referenced_locally — 初始化快照即测试意图（与 dashboard
  // harness 同款豁免；wsId 经 schema 收窄一次后固化，错误路径不二次引用 prop）。
  const parsed = WorkspaceIdSchema.safeParse(wsId);
  if (!parsed.success) throw new Error("agents-router-harness: invalid wsId fixture");
  const workspaceId = parsed.data as WorkspaceId;

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

<AgentsScreen wsId={workspaceId} />
