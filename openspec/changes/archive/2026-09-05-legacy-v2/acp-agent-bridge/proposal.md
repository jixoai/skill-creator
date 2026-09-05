# Proposal: acp-agent-bridge

## Why

Creator App 的愿景是一个 AI 驱动的技能编写闭环：用 AI 写技能、让 AI 测试它、再根据用法持续改进。这要求编辑器内嵌一个 AI 对话面板。ACP（Agent Client Protocol）是这一场景的开放标准——同一套协议消息（`session/new`、`session/prompt`、`sessionUpdate`、`requestPermission`、`readTextFile`、`writeTextFile`）可以让同一个面板对接任何合规 agent（Claude Code、Codex、Gemini、Goose、opencode 等），无需为每个 agent 各写一遍集成。

但浏览器无法 spawn 本地 CLI 子进程：ACP client 在浏览器里能跑（`@agentclientprotocol/sdk` 的 ws-client），但它没法把 `claude` / `codex` / `gemini` 拉起来。因此 daemon 必须做这道桥：spawn agent CLI 子进程（stdio ACP）↔ 重新暴露成浏览器可连的 WebSocket ACP 端点。这是「浏览器作 ACP client、daemon 作 ACP bridge」的唯一可行拓扑。

同时，用户明确要 **FULL 多 agent 支持**：不是固定接入一个 agent，而是 agent 选择器 + 多进程管理——同一时刻可以为多个 Creator 编辑 Tab 各自跑不同（或相同）的 agent 子进程，互不干扰。本变更落地这套桥接 + 多进程池 + agent 注册表，并把 agent 的文件操作强制收口到 Skill Creator 既有的 containment + workspace root 安全模型。

## What Changes

- 新增 `acp-bridge` daemon 能力：spawn 选定 agent 的 CLI 子进程，把它的 stdio ACP 桥接到一个浏览器可连的 WebSocket 端点。
- 新增 agent registry：探测用户机器上已安装的 ACP-capable agent（claude、codex、gemini、goose、opencode、qwen-code、kimi-cli、kiro-cli 等），缓存到 daemon 生命周期内。
- 新增 per-session 生命周期：每个打开 AI 会话的 Creator 编辑 Tab 拥有自己独立的 agent 子进程；关闭该 Tab 即终止对应子进程。
- 新增安全门：agent 的 `writeTextFile` / `readTextFile` 请求路由穿过 Skill Creator 的 containment check + 当前 workspace root 作用域（agent 只能碰被编辑的那个 workspace，不能访问任意文件系统）。
- 新增 WebSocket 端点 `/ws/acp/<sessionId>`：用与 `/ws/rpc` 同一枚 web token 鉴权，复用 JSON-RPC 帧多路复用。
- **BREAKING**：新增 daemon 域模块 `acp-bridge-service.ts`；新增契约命名空间 `acp`（`acp.agents.list` / `acp.session.open` / `acp.session.close` + session 事件）。破坏性更新策略不变——老 daemon/WebUI 收到新契约无法识别即按空值加载，不做向下兼容。

## Capabilities

### New Capabilities

- `acp-agent-bridge` —— daemon 侧桥接：spawn ACP agent 子进程、把 stdio↔WebSocket 双向桥接、强制文件操作穿过 containment + workspace root 安全门，并维护 per-session 子进程池的完整生命周期。

### Modified Capabilities

<!-- 本变更不修改既有 capability 的 requirements；安全门复用 path-safety.ts 的既有不变量（assertPathInside / atomicWriteUtf8），不改变其语义，仅作为 ACP 文件操作的拦截层注入。 -->

## Impact

- 新增依赖：`@agentclientprotocol/sdk`（零 npm 运行时依赖，仅 zod peer）。
- 新增 daemon 模块：`src/daemon/acp-bridge-service.ts`（子进程池 + stdio↔WS 桥 + 安全门）。
- 新增契约：`src/shared/contracts/acp.ts`（session 生命周期、agent registry 的 Zod schema）；`src/shared/rpc-contract.ts` 增 `acp` 命名空间（`agents.list` / `session.open` / `session.close` + session 事件流）。
- 安全不变量影响：ACP 文件操作必须穿过既有的 `path-safety.ts` containment（`assertPathInside`）+ 当前激活的 workspace provider root。`writeTextFile` 额外走 revision-safe 写入（`atomicWriteUtf8`）。agent 永不获得原始文件系统句柄。
- agent 子进程的 `cwd` 设为当前激活 workspace provider 的 root——这是 ACP `session/new` 携带 `cwd` 的语义出口。
- 传输层：`/ws/acp/<sessionId>?token=<webToken>`，鉴权逻辑与 `/ws/rpc` 一致（`web-server.ts` 的 upgrade handler）；新增的 upgrade 分支只是把帧在「浏览器 WS 客户端 ↔ agent stdio」之间双向 pipe，文件操作由安全门拦截。
