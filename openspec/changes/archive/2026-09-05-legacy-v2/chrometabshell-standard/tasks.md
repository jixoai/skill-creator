## 1. Shell 核心类型与工厂

- [x] 1.1 实现 `contract.ts`：RouteContract 接口（id/pattern/params/search/component/children）+ ErasedRouteContract
- [x] 1.2 实现 `define-route.ts`：defineRoute 工厂（类型推导 + DEV 校验 + 自注册 routeRegistry）
- [x] 1.3 实现 `define-activity.ts`：defineActivity 工厂（绝对 pattern + registerActivityRoot 回填）
- [x] 1.4 实现 `define-app.ts`：defineApp 工厂（manifest 校验：entry activity 恰好一个）
- [x] 1.5 实现 `registry.ts`：routeRegistry + appRegistry 单例（register/get/list）
- [x] 1.6 单测：defineRoute 类型推导、DEV 校验、自注册行为
- [x] 1.7 验证：`pnpm check`

## 2. 路由匹配与路径编译

- [x] 2.1 实现 `path-pattern.ts`：compilePattern（:param 编译）+ stringifyPattern（params→path）
- [x] 2.2 实现 `match.ts`：matchRouteTree 纯函数（pathname + Route 树 → matched chain | no-match）
- [x] 2.3 实现 `search.ts`：stringifySearch + parseSearch（zod coerce，扁平 key-value）
- [x] 2.4 单测：path-pattern（:param 替换/编码）、match（嵌套树/最长前缀/no-match）、search（序列化/反序列化）
- [x] 2.5 验证：`pnpm check`

## 3. 导航与 hooks

- [x] 3.1 实现 `navigate.ts`：go / goById / buildHref / targetById（委托 NavControllerAdapter）
- [x] 3.2 实现 NavControllerAdapter 接口 + 注入点（setNavControllerAdapter）
- [x] 3.3 实现 `hooks.svelte.ts`：useRoute / useParams / useSearch / useActivity（getter + $derived 模型）
- [x] 3.4 实现 `portal-context.svelte.ts`：setPortalTarget / setAppContext / useApp
- [x] 3.5 单测：navigate（go/goById 委托）、hooks（getter 响应性、AppShell 外调用返回 undefined）
- [x] 3.6 验证：`pnpm check`

## 4. AppShell + ActivityRouter + TabOutlet

- [x] 4.1 实现 `AppShell.svelte`：isolation:isolate 容器 + portal root + ActivityRouter 挂载 + setAppContext
- [x] 4.2 实现 `ActivityRouter.svelte`：matchRouteTree 渲染 + 按 RouteId 缓存组件（应用内保活）
- [x] 4.3 实现 `nav-controller.svelte.ts`：单 URL → tab 身份 + area 编码（黑盒状态机，基于 $state + popstate）
- [x] 4.4 实现 `TabOutlet.svelte`：按 tab 常驻 DOM（{each openTabs} + visibility 切换）+ home tab 不可关闭
- [x] 4.5 单测：AppShell（isolation 上下文）、TabOutlet（保活不卸载、home 不可关闭）
- [x] 4.6 验证：`pnpm check` + 桌面视觉验证（tab 切换保留 scroll）

## 5. device-prefs 统一管理

- [x] 5.1 实现 `device-prefs.ts`：DevicePrefsSchema（versioned + zod）+ read/write localStorage + safeParse 降级
- [x] 5.2 迁移现有 theme / sidebar 折叠状态到 device-prefs
- [x] 5.3 单测：schema 兼容性（incompatible→默认值）、读写 round-trip
- [x] 5.4 验证：`pnpm check`

## 6. SvelteKit 路由弱化

- [x] 6.1 重写 `webui/src/routes/+layout.svelte`：仅挂载 Shell（TabOutlet + 左侧导航）+ daemon 连接初始化
- [x] 6.2 确认 `+layout.ts`：ssr=false, prerender=false, trailingSlash=ignore
- [x] 6.3 删除现有 `+page.svelte` / `[id]/+page.svelte` 等文件路由（产品路由迁入 Shell RouteContract）
- [x] 6.4 验证：`pnpm check` + `pnpm build`（SPA fallback 正确）

## 7. 集成验证

- [x] 7.1 用一个最小 App（如 Workspaces home only）验证 Shell 标准端到端：defineApp → AppShell → TabOutlet → navigate
- [x] 7.2 验证 URL 驱动：刷新恢复视图状态、深链直达
- [x] 7.3 验证 tab 保活：切换不卸载、scroll 保留
- [x] 7.4 验证状态分层：视图状态在 URL、业务数据走 RPC、设备偏好在 localStorage
- [x] 7.5 全量验证：`pnpm check` + `pnpm build` + 桌面+窄屏视觉验证
