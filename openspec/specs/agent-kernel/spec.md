# agent-kernel Specification

## Purpose

DSH 作为 headless 内核驱动 Skill Creator 的 Agent 会话：单 dsh-base bundle 组合、
产品 preset、工具面收窄与 MCP 桥接——shell 是唯一宿主，DSH webui 永不作为产品面。

## Requirements

### Requirement: DSH serves as the headless agent kernel

The daemon MUST compose the official DSH base bundle (`@deepseek-ai/dsh-base`) as a headless in-process kernel that drives agent sessions, settings, approvals and tools. The DSH Web composition (dsh-web-app, web-frontend, host-webserver, client modules) MUST NOT be booted as the product host.

#### Scenario: headless kernel boot

- **WHEN** the daemon starts with a compatible locked DSH installation
- **THEN** the kernel profile activates the base bundle rows without any web rows and without listening on a DSH HTTP port
- **AND** daemon status exposes kernel availability, version and entry facts.

#### Scenario: kernel unavailable

- **WHEN** the kernel composition fails to boot (missing package, version drift, activation failure)
- **THEN** the daemon stays fully functional in Manager-only form with a typed reason
- **AND** the Agent surface projects unavailable without fake success.

### Requirement: agent sessions are kernel-driven products

Agent sessions surfaced in the product MUST be created, resumed, streamed and cancelled through the kernel's agent/session services. The Skill Creator shell MUST NOT spawn a second agent runtime or duplicate session identity.

#### Scenario: session lifecycle

- **WHEN** a user creates, prompts, or cancels a session in the Agent surface
- **THEN** the request is routed through kernel services and projected back as ordered events
- **AND** terminal sessions stop high-frequency refresh.

### Requirement: kernel capability handshake is versioned

The kernel composition MUST pin the DSH package matrix and verify capability availability at boot; drift MUST degrade to typed unavailable with a recovery hint rather than undefined behavior.

#### Scenario: version drift

- **WHEN** an installed DSH package no longer satisfies the locked matrix
- **THEN** boot reports the offending package/version and the daemon continues Manager-only.

### Requirement: kernel tool surface is capability-scoped

The composed kernel MUST disable general-purpose tool rows (bash, fs, and equivalents) for the product composition. Product agent sessions MUST NOT be exposed to general-purpose tools; the global tool table is limited to capability-layer registrations plus an explicit allowlist of kernel interaction tools (for example the ask-user approval tool that feeds panel approval cards). A session request for a general shell/filesystem capability MUST be rejected with an audit record.

#### Scenario: general tool request rejected

- **WHEN** an agent session attempts to invoke a bash or filesystem-equivalent capability
- **THEN** the request is rejected with a typed error and audited
- **AND** the global tool table contains only capability-layer registrations.

### Requirement: steward runs bind kernel sessions

Skill Steward runs MUST keep binding kernel sessions for transcript and tool-round evidence via the existing session binder; the Agent surface is a projection of the same kernel session identity, not a second one.

#### Scenario: steward run binding

- **WHEN** a steward run executes with the kernel available
- **THEN** its run record carries the kernel session id and tool rounds are projected to that session.

### Requirement: agent modes compose prompt section and tool surface

模式的权威注册表 MUST 位于 daemon kernel：每种模式携带版本化 prompt section（free 无专有
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

`agent.session.setMode` MUST 在 running 会话上返回 typed INVALID_OPERATION；否则 MUST 原子更新
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
