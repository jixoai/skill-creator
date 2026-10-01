# Design: intelligence-proposal-parity（契约体 = 工作计划 r3 §C + r4 补遗 C′）

## C′ wire 级补遗（r4；冲突处以本节为准；r4-codex 勘误已并入）

- **C′1a 四个新 capability，输入为 action 判别联合**（split/merge 多源）：

```ts
type IntelligenceProposeInput =
  | {
      action: "edit" | "disable";
      findingId: string;
      target: SkillRef;
      observedRevision: string;
      payload: ProposalPayloadSchema;
    } // 复用 skill-intelligence 既有载荷
  | {
      action: "split";
      findingId: string;
      targets: SkillRef[]; // 多源（被拆分技能 + 目标承载者）
      observedRevisions: string[]; // 与 targets 一一对应
      payload: ProposalPayloadSchema;
    }
  | {
      action: "merge";
      findingId: string;
      targets: SkillRef[];
      observedRevisions: string[];
      payload: ProposalPayloadSchema;
    };
// 输出统一 {proposalId}
```

authority=proposal（只产草案不写盘）。

- **C′1b 工具命名与投影模型（r5 实证修正）**：现状 = MCP 投影层只对
  **approved-mutation** authority 追加 `_propose` 后缀（skill-creator-mcp.ts
  的 authority 分支）；proposal authority 会落入普通工具分支。为避免
  `_propose` 外壳制造第二层 proposal，冻结为：capability 声明
  `authority: "proposal"` 时，**kernel 工具行与 MCP 工具同名注册**
  `intelligence_propose_edit | _disable | _split | _merge`（名字本身即
  propose 语义，不再二次追加后缀）；投影层新增 proposal-authority 分支
  （普通注册、无 mutation 变体）。模板正文一律使用实际工具名
  （`intelligence_propose_edit` 等，下划线），四段正文已按此更新。
- **C′2 统一投影 UnifiedProposalView（schema 冻结）**：

```ts
{ id: `mcp:${原id}` | `si:${原id}`,        // 前缀映射：McpProposalStore 的 id 直拼；
                                           // skillIntelligence 的 pr_ id 直拼
  source: "mcp" | "skill-intelligence",
  origin: "agent-tool",
  kind: "edit" | "disable" | "split" | "merge" | "wiki-append" | "distill-apply",
  target: SkillRef | null,                  // wiki 类无技能目标 → null
  targets?: SkillRef[],                     // split/merge 多源
  observedRevision: string | null,
  observedRevisions?: string[],             // split/merge 多源（与 targets 对齐）
  before: string | null, after: string | null,   // 草案 diff 体（无 diff 面 → null）
  finding: { id: string; summary: string } | null,
  validation: { success: boolean; errors: string[]; warnings: string[] } | null,
  status: "pending" | "approved" | "rejected" | "executed" | "failed",
    // r5 勘误：承载 MCP store 既有五态（proposals.ts）；si 源只有前三态
    // （approved 即终态——执行走 skillSteward grant 链）
  rejectCause?: "user" | "stale",           // status=rejected 时携带
  result?: { applied: boolean; error?: string } }  // executed/failed 的执行结果
```

`agent.proposals.list` 返回该视图；approve/reject 决策输入不变（id + 决定），
**按前缀路由**（mcp:→McpProposalStore，si:→skillIntelligence 服务）；stale
草稿（observedRevision ≠ 当前技能 revision）→ rejected 且 `rejectCause:
  "stale"`；两 store 各自映射，不改存储，无审计信息丢失（五态 + result 保全）。
（r6 处置注：si stale 的 approve 响应即 rejected+stale 决策收据；草稿本体按
skill-intelligence 既有语义保留——conflict 供重新分析后对照，显式 reject 才
删除。）

- **C′3 finding-propose seed 的 metadata 统一**：AgentSessionSeedMetadata 的
  `finding-propose` 分支（agent.ts 契约已冻结）为唯一元数据形状；split/merge
  的多源 revisions 进 `metadata.skillId`（主目标）+ 模板正文（全量清单），
  工具调用的 `targets/observedRevisions` 才是多源真值——元数据记录发起上下文，
  不复制载荷。

## C1 创建向量（冻结；四模板正文逐字如下）

```text
finding-propose-edit-v1（version 1）：
  请针对引用的技能（${skillName}）执行 intelligence_propose_edit 工具调用：
  finding ${findingId}（观察于 revision ${observedRevision}）。
  依据 finding 证据起草编辑提案；先调用工具，再向我复述提案要点。
占位符：${skillName} / ${findingId} / ${observedRevision}；替换：纯文本。

finding-propose-disable-v1（version 1）：
  请针对引用的技能（${skillName}）执行 intelligence_propose_disable 工具调用：
  finding ${findingId}（观察于 revision ${observedRevision}）。
  起草禁用提案并说明恢复路径；先调用工具，再向我复述提案要点。

finding-propose-split-v1（version 1）：
  请针对引用的技能（${skillName}）执行 intelligence_propose_split 工具调用：
  finding ${findingId}（观察于 revision ${observedRevision}）。
  按 finding 指出的职责混同起草拆分提案（目标边界逐条列出）；先调用工具，
  再向我复述提案要点。

finding-propose-merge-v1（version 1）：
  请针对引用的技能（${skillName}）执行 intelligence_propose_merge 工具调用：
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

## C′4 退役边界迁移（r5 P1）

- webui 消费迁移：intelligence.svelte.ts 的 skillIntelligence.propose 直连调用随 2.2 任务移除（改 seed 发起）。
- daemon 内部路径归类：steward-service.ts 直接创建 proposal 的内部管线调用**不是 UI 创建路径**——steward run 本身是 agent run，其服务层调用与 capability handler 同源实现；归类为 origin=agent-tool 的服务内部调用方（非第三向量），在 capability handler 注释与 spec 注记中显式声明。
- 冻结：WebUI 零直连创建；capability 工具 = agent 唯一创建向量；steward 内部管线 = 服务内部同源调用方。
