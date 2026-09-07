# agent-steward Specification

## Purpose

Agent steward runs orchestrated by the Manager with auditable lifecycles and explicit approval gates.

## Requirements

### Requirement: Steward run is auditable

The system MUST record selected skills, observed revisions, findings, proposals, approvals and terminal status for each steward run.

#### Scenario: completed optimization run

- **WHEN** an Agent proposes and the user applies an optimization
- **THEN** the daemon can show which revisions were analyzed, which patch was applied and which validation passed

### Requirement: Agent steward operates through Manager

The Agent steward MUST use the Manager-owned contracts in `../skill-steward-contracts/spec.md` and an immutable skill context snapshot. A provider-neutral runtime adapter MAY transport model sessions and events, but a generic ACP bridge MUST NOT be the product contract.

#### Scenario: agent opens a skill maintenance run

- **WHEN** the user starts an analysis or optimization run
- **THEN** the daemon records the selected skills, observed revisions, prompt/tool versions and adapter capabilities before prompting the Agent

### Requirement: Agent changes require approval

The system MUST stage Agent file changes as patches and MUST require validation plus explicit user approval before applying them to an Imported Provider.

#### Scenario: Agent suggests a merge

- **WHEN** an Agent proposes merging two skills
- **THEN** the UI shows the patch, affected identities, validation findings and approval action without changing the originals

### Requirement: Agent lifecycle is terminally bounded

The daemon MUST handle cancel, disconnect, process exit and shutdown as explicit terminal states and MUST not retain orphan processes or late writes.

#### Scenario: daemon stops during a run

- **WHEN** the daemon receives stop while an Agent run is active
- **THEN** it closes admission, cancels the run, rejects late events and removes unowned draft resources
