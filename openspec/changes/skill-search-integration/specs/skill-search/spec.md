# skill-search 变更（增量：内化接入）

## ADDED Requirements

### Requirement: daemon 以域单例服务 skills.search RPC

daemon domain MUST 持有进程级 `skillSearch` 单例（生产零参
`createSkillSearchService()`，server-owned roots；跨 RPC 调用保活——索引
惰性加载 + stat 增量 freshen 是该 service 的既有形态）。`skills.search`
RPC 输入 MUST 为 `{query: string(min 1), limit?: 1..50}`，输出
`{results: SkillSearchResult[]}`（复用 shared 契约，无第二份手写类型）。
空 query 由输入 schema 拒绝为 typed 校验错误；索引 IO 故障经错误边界透传
为 typed 失败，不伪装空结果。

#### Scenario: RPC 检索与作用域元数据

- **WHEN** 经 oRPC client 调 `skills.search({query: "React 组件"})`
- **THEN** 返回结果含稳定 sk_ id、canonicalPath、installations（workspaceId
  - providerId 三元组）与 contentHash，字段与 CLI `--json` 同契约

#### Scenario: 空 query 是校验错误

- **WHEN** 调 `skills.search({query: ""})`
- **THEN** 输入校验失败（typed error），不返回空数组的伪成功

### Requirement: MCP 面自动暴露 readonly skills_search

`skills.search` MUST 以 readonly authority 登记进 domain capability
registry；MCP server 据此自动注册 `skills_search` 工具（无 propose 变体），
stdio 与 in-process 两个 face 均可用。工具返回结构化结果（id/name/
description/canonicalPath/作用域/分数），供 Agent 直接消费。

#### Scenario: stdio face 可检索

- **WHEN** stdio MCP client 调 `skills_search`（query 命中沙箱技能）
- **THEN** 返回该技能的稳定 id 与作用域三元组；无 mutation 工具被注册

### Requirement: 内核专注模式放行 skills_search

全部专注模式（create/manage/explore）的 MCP 工具名单 MUST 包含
`skills_search`（free 模式保持既有全放行）——产品 agent 会话在任何模式都能
检索本地技能；模式 guard 对该工具不再以模式外为由拒绝。

#### Scenario: 专注模式调用不被拒

- **WHEN** create 模式会话调用 `mcp__skill-creator__skills_search`
- **THEN** 模式 guard 放行（全局 deny 面与其它既有拒绝不因本变更放宽）
