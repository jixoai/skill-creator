## ADDED Requirements

### Requirement: Minimal read-only evaluation view

The WebUI MUST provide a read-only evaluation view for a saved (edit-mode)
skill in the Creator that lists the skill's evaluation cases and, for each
case, the latest recorded result. The five outcome states (passed / failed /
error / unavailable / stale) MUST be visually distinguishable from one
another, and each result row MUST surface the observed end revision. The view
MUST NOT provide case creation, mutation, run start, cancel, or any other
evaluation write affordance — authoring and running remain CLI/MCP/RPC-only.

#### Scenario: list cases with latest outcomes

- **WHEN** an edit-mode skill has evaluation cases and recorded results
- **THEN** the view lists each case with its prompt summary, enabled state,
  assertion count, and the latest result's outcome badge and observed end
  revision, selecting the latest result per case by newest completion time

#### Scenario: no cases for a saved skill

- **WHEN** an edit-mode skill has no evaluation cases
- **THEN** the view shows an empty state directing to CLI/MCP for case
  creation and renders no mutation affordances

#### Scenario: unsaved skill issues no evaluation RPC

- **WHEN** the creator draft has no stable skill identity (new mode)
- **THEN** the view shows the save-first empty state and issues no evaluation
  RPC

#### Scenario: superseded or disconnected loads never project data

- **WHEN** an evaluation load is superseded by a newer request or the daemon
  connection is replaced before the response arrives
- **THEN** the stale response commits neither rows nor errors to the view
  state (no fabricated data)
