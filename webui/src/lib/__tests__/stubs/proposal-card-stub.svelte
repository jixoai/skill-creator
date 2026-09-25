<!--
  测试 stub（skill-wiki-maintainer 1.6）：AgentProposalCard 的最小替身——真实卡
  片的 approve/reject RPC 面与 DOM 断言无关；以 data 属性暴露 proposalId/status
  供组件级测试定位。vi.mock 工厂经动态 import 挂载本组件（lucide stub 同法）。
-->
<script lang="ts">
  let {
    proposalId,
    status,
  }: {
    proposalId: string;
    capability: string;
    input: unknown;
    status: string;
  } = $props();
</script>

<div data-testid="proposal-card" data-proposal-id={proposalId} data-status={status}>
  {proposalId}
</div>
