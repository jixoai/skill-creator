# Proposal: chrometabs-shell

## Why

当前应用只有 3 条扁平路由（`/workspace`、`/creator`、`/repository`），用户在三者之间线性串行切换。但真实工作流要求频繁的并行上下文切换：在 Creator 中编辑技能时，用户想回头瞄一眼 Workspaces 里已有的同类技能；或是在 Repository 扫描仓库时，想中途切到某个 Workspaces 目录确认目标 Provider。扁平路由模型下，每一次导航都会丢失当前路由的状态（请求代次、草稿、选中项），用户被迫在每次切换后重新加载、重新输入、重新滚动定位。

ChromeTabs 模型让每个 App（Workspaces / Creator / Repository）各自拥有一个独立的 Tab 栈：左侧导航保持固定，右侧渲染每个 App 自己的 Tab 栏。这样用户可以在 Creator 里同时打开多个技能编辑 Tab，在 Workspaces 里并行查看多个 Workspace，切换 App 时 Tab 栈与状态都被保留，实现「无状态丢失」的并行工作。

**本变更依赖 change 0 (`chrometabshell-standard`) 定义的 Shell 标准**——`src/lib/shell/` 提供的 `RouteContract` / `defineApp` / `AppShell` / `TabOutlet`（tab 保活）/ `navigate` API / `useParams` + `useSearch` hooks 已经把 Tab 化外壳与 URL 驱动渲染建好。本变更不再「自建 Tab 管理层」，而是在该标准之上做**三个 App 的 manifest 声明接入 + 现有 store 按状态分层原则迁移**。

## What Changes

- 在 change 0 的 Shell 标准之上声明三个 App 的 manifest（Workspaces / Creator / Repository），各自通过 `defineApp` 注册 entry home activity + 实例 activity（pattern + zod params/search + component）。
- 三个 App 的视图状态严格编码到 URL（pathname 表 tab 身份，search params 表选中项 / 筛选词 / 子视图），刷新可恢复——URL 是视图状态的唯一真相源。
- 现有全局单例 store（`workspaceState` / `skillsState` / `repositoryState`）按**状态分层原则**拆解：
  - 视图状态（选中项 / 筛选 / 子视图 / tab 身份）→ URL search params；
  - 持久 + 共享状态（workspace registry / 安装记录 / lock 文件 / ACP session / 扫描 session）→ daemon RPC（已有或新增）；
  - 设备偏好（theme / sidebar 折叠）→ `localStorage`（change 0 的 `device-prefs.ts`）；
  - 临时表单草稿 / 瞬时 UI 态 → 组件级 `$state`。
- 复用 change 0 的 tab 保活（`TabOutlet` 按身份常驻 DOM，visibility 切换不卸载）实现「切换 App / Tab 不丢上下文」——本变更不再自建 `TabScope` 包装层。
- **BREAKING**：旧路由（`/workspace`、`/creator`、`/repository`、`/workspace/[id]`）由 Shell 路由层的重定向节点映射到新 URL 模型（根 → home Tab；带 id → 实例 Tab），保证不抛 404。
- Tab 在一次会话内持久：切换左侧 App 不会关闭该 App 的 Tab 栈；当某个 App 的全部实例 Tab 都被关闭后，自动回到该 App 的 home Tab。

## Capabilities

- 新增：`chrometabs-shell` —— 在 Shell 标准（change 0）之上声明三个 App manifest，并把现有 store 迁移到状态分层模型（URL / daemon RPC / localStorage / memory）。

## Impact

- WebUI：新增三个 App 的 `manifest.ts`（Workspaces / Creator / Repository），声明各自的 activities + RouteContract；路由从 SvelteKit 文件路由切换到 Shell `RouteContract`（change 0 主导）。
- 现有 store 按状态分层拆解：视图状态迁 URL，持久态走 daemon RPC（不变量层无新增），设备偏好走 `localStorage`，临时草稿走组件 `$state`。WebUI 不维护第二份 RPC 类型（从 `src/shared/contracts/` 推导）。
- **依赖 change 0 `chrometabshell-standard`** 落地（Shell 标准模块、RouteContract、defineApp、TabOutlet、navigate、hooks）。
- 测试：新增三个 App manifest 声明接入测试（home/实例活动声明、URL → 身份解析、刷新恢复）；现有 store 测试适配状态分层（视图状态断言改为从 URL 读，而非从全局单例读）。
