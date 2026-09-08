# agent-kernel 变更

## ADDED Requirements

### Requirement: agent modes compose prompt section and tool surface

模式的权威注册表在 daemon kernel：每种模式携带版本化 prompt section（free 无专有
section）与 MCP 工具名单。agent setup 时按会话模式注入 section，并以 agent-scoped
`tools.guard` 拒绝名单外的 `mcp__skill-creator__*` 调用（返回模式切换指引）；全局
restrict（fs/shell/web 收窄）不因模式放宽。

#### Scenario: 专有模式收窄工具面

- **WHEN** create 模式会话调用 `mcp__skill-creator__repository_scan`
- **THEN** guard 以说明性 reason 拒绝执行；`ask_user_question` 与名单内工具不受影响

#### Scenario: free 模式全工具面

- **WHEN** free 模式会话调用任意 `mcp__skill-creator__*` 工具
- **THEN** 不因模式被拒（全局 deny 面仍生效）

### Requirement: mode switch persists and revives with history

`agent.session.setMode` 在 running 会话上返回 typed INVALID_OPERATION；否则原子更新
转录 meta 的 mode、有界释放 live 句柄（待答以空答案解决）、写入 `mode-changed` 帧。
后续 prompt 经内核 `agents.resume` 以新模式 setup 复活，LLM 历史由内核 session log
重建。转录 meta 缺失/非法 mode 读为 free（旧会话能力的事实投影）。

#### Scenario: 切换后重启 daemon

- **WHEN** 会话切到 manage 后 daemon 重启，用户继续发消息
- **THEN** revive 读取 meta.mode=manage 注入对应 section 与 guard；对话历史与
  mode-changed 帧完整回放

#### Scenario: 模式目录单一事实源

- **WHEN** WebUI 渲染模式卡与 chip
- **THEN** label/description/tokenHint 来自 shared 契约常量，不存在第二份手抄目录
