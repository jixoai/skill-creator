# Design: acp-agent-bridge

## Context

Skill Creator 已有稳固的安全与传输基座：`path-safety.ts`（`assertPathInside` containment、`atomicWriteUtf8` revision-safe 写）、`web-server.ts`（单 HTTP+WS 服务器、`/ws/rpc?token=<webToken>` 鉴权 upgrade、loopback only、token in fragment）、`rpc-contract.ts`（oRPC over WebSocket、Zod runtime 契约、有限业务错误词汇 `NOT_FOUND / CONFLICT / INVALID_OPERATION / UNAVAILABLE`）。依赖方向（AGENTS.md）：`shared contracts < domain < transport < entry`。

ACP（Agent Client Protocol）是 JSON-RPC over 换行分隔 JSON，像 LSP 但面向 agentic 编码对话。关键事实（来自 ACP spec + `@agentclientprotocol/sdk` 源码）：

- 浏览器 **能** 作 ACP client：`acp.client()`（browser-safe）+ `createWebSocketStream` ws-client。
- 浏览器 **不能** spawn 本地 CLI 子进程。
- 因此 daemon 必须桥接：spawn agent CLI 子进程（stdio ACP）↔ 重新暴露为 WebSocket ACP 端点。
- SDK 既有：`AcpServer` + `createNodeHttpHandler` / `createNodeWebSocketUpgradeHandler`（Node 桥接侧）、`ndJsonStream`（stdio 适配器）。
- 支持 ACP 的 agent CLI：claude（Anthropic）、codex（OpenAI）、gemini（Google）、goose、opencode、qwen-code、kimi-cli、kiro-cli 等，各自作为子进程以 stdio 说 ACP。
- `session/new` 携带 `cwd`——agent 借此获得文件系统上下文。
- ACP session 发 `sessionUpdate` 通知（`agent_message_chunk`、`tool_call`、`plan`、`agent_thought_chunk`），由 UI 渲染。
- 客户端（浏览器）实现 `requestPermission`、`readTextFile`、`writeTextFile`——这些正是 Skill Creator 注入安全模型（containment check、revision lock）的钩子点。

## 状态分层（来自 config.yaml 原则）

本变更的**所有 session 状态全部 daemon-owned**——浏览器是纯视图层，不持有会话历史或工具调用记录的持久副本：

| 状态                                                    | 存储层                                                                               | 说明                                                   |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| ACP session（messages / tool_calls / plans / thoughts） | **daemon**（子进程池 + ndJsonStream）                                                | daemon 持有；浏览器经 WS 推送渲染，**不存前端 memory** |
| Agent 对话历史                                          | **daemon**（agent 子进程 + session 生命周期内）                                      | daemon 持久；浏览器是视图层，重新连接重新拉取          |
| Session 生命周期（open / close / exited 事件）          | **daemon RPC**（`acp.session.open` / `acp.session.close`）+ WS 推送（`exited` 事件） | daemon-owned                                           |
| sessionId（深链 / tab 身份）                            | **URL**（pathname 或 search param）                                                  | 视图状态真相源；刷新可恢复对 session 的指向            |
| Agent registry（已装 agent 列表）                       | **daemon RPC** `acp.agents.list`（daemon 生命周期缓存）                              | 浏览器从 RPC 渲染选择器，不缓存                        |
| permission prompt 的瞬时 UI 态（弹窗开关）              | **组件级 `$state`**                                                                  | 瞬时 UI                                                |

**会话更新流**：agent 产生 `sessionUpdate` → daemon WS 推送给浏览器 → 浏览器组件渲染该 chunk → **不把会话历史累加进前端全局 `$state`**。浏览器断开重连同一 sessionId 时，由 daemon 重新推送 / 浏览器重新拉取当前 session 视图。

**禁止**：把 ACP 对话历史、tool_call 记录、plan 状态缓存在前端 memory 跨渲染周期；把它们写入 localStorage。

## Goals

- 让 Creator 编辑 Tab 内嵌的 AI 对话面板能对接任意已安装的 ACP-capable agent，无需 per-agent 集成。
- 多 agent：同一时刻可同时跑多个 agent 子进程（每个打开 AI 会话的 Tab 一个）；agent 选择器列出本机已装 agent（来自 `acp.agents.list` RPC）。
- 强制安全：agent 文件操作穿过既有 containment + workspace root 作用域；agent 子进程 `cwd` = 当前激活 workspace provider root。
- 优雅降级：agent 二进制缺失 / spawn 失败 → 返回类型化错误（`UNAVAILABLE`），不崩溃、不阻塞其它会话。
- 最大化复用：传输鉴权复用 `web-server.ts` 既有 upgrade；安全复用 `path-safety.ts` 既有原语；不另起文件系统实现。
- 状态分层合规：ACP session 状态（messages / tool_calls / plans）全部 daemon-owned，浏览器经 WS 推送渲染、不存前端 memory；sessionId 编码到 URL 支持深链。

## Non-Goals

- 远程 agent 端点（本期只桥接本地 stdio agent；远程 HTTP/WS agent 端点延后）。
- agent 自动更新 / 版本管理 UI。
- agent 高级配置 UI（自定义参数、模型选择、env 注入等延后；本期只做默认 spawn）。
- 跨 Tab 的 agent 会话共享（每个 AI 会话独立进程；不把一个 agent 会话投影到多个 Tab）。

## Decisions

### 架构

```text
Browser (Creator edit tab)                Daemon
┌──────────────────────┐         ┌──────────────────────────────────┐
│ ACP client           │         │ ACP bridge service               │
│ @agentclientprotocol │  WS     │                                  │
│ /sdk ws-client       │◄───────►│ /ws/acp/<sessionId>              │
│                      │ JSON-RPC│   │                              │
│ renders:             │ frames  │   ├─ security gate               │
│  agent_message_chunk │         │   │   (containment + root scope)  │
│  tool_call           │         │   │                              │
│  plan                │         │   ├─ subprocess pool             │
│  permission prompt   │         │   │   ┌────────────────────┐     │
│                      │         │   │   │ agent CLI (stdio)  │     │
│ sends:               │         │   │   │ claude / codex /   │     │
│  session/new         │         │   │   │ gemini / ...       │     │
│  session/prompt      │         │   │   └────────────────────┘     │
│  session/cancel      │         │   │     cwd = workspace root     │
│  requestPermission   │         │   │                              │
│  writeTextFile       │─────────┤   │                              │
│  readTextFile        │ gated:  │   └─ session lifecycle           │
│                      │ only    │      (open/focus/close tab       │
│                      │ inside  │       = spawn/keep/kill proc)    │
└──────────────────────┘ root    └──────────────────────────────────┘
```

### D1. 子进程池（daemon 持有全部 session 状态）

```text
Map<sessionId, { proc: ChildProcess, stream: NdJsonStream, root: string, agentId: string }>
```

一个 agent 进程对应一个 Creator AI session。sessionId 由 daemon 在 `acp.session.open` 时生成（opaque token），返回给 WebUI；WebUI 拿它去连 WS。进程数无硬上限，受 OS 资源约束（用户关闭 Tab 即回收）。同一 agent 二进制可被多 session 各自 spawn（彼此独立进程，互不污染上下文）。

**session 状态归属**：会话的 messages / tool_calls / plans / thoughts 全部由 agent 子进程产生、经 daemon 的 ndJsonStream 接收——daemon 是这些状态的 owner。浏览器作为 ws-client 连入后，daemon 通过 WS 把 `sessionUpdate` 推送给浏览器渲染；**浏览器不把会话历史累加进前端全局 `$state` 或 localStorage**，仅作为视图层消费推送。浏览器断开重连同一 sessionId 时，由 daemon 重新建立推送（或按需补发当前可见会话视图），不依赖前端 memory 恢复。

### D2. Agent discovery（agent registry）

启动时（惰性，首次 `acp.agents.list` 触发）探测 PATH 中已知 ACP-capable 二进制：

```text
KNOWN_ACP_AGENTS = [
  { id: "claude",   binary: "claude",   label: "Claude Code", vendor: "anthropic" },
  { id: "codex",    binary: "codex",    label: "Codex",       vendor: "openai" },
  { id: "gemini",   binary: "gemini",   label: "Gemini CLI",  vendor: "google" },
  { id: "goose",    binary: "goose",    label: "Goose",       vendor: "block" },
  { id: "opencode", binary: "opencode", label: "opencode",    vendor: "sst" },
  { id: "qwen-code",binary: "qwen-code",label: "Qwen Code",   vendor: "alibaba" },
  { id: "kimi-cli", binary: "kimi-cli", label: "Kimi CLI",    vendor: "moonshot" },
  { id: "kiro-cli", binary: "kiro-cli", label: "Kiro CLI",    vendor: "aws" },
]
discover():  for each entry: which(binary) -> { id, label, vendor, binaryPath, available: boolean }
```

结果缓存到 daemon 生命周期内（不监听文件系统变化；用户新装 agent 需重启 daemon 才被识别——这是有意的简单性）。`acp.agents.list` 返回带 `available` 标记的列表，UI 只把 `available: true` 的列为可选。

### D3. 安全门

拦截 agent → client 方向的 `readTextFile` / `writeTextFile` 请求（agent 想读/写文件时，请求先到 daemon，daemon 代为执行并把结果返回 agent；agent 永不获得原始文件句柄）：

```text
readTextFile(path):
  resolved = path.resolve(session.root, path)
  assertPathInside(session.root, resolved)   // 既不变量；逃逸即 reject
  return fs.readFile(resolved, "utf8")

writeTextFile(path, content):
  resolved = path.resolve(session.root, path)
  assertPathInside(session.root, resolved)
  atomicWriteUtf8(resolved, content)          // 既有 revision-safe 写（temp + rename）
  return ok
```

`session.root` = 打开 session 时锁定的 workspace provider root（来自 `acp.session.open` 的入参，由 WebUI 从当前激活 Tab 的 workspace target 取得）。整个 session 生命周期内 `root` 不变——agent 无法在运行中改 `cwd` 越界。

### D4. 传输

`/ws/acp/<sessionId>?token=<webToken>`：

- 在 `web-server.ts` 的 `handleUpgrade` 里新增分支：pathname 以 `/ws/acp/` 开头时，先验 token（与 `/ws/rpc` 同一逻辑），再验 sessionId 是否存在于子进程池。
- 鉴权/会话任一失败 → `401/404` 关闭 socket。
- 通过后，WS 只是把 JSON-RPC 帧在「浏览器 WS 客户端 ↔ agent stdio」之间双向 pipe；文件操作帧由安全门在 daemon 侧拦截处理（不透传给 agent 的原始 fs）。
- 一个 sessionId 同时只允许一个 WS 连接（重连先踢旧的）。

### D5. 权限请求

agent 的 `requestPermission`（例如「跑 bash 命令」「写某个文件」）作为 ACP permission prompt 透传到浏览器，UI 弹确认。用户 approve/deny 的结果回传 agent。默认策略：对 workspace root 外的破坏性操作默认 deny（即便用户不响应，超时也 deny）。本期的 permission 透传是「管道 + 默认 deny 超时」，不在 daemon 侧做复杂策略——Skill Creator 的强约束已经由 D3 的文件操作安全门承担。

### D6. 生命周期（daemon RPC 驱动 + URL 持 sessionId 深链）

```text
acp.session.open({ agentId, workspaceTarget }):
  agent = registry.lookup(agentId)
  if !agent.available: -> UNAVAILABLE
  root = resolveWorkspaceProviderRoot(workspaceTarget)   // 既有 workspace-registry
  sessionId = generateOpaqueId("acp")
  proc = spawn(agent.binaryPath, [], { stdio: ["pipe","pipe","pipe"], cwd: root })
  stream = ndJsonStream(proc.stdin, proc.stdout)
  pool.set(sessionId, { proc, stream, root, agentId })
  -> { sessionId }
  // proc 异常退出 -> 发 session 事件 { type: "exited", sessionId, code }（WS 推送）

WS connect(/ws/acp/<sessionId>):
  桥接 browser WS <-> agent stream；文件操作走安全门。
  // daemon 把 agent 的 sessionUpdate 推送给浏览器；浏览器渲染不缓存历史到 memory。

acp.session.close({ sessionId }):
  entry = pool.get(sessionId)
  if entry:
    proc.kill(SIGTERM) -> bounded grace -> SIGKILL
    pool.delete(sessionId)
  -> ok

Tab 关闭（WebUI 侧）-> acp.session.close RPC -> 子进程被杀。
Daemon stop（main.ts 生命周期）-> 遍历 pool 全杀（有界超时）。
```

**URL 深链**：Creator 编辑 Tab 的 URL（基于 change 0/1 Shell 标准，如 `/creator/edit/<wsId>/<provId>/<skillId>?session=acp_xxx`）持 sessionId 作为 search param——刷新可恢复对 session 的指向；浏览器刷新后用该 sessionId 重新连 WS（若 session 仍存活）或提示 session 已结束。sessionId 是视图状态（指向哪个 session），归 URL；session 的实际内容（messages/tool_calls/plans）归 daemon。

### D7. 优雅降级

agent 二进制缺失 / `spawn` 抛错 / 进程立刻退出 → `acp.session.open` 返回 `UNAVAILABLE`（既有错误词汇）；UI 显示「agent unavailable」，不崩溃 daemon、不影响其它 session。ACP 协议握手（`initialize`）走 SDK 的 `safeParse`；版本不兼容时按空值降级（既有破坏性更新策略），session 标记为不可用。

## Risks

- **子进程管理**：daemon 停止时必须杀光所有 agent 子进程，否则孤儿进程会泄漏。**缓解**：在 `main.ts` 的 daemon stop coordinator 里注册一个有界超时（如 2s）的 teardown，遍历 pool `SIGTERM` → grace → `SIGKILL`；进程 `exit`/`uncaughtException` 钩子也兜底一遍。
- **agent 越界**：agent 可能尝试读 `~/.ssh`、写 `~/.bashrc` 等。**缓解**：D3 安全门对所有文件操作强制 `assertPathInside(session.root)`；agent 子进程的 `cwd` = root，且无越权文件句柄。`requestPermission` 对 root 外破坏性操作默认 deny。
- **ACP 协议版本漂移**：agent CLI 升级后协议字段变化。**缓解**：pin SDK 版本；`initialize` 握手用 `safeParse`；字段缺失按空值降级而非崩溃。
- **多进程资源压力**：用户开很多 AI Tab 会拉起很多 agent 进程。**缓解**：本期不做主动限额（用户行为自约束），但子进程池是 per-session 短生命周期（Tab 关即回收），自然封顶；后续可在 registry 上加可选上限。
- **传输层耦合**：在 `web-server.ts` 的 upgrade handler 里加分支会侵入既有文件。**缓解**：新增分支保持与既有 `/ws/rpc` 分支同构（先 token、再路由），不重写既有 WS server；ACP bridge service 通过构造注入拿到 upgrade 回调的注册权，`web-server.ts` 只多一个 `if` 分支。
