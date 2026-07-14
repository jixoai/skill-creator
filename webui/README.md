<!--
文件意图（2026-07-14）
用户原始需求摘录：「skills manager 只是路由的一部分(`/workspace/~/`)；支持导入 workspace；创造、编辑技能的路由(/creator)；以及 `/repository/`。二者是有机互联的。」
正交意图：1. 定义 WebUI 的三路由职责；2. 解释前端状态和共享契约；3. 记录开发与组件边界。
妥协声明：本文件是 WebUI package 的单一入口，三项都属于使用该 package 前不可缺少的上下文；产品细节已下沉到独立 route、store 与 component。
-->

# Skill Creator WebUI

`webui` 是 daemon 承载的 SvelteKit 静态 SPA，也是 OpenTray 窗口中的人机工作台。它不直接访问 Node.js 或文件系统，所有读取和 mutation 均通过共享 oRPC 契约进入 daemon。

```text
App shell
|-- Workspaces ---------------- /workspace registry index
|   `-- /workspace/[id]
|       |-- ~ ----------------- ccski default agent locations
|       `-- ws_<opaque-id> ---- imported directory
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

| Route             | 人的任务                                                                                | RPC module                       |
| ----------------- | --------------------------------------------------------------------------------------- | -------------------------------- |
| `/workspace`      | 浏览 Home/Imported Workspace，并在所有视口导入或移除 registry entry                     | `workspace`                      |
| `/workspace/[id]` | 扫描、搜索、查看、校验、启用或禁用当前 Workspace 的技能                                 | `skills`, `workspace`            |
| `/workspace/~/`   | 查看 ccski 默认 Agent 位置中的技能                                                      | `skills`                         |
| `/creator`        | 选择 Imported Workspace，创建或 revision-safe 编辑技能                                  | `creator`, `skills`, `workspace` |
| `/repository`     | 扫描 Git source，选择并预览固定 commit 中的技能，再 dry-run 或安装到 Imported Workspace | `repository`, `workspace`        |

Creator 与 Repository 只把 Imported Workspace 作为写入目标。`~` 是发现视图，不是这两个路由的目标目录。

## 前端结构

```text
webui/src/
|-- routes/
|   |-- +layout.svelte ---------------- workbench shell / connection lifecycle
|   |-- workspace/+page.svelte -------- registry index / import-remove recovery
|   |-- workspace/[id]/+page.svelte --- workspace scope
|   |-- workspace/[id]/+page.ts ------- route ID validation / redirect
|   |-- creator/+page.svelte ---------- create/edit surface
|   `-- repository/+page.svelte ------- scan/preview/install surface
|
|-- lib/
|   |-- rpc-client.ts ----------------- token capture + typed oRPC client
|   |-- store.svelte.ts --------------- public state facade
|   |-- stores/
|   |   |-- connection.svelte.ts ------ socket lifecycle
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

开发态由 Vite 把 `/ws/` 代理到随机端口 daemon；release 由 daemon 同源提供静态 SPA 与 WebSocket。组件不持有文件输出路径，后续 mutation 使用 Workspace ID、Skill ID 或 Repository Session ID。

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
