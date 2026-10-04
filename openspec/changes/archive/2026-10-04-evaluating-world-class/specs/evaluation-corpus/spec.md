# evaluation-corpus Delta — evaluating-world-class

## MODIFIED Requirements

### Requirement: Run results use the five-state protocol with revision binding

Every run result MUST carry the case id, run id, target triple, expected
(bound) revision, observed start and end revisions, the runner kind and
version, and per-assertion outcome rows. Each assertion row MUST freeze the
assertion `kind`, the canonical `expected` text (the assertion definition's
value at run time), and the `observed` text (what the runner actually saw:
for contains/not-contains a bounded excerpt of the searched text centered on
the first match or its tail when absent; for finding-kind/finding-severity
the sorted unique observed values joined by ", " or an empty string when
none; for finding-triggered the canonical strings "true"/"false") so the
Evaluating detail screen can render the expected-vs-observed diff without
re-reading the case, and later case edits MUST NOT alter already-recorded
results. The outcome MUST be one of passed/failed/error/unavailable/stale:
`passed` only when every assertion passed; `unavailable` only for absent
external dependencies (distinct failure code from `error` execution
failures); `stale` when the target revision diverges from the bound revision
before or during the run. Results are immutable once recorded; later
revision drift marks display-level staleness only. Persisted results that
lack the frozen assertion-row fields are incompatible and MUST project to an
empty envelope (no migration, no write-back).

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

#### Scenario: assertion rows freeze expected/observed at run time

- **WHEN** a run judges a case whose assertions later get edited
- **THEN** the recorded result still renders its assertion rows from the
  frozen `kind`/`expected`/`observed` fields and is unaffected by the edit

#### Scenario: legacy persisted results rebuild empty

- **WHEN** a results file predating the frozen assertion-row fields is read
- **THEN** the store projects an empty envelope and the next accepted write
  rebuilds the file under the current schema
