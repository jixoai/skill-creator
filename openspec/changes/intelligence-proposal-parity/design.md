# Design: intelligence-proposal-parity（契约体 = 工作计划 r3 §冻结契约 C）

## C1 创建向量（冻结）

```text
edit / disable / split / merge 四动作
  -> IntelligenceView「经 agent 发起」按钮（四选一）
  -> seedAgentTestRun 同族入口：Agent 面板 + finding 上下文 + propose 工具指令
  -> 内核 agent 会话产出 tool call（capability/kernel 投影的 propose 工具）
  -> proposal 进入审批面
禁止：WebUI 直连 skillIntelligence.propose（RPC 从 WebUI 消费面退役并从
rpc-contract 移除——破坏性更新，无兼容路径）
```

- seed 的模板族：`finding-propose-edit-v1` / `-disable-v1` / `-split-v1` /
  `-merge-v1`（与 probe-recall-v1 同协议：ID/版本/正文冻结、不自动发送）。
- 用户在面板可编辑指令；proposal 仍由工具调用产生（不是文本解析）。

## C2 审批统一投影（冻结）

- `agent.proposals.*` = 唯一审批入口；投影源 = MCP mutation proposal store
  ∪ skillIntelligence proposal store；每条携带 `origin: "agent-tool"` 元数据。
- skillIntelligence 存储降级为数据源（不再直接服务 UI 审批面）；渲染统一
  before/after + observed revisions + validation 结果。
- spec 冻结：不存在 finding-created 直连创建路径；split/merge 与 edit/disable
  同向量，消除「能渲染不能创建」的悬空面。

## C3 时序与依赖

- 依赖 Ch2 seed 机制先行；本 change 排在 Ch2 之后、Ch5-Ch7 之前（r2 裁决序）。
