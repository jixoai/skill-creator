# evaluation-corpus Specification

## Purpose

Server-owned evaluation cases and five-state run results bound to skill revisions.

## Requirements

### Requirement: Evaluation cases are server-owned and Imported-scoped

Evaluation cases MUST persist under the daemon-owned evaluation directory
(`appDir()/evaluation/<workspaceId>/<providerId>/<skillId>/`), never inside a
skill directory. Case mutation MUST be limited to Imported Workspaces; the
Global Workspace is read-only. Persistence MUST round-trip through the current
schema with incompatible content projected to an empty envelope (no migration,
no write-back).

#### Scenario: global scope rejects writes

- **WHEN** a case create/update/remove targets the Global Workspace
- **THEN** the RPC rejects with a typed error and nothing is written

#### Scenario: restart recovery

- **WHEN** a cases file is corrupt or incompatible at read time
- **THEN** the store projects an empty envelope and subsequent writes rebuild
  the file from the accepted in-memory state

### Requirement: Run results use the five-state protocol with revision binding

Every run result MUST carry the case id, run id, target triple, expected
(bound) revision, observed start and end revisions, the runner kind and
version, and per-assertion outcomes. The outcome MUST be one of
passed/failed/error/unavailable/stale: `passed` only when every assertion
passed; `unavailable` only for absent external dependencies (distinct
failure code from `error` execution failures); `stale` when the target
revision diverges from the bound revision before or during the run. Results
are immutable once recorded; later revision drift marks display-level
staleness only.

#### Scenario: unavailable never passes

- **WHEN** the provider model is unreachable during a provider-model run
- **THEN** the result is `unavailable` with a MODEL_UNAVAILABLE-family failure
  code and no assertion is recorded as passed

#### Scenario: revision drift before the run

- **WHEN** the skill's current revision differs from the case's bound revision
- **THEN** the run records `stale` without executing assertions

#### Scenario: real-model evidence

- **WHEN** a provider-model run completes
- **THEN** the runner version records the prompt/tool/DSH version triple for
  GOAL completion audits

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
