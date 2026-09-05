## Why

当前 WebUI 是三个扁平路由页（`/workspace`、`/creator`、`/repository`），状态散落在全局 `$state` 单例 store 里。这种结构无法支撑产品的 ChromeTabs 愿景：每个 App 需要独立 tab 栈、tab 间并行工作不丢上下文、频繁跳转保留状态。

更根本的问题是**缺少应用框架标准**。参考 gaubee.com 的 GaubeeOS（iPadOS 心智模型），我们需要建立一套独立的 **ChromeTabShell 标准**——声明式路由契约 + App manifest + tab 保活 + 类型安全导航——作为三个 App（Workspaces/Creator/Repository）及未来扩展的统一基座。

同时确立**状态分层原则**：URL 是视图状态真相源，daemon 是持久/共享状态真相源，localStorage 仅存设备偏好。消除当前状态散落在前端单例的问题。

## What Changes

- 新建 `src/lib/shell/` 独立标准模块，精简实现 GaubeeOS 核心（不含 VFS/widget/CLI/desktop 等不需要的）：
  - `RouteContract`：声明式路由节点（id + pattern + zod params/search + component + children）
  - `defineRoute` / `defineActivity` / `defineApp`：类型安全工厂 + 运行时自注册
  - `AppShell`：隔离容器（isolation:isolate）+ portal 锚定 + ActivityRouter
  - `TabOutlet`：按 tabId 常驻 DOM 保活，visibility 切换不卸载
  - `navigate` API：`go(route, params)` / `goById(routeId, params)`
  - `hooks`：`useParams<T>()` / `useSearch<T>()` 返回 getter，调用方 `$derived` 包装
- **BREAKING**：现有 SvelteKit 文件路由（`webui/src/routes/`）替换为 Shell 路由模型；SvelteKit 仅承载 SPA fallback + Shell 挂载点
- **BREAKING**：现有全局 `$state` store（workspaceState/skillsState/repositoryState）解构，视图状态迁入 URL，持久状态迁入 daemon RPC
- 三个 App 以 manifest 声明接入（Workspaces / Creator / Repository），各自定义 activities + routes
- URL 编码 tab 身份：`/<app>?tab=<instanceKey>&...` 或路径段 `/<app>/<instanceKey>/...`

## Capabilities

### New Capabilities

- `chrometabshell-standard`: ChromeTabShell 应用框架标准——RouteContract + AppShell + Tab保活 + 类型安全导航 + 状态分层约定，作为所有 App 的统一基座

### Modified Capabilities

（无现有 spec，此为首版标准）

## Impact

- 新增 `webui/src/lib/shell/` 模块（route-contract / define-route / app-shell / tab-outlet / navigate / hooks / nav-controller）
- **BREAKING** 重写 `webui/src/routes/`：SvelteKit `+layout.svelte` 挂载 Shell，`+page.svelte` 移除，路由由 Shell RouteContract 驱动
- 现有 store 拆分：视图状态（选中/筛选/子视图）→ URL search params；持久状态 → 已有 daemon RPC；临时表单 → 组件级 `$state`
- `localStorage` 仅保留设备偏好（theme、sidebar 折叠），新增 `device-prefs.ts` 统一管理
- 参考：`/Users/kzf/Dev/GitHub/gaubee.com/src/lib/{app-scaffold,router,apps,nav}`
- 测试：Shell 标准自身单测（route 匹配、navigate、hooks）+ 三个 App 接入集成测试
