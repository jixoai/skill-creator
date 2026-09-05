# Design: workspaces-skill-preview

## Context

当前 Workspaces 的技能详情面板（`webui/src/lib/components/skill-detail.svelte`）只把 `skill.content` 用 `<pre><code>` 等宽块塞进去，既不解析 frontmatter，也不渲染 markdown。后端 `skills.info` 早已通过 `SkillInfoSchema.content`（`src/shared/contracts/skills.ts`）返回完整正文，`SkillInfoSchema.revision` 也已就绪；`creator.save` 已支持 `mode: "update"` + `expectedRevision`（`src/shared/contracts/creator.ts`）。缺口是纯前端的：用户读不到技能正文，聚合计数也把跨 Provider 共享路径下的同一技能重复计数。

本变更是 change 6 序列中的第 2 个，依赖 change 0 `chrometabshell-standard`（Shell 标准）+ change 1 `chrometabs-shell`（三个 App manifest 接入 + 状态分层迁移）。

```
┌─────────────────────────────────────────────────────────────┐
│ Shell (from change 0 + change 1)                            │
│ ┌──────────────┬──────────────────────────────────────────┐ │
│ │ Left Nav     │ Tabs Bar                                 │ │
│ │ • Workspaces │ [home] [Workspace A/<ws>/<prov>] [+]     │ │
│ │ • Creator    ├──────────────────────────────────────────┤ │
│ │ • Repository │ Skill List │ Skill Detail                │ │
│ │              │  (aside)  │  ├ frontmatter metadata tbl  │ │
│ │              │            │  ├ markdown body (rendered) │ │
│ │              │            │  └ actions: Validate/Edit…  │ │
│ └──────────────┴──────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## 状态分层（来自 config.yaml 原则）

| 状态                                              | 存储层                                          | 说明                                                                                              |
| ------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 选中技能 / 筛选词 / 列表 vs 详情子视图            | **URL search params**                           | `?skill=<id>&q=<filter>&view=list\|detail`；刷新可恢复；组件用 `useSearch` getter + `$derived` 读 |
| 技能列表 / 技能正文 / revision                    | **daemon RPC**（`skills.list` / `skills.info`） | 按需拉取，**不缓存在前端 memory 跨渲染周期**；切走再切回重新拉取                                  |
| 轻量编辑草稿（`name` / `description` 未保存输入） | **组件级 `$state`**                             | 临时表单；保存时通过 `creator.save` RPC 落盘；组件卸载即消失                                      |
| 设备偏好                                          | **localStorage**（change 0 `device-prefs.ts`）  | 仅 theme / sidebar 折叠等                                                                         |

## Goals

- 用户在详情面板能阅读完整的 SKILL.md：frontmatter 作为只读元数据表，正文渲染为格式化 markdown。
- 提供行内「轻量编辑」：仅 `name` / `description`，草稿存组件级 `$state`，保存走 `creator.save` 的 revision-safe 路径，不进入 Creator App 的正文编辑模式。
- Workspaces App 适配 Shell 标准 + 状态分层：home Tab + 每个 Workspace 独立实例 Tab；选中技能 / 筛选词 / 子视图全部编码在 URL，切换 Tab 不丢失视图状态。
- 技能列表 / 详情数据明确来自 daemon RPC（`skills.list` / `skills.info`），不在前端 memory 跨渲染周期缓存。
- Workspace 级聚合计数按 canonical path 去重；Provider 级计数保持不变。

## Non-Goals

- 完整的 markdown 编辑器（归 Creator App）。
- 技能版本历史 / lock 文件对比（归 `skills-cli-compat`）。
- 批量操作（启停批量、批量启用跨 Provider 安装）。
- 重新设计卡片或列表层级（仅复用现有 `SkillCard`）。
- 在前端 memory / localStorage 缓存技能列表或正文（违反状态分层）。

## Decisions

### D1. 预览渲染：Tailwind Typography + 最小 markdown 渲染器

项目已经依赖 `@tailwindcss/typography`（`webui/package.json` 中已声明）。正文渲染走 `<div class="prose prose-sm">{@html rendered}</div>`。渲染器选最小可满足 GitHub Flavored Markdown 子集（标题、列表、代码块、链接、强调、段落）的实现，避免引入完整 remark/rehype 链。优先候选：`marked`（体积小、零依赖、纯函数 `marked.parse(md)`）。渲染在客户端进行（content 来自 `skills.info` 的当次 RPC 响应，不在前端跨渲染缓存）。

frontmatter 解析复用现有逻辑（`creator.save` 已经接受 `SkillFrontmatterSchema`，约定一致）：把 `content` 切分为 frontmatter 块与 body 块，frontmatter 块以键值表展示。

### D2. 轻量编辑：组件级 `$state` 草稿 → `creator.save` RPC

- `name` / `description` 在元数据表中变为 `<Input>`（仅在 `provider.writable` 时启用，沿用 `skill-detail.svelte` 已有的 `editable` 透传条件）。
- 草稿（未保存的 `name` / `description` 输入）收敛在 `skill-detail.svelte` 组件局部 `$state`——这是临时表单状态，符合状态分层的「memory」层。组件卸载即丢弃；切走再切回重新从 `skills.info` RPC 拉取最新已保存值。
- 保存按钮触发 `creator.save({ mode: "update", workspaceId, providerId, skillId, expectedRevision: skill.revision, frontmatter: { name, description, ...其余透传字段 }, body: skill.content 原始 body })` RPC 落盘；成功后用返回的 `SkillDocument.revision` 刷新组件局部持有的 revision（仅当前渲染周期，不写全局 store）。
- 冲突（revision 不匹配）按 revision-safe 现有错误路径处理：toast 报错并提示重载。
- 不提供正文编辑——正文改动应通过 `onEdit` 跳转到 Creator App（已有路径）。

### D3. Workspaces App 接入 Shell 标准 + 视图状态 → URL

基于 change 0 的 Shell 标准 + change 1 的 manifest 声明：

- home activity 路由：`/workspaces`（复数）—— 技能位置索引列表（迁移自当前 `/workspace` 列表页）。
- instance activity 路由：`/workspaces/<wsId>/<provId>` —— 单 Workspace + 单 Provider 的技能列表 + 详情。
- **视图状态全部编码到 URL search params**（不再用 tab-scoped 全局 store）：
  - `?skill=<skillId>` —— 当前选中技能（详情面板展示哪个）
  - `?q=<filter>` —— 列表筛选词
  - `?view=list|detail` —— 窄屏下列表 / 详情子视图切换
- 组件用 change 0 的 `useSearch<{ skill?: string; q?: string; view?: "list" | "detail" }>()` getter + `$derived` 读这些值；选中 / 筛选 / 切子视图动作调 `navigate.go` 推 URL。
- 旧路由（`/workspace`、`/workspace/[id]`）由 Shell 路由层重定向节点映射到对应 activity。

```
旧路由              →  新 Shell 路由（基于 change 0/1）
/workspace             /workspaces                       (home activity)
/workspace/[id]        /workspaces/<ws>/<prov>            (instance activity)
                       + 视图状态在 URL：?skill=...&q=...&view=...
```

### D4. 去重计数：投影层在 `projectWorkspaceSnapshot` 中按 canonical path 去重

当前 `sumProviderCounts`（`projection.ts`）把所有 Provider 的 `skillCount` 直接相加。同一 Workspace 下，多个 Provider 可能共享同一路径（典型：`.agents/skills` 同时被多个社区 Agent 复用），同一物理技能被重复计入。

变更：在投影层引入一个「按 canonical path 去重的 skill 标识集合」，Workspace 级 `skillCount` 改为该集合的大小。Provider 级 `skillCount` 不变（每个 Provider 仍按其根目录报告全部技能）。去重键采用 `(canonicalRootPath, directoryName)`——以 Provider 根目录的 canonical 形式 + 技能目录名作为同一性判据（而非依赖 `skill.id`，因 `skill.id` 是按 Provider 注入身份的，跨 Provider 不同）。

```
去重键 = canonical(providerRoot) + path.sep + directoryName

Workspace.skillCount = | ∪ providers 的 { root, dirName } |
Provider.skillCount   = count(providerRoot 下全部技能)   // 不变
```

去重逻辑在 daemon 投影层（持久 + 共享状态层），前端 `skills.list` RPC 拿到的就是去重后的投影，不再在前端做二次聚合缓存。

### D5. 数据来源：技能列表 / 详情明确来自 daemon RPC

- 技能列表：来自 `skills.list` RPC（daemon 投影，含 D4 去重后的 Workspace 级计数 + Provider 级计数）。
- 技能详情（含正文 / frontmatter / revision）：来自 `skills.info` RPC。
- 这两类数据**不缓存在前端 memory 跨渲染周期**：组件挂载或 URL（`wsId` / `provId` / `skill`）变化时触发对应 RPC；切走 Tab 时组件被 TabOutlet visibility 隐藏（DOM 保留），但数据不在全局 `$state` 单例里持有；切回时若需要最新数据重新拉取。
- 实时变化（如外部 `npx skills add` 改了磁盘）走 daemon WS 推送 → UI 收到后重新拉取 RPC 投影。

### D6. 安全 / 不变量

- revision-safe：轻量编辑保存强制 `expectedRevision`，由 `creator.save` 既有约束保护。
- 不引入新的外部输入路径：所有 content 都来自 `skills.info` 已校验的响应；渲染器输出经 `{@html}` 注入，必须使用受信任渲染器并对输出做基本 sanitize（若用 `marked`，启用其 sanitizer 或叠加 `DOMPurify`）。这是本变更引入的新的客户端 HTML 注入面，需在 review 时单独确认渲染器配置关闭了原始 HTML 透传。
- WebUI 仍禁止 import daemon 实现或 `node:fs`。

## Risks

- **R1. markdown 渲染库增加 bundle 体积**。缓解：选最小渲染器（`marked` ~30KB gzip）；或对渲染器做 dynamic import（仅在详情面板首次进入时加载），首页 bundle 不受影响。
- **R2. 渲染器 `{@html}` 注入面**。技能正文是用户本地文件（非远端），但仍需保证渲染器关闭原始 HTML 透传，避免恶意 frontmatter / body 注入脚本。缓解：`marked` 默认转义 HTML；在测试中加一条「body 含 `<script>` 时不出现在输出中」的断言。
- **R3. 去重逻辑误伤 Provider 级发现**。缓解：去重只作用于 Workspace 级聚合；Provider 级 `skillCount` 完全不动；测试覆盖「同一技能在两个 Provider 下都仍被各自 `skills.list` 看到」。
- **R4. 依赖 change 0（`chrometabshell-standard`）与 change 1（`chrometabs-shell`）尚未落地**。缓解：本变更的预览 / 轻量编辑 / 去重三块可独立先行；Shell 接线部分（D3）以 change 0 / 1 落地为前置条件，标注为 task 3 的 gating 依赖。
- **R5. 旧路由 `/workspace`、`/workspace/[id]` 的重定向可能破坏外部深链**。缓解：Shell 路由层为旧路由保留内部重定向到对应 activity；OpenTray 桌面打开窗口时使用新路由。
- **R6. 切走再切回 Tab 重新拉取 RPC 的感知延迟**。状态分层下不缓存业务数据，切回时若 TabOutlet 已保留 DOM，组件可继续用上次渲染的数据（DOM 未卸载），仅在显式刷新或 WS 推送时重新拉取——避免无谓 RPC。
