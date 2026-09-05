# Tasks: repository-discover

> 依赖：change 0（`chrometabshell-standard`）+ change 1（`chrometabs-shell`）提供 Shell 标准 + Repository App manifest；change 2（`workspaces-skill-preview`）提供 Workspaces 技能高亮语义（URL `?skill=...`）。可独立先行：Task 1 / 2（catalog + 持久化 + RPC）。Gating 依赖 change 0 / 1 / 2：Task 3 / 4 / 5 / 6（Tab 接线与跳转）。

## 1. Curated source catalog

- [x] 1.1 新增 `src/shared/curated-sources.ts`：导出 `CuratedSourceEntry` 接口与 `CURATED_SOURCES` 静态只读数组（`{ id, label, gitUrl, description, homepage? }`）。文件顶部按文件意图法维护正交意图（catalog 快照 / 浏览器安全），形态对齐 `src/shared/provider-catalog.ts`。
- [x] 1.2 初始精选源至少收录 `vercel-labs/skills`、`anthropics/skills` 与若干社区仓库；每条 `gitUrl` 为 https 形态。
- [x] 1.3 新增单元测试：`CURATED_SOURCES` 条目字段非空、`id` 唯一、`gitUrl` 全部 https。
- [x] **Verify**: `pnpm check`（test + typecheck + webui check + fmt）。

## 2. User source persistence + RPC（daemon `sources.json`，不写 localStorage）

- [x] 2.1 新增 `src/shared/contracts/repository.ts` 中的 `SourcesFileSchema`（`{ version: 1, sources: [...] }`）与 `UserSourceSchema`、`AddUserSourceInputSchema`、`RemoveUserSourceInputSchema`。`gitUrl` 仅 https、长度受限。
- [x] 2.2 新增 daemon 模块 `src/daemon/source-registry.ts`：读写 `appDir()/sources.json`（**daemon 侧持久化，不写 localStorage**），读路径 `unknown → safeParse`，schema 不兼容按空值加载（破坏性更新策略）；写路径 server-owned，复用 `path-safety.ts` containment check；用户源 id 加 `user_` 前缀与 curated 命名空间隔离。
- [x] 2.3 在 `src/shared/rpc-contract.ts` 的 `repository` 下新增 `sources.list` / `sources.add` / `sources.remove` 三个 RPC；`sources.list` 返回 `{ builtIn: CuratedSourceEntry[], user: UserSource[] }`。浏览器永远经 RPC 读写，不直接读盘、不缓存到前端 memory 跨渲染周期。
- [x] 2.4 daemon 侧 RPC handler 接线：`sources.add` 校验失败即拒绝（不写盘）；`sources.remove` 拒绝内置源 id。
- [x] 2.5 新增 daemon focused tests：增删查往返、schema 不兼容降级、内置源不可删、非法 URL 被拒、跨实例读写一致性（用 `setHomeOverride` 隔离）；断言 user sources 不写 localStorage。
- [x] **Verify**: `pnpm check` + daemon focused tests（`src/daemon/source-registry.test.ts`）。

## 3. Repository home Tab（Discover grid + search + recent，源数据来自 RPC）

- [x] 3.1 **[gating: 需 change 0/1 落地]** 在 Repository App manifest（change 1 声明的 home activity `/repository`）下新增 home 视图；旧路由 `/repository` 由 Shell 路由层重定向节点映射到 home activity。
- [x] 3.2 home Tab 顶部搜索框（按 label/description 过滤当前投影的源列表，纯客户端过滤，不发远程请求）。未提交文本是组件局部 `$state`；提交后可作为 URL search param `?q=<filter>` 保留视图状态。
- [x] 3.3 渲染源卡片网格：curated ∪ user 合并展示，curated 标内置徽标、user 标用户徽标 + 删除按钮。**卡片数据来自 `repository.sources.list` RPC**（返回 `{ builtIn, user }`），不缓存在前端 memory 跨渲染周期、不写 localStorage。
- [x] 3.4 "最近扫描"区：列出本会话已打开过的 Repository 实例 Tab（按打开时间倒序），点击 `navigate.go` 聚焦对应 Tab。
- [x] 3.5 桌面（OpenTray appMode）+ 窄屏（`max-[720px]` 断点，沿用 change 1 下拉选择器）视觉验证：搜索框、卡片网格、最近扫描在两种形态下排版正确。
- [x] **Verify**: `pnpm check` + 桌面/窄屏视觉验证。

## 4. Source card component（扫描元数据来自 daemon session，scan trigger）

- [x] 4.1 新增 `webui/src/lib/components/source-card.svelte`：展示 label、description、内置/用户徽标、扫描元数据（skill 数 / commit 摘要，来自 daemon scan session）、删除按钮（仅用户源）、"Scan" 按钮。
- [x] 4.2 扫描元数据来自 daemon scan session（`repository.scan` / `repository.preview` RPC 按需拉取），**不缓存在前端 memory 跨渲染周期、不写 localStorage**；从未扫描显示 "Not scanned yet"，过时显示刷新 hint（不自动扫描）。
- [x] 4.3 "Scan" 按钮触发 `navigate.go` 打开实例 Tab（Task 5）并自动用该源 `gitUrl` 首扫；重复扫描同源聚焦已有实例 Tab。
- [x] 4.4 删除按钮触发 `repository.sources.remove` RPC，成功后重新拉取 `repository.sources.list` 刷新网格。
- [x] 4.5 桌面 + 窄屏视觉验证：卡片在窄屏单列堆叠、徽标与按钮可触达。
- [x] **Verify**: `pnpm check` + 桌面/窄屏视觉验证。

## 5. Scan Tab 适配（视图状态 → URL，scan session daemon-owned）

- [x] 5.1 把现有 `webui/src/routes/repository/+page.svelte` 的扫描 + 预览 + 多目标安装三件套迁移到 Repository App 的扫描 activity 路由 `/repository/scan/<source-id-or-session>`（change 1 声明）。
- [x] 5.2 实例 Tab 不再渲染顶部 Git URL 输入框（源已由 home Tab 卡片确定）；首扫用源 `gitUrl` 自动触发。
- [x] 5.3 scan session daemon-owned：浏览器按需拉取 `repository.scan` / `repository.preview` RPC，**不缓存到前端 memory 跨渲染周期**；请求代次门在组件内 per-call 构造，组件卸载即 GC。
- [x] 5.4 **选中待安装的 skills 编码到 URL search param** `?selected=rsk_1,rsk_2,...`（视图状态真相源，刷新可恢复）；若选中列表超 URL 长度，转 daemon session（URL 只存 sessionId 引用）。**安装目标选择（targets 表单）编码到 URL search param** `?targets=<encoded>` 或组件级 `$state`（表单输入），提交时走 `repository.install` RPC。
- [x] 5.5 保留窄屏（`max-[650px]`，沿用现有 container query）显式切换技能列表与快照预览、返回路径。
- [x] 5.6 桌面 + 窄屏视觉验证：扫描中、扫描完成空技能、扫描完成多技能、安装中四种态。
- [x] **Verify**: `pnpm check` + 桌面/窄屏视觉验证 + 状态分层 focused tests（视图状态 URL 化 + scan session 不缓存到前端 memory）。

## 6. 安装后跳转到 Workspaces（cross-App Tab focus + highlight via URL）

- [x] 6.1 在安装结果摘要（`InstallSummarySchema`，`kind: "result"`）旁新增 "View in Workspaces" 动作：单目标按钮 / 多目标下拉。
- [x] 6.2 跳转信息全部从既有 `InstallSummarySchema` 响应推导（`targets` + installed/overwritten 条目的 `target`/`skillId`）；**不改 RPC 契约**。
- [x] 6.3 点击触发 cross-App Tab 动作（change 0/1 的 `navigate.goById`）：计算目标 Workspaces instanceKey `{workspaceId}/{providerId}`，已存在则聚焦，否则打开。
- [x] 6.4 通过 URL search param `?skill=<skillId>&highlight=1` 通知目标 Workspaces Tab 高亮 `skillId` 并滚动入视（对齐 change 2 技能选中语义——视图状态走 URL，不用 in-memory token）；高亮一次性。
- [x] 6.5 桌面 + 窄屏视觉验证：单目标跳转、多目标下拉选择跳转、目标 Tab 已打开 vs 需新建两种路径。
- [x] **Verify**: `pnpm check` + 桌面/窄屏视觉验证。

## 7. Repository 状态分层迁移（来自 change 0 / 1）

- [x] 7.1 配合 change 0/1 把 `webui/src/lib/stores/repository.svelte.ts` 的 `repositoryState`（模块级全局单例）拆解：视图状态（选中 skills / targets / 当前源）→ URL search params；持久态（scan session / install 记录 / sources）→ daemon RPC；不引入 TabScope。
- [x] 7.2 `scanRequests` / `previewRequests` / `installRequests` 三个请求代次门保持 per-call 构造（组件内），不再绑定 TabScope owner generation。
- [x] 7.3 daemon 连接与 workspace registry 投影保持全局共享；scan / preview / install 数据按需从 daemon RPC 拉取，不缓存到前端 memory 跨渲染周期。
- [x] 7.4 适配现有 Repository store 测试：从「import 全局对象」改为「视图状态来自 URL + 持久态来自 RPC mock」断言。
- [x] **Verify**: `pnpm check` + Repository store focused tests。

## 8. Tests（源持久化、Discover 渲染、跳转、状态分层）

- [x] 8.1 源持久化：daemon `source-registry.test.ts` 覆盖增删查往返、schema 不兼容降级、内置源不可删、非法 URL 拒绝、`user_` 前缀命名空间隔离、user sources 不写 localStorage。
- [x] 8.2 Discover 渲染：home Tab 组件测试覆盖卡片网格渲染（curated ∪ user，数据来自 `repository.sources.list` RPC mock）、搜索过滤、扫描元数据展示（有数据 / 空态 / 过时 hint）、删除用户源。
- [x] 8.3 跳转：安装结果摘要测试覆盖单目标按钮、多目标下拉、跳转动作调用 `navigate.goById` 并通过 URL search param 传 highlight。
- [x] 8.4 集成：从 home Tab 点卡片 → 实例 Tab 首扫 → 多目标安装 → "View in Workspaces" 跳转的端到端流（RPC mock）。
- [x] 8.5 状态分层：选中 skills / targets 刷新可恢复（URL search params）；scan session / install 记录 / user sources 不缓存到前端 memory 跨渲染周期、不写 localStorage（mock RPC 计数）。
- [x] **Verify**: `pnpm check`（test + typecheck + webui check + fmt）。
