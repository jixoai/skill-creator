# Design: intelligence-proposal-parity（契约体 = 工作计划 r3 §C + r4 补遗 C′）

## C′ wire 级补遗（r4；冲突处以本节为准）

- **C′1 四个新 capability（r4 实证：当前 capability 面 31 项无一 propose）**：
  `intelligence.propose_edit` / `intelligence.propose_disable` /
  `intelligence.propose_split` / `intelligence.propose_merge`——输入
  `{findingId, observedRevision, target: {workspaceId, providerId, skillId},
  payload}`，输出 `{proposalId}`，authority=proposal（只产草案不写盘；MCP 面
  投影 `*_propose` 变体，与 wiki_append_propose 同模式）。
- **C′2 统一投影 UnifiedProposalView（冻结）**：
  `{id（前缀 `mcp:`|`si:`）, source: "mcp"|"skill-intelligence",
  origin:"agent-tool", kind, target 三元组, observedRevision, before/after,
  finding 摘要, validation 结果, status}`——`agent.proposals.list` 返回统一
  视图；approve/reject 按 id 前缀路由（mcp:→McpProposalStore，si:→
  skillIntelligence 服务）；stale 草稿 → rejected STALE；两 store 各自映射，
  不改存储。

## C1 创建向量（冻结；四模板正文逐字如下）

```text
finding-propose-edit-v1（version 1）：
  请针对引用的技能（${skillName}）执行 intelligence.propose_edit 工具调用：
  finding ${findingId}（观察于 revision ${observedRevision}）。
  依据 finding 证据起草编辑提案；先调用工具，再向我复述提案要点。
占位符：${skillName} / ${findingId} / ${observedRevision}；替换：纯文本。

finding-propose-disable-v1（version 1）：
  请针对引用的技能（${skillName}）执行 intelligence.propose_disable 工具调用：
  finding ${findingId}（观察于 revision ${observedRevision}）。
  起草禁用提案并说明恢复路径；先调用工具，再向我复述提案要点。

finding-propose-split-v1（version 1）：
  请针对引用的技能（${skillName}）执行 intelligence.propose_split 工具调用：
  finding ${findingId}（观察于 revision ${observedRevision}）。
  按 finding 指出的职责混同起草拆分提案（目标边界逐条列出）；先调用工具，
  再向我复述提案要点。

finding-propose-merge-v1（version 1）：
  请针对引用的技能（${skillName}）执行 intelligence.propose_merge 工具调用：
  finding ${findingId}（观察于 revision ${observedRevision}）。
  按 finding 指出的重复职责起草合并提案（保留主体与吸收项逐条列出）；先调用
  工具，再向我复述提案要点。

协议与 probe-recall-v1 同族：ID/版本冻结、不自动发送、用户可编辑最终指令、
模板版本随会话落档（testRun 元数据块 kind 为 finding-propose）。
```

## C2 审批统一投影（冻结）

- `agent.proposals.*` = 唯一审批入口；投影源 = MCP mutation proposal store
  ∪ skillIntelligence proposal store；每条携带 `origin: "agent-tool"` 元数据。
- skillIntelligence 存储降级为数据源（不再直接服务 UI 审批面）；渲染统一
  before/after + observed revisions + validation 结果。
- spec 冻结：不存在 finding-created 直连创建路径；split/merge 与 edit/disable
  同向量，消除「能渲染不能创建」的悬空面。

## C3 时序与依赖

- 依赖 Ch2 seed 机制先行；本 change 排在 Ch2 之后、Ch5-Ch7 之前（r2 裁决序）。
