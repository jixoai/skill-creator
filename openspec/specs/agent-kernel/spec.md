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

The kernel composition MUST pin the DSH package matrix at `0.1.6-alpha.1` audited against official commit `0a15e36e`; drift MUST degrade to typed unavailable with a recovery hint rather than undefined behavior.

#### Scenario: version drift

- **WHEN** an installed DSH package no longer satisfies the locked matrix
- **THEN** boot reports the offending package/version and the daemon continues Manager-only.

### Requirement: the kernel rides official native subagents for delegation

The product kernel MUST compose the official `@deepseek-ai/dsh-tool-subagent` rows for its Roles instead of a product-side session bridge. Each role is one configured row with a unique model-facing tool name, a `spawn` provider, continuable background mode, a versioned persona section, a structural tool filter, and a bounded depth. Role tool names MUST pass the per-mode product allowlist before the model can call them; sessions in focused modes MUST only see the roles their mode lists.

#### Scenario: role row activates at boot

- **WHEN** the kernel boots with the role catalog
- **THEN** every role's tool-subagent row is active with its distinct tool name
- **AND** a misconfigured row fails the boot activation assertion rather than degrading silently.

#### Scenario: focused mode gates roles

- **WHEN** a focused-mode session requests a role tool not listed for that mode
- **THEN** the call is denied with an audit record
- **AND** the free mode exposes the full role catalog.

### Requirement: subagent children are structurally narrowed and never ask the user

Role subagents MUST be restricted to their declared tool filter at the child-session creation window (hidden and refused, not prompt-only). Every role tool filter MUST deny `ask_user_question` because the panel's user-question answerer binds only the parent context. Child-originated mutations MUST still produce proposals through the human approval chain.

#### Scenario: outside-filter tool is refused structurally

- **WHEN** a role child attempts a tool outside its filter
- **THEN** the tool is neither listed nor executable in the child session
- **AND** the attempt surfaces as a typed refusal, not an approval prompt.

### Requirement: subagent lifecycle is visible and bounded

Subagent children MUST NOT appear in the panel session list (origin `subagent` filtered). Child activity MUST project onto the parent track as subagent frames (spawn, descriptor, catalog, settlement) with child transcripts inspectable. Kernel dispose MUST drain continuable descendants within a bounded window leaving no orphan children.

#### Scenario: settlement returns to the parent transcript

- **WHEN** a continuable role child settles
- **THEN** the parent transcript receives the settlement notice on its next turn
- **AND** the panel shows the subagent frame with the result summary.

#### Scenario: dispose drains children

- **WHEN** the kernel disposes while role children are live
- **THEN** descendants are drained within the bounded teardown window
- **AND** no child process or session survives the kernel handle.

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
