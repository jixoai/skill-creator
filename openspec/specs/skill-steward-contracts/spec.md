# skill-steward-contracts Specification

## Purpose

定义 AI-SKILLS-MANAGEMENT 领域协议：Manager 拥有的上下文快照、任务、结构化响应、专属工具调用与 patch 契约，以及 evidence、observed revision、prompt/tool version、approval token 与 terminal reason 的必填关系。该契约供 fixture、DSH 与 Codex 等 runtime 共同使用，保证 revision、evidence 与 approval 在不同 adapter 中一致且可审计。

## Requirements

### Requirement: Steward context is immutable and revision bound

A steward run MUST record one Workspace.Provider scope, selected skill identities, observed revisions, bounded skill content, prompt version, tool version and backend capabilities before the runtime receives a task.

#### Scenario: Skill changes during a run

- **WHEN** a Provider revision differs from the snapshot revision
- **THEN** all proposals referring to that skill become stale and no mutation is allowed

### Requirement: Agent output is structured

Every finding and proposal MUST include skill identity, observed revision, evidence and contract version. Unknown actions or incomplete payloads MUST be rejected without mutation.

#### Scenario: Incomplete disable recommendation

- **WHEN** the runtime emits a disable recommendation without evidence or expected revision
- **THEN** Manager records a typed rejection and leaves the Provider unchanged

### Requirement: Patches use a closed action union

The patch contract MUST distinguish edit, disable, split and merge actions and MUST carry expected revisions, safe destination names and inverse information required for rollback.

#### Scenario: Unsafe split destination

- **WHEN** a patch names a traversal path or a non direct-child destination
- **THEN** validation rejects the patch before approval and no file is written

### Requirement: Domain tools are finite

The Manager steward contract MUST expose only list_context, inspect, relations, propose, validate_proposal, apply_proposal and rollback as the steward protocol's agent-facing tool surface. Generic filesystem and shell operations MUST NOT be part of the steward protocol.

The capability layer exposed over MCP by change `dsh-kernel-rebase` is a separately governed superset for chat-panel and external consumption: every capability carries an explicit authority class, and mutating capabilities produce proposals for Manager approval rather than direct writes. This superset MUST NOT weaken or bypass the finite steward tool surface.

**Reason**: Scope the original global MUST to the steward protocol boundary; the MCP capability face (governed by authority classes in agent-surface) serves a different consumer set.

#### Scenario: Generic write request

- **WHEN** an Agent asks for a generic file write
- **THEN** the Manager returns a typed unavailable capability result and records the denied call

#### Scenario: MCP superset does not bypass the steward protocol

- **WHEN** an MCP client invokes a steward-domain mutating capability
- **THEN** the result is a proposal routed through the same approval transaction as the steward tool surface
- **AND** the seven-tool steward surface remains the only direct execution path inside steward runs.
