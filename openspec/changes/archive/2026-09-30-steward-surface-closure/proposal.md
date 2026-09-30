# Proposal: steward-surface-closure —— 旧 Steward UI/hosted 语义收口（webui 残留工作计划 Ch1）

## Why

2026-09-11 用户裁决删除了独立 Steward UI（commit 763a7eb），Agent 面板 + 模式成为
唯一 Agent 面；但两处 spec 文本仍停留在裁决前的世界：

- `steward-product-workflow` 的 Purpose 仍描述「DSH Web host 的 Manager island 工作流
  UI」，且其首条 Requirement 仍要求「reachable as a Manager surface」——与裁决矛盾。
- `dsh-webui-composition` 的 Purpose 仍完整描述「官方 DSH Web profile 作为产品宿主」。

Codex r1 复核（2026-09-30，ws3-codex-review，6.2/10）裁定：**退役的是旧 UI/hosted
语义，不是 Steward 领域**（Manager authority、proposal、approval、audit、rollback
保留）；`agent-steward` spec 描述权限与生命周期契约、不要求独立 UI route，不整体
退役；「后端保留为 agent internal」必须给出真实调用路径证据，不得把 rpc.steward.*
零 WebUI 消费等同于 agent 内部面。

## What Changes

```text
steward 领域能力（保留不动）
  |-- capability-core + skillSteward grant 链（startRun/validate/approve/apply/rollback）
  |-- agent.proposals.* MCP mutation 审批面
  `-- dsh-agent-runtime agent 工具行（如 skills.relations）
退役/收口的只有表述
  |-- steward-product-workflow：Purpose 重写 + 首条 Requirement 改为
  |   「agent-internal with Manager authority」（独立工作流 UI 不再是产品要求）
  |-- dsh-webui-composition：Purpose 重写为 headless 内核组合现实
  `-- 事实修正：steward.* 是 8 个 RPC（r0 误写 7）；「analyzer 已产品化」更正为
      「daemon 代码路径 + 测试 fixture」
```

**调用路径证据（r1 要求，落在 change notes）**：agent 对 steward 能力的真实路径 =
capability/MCP 工具 + 内核 agent run（dsh-agent-runtime.ts:224 注册 skills.relations
等工具行）；`rpc.steward.*`（backends/list/start/events/cancel/decidePermission/
approveProposal/rejectProposal 共 8 个）当前**无任何产品消费方**——保留为 daemon
内部/诊断面，change 明文冻结「不新增 WebUI 入口」。

**不动的**：SessionsSettings 的 kernel-only 提示是转录归属说明（r1：不机械删除）；
skillIntelligence.* 与 agent.proposals.* 双 store 的统一裁决归 Ch4
（intelligence-proposal-parity），不在本 change 范围。

## Impact

- 两个主 spec 的 Purpose 文本 + 一个 Requirement 重写（MODIFIED delta 附后）；
  `agent-steward` spec 核对后不改。
- 零代码变更（webui/src/lib/apps/workspaces/manifest.ts:4 的下线注记已是正确表述，
  保持不动）；纯 spec/文档收口。
- 后续 Ch2-Ch7 以此边界为前提（工作计划 r2 定稿）。
