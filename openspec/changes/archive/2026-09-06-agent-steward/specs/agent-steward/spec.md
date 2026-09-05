# Agent Steward

## ADDED Requirements

### Requirement: Steward run is auditable

The system MUST record selected skills, observed revisions, findings, proposals, approvals and terminal status for each steward run.

#### Scenario: completed optimization run

- **WHEN** an Agent proposes and the user applies an optimization
- **THEN** the daemon can show which revisions were analyzed, which patch was applied and which validation passed

## ADDED Requirements

### Requirement: Agent steward operates through Manager

The Agent steward MUST use a provider-neutral harness adapter and MUST receive an isolated execution root or a Manager-approved patch context.

#### Scenario: agent opens a skill maintenance run

- **WHEN** the user starts an analysis or optimization run
- **THEN** the daemon records the selected skills, observed revisions, adapter capabilities and execution root before prompting the Agent

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
