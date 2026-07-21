<!--
文件意图（2026-07-19）
用户原始需求摘录：「skills manager 只是路由的一部分(`/workspace/~/`)；支持导入 workspace；创造、编辑技能的路由(/creator)；以及 `/repository/`。二者是有机互联的。」；[2026-07-19]「走 appMode:true 模式。所以走原生的窗口管理。」；[2026-07-21]「`skill-creator stop` 找不到 daemon，但 `pnpm dev` 又说已有 daemon 持有 socket。」；[2026-07-22]「home 目录定义为特殊的 GlobalWorkspace；一个 Workspace 下可以包含多个 providers；下载到某个 Workspace.provider，且能多选。」
正交意图：1. 定义 WebUI 的三路由职责；2. 解释前端状态和共享契约；3. 记录开发与组件边界；4. 承载品牌门面图（color-symbol，经 `../resources/` 相对路径引用）。
妥协声明：本文件是 WebUI package 的单一入口，三项都属于使用该 package 前不可缺少的上下文；产品细节已下沉到独立 route、store 与 component。
-->

<p align="center">
  <img src="../resources/color-symbol.png" alt="Skill Creator" width="120" />
</p>

<h1 align="center">Skill Creator WebUI</h1>

`webui` 是 daemon 承载的 SvelteKit 静态 SPA，也是 OpenTray 窗口中的人机工作台。它不直接访问 Node.js 或文件系统，所有读取和 mutation 均通过共享 oRPC 契约进入 daemon。

WebUI 只在路由变化时确保窗口达到对应的最小推荐尺寸，不缩小操作者已有的更大窗口；不控制原生窗口透明度、焦点、层级或 blur 关闭，这些生命周期由 App Mode 原生窗口负责。

```text
App shell
|-- Workspaces ---------------- /workspace registry index
|   `-- /workspace/[id]
|       |-- ~ ----------------- Global Workspace / Agent provider roots
|       `-- ws_<opaque-id> ---- imported directory / provider roots
|-- Creator ------------------- /creator
`-- Repository ---------------- /repository

route/component
      |
      v
domain store --> typed oRPC client --> WebSocket --> daemon
                    ^
                    `-- src/shared/rpc-contract.ts
```

## 路由职责

| Route             | 人的任务                                                                                          | RPC module                       |
| ----------------- | ------------------------------------------------------------------------------------------------- | -------------------------------- |
| `/workspace`      | 浏览 Global/Imported Workspace，并在所有视口导入或移除 registry entry                             | `workspace`                      |
| `/workspace/[id]` | 选择当前 Workspace 的 Provider，再扫描、搜索、查看、校验、启用或禁用该 Provider 的技能            | `skills`, `workspace`            |
| `/workspace/~/`   | 查看 Global Workspace 中各 Agent Provider 的全局技能                                              | `skills`                         |
| `/creator`        | 无 query 新建，或由 workspace+provider 定位新建/编辑目标                                          | `creator`, `skills`, `workspace` |
| `/repository`     | 扫描并预览固定 commit，多选 Imported Workspace.Provider 安装，再以本地 Skill ID 衔接 Creator 复核 | `repository`, `workspace`        |

Creator 与 Repository 只把 Imported Workspace.Provider 作为写入目标。`~` 是 Global Workspace 的发现/管理视图，不是这两个路由的目标目录。

```text
Creator route load
  no query --------------------> blank draft
  workspace + provider --------> explicit create scope
  workspace + provider + skill -> explicit edit scope
  skill-only / invalid IDs ----> redirect /creator

Repository result
  installed / overwritten -----> workspaceId + providerId + daemon-signed local skillId
                                      |
                                      +-- one ---> direct Review installed
                                      `-- many --> review menu
                                                    |
                                                    `--> /creator?workspace=...&provider=...&skill=...
```

## 前端结构

```text
webui/src/
|-- routes/
|   |-- +layout.svelte ---------------- workbench shell / connection lifecycle
|   |-- workspace/+page.svelte -------- registry index / import-remove recovery
|   |-- workspace/[id]/+page.svelte --- workspace scope
|   |-- workspace/[id]/+page.ts ------- route ID validation / redirect
|   |-- creator/+page.svelte ---------- create/edit surface
|   |-- creator/+page.ts -------------- query identity validation / redirect
|   `-- repository/+page.svelte ------- scan/preview/install surface
|
|-- lib/
|   |-- rpc-client.ts ----------------- token capture + typed oRPC client
|   |-- store.svelte.ts --------------- public state facade
|   |-- stores/
|   |   |-- connection.svelte.ts ------ socket lifecycle
|   |   |-- request-generation.ts ----- latest-request-wins commit capability
|   |   |-- workspaces.svelte.ts ------ registry projection
|   |   |-- skills.svelte.ts ---------- scoped list/detail/toggle
|   |   |-- creator.ts ---------------- document/revision state
|   |   `-- repository.svelte.ts ------ pinned scan session state
|   |-- components/ ------------------- product components
|   `-- components/ui/ ---------------- shadcn-svelte registry primitives
|
`-- app.html
```

`src/shared/contracts/*.ts` 与 `src/shared/rpc-contract.ts` 是 browser-safe 的协议单源。`webui/src/lib/types.ts` 仅 re-export 契约类型，不维护手写镜像。

## 连接与授权

```text
tray URL #token=<secret>
          |
          +--> sessionStorage (current tab)
          `--> hash removed through SvelteKit replaceState

session token --> ws(s)://same-origin/ws/rpc?token=...
                                      |
                                      `--> daemon validates before upgrade
```

开发态按以下顺序建立同源边界；release 由 daemon 同源提供静态 SPA 与 WebSocket。组件不持有文件输出路径，后续 mutation 使用 Workspace Provider Target、Skill ID 或 Repository Session ID。

```text
release production daemon
  -> release previous development daemon
  -> wait for each PID + IPC endpoint
allocate daemon port
  -> mount /api/ Connect proxy
  -> mount /ws/ upgrade proxy
  -> Vite/SvelteKit SPA fallback
  -> HTTP listening
  -> spawn daemon
```

## 异步状态

```text
request N -- capture request generation + RPC owner --> await RPC
request N+1 / scope reset ------------------------------ invalidates N
RPC client replacement ------------------------------ changes owner
                                                              |
                                                              +-- isLatest
                                                              |      `--> loading cleanup
                                                              `-- isCurrent
                                                                     `--> data/error/follow-up commit
```

Workspace、Skills 与 Repository store 的读取和 mutation 各自持有代次门，互不共享取消域。Workspace list 明确返回 `loaded`、`superseded`、`failed`；Creator 在同一路由和连接仍有效时重试被 Layout 并发请求 supersede 的初始化，不能把尚未提交的空投影误判为显式 Workspace 不存在。Creator 再用 route key 与 document 代次隔离同路由 query 切换；取消选择、断线或组件销毁会主动撤销旧响应的提交资格。失效 mutation 返回无结果，不能让旧请求在新连接上继续 refresh、toast 或导航；断线重连不清空已经接纳的 dirty draft。

## 开发

依赖由根 workspace 一次安装：

```bash
pnpm install
```

从仓库根目录启动完整开发环境：

```bash
pnpm dev
```

只验证 WebUI：

```bash
pnpm --dir webui check
pnpm --dir webui build
```

完整验证与 stage 由根脚本负责：

```bash
pnpm check
pnpm build
```

## UI 边界

- Svelte 5 + SvelteKit static adapter。
- Tailwind CSS v4；页面和工具面板优先使用 grid、container query 与稳定尺寸。
- shadcn-svelte / bits-ui 提供行为原语，Lucide 提供图标，`tailwind-scrollbar` 提供一致的紧凑滚动条。
- `webui/src/lib/components/ui/**` 是 registry 工具生成的物理隔离区。不要在其中加入会被 registry 更新覆盖的手工意图头；产品语义、组合和场景定制放在 `components/` 或 route 中。
- WebUI 可以为人的操作密度聚合场景代码，但不能绕过共享契约或复制 daemon 的路径判定。
- 窄屏的 Creator 与 Repository 使用单屏列表/详情切换，进入后聚焦语义标题，返回后恢复原触发项；可见操作或其关联 label 命中区至少 `44px`。
