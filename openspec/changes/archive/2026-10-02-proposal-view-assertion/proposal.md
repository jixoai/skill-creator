# Proposal: proposal-view-assertion — approved 状态投影直接断言（codex r8 小注）

## Why

codex r8 复核小注：`test/agent-proposals-projection.test.ts` 覆盖了
executed / failed / pending（经 si 草稿）与 rejected（路由级），唯独没有对
`McpProposalView.status === "approved"`（审批已接受、执行在途的中间态）经
`projectMcpProposal` 原样投影的直接断言——该状态字段落线是
`view.status` 直通（`agent-proposals-projection.ts` line 45），回归只能靠
间接路径兜住。

## What Changes

- test-only：`test/agent-proposals-projection.test.ts` 追加一例——构造
  `status:"approved"` 的 McpProposalView，断言 `projectMcpProposal` 输出
  `status:"approved"` 原样投影、且无执行结果（`result` 缺席）。

## Impact

- 零生产行为变更；无 spec delta（skip_specs: true）。
