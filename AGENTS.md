<!--
文件意图（2026-07-22）
用户原始需求摘录：
- 「现在你将作为总负责人，接手这个项目，研究 claude-code 的代码……进行大胆的开发。」
- 「按照你自己的节奏去推进开发迭代。」
- 「Chat 针对人（澄清意图），Spec 针对意图（形成规范），Style 针对代码（约束产出）。」
- 「单个物理文件的正交意图上限为 5 个。达到 3 个即需触发警报，考虑重构拆分。」
- 「我们已经不做 keepOnTop:true 的模式了。而是走 appMode:true 模式。所以走原生的窗口管理。」
- 「placement直接居中就行，不用跟随tray；窗口推荐尺寸改进成最小推荐尺寸。」
- 「默认的变体名是 `default`，不填写就是默认；变体也可以表达垃圾篓 `empty/files`。」
- 「我们默认是破坏性更新的……使用 zod 的 safeParse 来统一解决这个问题，遇到不兼容的就当是空值。」
- 「任何外部输入都应该遵循这个规则：各种配置文件、数据库结构、网络返回等。」
- 「开发模式下，配置启动命令成 `pnpm dev`；Dock 点击要恢复完整开发进程树。」
- 「`pnpm skill-creator start` 必须挂载托盘；退出托盘后点击固定 Dock 图标必须重新启动。」
- 「`node dist/daemon.js` 确实没反应；生产 Dock 入口必须恢复或聚焦应用。」
- 「`skill-creator stop` 找不到 daemon，但 `pnpm dev` 又说已有 daemon 持有 socket。」
- 「同意，但是改成 `skill-creator openinbrowser`。」
- 「home 目录定义为特殊的 GlobalWorkspace；一个 Workspace 下可以包含多个 providers；下载到某个 Workspace.provider，且能多选。」
正交意图：1. 固化产品真相；2. 固化模块与安全边界；3. 固化工程风格；4. 固化验证标准；5. 固化演进与无兼容策略。
妥协声明：根级 `AGENTS.md` 是当前全仓共享的自动发现入口；五项是安全交付不可分离的治理上下文，具体领域定义已物理拆分到 `i18n.zh.md` 与源码契约。
-->

# AGENTS.md

本文件是 2026-07-22 架构诊断后的覆盖性事实源。每次架构诊断都应根据真实代码覆盖更新本文件，不追加失效历史；领域词汇同步到 `i18n.zh.md`。

## 1. 决策闭环

```text
Human
  |
  | Chat: 只追问不可调和的矛盾、极端取舍、边界条件
  v
Intent
  |
  | Spec: 面向过程、脱离具体语言、ASCII 优先
  v
Procedure
  |
  | Style: 类型、安全、文件意图、真实验证
  v
Code + Evidence
  |
  `---------------- diagnosis feedback ----------------> Chat
```

事实来源严格分层：

```text
[用户一手资料]  >  [仓库当前代码/测试/构建产物]  >  [Agent 架构决策]

冲突时：
用户最新明确输入 > 旧输入
可运行代码事实   > 过期文档
可复现实证       > 推测
```

不得伪造测试、构建、发布或视觉证据。无法运行时必须明确写出未验证项。

## 2. 产品真相

```text
Skill Creator（当前代码：ChromeTabs Shell，三个 App；DSH composition 尚未实现）
|
|-- /workspaces -------------- Workspaces App
|   |-- home tab ------------- Workspace 索引 / import-remove recovery
|   `-- provider tab --------- Workspace.Provider 技能列表 + 详情
|       `-- ~/ 或 ws_* ------- Global/Imported Workspace roots
|
|-- /creator ----------------- Creator App：在 Imported Workspace.Provider
|                              创建/编辑技能 + change log（单列编辑器；Agent
|                              会话由 DSH host 承载，内嵌 ACP 面板已移除）
|
`-- /repository -------------- Repository App：固定 Git commit 后预览/安装
                               + curated/user sources Discover feed
```

当前一级导航是 Workspaces、Creator、Repository；旧 Steward 是 Workspaces 下的 activity。URL 由 shell route registry 解析，SvelteKit 仅 catch-all 承载。旧实现不满足本轮技能管家目标。批准的目标是复用 DSH Web client plugins 与现有 Manager views，合为一个产品 Shell；任务归属以 GOAL.md 的五阶段顺序和 active changes 为准，不提前把目标写成实现事实。

```text
Workspace                  = skills 作用域第一层
Global Workspace (~)       = catalog 解析的 Agent 全局 roots 聚合
Imported Workspace         = daemon 已 canonicalize 并注册的目录
Provider                   = 一个 Workspace 内的 Agent skills root
Workspace Provider Target  = { workspaceId, providerId }
Creator            = create + revision-checked edit/delete + change log
Repository         = clone + pin commit + scan + preview + install
Source             = Discover feed 的 curated 或 user Git 源（sources.json）
Skills Update      = 对比 skills-CLI lock hash 与上游并重装（只读 check / 写入 apply）
Skill Steward      = Manager-owned domain tools + snapshot + proposal + approval + audit
Agent Runtime      = 目标为官方 DSH Agent/session/tools/prompt composition；fixture 仅测试，Codex 后端暂不纳入交付
ACP Bridge         = internal legacy：generic ACP session 已从产品入口移除（3.2），
                      Agent 会话由 DSH host 唯一承载；daemon 内诊断面保留但不扩张
```

核心约束：

1. 每个技能读取或 mutation 都显式绑定 Workspace Provider Target。
2. Global Workspace 可发现、查看、校验与启停 Provider 中现有技能；Creator 与 Repository 的写入目标只能是 Imported Workspace.Provider，不能是 `~`。
3. Repository 的 preview 与 install 必须来自同一个 pinned clone session。
4. WebUI 不拼接 mutation 输出路径；server 解析 opaque ID 到真实根目录。
5. UI 服务于人的直觉与操作密度，允许场景聚合，但不能绕过协议和文件系统边界。
6. Creator 允许无 query、workspace+provider 新建上下文、workspace+provider+skill 编辑上下文；不完整、未知或非法身份必须在渲染前清理。
7. OpenTray 以 `appMode: true` 承载正常应用窗口：窗口层级、焦点、最小化/最大化与关闭交给系统管理；启动时只按当前屏幕一次性居中，不读取 tray bounds 或持续跟随 tray；tray 是 macOS/Windows 的 UX 加成，WebUI 在任何平台（含 Linux/CI/headless）仍须经系统浏览器可达，`status.tray === "headless"` 不是不可用。系统浏览器只能由 `skill-creator openinbrowser` 显式打开，`start` 与 `open` 不得产生浏览器副作用。
8. App identity 只使用当前平台标准资产：macOS/Windows 优先使用 `resources/app-icon` 中手工生成的 light/dark ICNS/ICO，Linux 使用 Vite 从 `resources/color-symbol.png` 预构建的带尺寸 72 DPI PNG；tray template PNG 不得提升为 `appIcon`。
9. light 资产同时声明 `default/light`，dark 资产声明 `dark`。Core 只管理目录和当前变体；本项目暂不增加主题 IPC，WebView 不拥有 App identity 切换权。

## 3. 系统拓扑

DSH integration fact (2026-09-06): official `deepseek-ai/deepseek-harness` commit `d347e703908d0406b7a7ef80e3a0e594d86b2215` (v0.1.3-alpha.1, MIT) exposes composable `agent`, `agent-loop`, `session`, `tools`, `system-prompt`, `agent-presets`, `approval`, `sandbox`, API gateway and client module seams. The local `/Users/kzf/Dev/GitHub/dsh` checkout is only `dsh-herdr`; it is not evidence of the official Agent harness. Use `docs/research/2026-09-06-dsh-integration.md` and the active staged changes as the integration boundary; do not treat DSH stores or profiles as Manager truth.

```text
                         process boundary
                 +-------------------------------+
                 | Daemon                        |
CLI              |                               |       Filesystem
 |               |  IPC Server  -> lifecycle     |          ^
 +-- framed IPC -+                status          |          |
                 |                               |          |
                 |  HTTP 127.0.0.1               |     domain modules
Tray WebUI        |    |                          |          ^
 |               |    +-- static SPA             |          |
 +-- oRPC/WS -----+    `-- /ws/rpc -> RPC router -+----------+
Browser (web mode)-+                  |          |
                 |                    +-- Workspace Registry
                 |                    +-- skills (ccski) + skillsUpdate (lock hash)
                 |                    +-- creator / repository (Git)
                 |                    +-- sourceRegistry (sources.json)
                 |                    +-- acpBridge (agent 子进程池 + fs 安全门)
                 |                               |
                 | OpenTray -> ext-webview ------+--> native tray/window
                 |          `-- web mode: tray-only + 系统浏览器
                 +-------------------------------+

                         shared protocol
                 src/shared/contracts/*.ts
                              +
                 src/shared/rpc-contract.ts
                    ^                         ^
                    | implement               | infer
                  daemon                    WebUI
```

### 3.1 运行时状态机

```text
CLI start
   |
   +--> no live socket --> spawn daemon
   |                         |
   |                         v
   |                    bind IPC lock
   |                         |
   |                         v
   |                    HTTP mounted
   |                         |
   |                         v
   |              publish stop coordinator + signal listeners
   |                         |
   |              +----------+----------+
   |              |                     |
   |              v                     v
   |         tray mounted          tray headless
   |              |                     |
   |              v                     `--> status.trayError
   +--------> open succeeds
                  |
                  v
                ready

version mismatch --> stop old --> wait endpoint release --> spawn current

stop request --> flush acknowledgement --> close HTTP/IPC admission
                                      |--> Repository terminal gate + abort scans
                                      |--> destroy tray
                                      `--> grace deadline -> force sockets
                                                        -> inactive -> exit once

stop during tray mount --> bounded teardown --> late native handles arrive
                                                `--> destroy; never retain
```

`status.tray === "starting"` 是不可决策的过渡态：即使 HTTP 已可用，CLI `start` 也必须继续等待，不能提前决定原生窗口、web 或 headless 提示。`mounted`、`web` 与 `headless` 是 capability 终态：`mounted` 执行 retained-session `open`（show/focus）；`web` 表示已挂载纯 tray（菜单+图标）但无原生窗口，CLI `start`/`open` 在此态直接打开系统浏览器（CLI 端，不经 IPC），daemon 侧 tray 菜单点击由 daemon 自己打开浏览器；`headless` 完全无 tray，只输出 `skill-creator openinbrowser` 的恢复提示。`open` 在 `mounted` 发 IPC 显示窗口，在 `web` 降级为 CLI 端打开浏览器，在 `headless` 失败并给出同一提示；唯有 `openinbrowser` 显式调用系统浏览器。OpenTray 是 Dashboard 模式：原生 tray 是 UX 加成，WebUI 始终浏览器可达。IPC socket bind 是单例真相；只能在确认 endpoint 不接受连接后清理 stale Unix socket。

Web 模式由 `--web`/`--no-web` CLI flag 或 `SKILL_CREATOR_WEB` env 控制；Linux 默认 `true`（`@opentray/ext-webview` 无 Linux 原生包），其他平台默认 `false`。Web 模式的 `mountTray` 走 `mountWebTray` 路径：只 `createTray`（菜单 + 图标），不 `import("@opentray/ext-webview")`、不 `createWebviewWindow`；`TrayHost` 以 `mode: "web"` 构造，主菜单项文案固定为「Open in Browser」，`show()`/`toggle()`/primaryEvent 点击都重定向到 daemon 注入的 `onOpenInBrowser`。Web 模式不传 `appLaunch`（无原生窗口，Dock 冷启动向量无意义）。`TrayMountResult.tray` 类型因此放宽为 `CreateTrayHandle | OpentrayTray | null`（web 返回 base tray，windowed 返回 extended tray）。

Tray 采用 retained-session 模型：`createWebviewWindow` 仅 bootstrap 一次创建原生 session，之后所有激活用 `toVisible()`、隐藏用 `close()`，绝不重放 startup 宽高/style/native flags（OpenTray 当前 session 法则）。`isVisible()`/`visibleChange` 是原生操作可见性真相（含最小化），客户端不维护镜像猜测。tray 菜单主项按可见性切换 Show/Hide 文案。窗口以 `appMode: true`、`frameless: false`、`autoHide: false` 创建；启动完成后以 `WebviewPlacementKit.applyOnce(..., { placement: "screen-center" })` 按当前屏幕居中一次，不查询 tray bounds、不持续重定位；系统 Shell 负责窗口层级、焦点、最小化/最大化与关闭，daemon/WebUI 不再实现 opacity 动画、blur 倒计时、keep-on-top 偏好或窗口状态投影协议。

WebUI 按路由请求的是最小推荐尺寸：先读取 native `getBounds()`，只有当前宽或高不足时才将该维度扩展到推荐下限；任何已更大的维度必须保留，普通浏览器或缺失 native bridge 时静默跳过。

```text
tray click/menu --> toggle() --> query isVisible() truth --> toVisible()/close()
                                 |
                                 `--> visibleChange --> menu Show/Hide label

OS taskbar / Dock / app switcher --> native app window focus / minimize / maximize / close
```

开发态 Dock 冷启动必须恢复 Vite 监督器，而不是只恢复 daemon：

```text
pnpm dev -> stop production daemon ----+
         -> stop previous dev daemon --+-> wait each IPC release + PID exit
                                       |
                                       v
             Vite -> absolute Node + absolute tsx loader -> dev daemon -> WebView
               |
               `--> appLaunch = process.execPath
                                + [real node_modules/vite/bin/vite.js, "dev"]
                                + webui cwd

live Dock click -> reopenRequested -> latest retained appMode window
                                  -> toVisible() -> focus()
```

OpenTray broker 是 caller-scoped single-session；生产、旧开发与新开发模式不得并发争抢同一 app identity。`pnpm dev` 在 Vite 监听前依次检测正式 endpoint 与开发 endpoint，对每个活 daemon 发送 stop，并同时等待其 IPC endpoint 释放与 daemon PID 退出。Windows named pipe 按 home digest 后缀隔离（`\\.\pipe\skill-creator-sock-<digest>`），生产与开发 home 天然不争抢同一 pipe；Unix socket 路径本身就在各自 home 下。旧开发 daemon 退出会驱动其 Vite 监督器关闭，接管失败必须终止新 dev 启动，不能静默降级 headless。Vite 再使用绝对 Node 与绝对 `tsx` loader 启动源 daemon，完整开发树的任何子进程都不得依赖 Finder PATH。

CLI `stop` 先探测当前正式 endpoint；若开发 endpoint 不同则继续探测并停止开发 daemon。开发 home 由 `SKILL_CREATOR_DEV_HOME` 显式覆盖，否则遵循当前 `SKILL_CREATOR_HOME` 或平台短路径默认值。任何“已有 daemon”诊断都必须输出 `pnpm skill-creator stop` 这一真实可执行恢复入口，不能指向只会检查另一 runtime 的命令。

`SKILL_CREATOR_DEV_APP_LAUNCH` 是 Vite 到 daemon 的私有、严格 Zod 校验传输；不得持久化 shell、pnpm/package script、`.bin/vite` shim、完整环境变量或 daemon 子进程的 `process.argv`。开发向量由绝对 Node 直接执行项目内稳定的 `webui/node_modules/vite/bin/vite.js`，既避免 Finder PATH 中缺失裸 `node`，也不绑定一次安装的 pnpm virtual-store 版本目录。源码 link 期间，`predev` 与 `skill-creator start` 只在识别到真实 OpenTray workspace 时运行 `prepare:linked-consumer`；`status/open/stop` 与 registry 安装不得增加构建开销。

生产 Dock 冷启动不得持久化内部 `dist/daemon.js` 入口；raw daemon 遇到已有 IPC owner 会按单实例法则直接退出，无法表达 open/focus。生产 `appLaunch` 必须是绝对 Node + `dist/cli.js start` + package cwd：无 daemon 时由 CLI 启动，有 daemon 时发送 open；若 daemon 仍报告 mounted 但 open 已失败，则 CLI 先优雅停止失联实例，再重建 daemon、broker 与 retained window。

真实 daemon 生命周期测试必须同时设置独立 `OPENTRAY_HOME` 与 `SKILL_CREATOR_DISABLE_TRAY=1`。只隔离 `SKILL_CREATOR_HOME` 不足以隔离 broker lock、稳定 Bundle 和 native tray；测试退出不得留下影响操作者后续 `pnpm skill-creator start` / `pnpm dev` 的正式 OpenTray 状态。

WebUI 的 Workspace、Skill、Repository 读取与 mutation 分别使用独立 latest-request-wins 代次门；新请求、主动清理、路由变化或断线会撤销旧响应的提交资格。每次替换 RPC client 都递增 connection owner generation；请求令牌的 `isLatest` 只允许当前请求清理自身 loading，`isCurrent` 还要求 owner generation 未变化，只有它能提交数据、错误或后续 RPC。失效 mutation 的成功和 rejection 都投影为无结果，不能 toast、导航、刷新或调用新 client。Creator 额外把 query route key 与初始化代次绑定；旧连接的 await 尾部不得调用新连接的 RPC client。

```text
issue request N --> capture request generation + connection owner generation
       |
       +--> isLatest = N remains newest ----------------------> loading cleanup
       `--> isCurrent = isLatest + same connection owner ----> state/error/follow-up commit

disconnect / reconnect -> replace RPC client -> owner generation++ -> old isCurrent = false
```

动态 Workspace 路由先在 `+page.ts` 做 Zod load-time 收窄；非法 opaque ID 必须在组件渲染前 redirect，不能让组件以 fallback 数据掩盖地址错误。

Creator 的 `+page.ts` 接受无 query、有效 workspace-only、有效 workspace+skill 三态；skill-only 或任一非法 ID 在组件创建前 redirect 到 canonical `/creator`。

开发态 Vite 必须先分配动态 daemon 端口，再在 SvelteKit SPA fallback 之前挂载 `/api/` 与 `/ws/` middleware；HTTP 开始监听后才启动 daemon。daemon 启动窗口返回可重试 `503`，不能被 SPA `index.html` 吞掉。

Vite config restart 必须 await 旧 plugin 的 `closeBundle`：先向旧 daemon 发出终止并等待 child exit/单例资源释放，replacement server 才能 spawn 新 daemon。重复 environment close hook 共享同一个 teardown promise，不能重复终止 child。

### 3.2 Workspace 数据流

```text
daemon boot -> safeParse schemaVersion=2
              | valid --------> one in-memory Registry
              |                 absolute + normalized path
              |                 id = digest(path), unique IDs/paths, registered activeId
              ` incompatible --> empty current Registry (no migration or write)
                                            |
workspace.add(path, label?)                  |
          |                                  |
          v                                  |
path.resolve -> realpath -> ws_<digest> -----+
          |
          v
pure next state -> atomic workspaces.json commit -> replace memory state

workspace.list
     |
     +--> immutable state snapshot -> Global/Imported Provider roots + existing-root ccski counts
     |                                      |
     |                         registry revision changed?
     |                              | yes          | no
     |                              `--- retry     `--> UI projection
     |
     `--> never writes observations back to registry

WebUI workspace.list
     |
     +--> loaded ------ current owner commits projection
     +--> superseded -- newer list request owns projection; caller must not infer absence
     `--> failed ------ current owner records the actual failure

Creator initialization
     |
     `--> superseded by concurrent Layout load
              `--> same route/owner still current? retry : stop stale chain

workspaceId + providerId + skillId -> resolve scope -> allowed root -> containment -> action
```

持久化载入必须区分“数据不兼容”和“文件系统故障”，不得用一个宽泛的 `catch` 把所有异常都降级为空值：

```text
读取 workspaces.json
  |
  +-- 文件不存在 / JSON 解析失败 / Zod.safeParse 失败
  |      `--> empty current state
  |           不迁移、不删除、不自动覆盖，不产生成功写入副作用
  |
  `-- 权限拒绝 / 目录不可读 / 磁盘 I/O 失败 / atomic rename 失败
         `--> hard error
              停止本次 load 或 mutation，保留原文件，不伪装成空 Registry
```

`safeParse` 只负责识别当前版本无法接受的持久化数据；它不负责迁移旧字段，也不能吞掉权限、磁盘或原子写入错误。破坏性 schema 更新默认延迟到发布/部署阶段处理。

`~` 是 Global Workspace 的保留 ID，不是由 WebUI 展开的文件系统路径。Provider catalog 从社区 Agent roots 快照导出；Global root 可按环境变量或 XDG 路径解析，Imported root 只能由 canonical Workspace 目录派生。Imported Workspace ID 使用 canonical path 的 digest，Skill ID 使用 server 发现到的 canonical skill path digest。`providers`、`skillCount`、`available` 与 `writable` 都是动态观察值，不属于持久态；同一 daemon 内不得出现第二个 Registry 实例。

### 3.3 Creator 状态机

```text
/creator ----------------------------------------------> first writable Workspace.Provider / blank draft
/creator?workspace=ws_*&provider=<provider> ----------> explicit Workspace.Provider / blank draft
/creator?workspace=ws_*&provider=<provider>&skill=sk_*> explicit Workspace.Provider / existing document
incomplete, unknown, or invalid identity --------------> redirect /creator before render

                                       +--> create
Imported Workspace -------------------|      directoryName -> direct child -> atomic SKILL.md
                                       |
                                       `--> load -> revision = sha256(content)
                               |
                          edit in WebUI
                               |
                               v
                  save/delete(expectedRevision)
                               |
                +--------------+--------------+
                |                             |
          revision equal                revision changed
                |                             |
                v                             `--> reject + reload
          atomic write/remove
                |
                v
          rediscover + validate
```

Frontmatter 通过 `gray-matter` round-trip，核心字段经 Zod 校验，未知合法字段 passthrough。不得以重建 YAML 的方式丢失扩展字段。

Creator 已接纳的草稿由 route identity 拥有。断线只撤销在途 RPC 的提交资格，不重置 baseline 或 draft；同一路由重连必须保留 dirty draft。只有显式新建、切换文档/Workspace、合法导航或保存/删除过程可以按现有 discard guard 替换草稿。

### 3.4 Repository 状态机

```text
Git source + optional ref
          |
          v
temporary shallow clone
          |
          v
git rev-parse HEAD = immutable commit
          |
          v
repo_<opaque-session> -- owns --> clone directory + rsk_<opaque-id> map
          |
     +----+-------------------+
     |                        |
 preview                  dry-run/install -- acquire active operation reference
     |                        |
 same SKILL.md           same clone + selected IDs
                              |
                              v
                      Imported Workspace root
                              |
                              v
                bind ExpectedInstallTarget
      workspaceId + canonical root + selected name + direct-child path
                              |
                              v
        ccski unknown output -> Zod runtime parse -> one entry
                              |
                              v
           entry exactly matches selected name,
             canonical destination and direct-child path
                              |
                              v
            rediscover through injected SkillService
       canonical non-symlink directory + lstat regular SKILL.md
      + matching frontmatter name + resolve identity + validate
                              |
                              v
              workspaceId + local SkillId per verified write
                              |
                              `--> Creator review deep link

session missing/evicted --> reject --> scan again

session eviction --> revoke session capability
                          |-- no active operation --> delete clone
                          `-- active operation ----> retire clone --> delete on release

daemon stop --> terminal gate --> abort pending clone --> reject late retain
                                                `-----> delete unowned snapshot
```

扫描会话最多保留有限数量。淘汰先撤销 session capability；正在使用的 clone 必须等已接受操作释放后再删除。重复 skill name、非法 frontmatter 或不安全目录名必须在安装前变为不可安装状态。实际安装按 selected skill 逐项调用 installer 并逐项捕获失败；ccski output 先经 Zod runtime parse，不可信 output 被投影为该 selected identity 的 identity-free `failed`，后项失败不能抹掉前项成功。安装汇总的计数只由最终逐项状态重算；只有 `installed` / `overwritten` 项完成 ExpectedInstallTarget 全链验证后才能获得本地 Skill ID。

## 4. 目录与模块意图

```text
scripts/
|-- build-core.sh.ts ---------------- Bun + esbuild Node bundle
|-- stage-webui.sh.ts --------------- Bun static SPA staging
`-- dev.sh.ts ----------------------- Vite 监督器 + daemon 接管编排（pnpm dev 入口）

src/
|-- cli/
|   `-- cli.ts ---------------- [4] command route / IPC client / daemon replace / status
|
|-- shared/
|   |-- contracts/ ------------ [9 physical modules]
|   |   |-- skills.ts --------- identity / metadata / toggle / validation
|   |   |-- workspaces.ts ----- global/imported IDs / Provider projection and target
|   |   |-- creator.ts -------- document / create-update union / revision + change log
|   |   |-- repository.ts ----- session / remote skill / install result union / user sources
|   |   |-- daemon.ts --------- lifecycle status
|   |   |-- errors.ts --------- finite RPC business-error vocabulary
|   |   |-- acp.ts ------------ agent discovery / session open-close union
|   |   |-- skills-lock.ts ---- skills-CLI global v3 + project v1 lock snapshots
|   |   `-- skills-update.ts -- update check / apply result unions
|   |-- rpc-contract.ts ------- [1] compose browser-safe procedures
|   |-- frame.ts -------------- [3] IPC envelope / codec / parser
|   |-- package-version.ts ---- [2] source/bundle package version lookup
|   |-- external-input.ts ----- [2] external JSON decode / schema-safe projection
|   |-- provider-catalog.ts --- [2] browser-safe Agent root conventions snapshot
|   |-- curated-sources.ts ---- [2] built-in Discover feed snapshot
|   |-- web-mode.ts ----------- [2] --web/--no-web/SKILL_CREATOR_WEB flag resolution
|   |-- browser-launch.ts ----- [2] 系统浏览器打开（openinbrowser / web 模式降级）
|   `-- paths.ts -------------- [3] app dirs / logs / IPC endpoint
|
|-- daemon/
|   |-- index.ts -------------- [4] lock / HTTP / retained app window / teardown
|   |-- domain.ts ------------- [2] domain module composition / dependency wiring
|   |-- rpc-router.ts ---------- [5] skill+update / workspace+creator / repository+sources / status+acp / error boundary
|   |-- skill-service.ts ------- [3] discovery+identity / document read / toggle+validate
|   |-- creator-service.ts ----- [3] create / round-trip update / revision delete / change log
|   |-- repository-service.ts -- [3] pinned lifecycle / inspect / preview-install
|   |-- source-registry.ts ----- [3] curated+user sources / https-only / atomic sources.json
|   |-- skills-cli-probe.ts ---- [2] npx skills list --json 探测 / daemon 生命周期缓存
|   |-- skills-update-service.ts [3] lock 读取 / hash 对比 / 复用 install 重装
|   |-- acp-agent-discovery.ts - [2] ACP agent 二进制探测投影
|   |-- acp-bridge-service.ts -- [4] 子进程池 / stdio↔WS 帧桥 / fs 安全门 / 生命周期
|   |-- provider-roots.ts ------ [2] Global/Imported Provider root resolution
|   |-- workspace-registry/
|   |   |-- index.ts ---------- [3] registry truth / scope resolution / retry-consistent list
|   |   |-- state.ts ---------- [2] strict persisted state / pure transitions
|   |   |-- persistence.ts ---- [2] strict load / atomic commit
|   |   `-- projection.ts ----- [2] dynamic counts / availability projection
|   |-- path-safety.ts --------- [3] identity / containment / atomic revision write
|   |-- opentray-windows-host.ts [1] win32 native material comparator bridge
|   |-- web-server.ts ---------- [3] SPA / auth upgrade / bounded oRPC lifecycle
|   |-- ipc-server.ts ---------- [4] lock / protocol / dispatch / bounded acknowledged stop
|   `-- tray-host.ts ----------- app mode / retained session / visibility truth / web-mode redirect / failure classification
|
`-- webui/
    |-- config/daemon-dev.ts -------- Vite-owned Bun daemon + HTTP/WS proxy
    `-- src/
        |-- routes/ ------------ SvelteKit catch-all 承载点（+layout/+page/[...catch]）
        |-- lib/shell/ --------- ChromeTabs shell / route registry / nav / device prefs
        |-- lib/apps/ ---------- workspaces / creator / repository 三个 App manifest + 视图
        |-- lib/stores/ -------- connection / request generation / workspace / skills / creator / repository
        |-- lib/components/ ---- product composition（creator 子视图、source-card 等）
        `-- lib/components/ui/ - shadcn-svelte generated primitives
```

### 4.1 依赖方向

```text
shared contracts <----- domain modules <----- domain composition <----- transports <----- entry
       ^                       |
       +-- WebUI typed client  `--> path safety / ccski / Git / registry persistence

route -> domain store -> RPC client -> shared contract
router -> injected daemon domain -> module interface
```

禁止：

```text
WebUI -> node:fs
WebUI -> daemon implementation import
route -> handwritten transport payload mirror
domain module -> UI store
shared contract -> native/runtime-only dependency
```

## 5. 安全边界

```text
UNTRUSTED                         VALIDATION / AUTHORITY                 EFFECT

WebSocket upgrade token -------> exact startup token -----------------> oRPC
RPC JSON ----------------------> shared Zod schema -------------------> router
workspaces.json ---------------> JSON parse + v2 safeParse -----------> registry state
                                    | incompatible -------------------> empty current state
package JSON ------------------> JSON parse + current safeParse ------> runtime `unknown` / build rejection
ccski / Git / installer result -> current safeParse ------------------> discard entry / typed domain result
existing SKILL.md -------------> gray-matter + current safeParse -----> typed invalid-document rejection
workspace import path ---------> realpath + directory ----------------> registry
workspaceId / providerId / skillId -> server registry + catalog ------> scoped root
Creator directoryName ---------> lowercase safe name + direct child -> SKILL.md
Creator update/delete ---------> expected SHA-256 revision ----------> write/remove
Git source/ref ----------------> git clone + pinned HEAD ------------> scan session
Remote skill selection --------> session-owned opaque IDs ----------> install
Install output path -----------> Provider root direct child + SKILL.md -> local Skill ID
sources.json ------------------> JSON parse + safeParse --------------> user sources / empty
user source gitUrl ------------> https-only + dedupe + user_ id -----> Discover feed
skills-CLI lock (v3/v1) -------> safeParse ---------------------------> null -> skipped update
GitHub Trees API response -----> JSON parse + tree parser ------------> unavailable（不抛错）
npx skills list --json ---------> JSON parse + schema ----------------> empty path map
ACP agent discovery which -----> exit-code projection ----------------> available/missing
ACP stdio 帧 -------------------> 结构 parser（method/result/error）---> 帧桥转发 / 丢弃
ACP fs read/write 请求 ---------> daemon 代执行 containment+原子写 --> agent 无文件句柄
static request path -----------> resolved-root containment ----------> read asset
IPC bytes ---------------------> frame size + schema + protocol ------> CLI command
```

不可破坏的安全不变量：

1. HTTP 只监听 loopback；WebSocket 在 protocol upgrade 前鉴权。
2. Web token 放 URL fragment，不进入初始 HTTP request；捕获后仅存当前 tab 的 `sessionStorage` 并清理 hash。
3. Unix runtime 目录 `0700`，socket `0600`；活 socket 绝不能 unlink。
4. 文件 mutation 必须由 server-owned Workspace.Provider root 派生，不能信任调用方组合的路径。
5. Creator/Repository 仅可请求 Imported Workspace.Provider；创建目标必须是 Provider root direct child，编辑、删除、预览必须通过 containment check。
6. 文档写入使用同目录临时文件加 rename；并发编辑由 revision 拒绝，不做 last-write-wins。
7. Repository preview/install 必须绑定同一个 commit 和 session；session 淘汰立即拒绝新操作，但不得删除已接受安装仍在使用的 clone。每个 selected skill x selected Workspace.Provider 必须绑定预期 root、名称和直属路径；installer output 必须先 runtime parse，逐字段匹配后，还需通过 canonical path、非符号链接的普通 `SKILL.md`、frontmatter name、`SkillService.resolve` 与 validate 的重新发现链。安装汇总携带提交时的 targets；部分失败必须保留已完成项，只有完整验证的 `installed` / `overwritten` 项能签发本地 Skill ID。
8. 启用/禁用发生冲突时返回 conflict，不以破坏性 force 掩盖目标状态。
9. Workspace Registry mutation 必须先原子持久化完整 next state，成功后才替换内存真相；动态计数不得写回持久态。
10. daemon stop coordinator 与 signal listeners 必须先于 tray mount 发布；stop 先关闭 transport admission，再关停 domain，迟到的 native handles 不得重新挂载；非协作连接在 grace deadline 后强制回收，所有 stop 来源共享完成态与退出意图。
11. ACP agent 子进程永不获得原始文件句柄：`fs/read_text_file`、`fs/write_text_file` 请求由 daemon 在 Workspace Provider containment 内代为执行（写入走原子写）；session 由 daemon 持有 opaque ID，close 与 daemon stop 有界回收子进程，不留 orphan。
12. `repository.sources.*` 只接受 https Git URL；user 源与 curated 内置源 id 命名空间隔离，内置源不可被 remove；sources.json 是 server-owned 持久化，WebUI 不写 localStorage。
13. `skills.update.apply` 只能重装 check 已确认过时的 selected skills；lock/GitHub API 不可用一律投影为 skipped/unavailable，不得伪装成功或抛基础设施错误。

## 6. 文件意图法

```text
intent count
  0-2  -> 正常
    3  -> 警报：评估拆成文件夹或深模块
  4-5  -> 必须记录为何仍聚合，并在本次改动中优先拆分
   >5  -> 禁止继续写入；先重构
```

每个手写源码或文档顶部持续维护：

```text
/**
 * 用户原始需求 [YYYY-MM-DD]：「原文摘录」
 * 正交意图：
 *   [1] ...
 *   [2] ...
 * 妥协声明：仅当无法物理拆分时，写明不可调和的工具/语言/成本原因。
 */
```

规则：

- 意图是彼此可独立变化的原因，不是函数数量。
- 需求变化时覆盖过期意图，同时保留仍决定当前结构的原始输入与时间。
- 公共 HTTP/RPC、包级 export、跨进程协议必须有简洁接口注释。
- 注释语言跟随所在文件；架构解释面向高级工程师，不复述语法。
- 低于 User/Spec 基准的短板留下 `TODO`/`FIXME`；高于基准的扩张应删除。

物理隔离例外：

```text
webui/src/lib/components/ui/**
  owner: shadcn-svelte registry generator
  law:   不手工添加文件意图头
  why:   registry add/update 会覆盖原语文件
  where: 产品语义放 components/、routes/ 或 wrapper
```

这个例外只避免生成器覆盖手工元信息，不降低类型、可访问性和视觉验证标准。

## 7. Style 法则

### 7.1 TypeScript 与 runtime

- 默认 strict TypeScript。原则上禁止 `any`、`as any`、`@ts-nocheck`。
- 外部输入必须先作为 `unknown`，再经 Zod v4 `safeParse` 或明确 parser 收窄。适用所有配置文件、当前或未来数据库记录、网络返回、子进程/第三方库输出与磁盘文档；不得因 TypeScript 声明而跳过 runtime 边界。
- 读取完整快照时，语法或 schema 不兼容可投影为该领域的空值；集合读取时丢弃不兼容条目；外部结果无法安全表达为领域空值时返回类型化失败。不得记录、迁移或用旧字段重建当前状态。
- RPC/IPC、鉴权、opaque ID、路径、mutation 及写入前置条件仍必须明确拒绝。`safeParse` 不是放宽安全边界的理由，禁止把命令或权限错误伪装成空值。
- `type-safe` 必须落实为跨进程和文件边界的 runtime-safe；仅有静态类型不算完成。
- 契约类型从 `src/shared/contracts/` 推导；WebUI 禁止维护第二份手写 RPC 类型。
- 分支会随 domain variant 增长时优先使用 discriminated union 与 `ts-pattern`；固定、封闭的过程分派保持穷尽。
- 新脚本使用 TypeScript，并以 `.sh.ts` 命名后由 Bun 直接执行；生产 CLI/daemon 仍发布为 Node ESM bundle。

### 7.2 UI

```text
human task
   |
   v
information hierarchy -> dense predictable layout -> domain store -> RPC
```

- Svelte 5、shadcn-svelte、Lucide、Tailwind CSS v4 是当前 UI 基线。
- 工具型页面优先稳定侧栏、网格、容器查询、紧凑滚动条和明确状态；不为后端式解耦牺牲人的操作连续性。
- 图标按钮使用 Lucide 并提供可访问名称/tooltip；二元状态使用 switch/checkbox；选项集合使用菜单或 segmented control。
- 不嵌套装饰卡片，不使用营销式首屏，不让动态内容改变固定工具尺寸。
- Creator 的 dirty、saving、revision conflict、delete 和 validation 状态必须可区分。
- Repository 的 scanning、pinned commit、selection、preview、dry-run、overwrite、install result 必须可区分。
- 折叠/窄屏导航不能吞掉恢复性操作；Remove Workspace 必须在 workspace 索引仍可达。
- 窄屏使用单屏列表/详情切换；进入详情后聚焦语义标题，返回后恢复触发控件。可见移动操作或其关联 label 命中区至少为 `44px`。
- mutation 反馈必须区分 succeeded、skipped、conflict 与 failed；禁止把 skipped-only 写成成功 0 项。
- 延迟回调可能跨 HMR 模块代次存活；toast 等短生命周期实体使用不可复用 ID，禁止热替换后重置的 module counter。

### 7.3 依赖文档

```text
Context7 current docs
        |
        `--> unavailable/incomplete --> node_modules/<pkg>/README.md
                                         -> package.json exports
                                         -> exported .d.ts/.js
```

不得凭旧记忆猜依赖 API。原生 capability 必须按实际 platform/package 证据描述。

## 8. 无兼容策略

```text
code/data shape change
         |
         +--> current v2 code: direct breaking update
         |
         `--> release/deploy boundary: human decides migration
```

- 默认不保留旧的未发布 schema，不添加 alias、fallback naming 或胶水 parser。配置文件、当前或未来数据库快照和网络读取的 `safeParse` 失败按其领域投影为空/丢弃无效条目；不读取、不转换旧字段，也不在 load 时写回。不能安全降级的结果以类型化失败返回。
- CLI 与 daemon 包版本不同时替换 daemon，不伪装为兼容。
- 协议若必须同时支持新旧版本，必须按版本物理拆分文件与解析入口；禁止在同一 schema 内放宽成模糊 union。
- 升级、迁移和数据备份推迟到发布/部署决策，不能偷渡进功能代码。

## 9. 验证门槛

```text
change
  |
  +--> focused test
  +--> type/runtime contract check
  +--> full build
  +--> format/diff hygiene
  +--> package contents
  `--> UI change only: live desktop+narrow visual/interaction evidence
```

从仓库根目录执行：

```bash
pnpm test
pnpm typecheck
pnpm --dir webui check
pnpm build
pnpm exec vp fmt --check
git diff --check
npm pack --dry-run
```

`pnpm check` 是 test、root typecheck、WebUI check 与 formatter check 的聚合入口。修改 CLI 生命周期、IPC、Creator 或 Repository 时必须运行对应 focused tests；修改 UI 时还需启动 `pnpm dev`，在桌面与窄窗口验证真实交互、console、overflow、contrast 和 disconnected state。

提交前读取 `~/.codex/git-committer.md`。只提交本任务拥有的文件，不把无关工作树变化带入提交。

## 10. 诊断更新协议

```text
new user input / code truth
          |
          v
classify: first-hand or architecture decision
          |
          +--> canonical term changed --> update i18n.zh.md
          |
          +--> module/boundary changed -> overwrite AGENTS.md diagrams
          |
          `--> behavior changed --------> update README(s) + tests
```

架构诊断输出只保留结论、决策、风险。普通功能一句话闭环；重构才给演进报告。
