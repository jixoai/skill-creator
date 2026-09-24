# Proposal: wiki-mcp-surface

## Why

Owner 裁决（2026-09-22 会话中途补充）：「你新增了 skill wiki 这些能力之后，
我们的 Agent 这边也要配套提供 MCP，以便能够直接使用 skill wiki 的 SDK 去做
相关的管理。」目前 wiki 只有 GUI 面板与 `skill-creator wiki` CLI 两个消费面；
agent（经 skill-creator-mcp 的模型主体）无法读写碎片认知。

## What Changes

- capability 登记表新增四个 wiki 能力（输入 schema 与 rpc-contract 同源）：
  - `wiki.scopes`（readonly）：scope 索引（global 恒列 + registry workspaces，
    含只读摘要 patternCount/lastUpdated/exists）
  - `wiki.list`（readonly）：某 scope 的 patterns 投影
  - `wiki.read`（readonly）：单 pattern 全文
  - `wiki.append`（**approved-mutation**）：碎片追加（hash 幂等）——MCP 面上
    仅以 `wiki_append_propose` 出现，产 proposal 待人在 Manager UI 审批
    （与既有 mutation 红线一致；stdio 形态不注册）
- MCP 两形态自动投影：daemon 内 `/mcp`（Bearer）获得 3 readonly + 1 propose；
  `skill-creator mcp`（stdio readonly）获得 3 readonly
- ui:// 卡：wiki.read 命中渲染 wiki 卡（标题/来源 scope/正文预览）；
  list/scopes 走纯文本 JSON（无卡）

## Non-Goals

- 不做 wiki edit/remove 的 MCP 面（保持最小写入面；append 经 proposal 已够
  agent 摄取用——edit/remove 等切片③ Maintainer 设计定稿后随蒸馏通道评估）
- 不做 GUI 审批列表改动（proposal 面已有通用列表）
- 不引入 LLM 编排（切片③范畴）

## 影响面

- src/daemon/capability/domain-capabilities.ts（登记）
- src/daemon/mcp/cards.ts（wiki.read 卡模板）
- 测试：test/skill-creator-mcp.test.ts（工具清单/readonly 调用/propose 流）
  与 capability 登记测试
