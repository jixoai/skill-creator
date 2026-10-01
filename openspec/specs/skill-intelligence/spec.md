# skill-intelligence Specification

## Purpose

Read-only skill analysis with revision-locked proposal review.

## Requirements

### Requirement: Skill analysis produces evidence

The system MUST analyze one or more skills into a daemon-owned report containing structure, dependencies, overlap, conflicts, stale indicators and validation findings, with source paths and revisions attached.

#### Scenario: analyze a selected set

- **WHEN** a user selects multiple skills from one or more Providers
- **THEN** the daemon returns a report keyed by stable skill identities and the revisions observed at analysis start

### Requirement: Analysis is read only

Analysis MUST NOT modify skill files, enablement state or registry state.

#### Scenario: analysis detects a conflict

- **WHEN** two selected skills have overlapping triggers or contradictory instructions
- **THEN** the report records a conflict finding and no file or toggle changes occur

### Requirement: Optimization is a reviewed patch

Optimization MUST produce a draft patch or split/merge proposal that requires validation and explicit user approval before any Provider mutation.

#### Scenario: optimize a stale skill

- **WHEN** the Agent proposes an improved description and body
- **THEN** the proposal is stored as a draft against the observed revision and is not applied automatically

### Requirement: All four proposal kinds originate from agent tool calls

Edit, disable, split and merge proposals MUST be created exclusively by agent
tool calls produced in kernel agent sessions (seeded from the Intelligence view
with finding context); the WebUI MUST NOT offer a direct proposal-creation
path. The `skillIntelligence.propose` direct RPC is retired from the WebUI
consumption surface. Approval MUST happen through the unified agent proposals
face, which merges the MCP mutation proposal store and the skill-intelligence
proposal store with `origin: agent-tool` metadata.

#### Scenario: finding action seeds an agent session

- **WHEN** the user picks edit/disable/split/merge from a finding
- **THEN** the Agent panel opens seeded with the finding context and the
  matching propose-tool instruction
- **AND** the resulting proposal is produced by a tool call, not by a form

#### Scenario: no direct creation path remains

- **WHEN** the WebUI is searched for direct proposal-creation calls
- **THEN** no `skillIntelligence.propose` consumer exists and the unified
  approval face is the only decision surface
