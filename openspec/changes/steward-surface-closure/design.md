# Design: steward-surface-closure

## D1 — 退役边界（codex r1 裁决采纳）

```text
退役                                     保留
------------------------------------    ------------------------------------
独立 Steward 工作流 UI 要求             Manager authority / proposal /
（Requirement 的 Manager surface 措辞）  approval / audit / rollback 全链
两个 Purpose 的 DSH Web host 叙述        skillSteward grant 链与 fixture 适配
「steward.* 需要 WebUI 入口」的隐含预期  agent 工具行（skills.relations 等）
                                        agent-steward 权限/生命周期 spec
```

判定规则：本 change 只改「产品面要求与叙述」，不改任何运行时代码与能力注册；
后续任何 change 想恢复 Steward UI 入口，必须先推翻 2026-09-11 用户裁决。

## D2 — Requirement 重写（MODIFIED）

原「Steward is a complete Manager workflow」要求单一 Manager-owned 工作流 UI 内
提供全链操作。重写为「Steward workflow is agent-internal with Manager authority」：
管线与授权语义不变，产品面改为 agent 内部面 + proposal 审批面；原 scenario
「Workflow after host inversion」（要求 Manager surface 可达）替换为「agent 发起
的 proposal 经审批面到达用户」与「WebUI 无 steward 入口」两个场景。其余 Requirement
（Failure states are actionable 等）保留原文——它们约束的是状态语义，不绑 UI 形态。

## D3 — 事实修正清单（写入 change notes，防再次失真）

- rpc-contract 的 `steward.*` 是 8 个 RPC；7 是 Steward 域工具数（r0 混淆）。
- 真实 agent 调用路径：capability/MCP 工具 + dsh-agent-runtime 工具行；不是
  rpc.steward.*（后者零产品消费方，属 daemon 内部/诊断面）。
- 「analyzer 已产品化」→「analyzer 是 daemon 代码路径 + 测试 fixture（10 条期望
  矩阵，steward-effectiveness 3/3）；产品语料面由 Ch3 从零建立」。
- SessionsSettings 的 kernel-only 提示 = 转录归属说明，保留。
