# Proposal: intelligence-proposal-parity — proposal 来源统一经 agent tool call（工作计划 Ch4 / 契约 C）

## Why

GOAL.md 完成条件（105 行）：「edit/disable/split/merge 均从实际 DSH tool calls
形成方案，经 validation、人类 approval、apply、audit 和 rollback」。现状：
IntelligenceView 只从 finding 创建 edit/disable 且直连 `skillIntelligence.propose`
（IntelligenceView.svelte:233）；split/merge 仅审查渲染无创建路径；双 proposal
存储（skillIntelligence.* vs agent.proposals.*）并存无统一投影。Codex r2 裁定：
不得把 "finding-created" 当作未定义的第三条创建路径。

## What Changes（裁决无二选一，GOAL 直接采信）

- **四动作一律经内核 agent 会话的工具调用产生 proposal**：IntelligenceView 的
  edit/disable 直连表单**移除**；四动作（edit/disable/split/merge）统一为
  「经 agent 发起」——用 creator-test-session 的 seed 机制打开 Agent 面板，
  携带 finding 上下文 + 对应 propose 工具的调用指令；proposal 由 agent tool
  call 产生。
- **`skillIntelligence.propose` 从 WebUI 侧退役**（无兼容策略）；capability/
  kernel/MCP 投影的 propose 工具成为唯一创建向量。
- **审批统一投影**：agent.proposals.* 成为单一审批入口；skillIntelligence
  的 proposal 存储并入其投影（数据源之一，origin=agent-tool 元数据）；
  spec 冻结「不存在 finding-created 直连创建路径」。

## Impact

- webui：IntelligenceView 四动作改 seed 发起（复用 Ch2）；移除直连 propose
  调用与表单。
- daemon：agent.proposals 投影扩为统一面（并源 + origin 标注）；rpc-contract
  的 skillIntelligence.propose 移除（破坏性，无兼容）。
- 依赖：Ch2 的 seed 机制（先行实现）。
