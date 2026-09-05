# Proposal: workspaces-skill-preview

## Why

今天的 Workspaces 技能详情面板只能显示卡片描述 + Validate / Disable 按钮。用户在选择某个技能后，看到的仍只是 `SkillMetadata.description`（卡片级摘要），无法阅读 `SKILL.md` 的真实正文，无从判断这个技能到底该不该启用、值不值得参考。对一个定位为「skill manager」的产品来说，看不到技能正文是当前最大的产品缺口。

后端其实早已返回正文：`skills.info` 的响应体 `SkillInfoSchema` 中带有 `content: z.string()` 与 `revision` 字段（见 `src/shared/contracts/skills.ts`）。而前端 `skill-detail.svelte` 当前的实现是把 `skill.content` 用一个 `<pre><code>` 原样塞进了一个等宽文本块，既不解析 frontmatter，也不渲染 markdown。所以这是一个纯 UI 层缺口，不动任何契约。

## What Changes

- 在技能详情面板新增 **SKILL.md 渲染预览**：frontmatter 作为只读元数据表（key-value）展示，正文用 markdown 渲染为格式化文档。
- 新增 **轻量编辑**能力：frontmatter 的 `name` / `description` 字段直接以行内输入框呈现；保存通过 `creator.save`（`mode: "update"` + `expectedRevision`）走 revision-safe 路径。此入口不打开正文编辑（正文编辑仍归 Creator App）。
- 适配 change 1（`chrometabs-shell`）的 Tab 化模型：每个 Workspace 在独立 Tab 中打开。
- **BREAKING**：Workspaces 路由改为 tab-scoped。home Tab = 技能位置索引（迁移自当前 `/workspace` 列表页），实例 Tab = 单个 Workspace + 单个 Provider 的技能列表 + 详情（迁移自当前 `/workspace/[id]` 页）。旧路由由 tab 化路由解析并重定向。
- 显示 **真实去重后的聚合技能数**：同一路径下被多个 Provider 共享的同一技能（如 `.agents/skills` 同时被 Cline / Dexto / Kimi / Loaf / Warp / Zed 等共享）在 Workspace 级 `skillCount` 中只计一次，避免「安装一次、显示 N 个」的误导。Provider 级计数保持原样。

## Capabilities

- 新增：`skill-content-preview` —— 在技能详情面板中渲染 `SKILL.md` 正文 + frontmatter 元数据，并提供行内轻量编辑入口。
- 改造：Workspaces App 适配 `chrometabs-shell`（依赖 change 1）的 Tab 集成，路由变 tab-scoped。

## Impact

- WebUI：`skill-detail.svelte` 组件新增预览面板与轻量编辑输入；Workspaces 页面拆分为 home Tab + instance Tab（消费 change 1 提供的 Tab 外壳与状态隔离层）。
- 后端：**无契约变更**。`skills.info` 已经返回 `content`，`creator.save` 已支持 `mode: "update"` + `expectedRevision`（见 `src/shared/contracts/creator.ts`）。本变更不触碰 oRPC 契约与 Zod schema。
- 投影层：去重后的聚合计数落在 `src/daemon/workspace-registry/projection.ts` 的 `projectWorkspaceSnapshot` / `projectImportedWorkspace` / `projectGlobalWorkspace` 中——`sumProviderCounts` 之外新增一个按 canonical path 去重的 Workspace 级计数路径。各 Provider 自己的 `skillCount` 不变。
- 安全不变量：revision-safe 保存仍受 `creator.save` 既有约束保护；loopback / token-in-fragment / containment 不变。
- 测试：新增预览渲染、轻量编辑 revision 冲突、去重计数三类测试；现有 store 测试因 Tab 化需适配（由 change 1 主导，本变更为 Workspaces 的具体接线）。
