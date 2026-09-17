# Proposal: skill search 内化 — daemon RPC + MCP 工具 + 内核模式工具面

## Why

用户决策 [2026-09-17]：「同意你提供的下一阶段的规划，开始持续推进」——
skill-search CLI 与索引域已交付（2026-09-17-skill-search，实现复核
9.0/10 APPROVE），但内核会话与 GUI 尚无消费方。原任务书定位：「最终我们
还需要将这个 search 能力内化到内核中和 GUI 中，在任何需要搜索 skills 的
地方都进行升级。」本 change 是两段规划的第一段（纯后端）；GUI 接入
（ProviderView q 过滤 / 全局搜索入口 / composer `$` 菜单）是第二段独立
change，依赖本段的 `skills.search` RPC。

Agent 价值：MCP `skills_search` 工具让任何 MCP client（含产品 agent 内核
会话）可检索本地技能并拿到稳定 sk_ id + 作用域三元组——这是「Agent 根据
搜索结果决定 load/inspect/upgrade」的关键通路。

## What Changes

### C1 —— daemon RPC `skills.search`

- `src/shared/rpc-contract.ts`：`SkillsSearchInputSchema`（query min-1 +
  limit 可选，复用 contracts/search.ts 既有 schema）导出 + skills 命名空间
  增 `search` procedure（输出 `{results: SkillSearchResult[]}`）。
- `src/daemon/domain.ts`：`DaemonDomain` 增 `skillSearch` 单例字段
  （`createSkillSearchService()` 零参生产构造；daemon 生命周期长驻——索引
  惰性加载 + stat 增量，正是该 service 的设计形态）。
- `src/daemon/rpc-router.ts`：`search` handler 一行接线（错误走既有
  domainErrorBoundary；索引 IO 故障 = SkillSearchIndexError → typed 失败）。

### C2 —— MCP readonly `skills_search` 能力

- `src/daemon/capability/domain-capabilities.ts`：登记 `skills.search`
  （authority readonly）+ `DomainCapabilityDeps` Pick 增 `skillSearch`。
  skill-creator-mcp.ts 零改动（工具自动投影，基名 `skills_search`；readonly
  无 propose 变体；stdio face 天然可用——search 不是 mutation）。

### C3 —— 内核模式工具面放行

- `src/daemon/kernel/agent-modes.ts`：`skills_search` 加进全部专注模式的
  `tools` 数组（create/manage/explore；free 已是全放行）——「任何模式都能
  检索本地技能」。内核 YAML/dsh-kernel 零改动（全局面是
  `mcp__skill-creator__` 前缀通配，运行时 tools/list 拉取）。

### 明确不在本 change

- GUI（ProviderView / 全局搜索 / composer `$`）——第二段 change。
- ui:// 搜索结果卡（列表型结果先给结构化文本；卡是后续增强）。
- agent 角色能力面（AGENT_ROLES capabilities）——按需后续。

## 验证

RPC 集成测试（沙箱 home + 真实 domain，断言结果契约与空 query 的 typed
校验错误）、MCP stdio face 工具在场 + 调用往返、capability 清单测试同步
（DOMAIN_AUTHORITY/mapProcedures/stub）、agent-modes 断言、全量门。
