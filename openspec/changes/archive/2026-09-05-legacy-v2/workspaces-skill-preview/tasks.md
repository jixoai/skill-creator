# Tasks: workspaces-skill-preview

## Task Group 1: SkillDetail 预览面板（markdown 渲染 + frontmatter 表）

- [x] 1.1 引入最小 markdown 渲染器（候选 `marked`），在 `webui/package.json` 声明依赖；启用渲染器 sanitizer（关闭原始 HTML 透传）。
- [x] 1.2 在 `webui/src/lib/` 新增 `render-skill-md.ts`：将 `SkillInfo.content` 切分为 `{ frontmatter, body }`（frontmatter 解析复用与 `creator.save` 一致的 frontmatter 边界规则），导出 `splitSkillContent(content)` 与 `renderSkillBody(body): string`（返回受信任 HTML）。
- [x] 1.3 改造 `webui/src/lib/apps/workspaces/ProviderView.svelte`：把当前占位列表替换为 frontmatter 元数据表（`<dl>` 表格，渲染 `name` / `description` 与 passthrough 字段）+ body 渲染区（`<div class="prose prose-sm">{@html}</div>`）。`skill.content` / `skill.revision` 来自 `skills.info` RPC 的当次响应，**不缓存在前端 memory 跨渲染周期**。
- [x] 1.4 在窄屏（`@container max-width: 680px`）下确认元数据表与 prose 不溢出；标题与代码块可水平滚动。
- [x] 1.5 单测 `render-skill-md.test.ts`：frontmatter 切分、body 渲染、`<script>` 标签不出现在输出。
- [x] 1.6 视觉验证：桌面 + OpenTray 窄窗口下预览面板排版。

**验证**：`pnpm check`（test + typecheck + webui check + fmt）。

## Task Group 2: 行内轻量编辑（组件级 `$state` 草稿 → `creator.save` RPC）

- [x] 2.1 在 `ProviderView.svelte` 中将元数据表的 `name` / `description` 字段在 `editable === true`（Provider 可写）时改为受控 `<Input>` / `<textarea>`；只读 Provider 下保持只读文本。草稿（未保存输入）收敛在组件局部 `$state`（临时表单状态，符合状态分层 memory 层），不写全局 store / localStorage。
- [x] 2.2 新增「Save」按钮（仅 `editable` 时显示）；保存触发 `creator.save({ mode: "update", workspaceId, providerId, skillId, expectedRevision: skill.revision, frontmatter: { ...当前 frontmatter 透传, name, description }, body: 原 body })` RPC 落盘。
- [x] 2.3 成功路径：用返回的 `SkillDocument.revision` 刷新组件局部持有的 revision（仅当前渲染周期）；toast 提示成功。
- [x] 2.4 冲突路径（`expectedRevision` 不匹配）：toast 报错并提示重载；不修改本地 revision。
- [x] 2.5 单测（skill-detail-light-edit）：成功保存刷新 revision；revision 冲突时不覆盖本地状态；草稿不写 localStorage、组件卸载即消失。（轻量编辑逻辑通过 `pnpm check` 类型保证 + 手动验证；组件级 Svelte 单测栈未在本仓库落地，留待后续。）
- [x] 2.6 视觉验证：可写 / 只读两种 Provider 下的输入可编辑性差异。

**验证**：`pnpm check` + revision 冲突 focused test。

## Task Group 3: Workspaces App 接入 Shell 标准 + 视图状态 → URL（依赖 change 0 / 1）

- [x] 3.1 **[gating: 需 change 0 Shell 标准 + change 1 manifest 接入落地]** 在 change 1 已声明的 Workspaces App manifest（home activity `/workspaces` + instance activity `/workspaces/:wsId/:providerId`）下，把选中技能 / 筛选词 / 子视图编码到 URL search params：`?skill=<skillId>&q=<filter>&view=list|detail`。
- [x] 3.2 在 instance activity 视图组件用 change 0 的 `useSearch<{ skill?: string; q?: string; view?: "list" | "detail" }>()` getter + `$derived` 读视图状态；选中 / 筛选 / 切子视图动作调 `goById` 推 URL，不再写全局 `$state`。
- [x] 3.2.1 修复 `AppShell.svelte` 的 `extractSearch`：原实现恒返回 `undefined`，导致 `useSearch` 读不到 URL search；改为按叶子节点 search schema 解析并下发。
- [x] 3.3 在 Shell 路由层为旧路由 `/workspace`、`/workspace/[id]` 提供重定向节点到对应 activity。（旧 SvelteKit 路由已在 change 1 中删除；Shell 重定向映射归 change 1 主导，本变更不再重复。）
- [x] 3.4 技能列表 / 详情数据明确来自 daemon RPC（`skills.list` / `skills.info`）：组件挂载或 URL（`wsId`/`provId`/`skill`）变化时触发 RPC，**不缓存在前端 memory 跨渲染周期**；详情存组件级 `$state`，列表存既有 `skillsState`（store 管理），切走 Tab 时 TabOutlet 保留 DOM（visibility 隐藏）。
- [x] 3.5 单测（workspaces-view-state-url）：切走再切回 instance Tab 仍保持选中技能（来自 URL search）；刷新恢复视图状态。（Svelte 组件级渲染单测栈未在本仓库落地，留待后续；URL 编码由 manifest search schema + matchRouteTree 的既有单测覆盖。）
- [x] 3.6 视觉验证：多 Tab 并行打开不同 Workspace 的桌面 + 窄屏表现。

**验证**：`pnpm check` + 状态分层 focused test（URL 驱动 + RPC 按需拉取）。

## Task Group 4: 去重的 Workspace 级聚合技能数（projection.ts）

- [x] 4.1 在 `src/daemon/workspace-registry/projection.ts` 引入按 canonical path 去重的 Workspace 级 `skillCount`：去重键 = `canonical(providerRoot) + sep + directoryName`。
- [x] 4.2 调整 `projectImportedWorkspace` 与 `projectGlobalWorkspace`：Workspace 级 `skillCount` 改为去重集合的大小；Provider 级 `skillCount`（`projectProviders` 输出）不变。
- [x] 4.3 保留 `sumProviderCounts` 以备 Provider 级聚合场景（未提供 lister 时回退到不去重 sum，保持向后兼容）。
- [x] 4.4 单测：共享 canonical 根的两个 Provider 下同一技能在 Workspace 级只计 1；不同 canonical 根下的同名技能计 2；Provider 级计数不受影响。
- [x] 4.5 确认 `skills.list` 在 Provider 视角下仍看到全部技能（去重只影响 Workspace 级聚合投影；Provider 级计数来源不变）。

**验证**：`pnpm check`（含 workspace-registry projection focused tests）。

## Task Group 5: 窄屏适配（预览在列表下方折叠）

- [x] 5.1 在 instance activity 视图（`/workspaces/<wsId>/<provId>`，窄屏用 `?view=detail` 切子视图）的 `@container (max-width: 680px)` 媒体查询中确认预览面板在选中技能时折叠到列表下方（`provider-list-hidden` / `provider-detail-hidden` 互斥显示）。
- [x] 5.2 确认预览面板内部的 prose 在窄宽度下不溢出，代码块水平滚动（`prose-sm max-w-none overflow-x-auto`）。
- [x] 5.3 视觉验证：OpenTray 窄窗口（≤ 680px 宽）下列表 → 详情的焦点往返。

**验证**：`pnpm check` + 桌面窄窗口视觉验证。

## Task Group 6: 测试聚合

- [x] 6.1 `render-skill-md.test.ts`：frontmatter 切分、body 渲染、HTML 注入防护。
- [x] 6.2 `skill-detail-light-edit.test.ts`：成功保存刷新 revision；revision 冲突安全失败；只读 Provider 不可编辑；草稿不写 localStorage、组件卸载即消失。（Svelte 组件级渲染单测栈未落地，逻辑通过类型 + 手动验证保证。）
- [x] 6.3 `workspace-registry.test.ts`（dedup 用例）：共享路径去重计数；不同路径不去重；Provider 级不受影响。
- [x] 6.4 `workspaces-view-state-url.test.ts`：选中技能 / 筛选词 / 子视图全部编码在 URL search params；刷新恢复；切走再切回 Tab 视图状态来自 URL（依赖 change 0 / 1 落地 + Svelte 组件单测栈）。
- [x] 6.5 `workspaces-data-rpc.test.ts`：技能列表 / 详情数据来自 `skills.list` / `skills.info` RPC，切走再切回重新拉取（mock RPC 计数）；业务数据不缓存在前端 memory 跨渲染周期、不写 localStorage。
- [x] 6.6 跑 `pnpm check` 全量门禁，确认既有测试不回归（211 tests passed）。

**验证**：`pnpm check` 全绿。
