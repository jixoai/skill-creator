# dsh-runtime-integration Specification

## Purpose

把官方 DeepSeek Harness 组合接入 Skill Creator 的 provider-neutral Agent runtime：capability handshake、版本记录与 unavailable 投影；agent/session/stream/tool callback 适配，并把 Skill Creator domain tools 注册到 agent scope。DSH 只作 runtime 基础设施，不复制其私有数据库或 WebUI 状态。

## Requirements

### Requirement: DSH integration is capability negotiated

The adapter MUST perform an explicit handshake covering harness version, composition rows, agent/session/tools/system-prompt capabilities and stream protocol. A failed handshake MUST produce a typed unavailable state.

#### Scenario: DSH is missing

- **WHEN** the user selects DSH and the executable or required composition is unavailable
- **THEN** the UI shows the reason and Manager deterministic workflows remain usable

### Requirement: Manager remains the authority

DSH session, settings, profile and client stores MUST remain runtime concerns. Skill identity, revision, proposal, approval, apply and audit MUST be resolved by Manager services.

#### Scenario: Agent requests a direct write

- **WHEN** a DSH tool or model asks to write a Provider path outside the domain registry
- **THEN** the request is denied and the Provider is unchanged

### Requirement: the kernel DSH home is app-scoped by default

The daemon kernel host MUST default its DSH storage home to the app-scoped `<homeDir()/>/.skill-creator/dsh-home`, bootstrapping it empty on first boot; a non-blank `DSH_HOME` env override MUST be honored verbatim (the rollback switch to a user harness home). The model-route bridge (settings.yaml / credentials projection) MUST write to the same resolved home as the kernel host, and the user's `~/.dsh` MUST NOT be read or mutated unless selected via the env override.

#### Scenario: incompatible user harness state cannot break the kernel

- **WHEN** the user's real `~/.dsh` holds state the pinned harness family rejects
- **THEN** the product kernel still boots from the app-scoped home and agent sessions work
- **AND** no part of the product writes into `~/.dsh`.

#### Scenario: explicit override

- **WHEN** `DSH_HOME` is set to a non-blank path
- **THEN** the kernel host and the model-route bridge both resolve that path; blank values fall back to the app-scoped default.

### Requirement: Stream continuity is terminally safe

Disconnect, cancellation, stale session and daemon stop MUST produce terminal run states; late DSH events MUST be ignored after the run loses ownership.

#### Scenario: Daemon stops during a run

- **WHEN** the daemon stop coordinator closes the DSH stream while a proposal is pending
- **THEN** the run becomes `stopped`, temporary resources are released, and no late event can apply the proposal

### Requirement: DSH event stream is schema-narrowed at the boundary

Daemon-side consumption of DSH firehose events (tool-call/result payloads, assistant text and reasoning chunks, todo snapshots) MUST safeParse each external payload against the current contract schemas before use. Malformed payloads MUST be discarded with a bounded diagnostic (no full payload logging) and MUST NOT pollute streaming buffers, todo projection, or frame sequencing.

#### Scenario: malformed tool-call payload

- **WHEN** the firehose delivers a tool-call event whose data fails the payload schema
- **THEN** the event is dropped, a single truncated diagnostic is logged, and subsequent well-formed events still produce correct frames in order

#### Scenario: malformed todo snapshot

- **WHEN** a todo payload carries a non-array `todos` field
- **THEN** the panel's todo projection keeps its previous snapshot and no frame is emitted for the malformed payload

### Requirement: Model catalog and attachment payloads carry bounded shapes

The model catalog projection from the pi-ai assembly data MUST expose optional integer `contextWindow` per model when the source carries it (unknown stays absent, never fabricated). User-text attachment thumbnails, when present, MUST be data-URL image payloads within a fixed byte bound; anything failing the shape check projects to no thumbnail rather than reaching the image pipeline.

#### Scenario: context window projection

- **WHEN** the assembly data for a provider carries contextWindow 204800 for a model
- **THEN** the catalog entry exposes that value and route persistence can carry it into settings modelRoutes

#### Scenario: bounded thumbnail

- **WHEN** a replayed attachment thumb is an oversized or non-image data URL
- **THEN** the thumb is dropped (name chip fallback) and the replay still renders the message with its attachment list
