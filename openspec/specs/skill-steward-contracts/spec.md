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

The Manager contract MUST expose only list_context, inspect, relations, propose, validate_proposal, apply_proposal and rollback. Generic filesystem and shell operations MUST NOT be part of the steward protocol.

#### Scenario: Generic write request

- **WHEN** an Agent asks for a generic file write
- **THEN** the Manager returns a typed unavailable capability result and records the denied call
