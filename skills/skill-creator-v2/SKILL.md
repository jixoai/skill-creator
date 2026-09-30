---
name: skill-creator-v2
description: 本机 Agent 技能工作台 Skill Creator (V2) 的使用指南。当需要搜索/查找本机已安装技能（find/search skills）、读取技能全文、管理技能（安装/更新/启停/校验/清理重复）、维护 skill wiki，或用户提到 skill-creator / skill creator / 技能管理器 / skills manager / SKILL.md 管理时使用。两条通路：CLI（skill-creator search / wiki / mcp …）与只读 MCP 工具面（skills_search / skills_info / wiki_read …）；变更类操作一律经 Skill Creator GUI 人工审批。
x-managed-by: skill-creator
---

<!--
文件意图：本目录是 Skill Creator 产品自带的官方技能源（随 npm 包 / git 仓库分发）。
~/.agents/skills/skill-creator-v2 是指向本目录的符号链接（daemon 启动时自举维护，
来源经 package.json 身份鉴定）。内容是产品对外行为面（CLI + MCP readonly 工具）的
文档投影，事实源在产品仓库；升级包后本文件自动保鲜，无需任何迁移。
-->

# Skill Creator V2 — 本机技能管理与检索入口

Skill Creator 是本机的技能工作台：管理所有 Agent 的技能目录（发现 / 校验 / 启停 /
安装 / 更新 / 修订历史），并提供本地 BM25 检索与技能 wiki。本机全部技能按
Workspace（`~` = 全局聚合，或已导入的 ws_* 目录）→ Provider（claude-code / codex /
cursor / zcode 等 Agent 的 skills root）两层作用域组织。

## 通路选择

```text
要做什么？
├─ 找技能 / 搜本机已装技能 ──────────> CLI: skill-creator search <query>
│                                      或 MCP: skills_search {query, limit?}
├─ 读某个技能的全文 / 校验它 ─────────> MCP: skills_search 拿 {workspaceId,
│                                      providerId, skillId} 三元组
│                                      → skills_info / skills_validate
├─ 列出本机有哪些 Workspace/Provider > MCP: workspace_list
├─ 装新技能 / 更新 / 启停 / 编辑 ─────> 引导用户在 GUI 操作（skill-creator start）；
│                                      读写面只读，mutation 需 GUI 人工审批
├─ 技能经验 / 认知碎片 wiki ──────────> CLI: skill-creator wiki <子命令>
│                                      或 MCP: wiki_scopes / wiki_list / wiki_read
└─ 结构化批量消费（推荐常驻）─────────> 注册 MCP: skill-creator mcp（stdio，只读）
```

## 硬规则

- **只读面**：CLI/MCP 通路对技能数据只读；安装、更新、启停、编辑、删除都在
  Skill Creator GUI 内完成（`skill-creator start` 启动）——先向用户说明要做什么、
  影响哪些技能，再引导操作，不要声称"已修改"。
- **opaque id**：skillId（`sk_*`）与三元组由服务端签发，不要手工拼路径或猜测；
  永远先 `skills_search` / `workspace_list` 拿真 id。
- **搜索不需要 daemon**：`skill-creator search` 进程内完成（首次建索引稍慢）。

## 深入

完整 MCP 工具目录（含每个工具的输入形状）、CLI 全参考、Workspace/Provider 概念
与 MCP stdio 注册片段见 [references/tools.md](references/tools.md)。
