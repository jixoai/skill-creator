<!--
文件意图（2026-07-14）
用户原始需求摘录：
- 「现在你将作为总负责人，接手这个项目，研究 claude-code 的代码……进行大胆的开发。」
- 「Chat 针对人（澄清意图），Spec 针对意图（形成规范），Style 针对代码（约束产出）。」
- 「单个物理文件的正交意图上限为 5 个。达到 3 个即需触发警报，考虑重构拆分。」
正交意图：1. 固化产品真相；2. 固化模块与安全边界；3. 固化工程风格；4. 固化验证标准；5. 固化演进与无兼容策略。
妥协声明：根级 `AGENTS.md` 是当前全仓共享的自动发现入口；五项是安全交付不可分离的治理上下文，具体领域定义已物理拆分到 `i18n.zh.md` 与源码契约。
-->

# AGENTS.md

本文件是 2026-07-14 架构诊断后的覆盖性事实源。每次架构诊断都应根据真实代码覆盖更新本文件，不追加失效历史；领域词汇同步到 `i18n.zh.md`。

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

## 3. 系统拓扑

```text
                         process boundary
                 +-------------------------------+
                 | Daemon                        |
CLI              |                               |       Filesystem
 |               |  IPC Server  -> lifecycle     |          ^
 +-- framed IPC -+                status          |          |
                 |                               |          |
                 |  HTTP 127.0.0.1               |     service layer
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
stop request      --> flush acknowledgement --> destroy tray --> stop HTTP/IPC
```

`open` 是 show/focus，不是 visibility toggle。IPC socket bind 是单例真相；只能在确认 endpoint 不接受连接后清理 stale Unix socket。

WebUI 的 route load 必须绑定当前 effect/连接代次；HMR、路由变化或断线时取消旧异步链，并清空 loaded guard。旧连接的 await 尾部不得调用新连接的 RPC client。

动态 Workspace 路由先在 `+page.ts` 做 Zod load-time 收窄；非法 opaque ID 必须在组件渲染前 redirect，不能让组件以 fallback 数据掩盖地址错误。

### 3.2 Workspace 数据流

```text
workspace.add(path, label?)
          |
          v
path.resolve -> realpath -> isDirectory
          |
          v
ws_<sha256-prefix> + canonical path -> workspaces.json
          |
          +--> idempotent when same canonical path already exists

subsequent operation
workspaceId + skillId -> registry -> allowed root -> containment -> action
```

`~` 是保留 Workspace ID，不是由 WebUI 展开的文件系统路径。Imported Workspace ID 使用 canonical path 的 digest，Skill ID 使用 server 发现到的 canonical skill path digest。

### 3.3 Creator 状态机

```text
                    +--> create
Imported Workspace |      directoryName -> direct child -> atomic SKILL.md
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
 preview                  dry-run/install
     |                        |
 same SKILL.md           same clone + selected IDs
                              |
                              v
                      Imported Workspace root

session missing/evicted --> reject --> scan again
```

扫描会话最多保留有限数量，淘汰时删除临时 clone。重复 skill name、非法 frontmatter 或不安全目录名必须在安装前变为不可安装状态。

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
|   |-- contracts/ ------------ [5 physical modules]
|   |   |-- skills.ts --------- identity / metadata / toggle / validation
|   |   |-- workspaces.ts ----- home/imported IDs / workspace projection
|   |   |-- creator.ts -------- document / create-update union / revision
|   |   |-- repository.ts ----- session / remote skill / install result union
|   |   `-- daemon.ts --------- lifecycle status
|   |-- rpc-contract.ts ------- [1] compose browser-safe procedures
|   |-- frame.ts -------------- [3] IPC envelope / codec / parser
|   |-- package-version.ts ---- [2] source/bundle package version lookup
|   `-- paths.ts -------------- [3] app dirs / logs / IPC endpoint
|
|-- daemon/
|   |-- index.ts -------------- [4] lock / HTTP / tray / teardown
|   |-- rpc-router.ts ---------- [4] skill / workspace+creator / repository / status handlers
|   |-- skill-service.ts ------- [4] discovery / identity+detail / toggle / validate
|   |-- workspace-service.ts --- [3] registry / scope resolution / counts
|   |-- creator-service.ts ----- [3] create / round-trip update / revision delete
|   |-- repository-service.ts -- [3] pinned clone / inspect / preview-install
|   |-- path-safety.ts --------- [3] identity / containment / atomic revision write
|   |-- web-server.ts ---------- [3] SPA / auth upgrade / oRPC host
|   |-- ipc-server.ts ---------- [4] lock / protocol / dispatch / acknowledged stop
|   `-- tray-host.ts ----------- native capability adapter
|
`-- webui/
    |-- config/daemon-dev.ts -------- Vite-owned Bun daemon + HTTP/WS proxy
    `-- src/
        |-- routes/ ------------ product surfaces and app shell
        |-- lib/stores/ -------- connection / workspace / skills / creator / repository
        |-- lib/components/ ---- product composition
        `-- lib/components/ui/ - shadcn-svelte generated primitives
```

### 4.1 依赖方向

```text
shared contracts <----- daemon services <----- daemon entry
       ^
       +-------------- WebUI typed client

route -> domain store -> RPC client -> shared contract
router -> service -> path safety / ccski / Git
```

禁止：

```text
WebUI -> node:fs
WebUI -> daemon implementation import
route -> handwritten transport payload mirror
service -> UI store
shared contract -> native/runtime-only dependency
```

## 5. 安全边界

```text
UNTRUSTED                         VALIDATION / AUTHORITY                 EFFECT

WebSocket upgrade token -------> exact startup token -----------------> oRPC
RPC JSON ----------------------> shared Zod schema -------------------> router
workspace import path ---------> realpath + directory ----------------> registry
workspaceId / skillId ---------> server registry + opaque ID --------> scoped root
Creator directoryName ---------> lowercase safe name + direct child -> SKILL.md
Creator update/delete ---------> expected SHA-256 revision ----------> write/remove
Git source/ref ----------------> git clone + pinned HEAD ------------> scan session
Remote skill selection --------> session-owned opaque IDs ----------> install
static request path -----------> resolved-root containment ----------> read asset
IPC bytes ---------------------> frame size + schema + protocol ------> CLI command
```

不可破坏的安全不变量：

1. HTTP 只监听 loopback；WebSocket 在 protocol upgrade 前鉴权。
2. Web token 放 URL fragment，不进入初始 HTTP request；捕获后仅存当前 tab 的 `sessionStorage` 并清理 hash。
3. Unix runtime 目录 `0700`，socket `0600`；活 socket 绝不能 unlink。
4. 文件 mutation 必须由 server-owned Workspace root 派生，不能信任调用方组合的路径。
5. 创建目标必须是 Workspace direct child；编辑、删除、预览必须通过 containment check。
6. 文档写入使用同目录临时文件加 rename；并发编辑由 revision 拒绝，不做 last-write-wins。
7. Repository preview/install 必须绑定同一个 commit 和 session；session 失效就重新 scan。
8. 启用/禁用发生冲突时返回 conflict，不以破坏性 force 掩盖目标状态。

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
