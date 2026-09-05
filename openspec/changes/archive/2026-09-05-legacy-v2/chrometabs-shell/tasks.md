# Tasks: chrometabs-shell

> 每个 task 必须可通过 `pnpm check`（test + typecheck + webui check + fmt）验证。涉及 UI 的 task 必须包含桌面 + 窄屏（`max-[720px]`）视觉验证。本变更依赖 change 0 (`chrometabshell-standard`) 落地：Shell 标准模块（`src/lib/shell/`）— `RouteContract` / `defineApp` / `AppShell` / `TabOutlet`（tab 保活）/ `navigate` / `useParams` + `useSearch` hooks — 必须先就绪。

## 1. App manifest 声明 + Shell 标准接入（基于 change 0）

- [x] 1.1 **[gating: 需 change 0 落地]** 在 `webui/src/apps/workspaces/manifest.ts` 用 `defineApp` 声明 Workspaces App：entry home activity（`pattern: "/workspaces"`）+ 实例 activity（`pattern: "/workspaces/:wsId/:provId"`），实例 activity 的 zod search 含 `q?` / `skill?` / `view?`。
- [x] 1.2 在 `webui/src/apps/creator/manifest.ts` 用 `defineApp` 声明 Creator App：home（`/creator`）+ 新建（`/creator/new/:provId`）+ 编辑（`/creator/edit/:wsId/:provId/:skillId`，search 含 `subview?`）。
- [x] 1.3 在 `webui/src/apps/repository/manifest.ts` 用 `defineApp` 声明 Repository App：home（`/repository`）+ 扫描（`/repository/scan/:sourceIdOrSession`，search 含 `selected?` / `targets?`）。
- [x] 1.4 在 `webui/src/routes/+layout.svelte` 挂载 change 0 的 `AppShell`（替换现有扁平 layout）；SvelteKit 仅承载 SPA fallback + Shell 挂载点，移除既有 `+page.svelte`。
- [x] 1.5 单测：三个 manifest 自注册到 `appRegistry`；每个 App 恰好一个 `entry: true` activity；实例 activity 的 zod params/search 类型推导可用。
- [x] 1.6 `pnpm check` 通过。

## 2. 视图状态 → URL（基于 change 0 hooks）

- [x] 2.1 把现有 store 中的视图字段（Workspaces 的 `selectedSkill` / `query` / `view`；Creator 的 `activeSubview`；Repository 的 `selectedSkillIds` / `targets`）迁到 URL search params，组件改用 `useParams<T>()` / `useSearch<T>()` 的 getter + `$derived` 读取。
- [x] 2.2 选中 / 筛选 / 子视图切换动作改走 `navigate.go(route, params)` 或 `navigate.goById(routeId, params)`，不再直接写 `$state`。
- [x] 2.3 单测：完整 URL（含 search）刷新后恢复到同一 tab + 选中 + 筛选 + 子视图；浏览器历史后退到上一个视图状态。
- [x] 2.4 桌面 + 窄屏视觉验证：URL 驱动的视图切换在两种形态下一致。
- [x] 2.5 `pnpm check` 通过。

## 3. 持久 + 共享状态 → daemon RPC（消除前端 memory 缓存）

- [x] 3.1 把 `workspaces.svelte.ts` / `skills.svelte.ts` / `repository.svelte.ts` 中跨渲染周期缓存的业务数据（registry 列表 / 技能列表 / 技能正文 / scan 投影 / install 投影）改为按需 RPC 拉取；组件挂载或 URL 变化时触发对应 RPC，不在全局 `$state` 里持有跨渲染副本。
- [x] 3.2 实时更新（ACP `sessionUpdate`、install 完成、scan 进度）经 WS 推送，UI 收到后重新拉取对应 RPC 投影（不在前端 memory 里增量维护）。
- [x] 3.3 删除全局单例中残留的业务状态字段；保留请求代次门（`createRequestGenerationGate`）但改为组件内 per-call 构造。
- [x] 3.4 单测：切走再切回 Tab 时组件重新发起 RPC（mock RPC 计数）；业务数据不被写入 localStorage。
- [x] 3.5 `pnpm check` 通过。

## 4. 设备偏好 → localStorage（change 0 `device-prefs.ts`）

- [x] 4.1 把现有散落在各组件的 localStorage 读写（theme、sidebar 折叠、窗口尺寸偏好）统一迁到 change 0 的 `device-prefs.ts`（versioned schema、`safeParse` 兜底）。
- [x] 4.2 确认业务状态（tab 栈 / 选中项 / 技能列表 / 草稿）不被写入 localStorage；如有残留写入，删除。
- [x] 4.3 单测：schema 不兼容时按默认值加载，不报错；设备偏好跨刷新保留。
- [x] 4.4 `pnpm check` 通过。

## 5. 临时表单 / 瞬时 UI → 组件级 `$state`

- [x] 5.1 把 Creator 草稿（未保存正文 / frontmatter 输入）、搜索框未提交文本、dropdown 开关、loading 态、toast 等收敛进对应组件的局部 `$state`，不再放全局单例。
- [x] 5.2 Creator 编辑 Tab 关闭前 dirty-check（与现有未保存提示同一套），未确认不卸载；卸载后草稿 `$state` 被 GC。
- [x] 5.3 单测：两个 Creator Tab 的草稿互不污染；关闭含未保存草稿的 Tab 触发确认；确认后草稿消失，重新打开同一技能时从 daemon RPC 拉取最新正文。
- [x] 5.4 `pnpm check` 通过。

## 6. 旧路由重定向节点

- [x] 6.1 在 Shell RouteContract 树里加重定向节点：`/workspace` → `/workspaces`；`/workspace/[id]` → `/workspaces/<wsId>/<provId>`（从 registry 解析 id）；`/creator` → `/creator`；`/repository` → `/repository`；`/workspace/~/` → `/workspaces`。
- [x] 6.2 单测：旧路由根重定向到 home Tab；带 id 旧路由重定向到实例 Tab；均不抛 404。
- [x] 6.3 `pnpm check` 通过。

## 7. 左侧导航集成（切换 App 切换 Tab 栈）

- [x] 7.1 改造 `app-sidebar.svelte`：点击 Workspaces / Creator / Repository 时调 `navigate.goById("<app>.home")` 推 URL 到该 App 的 home（或该 App 当前激活 Tab，若已有实例 Tab）。
- [x] 7.2 一级导航高亮规则改为 `$derived` 自 URL 的 app 段。
- [x] 7.3 「Imported」子区与「Import workspace」入口仍属 Workspaces App 上下文，切换 App 时不影响其它栈（TabOutlet visibility 隔离）。
- [x] 7.4 桌面 + 窄屏视觉验证（侧栏折叠与 Tab 栈切换互不干扰）。
- [x] 7.5 `pnpm check` 通过。

## 8. 窄屏 Tab 栏收成下拉选择器

- [x] 8.1 在 Tab 栏组件（change 0 AppShell 提供）用现有 `MediaQuery("(max-width: 720px)")` 判定窄屏；窄屏下用下拉选择器替换横向 Tab 栈，列出当前 App 全部 Tab。
- [x] 8.2 选择器默认显示当前激活 Tab 标识，切换行为与宽屏一致（推 URL）。
- [x] 8.3 窄屏下实例 Tab 仍可通过选择器旁的关闭操作关闭（home 不可关闭）。
- [x] 8.4 窄屏视觉验证。
- [x] 8.5 `pnpm check` 通过。

## 9. 测试

- [x] 9.1 App manifest 接入测试：三个 App 自注册；entry activity 唯一；实例 activity 类型推导。
- [x] 9.2 视图状态 URL 化测试：选中 / 筛选 / 子视图切换都更新 URL；刷新恢复；浏览器历史后退。
- [x] 9.3 状态分层测试：业务数据走 RPC 不进 memory 缓存；切走再切回重新拉取；业务状态不写 localStorage；临时草稿随组件卸载消失。
- [x] 9.4 深链测试：直接访问完整 URL（含 search）定位到正确 Tab + 视图状态；未在栈中时按需创建。
- [x] 9.5 旧路由重定向测试：`/workspace`、`/workspace/[id]`、`/workspace/~/` 等映射到 Shell 路由且不抛 404。
- [x] 9.6 窄屏下拉选择器行为测试。
- [x] 9.7 全量 `pnpm check` 通过。
