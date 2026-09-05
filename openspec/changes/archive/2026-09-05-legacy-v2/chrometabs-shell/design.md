# Design: chrometabs-shell

## Context

Skill Creator 的 WebUI 目前是「左侧稳定导航 + 右侧单路由工作区」的扁平结构（见 `webui/src/routes/+layout.svelte` 与 `app-sidebar.svelte`）。三个 App（Workspaces / Creator / Repository）各自有独立的 SvelteKit 路由，状态由一组全局单例 store 承载：

- `webui/src/lib/stores/workspaces.svelte.ts` —— `workspaceState`（registry 投影、activeId、loading）。
- `webui/src/lib/stores/skills.svelte.ts` —— `skillsState`（当前 Provider 的技能列表、选中项、查询词）。
- `webui/src/lib/stores/repository.svelte.ts` —— `repositoryState`（scan / preview / install 投影）。
- `webui/src/lib/stores/creator.ts` —— 纯命令封装（save / load / remove），无自身可变状态。
- `webui/src/lib/stores/request-generation.ts` —— `createRequestGenerationGate(getConnectionGeneration)`，latest-wins 请求代次门，已是 per-call 构造。

现状的问题：这些 store 都是模块级全局单例，把「视图状态」（选中项 / 筛选 / 当前 target）和「持久 + 共享状态」（workspace registry 投影、技能列表数据）混在一起存在前端 memory 里。一次会话中只能存在一个「当前 workspace target」、一份 Creator 草稿、一个 repo scan session；刷新即丢失视图状态。

**本变更依赖 change 0 (`chrometabshell-standard`)**，后者已经建立了 `src/lib/shell/` 标准模块：`RouteContract`、`defineRoute` / `defineActivity` / `defineApp`、`AppShell`、`TabOutlet`（tab 保活，按身份常驻 DOM）、`navigate`（`go` / `goById`）、`useParams` / `useSearch` hooks、`device-prefs.ts`（localStorage 统一入口）。本变更**不再自建 TabScope / tab-registry / tab-bar**，而是：

1. 在 Shell 标准之上声明三个 App 的 manifest（`defineApp`）。
2. 把现有 store 按**状态分层原则**拆解到 URL / daemon RPC / localStorage / 组件 `$state` 四层。

依赖方向（遵循 AGENTS.md）：`shared contracts < domain < transport < entry`。本变更只动 WebUI 层 + 可能新增少量 daemon RPC（把原存前端 memory 的持久态下沉），不触既有 oRPC 契约的安全不变量。

## 状态分层原则（来自 config.yaml，2026-07-27）

```
状态类型          │ 存储位置              │ 示例
─────────────────┼──────────────────────┼──────────────────────────
视图状态          │ URL pathname+search  │ tab身份/选中skill/筛选词/子视图
持久+共享状态     │ daemon RPC (oRPC+WS) │ workspace registry/安装记录/
                 │                       │ ACP会话/扫描会话/lock文件
设备偏好          │ localStorage         │ theme/sidebar折叠/窗口尺寸偏好
临时表单          │ 组件级 $state        │ Creator草稿输入/搜索框未提交文本
瞬时UI            │ 组件级 $state        │ dropdown开关/loading态/toast
```

禁止：把业务状态存在 localStorage；把视图状态存散落的 `$state` 全局单例；把业务数据缓存在前端 memory 超出单次渲染周期。

## Goals

- 在 change 0 的 Shell 标准之上声明三个 App 的 manifest（Workspaces / Creator / Repository），各自通过 `defineApp` 注册 entry home activity + 实例 activity。
- URL 是视图状态唯一真相源：tab 身份、选中项、筛选、子视图全部编码在 URL（pathname + search params），刷新可恢复。
- 现有 store 按状态分层拆解，消除「视图状态 + 持久态混在前端单例」的问题。
- 复用 change 0 的 tab 保活（`TabOutlet`），切换 App / Tab 不卸载 DOM、不丢上下文。
- 旧路由（`/workspace` / `/creator` / `/repository` / `/workspace/[id]`）由 Shell 路由层重定向节点映射，不抛 404。

## Non-Goals

- 自建 Shell 标准 / tab-registry / TabScope（归 change 0）。
- 跨 App 的 Tab 拖拽（不支持把 Workspaces 的 Tab 拖进 Creator）。
- Tab 跨 daemon 重启的持久化（关闭应用即丢 Tab 栈，不在 sessionStorage / localStorage 之外持久化）。
- Tab 钉选 / 重排序 / 拖拽排序。

## Decisions

### 架构（基于 change 0 的 Shell 标准）

```text
┌──────────────┬──────────────────────────────────────────────┐
│ Left Nav     │ Tab Bar (change 0: tab stack per App)        │
│ • Workspaces │ [home] [ws_myproj] [~]          [+] [×]      │
│ • Creator    ├──────────────────────────────────────────────┤
│ • Repository │ TabOutlet (change 0: per-tabId 常驻 DOM)      │
│              │ ┌──────────────────────────────────────────┐ │
│              │ │ AppShell(app, activity, location)         │ │
│              │ │   └ ActivityRouter → active tab content   │ │
│              │ └──────────────────────────────────────────┘ │
└──────────────┴──────────────────────────────────────────────┘

Tab 身份与视图状态全部来自 URL（change 0 navController 解析）。
```

### D1. 三个 App 的 manifest（基于 change 0 `defineApp`）

每个 App 以 `defineApp` 声明，entry activity = home Tab，其它 activity = 实例 Tab。pattern + zod params/search 定义在 manifest 里。

```text
workspaces/manifest.ts:
  defineApp({
    id: "workspaces",
    activities: [
      { pattern: "/workspaces",                 entry: true, ... },   // home
      { pattern: "/workspaces/:wsId/:provId",   ... },                // instance
    ],
  })

creator/manifest.ts:
  defineApp({
    id: "creator",
    activities: [
      { pattern: "/creator",                                          entry: true, ... },
      { pattern: "/creator/new/:provId",                              ... },  // 新建
      { pattern: "/creator/edit/:wsId/:provId/:skillId",              ... },  // 编辑
    ],
  })

repository/manifest.ts:
  defineApp({
    id: "repository",
    activities: [
      { pattern: "/repository",                       entry: true, ... },
      { pattern: "/repository/scan/:sourceIdOrSession", ... },
    ],
  })
```

实例 Tab 的 instanceKey 由 path params 派生（Workspaces 用 `wsId:provId`；Creator 用 `wsId:provId:skillId` 或 `new:provId`；Repository 用 `sourceIdOrSession`）。同一 instanceKey 在一个 App 内唯一——再次打开等价于聚焦（change 0 的 navController 已实现该唯一性）。

### D2. 视图状态 → URL（唯一真相源）

所有视图状态编码到 URL search params，刷新可恢复，组件用 `useSearch<T>()` getter + `$derived` 读：

```text
App           pathname                                   search params (示例)
─────────────┼──────────────────────────────────────────┼──────────────────────────────
Workspaces    /workspaces/:wsId/:provId                  q=<filter>&skill=<selectedSkillId>&view=list|detail
Creator       /creator/edit/:wsId/:provId/:skillId       subview=file|log|preview|validate|test
Repository    /repository/scan/:sourceIdOrSession        selected=rsk_1,rsk_2&targets=<encoded>
```

- 切换 Tab、选中技能、改筛选词、切子视图 = 改 URL；`navigate.go` / `navigate.goById` 推 URL。
- 组件用 `useSearch` 的 getter + `$derived` 拿响应式视图状态；不再从全局 `$state` 单例读。
- 深链：直接访问完整 URL（含 search）即可恢复到精确的 tab + 选中 + 子视图状态。

### D3. 持久 + 共享状态 → daemon RPC（URL-as-truth 模型）

把原本被前端 memory 缓存、但其实属于「持久 + 共享」的数据明确下沉到 daemon RPC（已有或新增）。前端是「按需 RPC + 渲染」的视图层，不在 memory 里跨渲染周期缓存：

```
数据                  来源 RPC                                         说明
─────────────────────┼────────────────────────────────────────────────┴──────────────────────────────
workspace registry    workspace.list / workspace.info                  daemon 持久，前端按需拉取
技能列表              skills.list                                       daemon 投影，不缓存在前端
技能正文/revision     skills.info                                       详情视图按需拉取
scan session          repository.scan / repository.preview             pinned-clone，daemon 持有
install 记录          repository.install                                daemon 写盘
ACP session           acp.session.open + WS push (sessionUpdate)        daemon 持有，浏览器仅渲染
skills lock           skills.update.check / skills.update.apply         daemon 读写，前端仅触发
creator revision 日志 creator.revisions                                  daemon 持久
```

实时更新（如 ACP `sessionUpdate`、install 完成）走 WS 推送；UI 收到推送后重新触发对应 RPC 拉取最新投影，而非在前端 memory 里增量维护。

### D4. 设备偏好 → localStorage（change 0 `device-prefs.ts`）

theme / sidebar 折叠 / 窗口尺寸偏好统一走 change 0 的 `device-prefs.ts`（schema versioned、`safeParse` 兜底）。本变更迁移现有散落的 localStorage key 进该统一入口；**禁止**把业务状态（tab 栈、选中项、技能列表）写 localStorage。

### D5. 临时表单 / 瞬时 UI → 组件级 `$state`

- Creator 草稿（未保存正文输入）→ 编辑器组件局部 `$state`，保存时通过 `creator.save` RPC 落盘。
- 搜索框未提交文本、dropdown 开关、loading 态、toast → 组件局部 `$state`。
- 关闭 Tab 时这些组件被卸载，临时态自然消失；不需要 `dispose()` 主动清理（与旧 TabScope 模型不同）。

### D6. Svelte 5 runes 选择（无全局可变 store）

- 视图状态：通过 change 0 的 `useParams<T>()` / `useSearch<T>()` 拿 getter，调用方用 `$derived` 包装。**不引入新的全局 `$state`。**
- 各 App 的 Tab 栈视图：`$derived`，从 change 0 的 `routeRegistry` / `appRegistry` 派生（按 app 过滤已打开的 tab 身份）。
- 当前激活 Tab：`$derived`，从 URL（`page.url`）派生——URL 与 UI 单一事实源（change 0 navController 已提供）。
- 请求代次门（`createRequestGenerationGate`）保持 per-call；在组件内构造，组件卸载即被 GC，无需 TabScope.dispose。

### D7. 旧路由重定向节点

在 Shell RouteContract 树里加重定向节点（change 0 的 navigate 支持内部重定向）：

```text
旧路由                  →  新 URL（Shell 路由）
/workspace                 /workspaces                       (home)
/workspace/[id]            /workspaces/<wsId>/<provId>       (instance，从 registry 解析 id)
/creator                   /creator                          (home)
/repository               /repository                       (home)
/workspace/~/              /workspaces                       (home)
```

本项目默认破坏性更新（AGENTS.md），但仍保证入口可解析、不抛 404。

## Risks

- **现有 store 拆解是本次最大成本。** 三个 store 文件 + 消费者都直接 `import { workspaceState }`。**缓解**：按状态分层逐字段拆——视图字段（activeId / selectedSkill / query）迁 URL search params；持久字段（registry 列表 / 技能列表）改为按需 RPC 拉取 + WS 推送刷新；store 内部的请求代次门、latest-wins 判定逻辑保持不变（只是从模块级单例改为组件内构造）。
- **Creator 的 dirty draft 语义**：草稿现在在编辑器组件局部 `$state`，关闭 Tab 即丢。**缓解**：Creator 实例 Tab 关闭前走 dirty-check 提示（与现有未保存提示同一套），未确认不卸载。
- **URL 长度限制**：复杂筛选（如 Repository 多选技能）可能超长。**缓解**：search params 保持扁平 key-value；大量数据（如 Repository 一次选几十个技能）若超 URL 长度，转 daemon session（URL 只存 sessionId）——本规则与 change 0 D6 一致。
- **旧路由兼容**：用户书签可能仍指向 `/workspace/[id]`。**缓解**：Shell 路由层重定向节点把旧路径映射到新 URL 模型。
- **窄屏 Tab 栏可用性**：窄屏下水平 Tab 栈挤占内容。**缓解**：窄屏（沿用现有 `max-[720px]` 断点）把 Tab 栏收成下拉选择器（change 0 的 AppShell / TabOutlet 已为窄屏预留 visibility 切换钩子）。
