# dsh-runtime-integration Specification

## Purpose

把官方 DeepSeek Harness 组合接入 Skill Creator 的 provider-neutral Agent runtime：capability handshake、版本记录与 unavailable 投影；agent/session/stream/tool callback 适配，并把 Skill Creator domain tools 注册到 agent scope。DSH 只作 runtime 基础设施，不复制其私有数据库或 WebUI 状态。

## Requirements

### Requirement: DSH integration is capability negotiated

The adapter MUST perform an explicit handshake covering harness version, composition rows, agent/session/tools/system-prompt capabilities and stream protocol. A failed handshake MUST produce a typed unavailable state.

#### Scenario: DSH is missing

- **WHEN** the user selects DSH and the executable or required composition is unavailable
- **THEN** the UI shows the reason and Manager deterministic workflows remain usable

### Requirement: Manager remains the authority

DSH session, settings, profile and client stores MUST remain runtime concerns. Skill identity, revision, proposal, approval, apply and audit MUST be resolved by Manager services.

#### Scenario: Agent requests a direct write

- **WHEN** a DSH tool or model asks to write a Provider path outside the domain registry
- **THEN** the request is denied and the Provider is unchanged

### Requirement: Stream continuity is terminally safe

Disconnect, cancellation, stale session and daemon stop MUST produce terminal run states; late DSH events MUST be ignored after the run loses ownership.

#### Scenario: Daemon stops during a run

- **WHEN** the daemon stop coordinator closes the DSH stream while a proposal is pending
- **THEN** the run becomes `stopped`, temporary resources are released, and no late event can apply the proposal
