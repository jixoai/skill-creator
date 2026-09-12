# dsh-runtime-integration 变更（redesign-model-tabs-and-agent-panel）

## ADDED Requirements

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
