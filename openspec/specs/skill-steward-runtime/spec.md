# skill-steward-runtime Specification

## Purpose

在 contracts 之上提供不依赖外部模型的确定性管家 runtime：Manager 拥有的 skill tool registry 与 capability handshake，fixture Agent adapter 按结构化事件驱动 check、optimize、organize 全链（观察、提议、验证、审批、应用、回滚），作为可重复验证生产协议的 vertical slice，而非 demo backend。

## Requirements

### Requirement: Manager owns domain tools

The runtime MUST expose only the typed skill domain tools defined by the contracts change. Tool calls MUST be scoped to the immutable snapshot and MUST record input, result, revision and permission.

No legacy proposal approval endpoint may mutate a Steward proposal outside the Manager grant and apply transaction. A human-only legacy proposal surface, if retained for existing Manager workflows, MUST use a separately named contract and MUST NOT be callable by the Agent tool registry.

#### Scenario: Legacy approval tries to bypass a Steward grant

- **WHEN** a Steward proposal is sent to the legacy direct approval route without a matching human grant
- **THEN** the Manager rejects it without changing Provider state
- **AND** the audit records the rejected bypass attempt

#### Scenario: Generic file request

- **WHEN** an adapter requests a generic filesystem or shell operation
- **THEN** the Manager rejects it as an unavailable capability and performs no mutation

### Requirement: Apply is revision and approval bound

The Manager MUST revalidate expected revisions and consume a one-time approval token immediately before each apply. A stale or replayed request MUST leave the Provider unchanged.

Validation MUST NOT mint authorization. Only an authenticated human approval action can create the Manager-owned grant; runtime permission decisions cannot substitute for it. Manager derives inverse patches from actual pre-state. Multi-file failures use a durable journal and compensation; incomplete compensation MUST become recovery-required and block further mutations on the affected target.

The rollback tool MUST only prepare a Manager-derived reverse proposal. Applying it MUST require separate human approval bound to the exact reverse patch and current postconditions. Cancellation, proposal revocation and daemon restart MUST invalidate unused grants. An apply already in progress MUST finish its journal or compensation before releasing mutation ownership.

#### Scenario: Agent requests rollback without human approval

- **WHEN** the Agent requests rollback for a completed audit record
- **THEN** Manager prepares a reverse proposal without changing Provider files
- **AND** applying that reverse proposal is denied until a human approves its exact fingerprint

#### Scenario: Skill changed during review

- **WHEN** the Provider revision differs from the proposal's expected revision
- **THEN** apply returns `stale` and creates no partial write

#### Scenario: Agent validates then attempts apply

- **WHEN** validation passes but no human approval exists
- **THEN** apply is denied without mutation even if DSH granted runtime permission

#### Scenario: Compensation encounters an external edit

- **WHEN** a failed multi-file operation cannot compensate without overwriting an external edit
- **THEN** Manager retains the journal and backups, reports recovery-required, and preserves the external edit

### Requirement: Run context and history survive restart

Manager MUST persist immutable bounded snapshots, findings, grants, patch manifests and operation outcomes. Skill document revisions MUST be computed from the same bytes supplied to the analyzer and runtime. Restart MUST not replay consumed grants or automatically resume writes.

#### Scenario: Restart interrupts a split

- **WHEN** the process exits between creation of split targets
- **THEN** startup reconciles the journal before admitting further target writes and exposes the recovered or recovery-required state

### Requirement: Fixture runtime is deterministic

A fixture adapter MUST exercise the same tool, event and lifecycle protocol as a real backend and MUST support deterministic failure injection.

#### Scenario: Late event after cancel

- **WHEN** an event arrives after cancel or terminal disposal
- **THEN** it is recorded as ignored and cannot create, approve or apply a patch
