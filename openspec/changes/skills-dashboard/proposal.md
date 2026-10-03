# Proposal: skills-dashboard — SkillsWorkspacePage 的 Skills 主屏（mobileScreen 网格）

## Why

Owner 原话：「左侧 workspace 这里的入口，改成 skills，默认不再按照 agent 去做
分类，而是直接展示所有的 skill……我更倾向开发 skills-dashboard。skills-dashboard
将包含 skills、agents、还有 repos（Repository 这也可以整合到这里来）」。拍板
（grill Q4/Q11）：三块是并列 **mobileScreen**——每个 screen 有自身 height 概念，
自动换行适应单/双/三/四列。Repository 作为一级导航退役，被 dashboard 吸收。

## What Changes

- **Skills 主屏重构**（`/w/:wsId/skills`）：mobileScreen 网格布局——
  - **Skills screen（主屏，双列起步）**：当前 workspace 全技能**跨 provider
    平铺**列表（不按 agent 分组），skills.search 全文搜索 + provider 筛选
    chip + duplicates 标记；固定高度内部滚动；行 → 详情（detail = **只读
    文档详情 + 管理动作** toggle/validate/update check；frontmatter/正文编辑
    唯一入口 = Creator 编辑页深链——现 ProviderView 的 name/description
    行内轻量编辑随之退役。r2 修订：所有权切分与 creator-agent-chat 同源）。
  - **Agents screen（单列）**：「从 agent 视角看技能」——provider 卡片
    （每 agent 可见技能数/启停态 + 进入该 provider 过滤视图）+ intelligence
    findings 入口（深链到分析视图）。
  - **Repos screen（单列）**：Discover feed（curated + user sources）+ 扫描/
    preview/install 完整流（RepositoryHome/RepositoryScan 迁入，pinned-clone
    语义原样）。
  - WorkspacesHome 的库快照行 / self-skill banner / 位置索引随迁（冒烟锚点
    en 逐字不变，落 Global tab 的 skills 屏页脚）。
- **聚合 RPC**：`skills.list` 是 provider-scoped——新增 server-owned
  `skills.listWorkspace`（workspace 级聚合，含 per-provider 计数与 duplicates
  投影；**有界契约（r2 修订）**：可选 `q` 预过滤 + `limit`（默认 200，hard
  cap 500，越界 typed 拒绝）+ `nextCursor` 分段，单次响应恒有界——provider
  数量少不构成无界豁免；一个 provider 失败投影为该 provider 的 typed
  `error`（schema 字段），不拖垮整屏）。
- **Intelligence 双入口同身份**：Agents screen 的分析入口与 skill 详情入口
  指向同一分析身份（路由收敛 `/w/:wsId/skills/intelligence/:providerId`），
  不留两份状态。
- **Repository app 退役**：manifest 删除，redirect 已在 shell-page-tabs 预置
  （/repository → /w/~/skills），本 change 更新 redirect 直指 Repos screen
  深链（/w/:wsId/skills?screen=repos 或 path 段，design 定）。

## Impact

- webui：ProviderView 拆分（list 平铺化 / detail 面组件化；行内轻量编辑退役
  归 Creator 深链）、Repository 两视图迁入 dashboard、WorkspacesHome 退役
  吸收、新增 dashboard 壳组件。
- 契约：skills namespace 新增 listWorkspace 过程（readonly，有界契约）；spec
  delta 挂 skill-registry（有界聚合读与 per-provider 失败隔离为 spec 级
  Requirement——r2 修订：不再 skip_specs）。
- 测试：duplicates 投影、聚合失败语义（typed error）、有界分段、迁移路由
  redirect 更新、冒烟锚点、detail 面零编辑写断言。
- i18n（引用制）：完成时在 webui-i18n-bilingual 的 inventory.md 标记对应
  B 类面完成并双语适配（唯一帐本 = 该 change）。
