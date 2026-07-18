<!--
文件意图（2026-07-15）
用户原始需求摘录：
- 「现在你将作为总负责人，接手这个项目，研究 claude-code 的代码……进行大胆的开发。」
- 「按照你自己的节奏去推进开发迭代。」
- 「Chat 针对人（澄清意图），Spec 针对意图（形成规范），Style 针对代码（约束产出）。」
- 「单个物理文件的正交意图上限为 5 个。达到 3 个即需触发警报，考虑重构拆分。」
正交意图：1. 固化产品真相；2. 固化模块与安全边界；3. 固化工程风格；4. 固化验证标准；5. 固化演进与无兼容策略。
妥协声明：根级 `AGENTS.md` 是当前全仓共享的自动发现入口；五项是安全交付不可分离的治理上下文，具体领域定义已物理拆分到 `i18n.zh.md` 与源码契约。
-->

# AGENTS.md

本文件是 2026-07-15 架构诊断后的覆盖性事实源。每次架构诊断都应根据真实代码覆盖更新本文件，不追加失效历史；领域词汇同步到 `i18n.zh.md`。

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
Skill Creator
|
|-- /workspace ---------------- Workspace registry index / import-remove recovery
|
|-- /workspace/[id]
|   |-- /workspace/~/ -------- Home Workspace: ccski 默认 Agent 位置
|   `-- /workspace/ws_* ------- Imported Workspace: 已注册目录
|
|-- /creator ----------------- 在 Imported Workspace 创建/编辑技能
|
`-- /repository -------------- 固定 Git commit 后预览/安装
```

唯一一级导航是 Workspaces、Creator、Repository。

```text
Workspace          = 技能操作的作用域
Home Workspace (~) = ccski 默认 Agent 位置的聚合发现入口
Imported Workspace = daemon 已 canonicalize 并注册的目录
Creator            = create + revision-checked edit/delete
Repository         = clone + pin commit + scan + preview + install
```

核心约束：

1. 每个技能读取或 mutation 都显式绑定 Workspace ID。
2. Creator 与 Repository 的写入目标只能是 Imported Workspace，不能是 `~`。
3. Repository 的 preview 与 install 必须来自同一个 pinned clone session。
4. WebUI 不拼接 mutation 输出路径；server 解析 opaque ID 到真实根目录。
5. UI 服务于人的直觉与操作密度，允许场景聚合，但不能绕过协议和文件系统边界。
6. Creator 允许无 query、workspace-only 新建上下文、workspace+skill 编辑上下文；skill-only 或非法身份必须在渲染前清理。
7. OpenTray 是 Dashboard 模式：原生 tray 是 macOS/Windows 的 UX 加成，WebUI 必须在任何平台（含 Linux/CI/headless）经系统浏览器可达；`status.tray === "headless"` 不是不可用，而是浏览器模式。

## 3. 系统拓扑

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
                 |                     |         |
                 |                     +-- ccski |
                 |                     +-- Git   |
                 |                     `-- paths |
                 |                               |
                 | OpenTray -> ext-webview ------+--> native tray/window
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

`open` 在 tray 挂载时是 retained-session 恢复（show/focus），在 headless/任何平台降级为打开系统浏览器。OpenTray 是 Dashboard 模式：原生 tray 是 UX 加成，WebUI 始终浏览器可达。IPC socket bind 是单例真相；只能在确认 endpoint 不接受连接后清理 stale Unix socket。

Tray 采用 retained-session 模型：`createWebviewWindow` 仅 bootstrap 一次创建原生 session，之后所有激活用 `toVisible()`、隐藏用 `close()`，绝不重放 startup 宽高/style/native flags（OpenTray 0.14 session 法则）。`isVisible()`/`visibleChange` 是原生操作可见性真相（含最小化），客户端不维护镜像猜测。tray 菜单主项按可见性切换 Show/Hide 文案；blur 触发的自动隐藏由页面拥有的 WAAPI 退出动画收口，动画完成回调 `tray.completeAutoClose`，daemon 复核仍可关闭才真正 `hide()`。Creator 路由（`/creator`）拥有表单输入，blur 时禁止自动隐藏。keep-onTop 偏好是 app 级单一读写源（`PreferencesStore`），WebUI 与 TrayHost 都订阅同一真相。daemon→WebUI 投影帧（`pin`/`preferences`）经 `state.subscribe` 异步生成器推送，首帧带 hello + 当前 preferences + 若 tray 已挂载则带初始 pin；连接世代更替时旧订阅不得提交新状态。

```text
tray click/menu --> toggle() --> query isVisible() truth --> toVisible()/close()
       |
window blur --> reevaluate auto-close --> exitRequested pin frame broadcast
       |                                              |
       |                             keep-onTop pin / Creator route / focus --> cancel
       v
page WAAPI exit animation (6s, mirror native opacity) --> completeAutoClose RPC
       |
       `--> daemon re-checks canAutoClose --> hide() (close retained session) : cancel
```

WebUI 的 Workspace、Skill、Repository 读取与 mutation 分别使用独立 latest-request-wins 代次门；新请求、主动清理、路由变化或断线会撤销旧响应的提交资格。每次替换 RPC client 都递增 connection owner generation；请求令牌的 `isLatest` 只允许当前请求清理自身 loading，`isCurrent` 还要求 owner generation 未变化，只有它能提交数据、错误或后续 RPC。失效 mutation 的成功和 rejection 都投影为无结果，不能 toast、导航、刷新或调用新 client。Creator 额外把 query route key 与初始化代次绑定；旧连接的 await 尾部不得调用新连接的 RPC client。tray 投影流订阅同样绑定 connection generation：重连时撤销旧 `state.subscribe` 迭代器的提交资格。

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
daemon boot -> strict schemaVersion=1 load -> one in-memory Registry
              absolute + normalized path
              id = digest(path), unique IDs/paths, registered activeId
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
     +--> immutable state snapshot -> availability + ccski counts
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

workspaceId + skillId -> resolve scope -> allowed root -> containment -> action
```

`~` 是保留 Workspace ID，不是由 WebUI 展开的文件系统路径。Imported Workspace ID 使用 canonical path 的 digest，Skill ID 使用 server 发现到的 canonical skill path digest。`skillCount` 和 `available` 是动态观察值，不属于持久态；同一 daemon 内不得出现第二个 Registry 实例。

### 3.3 Creator 状态机

```text
/creator -----------------------------> first writable Workspace / blank draft
/creator?workspace=ws_* --------------> explicit Workspace / blank draft
/creator?workspace=ws_*&skill=sk_* ---> explicit Workspace / existing document
skill-only or invalid opaque ID ------> redirect /creator before render

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
`-- stage-webui.sh.ts --------------- Bun static SPA staging

src/
|-- cli/
|   `-- cli.ts ---------------- [4] command route / IPC client / daemon replace / status
|
|-- shared/
|   |-- contracts/ ------------ [6 physical modules]
|   |   |-- skills.ts --------- identity / metadata / toggle / validation
|   |   |-- workspaces.ts ----- home/imported IDs / workspace projection
|   |   |-- creator.ts -------- document / create-update union / revision
|   |   |-- repository.ts ----- session / remote skill / install result union
|   |   |-- daemon.ts --------- lifecycle status
|   |   `-- tray.ts ----------- pin frame / preferences / ok response
|   |-- rpc-contract.ts ------- [1] compose browser-safe procedures + state.subscribe stream
|   |-- frame.ts -------------- [3] IPC envelope / codec / parser
|   |-- package-version.ts ---- [2] source/bundle package version lookup
|   |-- paths.ts -------------- [3] app dirs / logs / IPC endpoint / preferences path
|   `-- window-opacity.ts ------ [1] shared enter-seed opacity (host + page)
|
|-- daemon/
|   |-- index.ts -------------- [4] lock / HTTP / retained tray / preferences / teardown
|   |-- domain.ts ------------- [2] domain module composition / dependency wiring
|   |-- rpc-router.ts ---------- [5] skill / workspace+creator / repository / status / tray / preferences / state / error boundary
|   |-- skill-service.ts ------- [3] discovery+identity / document read / toggle+validate
|   |-- creator-service.ts ----- [3] create / round-trip update / revision delete
|   |-- repository-service.ts -- [3] pinned lifecycle / inspect / preview-install
|   |-- workspace-registry/
|   |   |-- index.ts ---------- [3] registry truth / scope resolution / retry-consistent list
|   |   |-- state.ts ---------- [2] strict persisted state / pure transitions
|   |   |-- persistence.ts ---- [2] strict load / atomic commit
|   |   `-- projection.ts ----- [2] dynamic counts / availability projection
|   |-- path-safety.ts --------- [3] identity / containment / atomic revision write
|   |-- preferences-store.ts --- [1] keep-onTop truth / atomic persist / preferences event
|   |-- opentray-windows-host.ts [1] win32 native material comparator bridge
|   |-- web-server.ts ---------- [3] SPA / auth upgrade / bounded oRPC lifecycle / broadcast + attachTray
|   |-- ipc-server.ts ---------- [4] lock / protocol / dispatch / bounded acknowledged stop
|   `-- tray-host.ts ----------- retained session / visibility truth / auto-close / failure classification
|
`-- webui/
    |-- config/daemon-dev.ts -------- Vite-owned Bun daemon + HTTP/WS proxy
    `-- src/
        |-- routes/ ------------ product surfaces and app shell
        |-- lib/stores/ -------- connection / request generation / workspace / skills / creator / repository / tray
        |-- lib/window-visibility.ts - page-owned WAAPI enter/exit animation + native opacity mirror
        |-- lib/window-opacity-timeline.ts - exit keyframes / countdown
        |-- lib/components/ ---- product composition
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
workspaces.json ---------------> strict schema + path/ID identity ----> registry state
workspace import path ---------> realpath + directory ----------------> registry
workspaceId / skillId ---------> server registry + opaque ID --------> scoped root
Creator directoryName ---------> lowercase safe name + direct child -> SKILL.md
Creator update/delete ---------> expected SHA-256 revision ----------> write/remove
Git source/ref ----------------> git clone + pinned HEAD ------------> scan session
Remote skill selection --------> session-owned opaque IDs ----------> install
Install output path -----------> Workspace direct child + SKILL.md -> local Skill ID
static request path -----------> resolved-root containment ----------> read asset
IPC bytes ---------------------> frame size + schema + protocol ------> CLI command
tray/preferences RPC ----------> shared Zod schema + OkResponse -----> tray host / store
state.subscribe stream --------> authenticated WS upgrade only -------> broadcast frames
```

不可破坏的安全不变量：

1. HTTP 只监听 loopback；WebSocket 在 protocol upgrade 前鉴权。
2. Web token 放 URL fragment，不进入初始 HTTP request；捕获后仅存当前 tab 的 `sessionStorage` 并清理 hash。
3. Unix runtime 目录 `0700`，socket `0600`；活 socket 绝不能 unlink。
4. 文件 mutation 必须由 server-owned Workspace root 派生，不能信任调用方组合的路径。
5. 创建目标必须是 Workspace direct child；编辑、删除、预览必须通过 containment check。
6. 文档写入使用同目录临时文件加 rename；并发编辑由 revision 拒绝，不做 last-write-wins。
7. Repository preview/install 必须绑定同一个 commit 和 session；session 淘汰立即拒绝新操作，但不得删除已接受安装仍在使用的 clone。每个 selected skill 必须绑定预期 Workspace、名称和直属路径；installer output 必须先 runtime parse，逐字段匹配后，还需通过 canonical path、非符号链接的普通 `SKILL.md`、frontmatter name、`SkillService.resolve` 与 validate 的重新发现链。安装汇总携带提交时的 Workspace ID；部分失败必须保留已完成项，只有完整验证的 `installed` / `overwritten` 项能签发本地 Skill ID。
8. 启用/禁用发生冲突时返回 conflict，不以破坏性 force 掩盖目标状态。
9. Workspace Registry mutation 必须先原子持久化完整 next state，成功后才替换内存真相；动态计数不得写回持久态。
10. daemon stop coordinator 与 signal listeners 必须先于 tray mount 发布；stop 先关闭 transport admission，再关停 domain，迟到的 native handles 不得重新挂载；非协作连接在 grace deadline 后强制回收，所有 stop 来源共享完成态与退出意图。
11. daemon→WebUI 投影帧（`pin`/`preferences`）只经已通过 token 鉴权的 `/ws/rpc` 升级连接推送；tray 自动隐藏意图与 keep-onTop 偏好属于 daemon 拥有的投影真相，WebUI 不得本地伪造后写入。

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
- 外部输入必须先作为 `unknown`，再经 Zod v4 或明确 parser 收窄。
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

- 默认不保留旧的未发布 workspace registry schema，不添加 alias、fallback naming 或胶水 parser。
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
