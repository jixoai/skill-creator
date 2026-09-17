# Proposal: search duplicates — 索引内容重复面（API + Workspaces 标记）

## Why

用户裁决 [2026-09-18]：中期方向（索引 × Intelligence 打通的第一步）一并做
掉，「工作量不多」。第一代索引的设计定位就是「重复检测/合并/升级/同步的
数据基座」（docs/search-design.md §1）；`contentHash` 分组与搜索结果的
`duplicates` 折叠附注已在索引内就绪，但：

1. 没有无查询维度的「全量重复组列表」——用户不搜就看不到哪些技能同内容。
2. Workspaces 界面没有任何「同内容多安装」的视觉呈现；IntelligenceView 的
   duplicates findings 走独立分析器（全量重分析），与索引事实不互通。

## What Changes

- **P1 `duplicates()` 服务面**：index/service 暴露无查询的重复组投影——
  contentHash 分组 >1 canonical 条目的组，每成员携带 `{id, name,
  canonicalPath, installations, disabled, conflict}`；经 freshen 保证与
  磁盘一致（与 search 同一新鲜度语义）。
- **P2 RPC + capability**：`skills.duplicates`（readonly，无输入）；
  capability 登记后 MCP 面自动投影 `skills_duplicates`（agent 可查）。
- **P3 WorkspacesHome「同内容技能」区块**：组列表（每组成员行 = name +
  安装作用域标签 + 跳转 ProviderView 详情链接）；空态不渲染区块；loading/
  error 态与 workspace 面既有样式一致。

## Impact

- 代码：`skill-search/index.ts`（duplicates 投影）、`service.ts`、
  `contracts/search.ts`（组 schema）、`rpc-contract.ts`、capability、
  webui（WorkspacesHome + store 轻扩展）。
- 不动 IntelligenceView（其分析器 findings 是独立管线，本 change 只做索引
  事实面；两者的融合属后续 Intelligence 侧规划）。
