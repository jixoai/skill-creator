# Capability: chrometabs-shell

在 change 0 (`chrometabshell-standard`) 定义的 Shell 标准之上，声明 Workspaces / Creator / Repository 三个 App 的 manifest，并把现有全局单例 store 迁移到状态分层模型（URL / daemon RPC / localStorage / 组件 `$state`）。

## ADDED Requirements

### Requirement: 三个 App 以 manifest 声明接入 Shell 标准

Workspaces / Creator / Repository 三个 App MUST 各自通过 change 0 的 `defineApp` 声明 manifest，注册 entry home activity 与实例 activity；Shell 标准（change 0）MUST 承担 tab 管理、tab 保活、URL 解析与导航，本变更 MUST NOT 自建 `TabScope` / tab-registry / tab-bar。

#### Scenario: 三个 App manifest 注册成功

- **WHEN** 应用启动并挂载 change 0 的 AppShell
- **THEN** Workspaces / Creator / Repository 三个 App 各自的 `manifest.ts` 通过 `defineApp` 自注册到 `appRegistry`
- **AND** 每个 App 恰好声明一个 `entry: true` 的 home activity（pattern 为 `/<app>`）
- **AND** 实例 activity（如 `/workspaces/:wsId/:provId`、`/creator/edit/:wsId/:provId/:skillId`、`/repository/scan/:sourceIdOrSession`）通过 `defineActivity` 声明，zod params/search 校验就绪
- **AND** 本变更不引入 `src/lib/tabs/` 或 `TabScope` 类型（tab 管理全部委托 change 0 的 `TabOutlet` + `navController`）

#### Scenario: 切换 App 切换 Tab 栈

- **WHEN** 用户在左侧导航点击 Creator
- **THEN** URL 切到 `/creator/...`，change 0 的 navController 重算激活 Tab
- **AND** TabOutlet 把 Workspaces Tab 的 visibility 切为 hidden（DOM 不卸载，scroll/草稿保留）
- **AND** Creator App 的当前激活 Tab（或其 home Tab）被切为 visible
- **AND** 切回 Workspaces 时原 Tab DOM 与视图状态（来自 URL）完整恢复

### Requirement: 视图状态编码到 URL 作为唯一真相源

tab 身份、选中项、筛选词、子视图切换 MUST 全部编码在 URL（pathname + search params）；组件 MUST 通过 change 0 的 `useParams` / `useSearch` 读取视图状态，MUST NOT 从全局 `$state` 单例读视图状态。

#### Scenario: 刷新恢复 tab + 视图状态

- **WHEN** 用户在 Workspaces 实例 Tab 选中技能 `sk_xxx`、筛选词为 `auth`、视图为 detail，对应 URL 为 `/workspaces/ws_abc/claude-code?skill=sk_xxx&q=auth&view=detail`
- **AND** 用户刷新浏览器
- **THEN** 应用从 URL 恢复到同一 tab 身份、同一选中技能、同一筛选词、同一 detail 视图
- **AND** 组件用 `useSearch` 的 getter + `$derived` 拿到这些值，不读任何全局 `$state`

#### Scenario: 切换子视图更新 URL

- **WHEN** 用户在 Creator 编辑 Tab 点击「日志」子视图（当前 URL 为 `/creator/edit/ws_abc/claude-code/sk_xxx?subview=file`）
- **THEN** URL 更新为 `?subview=log`（通过 `navigate.go`）
- **AND** 子视图组件 `$derived` 自 `useSearch`，自动切到日志视图
- **AND** 浏览器历史可后退到 `subview=file`

### Requirement: 持久 + 共享状态走 daemon RPC，不在前端 memory 跨渲染缓存

workspace registry、技能列表、技能正文、scan session、install 记录、ACP session、lock 文件、revision 日志等持久 + 共享状态 MUST 通过 daemon RPC（oRPC + WS）读写；前端 MUST NOT 在 memory 里跨渲染周期缓存这些数据，MUST NOT 把业务状态写入 localStorage。

#### Scenario: 技能列表从 daemon RPC 拉取

- **WHEN** Workspaces 实例 Tab 渲染技能列表
- **THEN** 数据来自 `skills.list` RPC 调用（或 WS 推送后重新拉取），不在前端全局 `$state` 里缓存跨渲染
- **AND** 切走再切回该 Tab 时，组件重新发起 RPC 拉取（或消费 WS 推送的最新投影）
- **AND** 技能列表数据不被写入 localStorage

#### Scenario: ACP session 更新经 WS 推送

- **WHEN** daemon 侧 ACP session 收到 agent 的 `sessionUpdate`（message_chunk / tool_call / plan）
- **THEN** daemon 通过 WS 推送该更新到浏览器
- **AND** 浏览器组件渲染该更新，不把会话历史缓存在前端全局 memory
- **AND** 重新打开同一 sessionId 的 Tab 时，浏览器重新从 daemon 拉取 / 订阅会话状态

### Requirement: 设备偏好走 localStorage，临时表单走组件 `$state`

theme、sidebar 折叠、窗口尺寸等设备偏好 MUST 通过 change 0 的 `device-prefs.ts` 统一管理 localStorage（schema versioned、`safeParse` 兜底）；Creator 草稿、未提交搜索文本、dropdown 开关等临时 / 瞬时 UI 状态 MUST 收敛在组件局部 `$state`，MUST NOT 写入全局单例或 localStorage。

#### Scenario: 设备偏好统一入口

- **WHEN** 用户切换 theme 或折叠 sidebar
- **THEN** 偏好写入 change 0 的 `device-prefs.ts`（versioned schema，`safeParse` 兜底）
- **AND** 业务状态（tab 栈 / 选中项 / 技能列表）不被写入 localStorage
- **AND** schema 不兼容时按默认值加载，不报错

#### Scenario: 临时草稿随组件卸载消失

- **WHEN** 用户在 Creator 编辑器组件输入未保存正文（局部 `$state`），然后关闭该 Tab
- **THEN** 编辑器组件被卸载，草稿 `$state` 被 GC
- **AND** 关闭前若草稿未保存，触发 dirty-check 提示（与现有未保存提示同一套），未确认不卸载
- **AND** 同一技能再次打开时从 daemon RPC（`creator.load` / `skills.info`）拉取最新已保存正文，不恢复旧草稿

### Requirement: Home Tab 恒在且不可关闭

每个 App 的 Tab 栈 MUST 包含一个固定 home Tab（其 activity 标 `entry: true`，instanceKey 为保留值 `home`），且该 home Tab MUST NOT 被用户关闭。

#### Scenario: 首次进入某 App 只有 home Tab

- **WHEN** 用户首次切换到一个尚未打开过任何实例 Tab 的 App
- **THEN** 该 App 的 Tab 栈中只显示 home Tab
- **AND** home Tab 上不渲染关闭按钮（`×`）

#### Scenario: 尝试关闭 home Tab 被拒绝

- **WHEN** 通过任何途径（键盘、点击、程序调用）尝试关闭 home Tab
- **THEN** 操作被忽略，home Tab 仍保留
- **AND** Tab 栈中始终至少存在 home Tab

#### Scenario: 关闭最后一个实例 Tab 回到 home

- **WHEN** 用户关闭某 App 的最后一个实例 Tab
- **THEN** URL 切回 `/<app>`，激活 Tab 变为 home Tab
- **AND** TabOutlet 把 home Tab 切为 visible
- **AND** 该 App 的 Tab 栈中此时仅剩 home Tab

### Requirement: 打开实例即创建或聚焦 Tab

打开一个 workspace / skill / repo 实例时，MUST 通过 `navigate.go` / `goById` 把对应实例 URL 推到地址栏；change 0 的 navController MUST 按 instanceKey 唯一性创建或聚焦 Tab，避免重复 Tab。

#### Scenario: 首次打开某实例创建 Tab

- **WHEN** 用户打开一个尚未在当前 App Tab 栈中的实例（如 Workspaces 中点击 `ws_myproj`）
- **THEN** 调 `navigate.go(workspaceInstanceRoute, { wsId, provId })` 推 URL
- **AND** change 0 的 navController 为该 instanceKey 创建新 Tab，TabOutlet 常驻其 DOM
- **AND** 新 Tab 被激活，URL 为 `/workspaces/<wsId>/<provId>?...`

#### Scenario: 重复打开已存在实例聚焦而非新建

- **WHEN** 用户再次打开一个 instanceKey 已存在于当前 App Tab 栈的实例
- **THEN** 不创建新 Tab，而是聚焦已存在的那个 Tab
- **AND** URL 更新为该 Tab 的 instanceKey，视图状态从 URL search params 恢复

### Requirement: 旧路由重定向到 Shell 路由

旧路由（`/workspace`、`/creator`、`/repository`、`/workspace/[id]`、`/workspace/~/`）MUST 由 Shell RouteContract 树的重定向节点映射到新 URL 模型，MUST NOT 抛 404。

#### Scenario: 旧路由根重定向到 home Tab

- **WHEN** 用户访问 `/workspace`
- **THEN** 应用将其内部重定向到 `/workspaces`（Workspaces home Tab）
- **AND** 不抛 404

#### Scenario: 旧路由带 id 重定向到实例 Tab

- **WHEN** 用户访问 `/workspace/ws_myproj`
- **THEN** 应用从 workspace registry 解析 `ws_myproj` 得到 `{wsId, provId}`，重定向到 `/workspaces/<wsId>/<provId>`
- **AND** 若该 Tab 尚未在栈中，navController 按需创建后聚焦
- **AND** 不抛 404

### Requirement: 窄屏 Tab 栏收成下拉选择器

在窄屏（沿用现有 `max-[720px]` 断点）下，Tab 栏 MUST 收成下拉选择器，避免横向挤占内容区。

#### Scenario: 窄屏渲染下拉选择器

- **WHEN** 视口宽度小于或等于 720px
- **THEN** ChromeTabs 栏被替换为一个下拉选择器，列出当前 App Tab 栈的全部 Tab
- **AND** 选择器默认显示当前激活 Tab 的标识
- **AND** 用户可从下拉中切换 Tab，行为与宽屏点击 Tab 一致（推 URL）

#### Scenario: 窄屏下实例 Tab 仍可关闭

- **WHEN** 在窄屏下拉选择器中聚焦某实例 Tab
- **THEN** 该实例 Tab 可通过选择器旁的关闭操作被关闭（home Tab 仍不可关闭）
- **AND** 关闭后下拉选择器激活项回到上一个 Tab 或 home Tab
