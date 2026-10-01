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
