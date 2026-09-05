<!--
文件意图（2026-07-22）
用户原始需求摘录：
- 「参考 ../../pnpm-pub 这个项目的架构：cli+gui(webui+opentray)，基于 ../ccski 这个 sdk 来快速搭建一个 skills 管理器。」
- 「skills manager 只是路由的一部分(`/workspace/~/`)；我们还需要支持导入 workspace；创造、编辑技能的路由(/creator)；以及 `/repository/`。」
- [2026-07-22]「home 目录定义为特殊的 GlobalWorkspace；一个 Workspace 下可以包含多个 providers；下载到某个 Workspace.provider，且能多选。」
- 「继续迭代，大胆创新……以人为本，要让小白到各行各业到专业工程师用起来都舒心。」
- [2026-07-15]「按照你自己的节奏去推进开发迭代。」
- [2026-07-19]「我们已经不做 keepOnTop:true 的模式了。而是走 appMode:true 模式。所以走原生的窗口管理。」
- [2026-07-21]「我们默认是破坏性更新的……使用 zod 的 safeParse 来统一解决这个问题，遇到不兼容的就当是空值。」
- [2026-07-21]「任何外部输入都应该遵循这个规则：各种配置文件、数据库结构、网络返回等。」
- [2026-07-21]「`skill-creator stop` 找不到 daemon，但 `pnpm dev` 又说已有 daemon 持有 socket。」
- [2026-07-22]「同意，但是改成 `skill-creator openinbrowser`。」
正交意图：1. 定义产品边界；2. 给出真实安装与运行方式；3. 说明协议和安全模型；4. 提供开发验证入口；5. 承载品牌门面图（color-symbol）。
妥协声明：README 是包发布后唯一随包分发的公开入口，安装、运行、边界与安全事实必须同处一份文件，拆分会使发布包缺失必要上下文。品牌图经项目相对路径 `./resources/color-symbol.png` 引用，GitHub 自动渲染为 raw 链接；resources 不进 npm 包，npm 端图片缺失不影响文本可读性，repository 字段引导读者到 GitHub。
-->

<p align="center">
  <img src="./resources/color-symbol.png" alt="Skill Creator" width="180" />
</p>

<h1 align="center">Skill Creator</h1>

Skill Creator 是本地优先的 Agent 技能工作台。薄 CLI 管理单例 daemon，daemon 通过 OpenTray 承载 Svelte WebUI，并以 ccski SDK 发现、校验和安装 `SKILL.md` 技能；Workspace/Provider 投影、权限边界和跨路由体验属于 Skill Creator，而不是 ccski。

```text
                               Skill Creator

  Human
    |
    +-- CLI -------- versioned IPC --------+
    |                                      |
    +-- Tray WebUI -- authenticated oRPC --+--> Daemon --> filesystem / Git
                                                   |
                                                   +--> ccski
                                                   +--> OpenTray ext-webview

  /workspaces                /creator                /repository
  list / import/remove       create / edit           scan / preview / install
  discover / inspect         revision checked        one pinned Git commit
  validate / toggle          change log              curated + user sources
```

一级导航是 Workspaces、Creator、Repository 三个 App；WebUI 使用 ChromeTabs 式标签 Shell（`webui/src/lib/shell` + `webui/src/lib/apps`），URL 由 shell 内 route registry 解析，SvelteKit 侧只有一个 catch-all 承载点。

## 产品边界

| Surface                    | 责任                                                                                                          | 写入边界                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `/workspaces` home         | 索引 Global 与 Imported Workspace，提供导入与移除恢复入口                                                     | Remove Workspace 只删除 registry entry，不删除用户目录                                      |
| `/workspaces` provider tab | 在一个 Workspace 的 Provider 中发现、筛选、查看、校验、启用或禁用技能；对比上游检查并按需重装过时技能         | 每次操作显式携带 Workspace ID + Provider ID                                                 |
| Global Workspace（`~`）    | 聚合各 Agent 的全局 skills roots                                                                              | 可读/可管理现有技能，不作为 Creator 或 Repository 的写入目标                                |
| `/creator`                 | 在已导入 Workspace.Provider 中创建、加载、编辑和删除 `SKILL.md`；查看 change log；接入本机 ACP agent 辅助编写 | `workspace`+`provider` 预选新建；再加 `skill` 加载编辑；更新和删除需要内容 revision         |
| `/repository`              | 扫描 Git 仓库、预览技能、dry-run、多目标安装并复核结果；管理 curated 与自建 Discover 源                       | 扫描会话固定到一个 commit；可多选已导入 Workspace.Provider 写入目标；用户源仅 https Git URL |

Workspace 是技能作用域的第一层，Provider 是其中的 Agent skills root。Global Workspace（`~`）从社区 catalog 解析本机 Agent 全局目录；Imported Workspace 从其 canonical directory 派生每个 Provider 根目录。用户只在导入 Workspace 时提交目录路径；注册后，技能读写使用 daemon 验证的 `WorkspaceProviderTarget`、opaque Workspace ID 和 Skill ID，不由 WebUI 拼接输出路径。

Provider catalog 是 [vercel-labs/skills](https://github.com/vercel-labs/skills) `src/agents.ts` 的审阅快照，运行时位于 `src/shared/provider-catalog.ts`。本地研究检出说明见 [references/README.md](references/README.md)；它不是运行时或发布依赖。

```text
/creator
   |-- no query ----------------------------------- blank draft in the first writable Workspace.Provider
   |-- ?workspace=ws_*&provider=<provider> -------- blank draft in that Imported Workspace.Provider
   `-- ?workspace=ws_*&provider=<provider>&skill=sk_* -- revision-safe edit

skill without workspace / invalid ID ---- redirect to canonical /creator

Repository install
   `-- selected skills x selected Workspace.Provider targets
          -> daemon-verified local Skill IDs -> Review installed -> Creator edit
```

## 环境要求

- Node.js `>=20`
- Bun `>=1.3`（开发与构建脚本）
- pnpm `>=10`
- Git，可被当前进程通过 `git` 命令调用
- macOS、Windows（`arm64` / `x64`）或 Linux

macOS 与 Windows 使用 `@opentray/ext-webview` 承载原生应用窗口（`appMode: true` 进入任务栏/Dock 与应用切换器；窗口焦点、层级和关闭由系统管理）。Linux 上 `@opentray/ext-webview` 没有原生包，默认进入 **web 模式**：daemon 只挂载纯 opentray 通知栏图标（菜单 + 图标），WebUI 在系统浏览器中打开。任何平台都可用 `--web` / `--no-web` 显式覆盖。

## 安装与开发

根目录是 pnpm workspace，包含 `webui`。只需安装一次：

```bash
pnpm install
```

启动带 HMR 的 WebUI 与开发 daemon：

```bash
pnpm dev              # 默认（macOS/Windows 用原生窗口）
pnpm dev --web        # 强制 web 模式：纯 tray + 浏览器，无原生窗口
pnpm dev --no-web     # 强制 windowed 模式（覆盖 Linux 默认）
```

`pnpm dev` 由 `scripts/dev.sh.ts` 包装：它拦截 `--web` / `--no-web` 转成 `SKILL_CREATOR_WEB` env（vite 本身不容忍未知 flag），其余参数原样透传给 vite。Vite 会先释放正式 daemon 与上一棵开发进程树，再分配 daemon 端口，于 SvelteKit SPA fallback 之前挂载 `/api/` 与 `/ws/` 代理，并挂载开发态 OpenTray。重复执行 `pnpm dev` 不需要手动清理旧 socket；接管会等待旧 daemon 的 PID 和 IPC endpoint 同时释放。daemon 启动窗口返回可重试 `503`，不会把 API 请求误回退为 `index.html`。macOS 开发态的 home 默认为 `/tmp/sc-v2`，因此应用状态位于 `/tmp/sc-v2/.skill-creator/`，不会读写正式用户状态。Windows 使用系统临时目录下的 `skill-creator-v2-dev`。

构建与完整静态检查：

```bash
pnpm build
pnpm check
```

`pnpm build` 产出：

```text
dist/
|-- cli.js          # skill-creator bin
|-- daemon.js       # daemon entry
|-- package.json    # daemon/CLI version truth
`-- webui/          # static SvelteKit SPA
```

## CLI

构建后可在仓库内使用 `pnpm skill-creator <command>`；作为包安装后使用 `skill-creator <command>`。

| Command         | 行为                                                                                                                          |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `start`         | 启动 daemon，等待 WebUI 与 tray 完成挂载，然后显示原生窗口；web 模式打开浏览器；headless 时只提示 `openinbrowser`，不自动打开 |
| `start --web`   | 以 web 模式启动：只挂纯 tray 图标（菜单 + 图标），不创建原生窗口，WebUI 在系统浏览器打开（Linux 默认）                        |
| `open`          | 显示并聚焦现有 tray 窗口；web 模式降级为打开浏览器；headless 时失败并提示 `openinbrowser`                                     |
| `openinbrowser` | 显式在系统浏览器打开当前 daemon 的带 token WebUI URL                                                                          |
| `status`        | 输出 PID、版本、HTTP 端口、tray 状态（mounted/web/headless）和可用的 tray 错误                                                |
| `stop`          | 停止正式 daemon；若正式 endpoint 不存在则发现开发 daemon，并等待 endpoint 释放                                                |
| `version`       | 输出包版本                                                                                                                    |
| `help`          | 输出命令帮助                                                                                                                  |

```bash
pnpm build
pnpm skill-creator start
pnpm skill-creator start --web   # 强制 web 模式（纯 tray + 浏览器）
pnpm skill-creator status
pnpm skill-creator open
pnpm skill-creator openinbrowser
pnpm skill-creator stop
```

## 运行架构

```text
src/cli/cli.ts
    |
    | length-prefixed JSON frame
    | protocolVersion + clientVersion
    v
src/daemon/ipc-server.ts ---------------------- single-instance owner
    |
    +--> src/daemon/index.ts ------------------ lifecycle/status
    |       |-- WebServer @ 127.0.0.1:random
    |       `-- TrayHost -> OpenTray ext-webview
    |
    +--> src/daemon/rpc-router.ts
            `--> domain.ts ------------------ one daemon composition root
                    |-- workspace-registry/ -- persisted truth + dynamic projection
                    |-- skill-service.ts ----- ccski adapter
                    |-- creator-service.ts --- revision-safe document writes
                    |-- repository-service.ts  pinned clone lifecycle
                    |-- source-registry.ts --- curated + user Discover sources
                    |-- skills-update-service.ts  lock-hash update check/apply
                    `-- acp-bridge-service.ts  agent subprocess + fs security gate

src/shared/rpc-contract.ts
    ^                    ^
    | runtime schemas    | inferred client types
 daemon              webui/src/lib/rpc-client.ts
```

浏览器安全的契约由 `src/shared/rpc-contract.ts` 统一组合，具体 schema 物理拆分在 `src/shared/contracts/`：

| RPC module   | Procedures                                                                    |
| ------------ | ----------------------------------------------------------------------------- |
| `skills`     | `list`, `info`, `toggle`, `validate`, `update.check`, `update.apply`          |
| `workspace`  | `list`, `add`, `remove`, `setActive`                                          |
| `creator`    | `save`, `load`, `remove`, `revisions`                                         |
| `repository` | `scan`, `preview`, `install`, `sources.list`, `sources.add`, `sources.remove` |
| `daemon`     | `status`                                                                      |
| `acp`        | `agents.list`, `session.open`, `session.close`                                |

WebUI 直接从共享契约推导 client 类型；daemon 通过同一契约实现 handler。网络输入和输出都经过 Zod runtime validation。

Workspace 列表、Skill 列表/详情和 Repository 扫描/预览分别使用独立请求代次；新请求、作用域切换或 RPC client 更替会使旧响应失去提交资格，避免慢响应覆盖新界面状态。失效的读写请求不会触发新连接的后续刷新或导航；Creator 已接纳的 dirty draft 不因断线重连被清空。

## 安全模型

```text
explicit import path
        |
        v
 realpath + directory check --> ws_<digest> --> server registry
                                            |
WebUI mutation -----------------------------+--> server resolves root
   workspaceId + providerId + skillId            |
                                                 +--> containment check
                                                 +--> atomic write

Git source + ref --> temporary clone --> commit SHA --> repo_<session>
                                                        |
                                      preview/install --+--> same snapshot
```

- HTTP 仅监听 `127.0.0.1`。`/api/health` 和静态 SPA 不执行文件系统 mutation。
- daemon 每次启动生成 32-byte Web token。token 经 URL fragment 交给 WebUI，捕获到当前标签页的 `sessionStorage` 后从地址栏移除；`/ws/rpc` 在升级前校验 token。
- IPC endpoint 是单例锁。macOS 上 runtime 目录权限为 `0700`、socket 为 `0600`；Windows 使用 `\\.\pipe\skill-creator-sock`。
- Workspace、Provider、Skill、Repository Session 与 Remote Skill 均由 server 生成或验证的身份约束。除 `workspace.add` 的显式导入和 `repository.scan` 的 Git source 外，mutation 不接受调用方输出路径。
- daemon 生命周期内只有一个内存 Workspace Registry。持久路径必须绝对且规范化，`ws_*` 必须与路径 digest 相符；导入、移除和切换先原子提交完整 next state，再替换内存状态。`skillCount` 与可用性只在读取时派生，永不写入 registry。
- Creator 新建只允许已导入 Workspace.Provider 的直接子目录；编辑和删除必须仍在该 Provider root 内。文档使用临时文件加 rename 原子落盘，update/delete 以 SHA-256 revision 拒绝陈旧操作。
- Repository 扫描先 clone，再用 Zod 收窄 HEAD commit。预览和安装复用同一临时快照与 session ID；淘汰立即拒绝新操作，但会让已接受的安装持有快照直到完成。daemon stop 会终止 pending clone，且 late scan 不得重新登记 session。
- Repository 安装不能指向 `~`；每个目标必须是一个已导入、可写的 Workspace.Provider。多选目标会得到逐 skill、逐目标的独立结果。
- Repository 安装汇总携带提交时的 Workspace.Provider target；ccski installer output 先经 runtime schema 收窄，只有实际 `installed` / `overwritten` 且重新验证为 Provider root 直属、非符号链接 `SKILL.md` 目录的结果项会获得本地 Skill ID，供 Creator 复核。
- daemon 在 tray mount 前发布 stop coordinator 与 signal listeners。stop 先关闭 HTTP/WebSocket 与 IPC admission，再并行回收 Repository、tray 与连接；mount 期间迟到的 native handles 会被立即销毁，非协作 socket 在 grace deadline 后强制关闭，并发 stop 合并为同一完成态。
- 所有外部读取先解码为 `unknown`，再用当前 Zod schema `safeParse`。配置文件、未来数据库记录和第三方/网络返回中不兼容的快照按其领域投影为空，集合丢弃无效项，不能读取为安全空值的结果返回类型化失败；RPC/IPC、鉴权、路径和 mutation 输入仍明确拒绝，绝不降级为空。
- 当前 v2 registry 没有旧 schema 的迁移层。JSON 语法错误或不符合当前 Zod schema 的旧状态整体按空值加载：不读取、不转换、不在加载时写回；下一次正常 workspace mutation 才原子提交当前 v2 状态。文件 I/O 错误仍拒绝启动并写入当前 home 下的 `.skill-creator/logs/daemon.log`。当前没有数据库实现；引入后数据库读取必须遵循同一投影法则。

## 状态路径

| 状态               | macOS / release                           | Windows / release                              |
| ------------------ | ----------------------------------------- | ---------------------------------------------- |
| 应用目录           | `~/.skill-creator/`                       | `%USERPROFILE%\.skill-creator\`                |
| Workspace registry | `~/.skill-creator/workspaces.json`        | `%USERPROFILE%\.skill-creator\workspaces.json` |
| 用户 Repository 源 | `~/.skill-creator/sources.json`           | `%USERPROFILE%\.skill-creator\sources.json`    |
| Daemon log         | `~/.skill-creator/logs/daemon.log`        | `%USERPROFILE%\.skill-creator\logs\daemon.log` |
| IPC                | `~/.skill-creator/run/skill-creator.sock` | `\\.\pipe\skill-creator-sock-<home-digest>`    |

`SKILL_CREATOR_HOME` 可覆盖当前命令的 home 根目录；应用仍在该目录下创建 `.skill-creator/`。`SKILL_CREATOR_DEV_HOME` 专门覆盖开发 runtime 的发现路径；macOS 默认对应 `/tmp/sc-v2/.skill-creator/`。

## 验证

```bash
pnpm test
pnpm typecheck
pnpm --dir webui check
pnpm build
pnpm exec vp fmt --check
git diff --check
npm pack --dry-run
```

## License

MIT
