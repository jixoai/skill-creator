# Specification: agent-kernel

## ADDED Requirements

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

### Requirement: steward runs bind kernel sessions

Skill Steward runs MUST keep binding kernel sessions for transcript and tool-round evidence via the existing session binder; the Agent surface is a projection of the same kernel session identity, not a second one.

#### Scenario: steward run binding

- **WHEN** a steward run executes with the kernel available
- **THEN** its run record carries the kernel session id and tool rounds are projected to that session.
