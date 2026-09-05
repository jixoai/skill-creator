## ADDED Requirements

### Requirement: Shell 标准 MUST 提供声明式 RouteContract 类型与工厂

ChromeTabShell 标准 MUST 提供 `RouteContract` 接口（id + pattern + zod params/search + component + children）和 `defineRoute` / `defineActivity` / `defineApp` 工厂函数。工厂函数 MUST 在构造时自注册到 routeRegistry，并在 DEV 模式校验 id 命名规范与 pattern 合法性。类型参数（params/search）MUST 从 zod schema 自动推导，供 navigate API 和 hooks 消费。

#### Scenario: defineRoute 构造类型安全的路由节点

- **WHEN** 调用 `defineRoute({ id: "workspaces.provider", pattern: "/workspaces/:wsId/:providerId", params: z.object({...}), component: () => import(...) })`
- **THEN** 返回 `RouteContract<ZodObject, undefined>`，其 params 类型为 `z.infer<ZodObject>`
- **AND** 该 Route 自注册到 routeRegistry，absolutePattern 可供 navigate 使用

#### Scenario: defineApp 校验 entry activity

- **WHEN** 调用 `defineApp` 时 activities 中有 0 个或多个 entry
- **THEN** DEV 模式 MUST warn（0 个或多个 entry），运行时取首个 entry 的 pattern 作为入口路由

### Requirement: AppShell MUST 提供隔离容器与 portal 锚定

AppShell 组件 MUST 以 `isolation: isolate` 建立独立堆叠上下文，应用内 `position:fixed`/`z-*` MUST NOT 穿透到 Shell 层。AppShell MUST 内嵌 portal root 容器，bits-ui Portal 默认挂载于此而非 `document.body`。AppShell MUST 通过 `setPortalTarget` / `setAppContext` 向子组件下发上下文。

#### Scenario: 应用内浮层不逃逸到 body

- **WHEN** 应用内打开一个 bits-ui Dialog
- **THEN** Dialog MUST 渲染在 AppShell 的 portal root 内，而非 document.body
- **AND** Dialog 的 z-index MUST 受限于 AppShell 的 isolation 上下文

### Requirement: TabOutlet MUST 按 tab 身份常驻 DOM 保活

TabOutlet MUST 为每个已打开的 tab（app + instanceKey）渲染一个常驻的 AppShell 实例。切换 tab 时 MUST 仅切换 visibility（CSS），MUST NOT 卸载非激活 tab 的 DOM。激活 tab 由 URL 中的 app + instanceKey 决定。home tab（instanceKey="home"）MUST 始终存在且不可关闭。

#### Scenario: 切换 tab 保留 DOM 与状态

- **WHEN** 用户在 Workspaces tab 滚动到某位置后切换到 Creator tab，再切回 Workspaces
- **THEN** Workspaces 的 DOM MUST 未被卸载，scroll 位置和组件状态 MUST 保留

#### Scenario: home tab 不可关闭

- **WHEN** 用户尝试关闭某 App 的 home tab
- **THEN** 该操作 MUST 被拒绝（关闭按钮不渲染或 disabled）

### Requirement: URL MUST 是视图状态的唯一真相源

tab 身份（app + instanceKey）、选中项、筛选条件、子视图切换 MUST 全部编码在 URL 的 pathname 和 search params 中。URL 变化 MUST 驱动渲染，页面刷新 MUST 能恢复完整视图状态。前端 memory（`$state`）MUST NOT 承载这些状态。

#### Scenario: 刷新页面恢复视图状态

- **WHEN** 用户在 Workspaces 选中某技能并切换到 detail 子视图后刷新页面
- **THEN** URL 中的 `?skill=sk_xxx&view=detail` MUST 被解析，视图恢复到同一技能的 detail 子视图

#### Scenario: 深链直达特定 tab 和状态

- **WHEN** 从外部传入 URL `/creator/edit/ws_abc/claude-code/sk_xxx?subview=log`
- **THEN** MUST 打开 Creator App 的该 skill 编辑 tab，并定位到变更日志子视图

### Requirement: navigate API MUST 提供类型安全的导航

navigate API MUST 提供 `go(route, params)` 直接传 Route 单例（同 App 内，最强类型）和 `goById(routeId, params)` 字符串 id（跨 App 解耦）。API MUST 委托 NavController 修改 URL，MUST NOT 直接操作组件状态。`buildHref` / `targetById` MUST 能构造不触发导航的延迟目标。

#### Scenario: 跨 App 导航到特定路由

- **WHEN** 在 Workspaces 中点击「编辑此技能」
- **THEN** 调用 `goById("creator.edit", { wsId, providerId, skillId })` MUST 导航到 Creator 编辑 tab
- **AND** 如果该 tab 已存在（同 instanceKey），MUST 聚焦而非新开

### Requirement: hooks MUST 以 getter + $derived 模型提供响应式数据

`useParams<T>()` / `useSearch<T>()` MUST 返回 getter 函数（非快照值），调用方在组件内用 `$derived` 包装以建立响应式追踪。这确保 URL 变化时组件正确响应。hooks MUST 在 AppShell 上下文内调用，否则返回 undefined 或抛错。

#### Scenario: URL search 变化驱动组件响应

- **WHEN** URL 的 `?q=search` 变为 `?q=filter`，组件用 `const q = $derived(getSearch()?.q)`
- **THEN** q MUST 响应式更新为新值，组件重新渲染

### Requirement: 状态分层 MUST 严格遵循三层约定

视图状态 MUST 编码在 URL（pathname + search）。持久和共享状态 MUST 通过 daemon RPC（oRPC + WebSocket）读写。设备偏好（theme/sidebar/窗口尺寸）MUST 存储在 localStorage，经 `device-prefs.ts` 统一管理（schema versioned + safeParse）。前端 memory（`$state`）MUST 仅用于临时表单草稿和瞬时 UI 状态。MUST NOT 把业务状态或视图状态存入 localStorage 或散落的全局 `$state` 单例。

#### Scenario: 设备偏好经 device-prefs 统一管理

- **WHEN** 用户切换 theme 为 dark
- **THEN** device-prefs MUST 写入 localStorage（schema versioned），incompatible 旧数据 MUST 按默认值加载（不迁移不报错）

#### Scenario: 业务状态不经 localStorage

- **WHEN** workspace 列表或技能列表需要展示
- **THEN** 数据 MUST 来自 daemon RPC 实时获取，MUST NOT 从 localStorage 读取缓存

### Requirement: SvelteKit 路由 MUST 弱化为 SPA fallback

SvelteKit 文件路由 MUST 仅保留 `+layout.svelte` 作为 Shell 挂载点和 SPA fallback。`ssr = false`、`prerender = false`。所有产品路由 MUST 由 Shell RouteContract 驱动，MUST NOT 使用 SvelteKit 的 `+page.svelte` 文件路由。

#### Scenario: SvelteKit 仅承载 Shell

- **WHEN** 构建应用
- **THEN** `webui/src/routes/` 下 MUST 仅剩 `+layout.svelte`（挂载 Shell）和 `+layout.ts`（ssr/prerender 配置），所有产品页面 MUST 在 Shell 路由系统内声明
