## Context

Skill Creator 当前的 WebUI 是三个扁平 SvelteKit 路由页，状态散落在全局 `$state` 单例。产品方向是 ChromeTabs 多 tab 应用，每个 App（Workspaces/Creator/Repository）拥有独立 tab 栈，tab 间并行不丢上下文。

参考 gaubee.com 的 GaubeeOS 标准（iPadOS 心智：App → Activity → Route），我们建立精简版 **ChromeTabShell 标准**。与 GaubeeOS 的差异：不需要 VFS/widget/CLI/desktop/content-pipeline，只需要路由 + tab 保活 + 应用注册 + 导航。Skill Creator 的持久状态在 daemon（GaubeeOS 的状态在 Worker 后端），架构同构。

## Goals / Non-Goals

**Goals:**

- 建立可复用的 Shell 标准模块，三个 App 以 manifest 声明接入
- URL 作为视图状态真相源：tab 身份、选中、筛选、子视图全部可从 URL 恢复
- Tab 保活：切换 tab 不卸载 DOM，scroll/state 保留
- 类型安全路由：zod schema 驱动 params/search 类型推导
- 状态分层清晰：URL / daemon RPC / localStorage(device prefs) / memory(临时表单)

**Non-Goals:**

- GaubeeOS 的 VFS / widget / CLI / desktop / content-pipeline（不需要）
- 跨 App tab 拖拽 / tab pinning / tab 持久化跨 daemon 重启
- 应用安装/卸载市场（三个 App 是内置固定的，不做动态安装）

## Decisions

### D1: 模块结构（精简 GaubeeOS）

```
webui/src/lib/shell/
├── contract.ts          RouteContract 类型（id/pattern/params/search/component/children）
├── define-route.ts      defineRoute 工厂（类型推导 + 自注册 routeRegistry）
├── define-activity.ts   defineActivity 工厂（绝对 pattern + Route 树）
├── define-app.ts        defineApp 工厂（manifest 校验：恰好一个 entry activity）
├── match.ts             matchRouteTree 纯函数（pathname → matched chain）
├── path-pattern.ts      compilePattern / stringifyPattern（:param 编译）
├── search.ts            stringifySearch / parseSearch（zod coerce）
├── registry.ts          routeRegistry + appRegistry 单例
├── navigate.ts          go / goById / buildHref / targetById（委托 navController）
├── hooks.svelte.ts      useRoute / useParams / useSearch（getter + $derived 模型）
├── AppShell.svelte      隔离容器（isolation:isolate + portal root + ActivityRouter）
├── ActivityRouter.svelte  Route 树渲染（按 RouteId 缓存组件，应用内保活）
├── TabOutlet.svelte     按 tabId 常驻 DOM（visibility 切换，双层模型）
├── nav-controller.svelte.ts  单 URL → tab 身份 + area 编码（黑盒状态机）
├── portal-context.svelte.ts  setPortalTarget / setAppContext / useApp
├── device-prefs.ts      localStorage 统一入口（theme/sidebar 等，schema versioned）
└── __tests__/           route 匹配 / navigate / hooks / path-pattern 单测
```

### D2: URL 编码模型（视图状态真相源）

```
URL 结构: /<app>/<instanceKey>/<route-segment>?<search>

示例:
  /workspaces/home                          ← Workspaces 首页 tab（固定）
  /workspaces/ws_abc123/claude-code?        ← Workspaces 实例 tab
    q=search&skill=sk_xxx&view=detail
  /creator/home                             ← Creator 首页 tab（固定）
  /creator/new/claude-code?template=basic   ← Creator 新建 tab
  /creator/edit/ws_abc/claude-code/sk_xxx?  ← Creator 编辑 tab
    subview=log
  /repository/home                          ← Repository 首页 tab（固定）
  /repository/scan/repo_xxx?selected=rsk_1  ← Repository 扫描 tab

tab 身份 = {app, instanceKey}
  - home 是保留 instanceKey（每个 App 一个固定首页 tab，不可关闭）
  - 实例 tab 的 instanceKey 由打开动作派生（workspaceId / skillId / sessionId）
  - 同 instanceKey 的 tab 只存在一个（聚焦而非新开）
```

### D3: Tab 保活双层模型（借鉴 GaubeeOS AreaOutlet）

```
TabOutlet 渲染模型
┌─────────────────────────────────────────────┐
│  所有已打开的 tab 常驻 DOM（按 app+instanceKey）│
│                                             │
│  {#each openTabs as tab}                    │
│    <div class:tab-hidden={tab !== active}> │ ← visibility 切换，不卸载
│      <AppShell app={tab.app}                │
│                activity={tab.activity}      │
│                location={tab.location} />   │
│    </div>                                   │
│  {/each}                                    │
│                                             │
│  激活 tab = URL 中的 app+instanceKey        │
│  切换 tab = 改 URL → navController 重算 →   │
│            visibility 重新分配              │
└─────────────────────────────────────────────┘
```

### D4: 状态分层强制约定

```
状态类型          │ 存储位置              │ 示例
─────────────────┼──────────────────────┼──────────────────────────
视图状态 (URL)    │ URL pathname+search  │ tab身份/选中skill/筛选词/子视图
持久+共享状态     │ daemon RPC (oRPC+WS) │ workspace registry/安装记录/
                 │                       │ ACP会话/扫描会话/lock文件
设备偏好          │ localStorage         │ theme/sidebar折叠/窗口尺寸偏好
临时表单          │ 组件级 $state        │ Creator草稿输入/搜索框未提交文本
瞬时UI            │ 组件级 $state        │ dropdown开关/loading态/toast
```

禁止：

- 把 tab 栈/选中项/筛选条件存在 `$state` 全局单例或 localStorage
- 把业务数据（workspace列表/技能列表）缓存在前端 memory 超出单次渲染周期
- 前端直接读写文件系统（必须经 daemon RPC）

### D5: navigate API + hooks（类型安全导航）

```ts
// 同 App 内：直接传 Route 单例（最强类型）
go(workspaceDetailRoute, { wsId: "ws_abc", providerId: "claude-code" });

// 跨 App：字符串 RouteId（解耦）
goById("creator.edit", { wsId: "ws_abc", providerId: "claude-code", skillId: "sk_xxx" });

// 组件内读取（getter + $derived 响应式）
const getParams = useParams<{ wsId: string; providerId: string }>();
const wsId = $derived(getParams()?.wsId);
const getSearch = useSearch<{ q?: string; view?: "list" | "detail" }>();
const query = $derived(getSearch()?.q ?? "");
```

### D6: 三个 App 的 manifest 声明

```ts
// webui/src/apps/workspaces/manifest.ts
defineApp({
  id: "workspaces",
  name: "Workspaces",
  icon: IconFolders,
  activities: [
    defineActivity({
      pattern: "/workspaces", // home tab
      entry: true,
      root: leafRoute({ component: () => import("./WorkspacesHome.svelte") }),
    }),
    defineActivity({
      pattern: "/workspaces/:wsId/:providerId", // 实例 tab
      root: defineRoute({
        id: "workspaces.provider",
        pattern: "",
        params: z.object({ wsId: WorkspaceIdSchema, providerId: ProviderIdSchema }),
        search: z.object({
          q: z.string().optional(),
          skill: SkillIdSchema.optional(),
          view: z.enum(["list", "detail"]).optional(),
        }),
        component: () => import("./ProviderView.svelte"),
      }),
    }),
  ],
});
```

### D7: device-prefs 统一管理

```ts
// webui/src/lib/shell/device-prefs.ts
// schema versioned, safeParse, graceful degradation
const DevicePrefsSchema = z.object({
  version: z.literal(1),
  theme: z.enum(["light", "dark", "system"]).default("system"),
  sidebarCollapsed: z.boolean().default(false),
});
// 读写 localStorage，incompatible → 默认值（不迁移不报错）
```

## Risks / Trade-offs

- **SvelteKit 路由弱化**：SvelteKit 的文件路由被 Shell 路由取代，仅保留 `+layout.svelte` 作 SPA fallback + Shell 挂载点。失去 SvelteKit 的预渲染/SEO 能力——但 Skill Creator 是本地工具应用，不需要 SEO。
- **Shell 标准的开发成本**：建立完整标准模块（含单测）约相当于一个中型 feature。Mitigate：精简到只含必需部分（7 个核心文件），参考 GaubeeOS 成熟实现。
- **store 迁移工作量**：现有 4 个全局 store 的状态要拆分到 URL/RPC/memory 三层。Mitigate：分阶段——先建 Shell + 迁 Workspaces，验证模式后再迁其余。
- **URL 长度限制**：复杂筛选条件可能超出 URL 长度。Mitigate：search params 保持扁平 key-value，大量数据走 RPC session（URL 只存 sessionId）。
