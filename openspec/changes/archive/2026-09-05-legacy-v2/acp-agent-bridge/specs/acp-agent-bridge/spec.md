# Capability: acp-agent-bridge

daemon 侧 ACP 桥接：发现本机已安装的 ACP-capable agent、为每个 Creator AI 会话 spawn 独立 agent 子进程、在浏览器 WebSocket 与 agent stdio 之间双向桥接 JSON-RPC 帧，并强制所有 agent 文件操作穿过 containment + workspace root 安全门。

## ADDED Requirements

### Requirement: Daemon 发现并暴露已安装的 ACP Agent

daemon MUST 探测本机 PATH 中已知的 ACP-capable agent 二进制（claude、codex、gemini、goose、opencode、qwen-code、kimi-cli、kiro-cli 等），并通过 `acp.agents.list` RPC 返回带 `available` 标记的列表；探测结果在 daemon 生命周期内缓存。

#### Scenario: 列出本机已安装的 agent

- **WHEN** WebUI 首次调用 `acp.agents.list`
- **THEN** daemon 探测 PATH 中已知 ACP-capable 二进制
- **AND** 返回列表，每项含 `id`、`label`、`vendor`、`binaryPath` 与 `available`（`which` 命中即为 true）
- **AND** 探测结果被缓存，后续调用不再重新探测

#### Scenario: 未安装任何 agent 返回空可用集

- **WHEN** 用户机器上未安装任何已知 ACP-capable agent
- **THEN** `acp.agents.list` 返回的列表中所有项 `available` 为 false（或可用集为空）
- **AND** 不抛错、不崩溃 daemon

### Requirement: 打开 AI 会话即 spawn 选定 Agent 子进程

打开一个 Creator AI 会话（`acp.session.open`）MUST spawn 用户选定的 agent 作为子进程，其 `cwd` 设为当前激活 workspace provider 的 root，并返回一个 opaque sessionId 供 WebUI 连接 WebSocket。

#### Scenario: 成功打开会话并 spawn agent

- **WHEN** WebUI 调用 `acp.session.open({ agentId, workspaceTarget })` 且该 agent `available`
- **THEN** daemon 解析 `workspaceTarget` 得到 workspace provider root
- **AND** 以该 root 为 `cwd` spawn 选定 agent 的二进制（stdio 管道）
- **AND** 注册一个新条目到子进程池，生成 opaque sessionId
- **AND** 返回 `{ sessionId }` 给 WebUI

#### Scenario: 选定 agent 不可用时返回类型化错误

- **WHEN** WebUI 调用 `acp.session.open` 但选定 agent 二进制不存在或 spawn 抛错
- **THEN** daemon 返回 `UNAVAILABLE` 错误（既有错误词汇）
- **AND** 不在子进程池中注册任何条目
- **AND** daemon 不崩溃，其它已存在的会话不受影响

### Requirement: ACP 消息在浏览器与 Agent 之间实时双向桥接

浏览器连上 `/ws/acp/<sessionId>` 后，daemon MUST 在浏览器 WebSocket 与 agent stdio 之间实时双向 pipe JSON-RPC 帧（含 `session/new`、`session/prompt`、`session/cancel`、`sessionUpdate` 通知），使 UI 能渲染 `agent_message_chunk`、`tool_call`、`plan`、`agent_thought_chunk`。

#### Scenario: 浏览器发送 prompt 流式收到 agent 输出

- **WHEN** 浏览器经 WS 发送 `session/prompt` 帧给一个已连接的 session
- **THEN** daemon 把该帧写入 agent 的 stdin
- **AND** agent 产生的 `sessionUpdate` 通知（`agent_message_chunk` / `tool_call` / `plan` 等）被实时回传到浏览器 WS
- **AND** 帧顺序与 agent 产出顺序一致（不重排、不合并）

#### Scenario: 无效 sessionId 的 WS 连接被拒绝

- **WHEN** 浏览器尝试连接 `/ws/acp/<不存在的 sessionId>`
- **THEN** daemon 在 upgrade 阶段关闭 socket（404 语义）
- **AND** 不创建任何新会话

#### Scenario: 同一 sessionId 重连先踢旧连接

- **WHEN** 同一 sessionId 已有一个活跃 WS 连接，又来一个新 WS 连接
- **THEN** 旧连接被关闭
- **AND** 新连接接管该 session 的桥接
- **AND** agent 子进程不被重启

### Requirement: Agent 文件操作被 Containment + Root 作用域拦截

agent 发出的 `readTextFile` / `writeTextFile` 请求 MUST 由 daemon 拦截代为执行：路径先 resolve 到 session 的 workspace root，再过既有 `assertPathInside` containment check；越界路径一律拒绝，agent MUST NOT 获得原始文件系统句柄。

#### Scenario: agent 读取 root 内文件成功

- **WHEN** agent 对 session root 内的相对路径发 `readTextFile`
- **THEN** daemon 把路径 resolve 到 session root
- **AND** 该绝对路径通过 `assertPathInside(session.root, resolved)`
- **AND** daemon 代为读取并以 UTF-8 内容回传 agent

#### Scenario: agent 读取 root 外文件被拒绝

- **WHEN** agent 发 `readTextFile` 指向 session root 之外的路径（如 `~/.ssh/config`、`../escape`）
- **THEN** `assertPathInside` 抛 containment 错误
- **AND** daemon 向 agent 回一个错误响应（不读文件、不泄露内容）
- **AND** session 不被终止（agent 可继续在 root 内工作）

### Requirement: writeTextFile 走 Revision-safe 原子写

agent 的 `writeTextFile` 在通过 containment 后，MUST 用既有的 revision-safe 原子写（临时文件 + rename）落盘，避免半写损坏既有技能文件。

#### Scenario: agent 写 root 内文件走原子写

- **WHEN** agent 对 session root 内路径发 `writeTextFile({ path, content })` 且路径通过 containment
- **THEN** daemon 调用既有 `atomicWriteUtf8`（写临时文件 mode 0600 → rename）
- **AND** 写成功后向 agent 回 ok
- **AND** 中途进程崩溃不会留下半写的主文件（最多残留一个 temp，下次写覆盖）

### Requirement: 关闭 AI 会话终止 Agent 子进程

关闭一个 Creator AI 会话（`acp.session.close` 或 Tab 关闭触发）MUST 终止对应的 agent 子进程并从池中清理。

#### Scenario: 显式关闭会话杀进程

- **WHEN** WebUI 调用 `acp.session.close({ sessionId })` 且该 session 存在
- **THEN** daemon 向 agent 子进程发 `SIGTERM`
- **AND** 经有界宽限期后仍未退出则发 `SIGKILL`
- **AND** 从子进程池删除该条目
- **AND** 返回 ok

#### Scenario: 关闭不存在的会话是幂等

- **WHEN** WebUI 调用 `acp.session.close({ sessionId })` 但该 session 不在池中（已被清理）
- **THEN** daemon 返回 ok（不抛错）
- **AND** 不影响其它会话

### Requirement: Daemon 停止有界杀光全部 Agent 子进程

daemon 停止（用户 `skill-creator stop` 或进程退出）时，MUST 遍历子进程池，在有界超时内杀光全部 agent 子进程，避免孤儿进程泄漏。

#### Scenario: daemon stop 杀光 agent 子进程

- **WHEN** daemon 收到停止信号且子进程池非空
- **THEN** 对每个 agent 子进程发 `SIGTERM`
- **AND** 经有界宽限期（如 2s）仍未退出的发 `SIGKILL`
- **AND** 在宽限期内完成 teardown，不无限阻塞 daemon 退出

#### Scenario: agent 进程异常退出广播会话事件

- **WHEN** 某个 agent 子进程在 session 显式关闭前异常退出（非零退出码 / 被信号杀死）
- **THEN** daemon 经 oRPC 事件流发一个 `{ type: "exited", sessionId, code }` 会话事件
- **AND** 从子进程池删除该条目
- **AND** 不影响其它会话的 agent 子进程

### Requirement: WebSocket 端点复用 web token 鉴权

`/ws/acp/<sessionId>` MUST 复用与 `/ws/rpc` 同一枚 web token 鉴权；token 校验失败的连接在 upgrade 阶段被拒绝。

#### Scenario: 携带正确 token 的连接被接受

- **WHEN** 浏览器连接 `/ws/acp/<sessionId>?token=<正确的 webToken>` 且 sessionId 存在
- **THEN** upgrade 成功，WS 建立
- **AND** 开始双向桥接 JSON-RPC 帧

#### Scenario: 携带错误 token 的连接被拒绝

- **WHEN** 浏览器连接 `/ws/acp/<sessionId>?token=<错误值>`
- **THEN** upgrade 阶段关闭 socket（401 语义）
- **AND** 不与 agent stdio 建立任何桥接
