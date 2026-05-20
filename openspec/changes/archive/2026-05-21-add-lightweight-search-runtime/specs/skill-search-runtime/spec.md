## ADDED Requirements

### Requirement: Default skill search SHALL run in-process

The system SHALL provide a default skill search runtime that runs inside the CLI process and MUST NOT require a separately managed local service, open network port, GPU runtime, or network access to search local skill references.

#### Scenario: Search a local skill without external services

- **WHEN** a user runs `search-skill` against a skill directory containing local reference files
- **THEN** the system SHALL search those references using an in-process backend
- **AND** the system SHALL NOT require starting or connecting to an external local service

### Requirement: Search backends SHALL implement a stable contract

The system SHALL interact with search backends only through a stable backend contract that exposes initialization, indexing, search, clearing, statistics, and backend identity/metadata.

#### Scenario: Commands use backend contract only

- **WHEN** CLI commands build an index, query an index, or clear an index
- **THEN** they SHALL call backend contract methods
- **AND** they SHALL NOT inspect backend implementation types, server internals, or backend-specific object shapes

### Requirement: Public search modes SHALL be behavior-based

The public CLI SHALL expose search modes by behavior or explicit capability instead of backend vendor name. The stable modes SHALL be `auto`, `fulltext`, `fuzzy`, and `vector`.

#### Scenario: User selects the full-text mode

- **WHEN** a user runs `search-skill --mode fulltext <query>`
- **THEN** the system SHALL use the default full-text backend

#### Scenario: User selects the vector mode

- **WHEN** a user runs `search-skill --mode vector <query>`
- **THEN** the system SHALL use the configured vector backend
- **AND** that backend SHALL remain separate from the default full-text path

#### Scenario: Legacy chroma spelling is requested

- **WHEN** a user runs `search-skill --mode chroma <query>`
- **THEN** the CLI SHALL map it to `--mode vector` as an undocumented legacy alias
- **AND** `chroma` SHALL NOT appear as a stable documented mode

### Requirement: Search results SHALL preserve provenance and user priority

Search results SHALL include provenance for every match, including source type and file path. When user-authored and Context7-authored results are otherwise comparable, user-authored content SHALL rank ahead.

#### Scenario: Comparable user and Context7 results exist

- **WHEN** a query matches both `assets/references/user` and `assets/references/context7`
- **THEN** each result SHALL include its provenance metadata
- **AND** user-authored results SHALL rank ahead when their scores are otherwise comparable

### Requirement: Auto mode SHALL compose full-text and fuzzy behavior

The `auto` mode SHALL orchestrate between the default full-text backend and the fuzzy backend using explicit quality rules. In this change, it SHALL NOT automatically invoke vector search.

#### Scenario: Full-text search is insufficient

- **WHEN** `auto` mode produces empty or low-quality results from the full-text backend
- **THEN** the system SHALL run the fuzzy backend
- **AND** it SHALL return merged or fallback results according to explicit quality rules

### Requirement: Vector mode SHALL remain explicit until replacement proof is complete

The vector backend SHALL be activated only through explicit mode selection until the replacement verification matrix proves it belongs in the automatic path.

#### Scenario: Vector backend exists but auto mode is unresolved

- **WHEN** `vector` mode is implemented but the automatic composition policy is not yet proven
- **THEN** `auto` mode SHALL continue to use the proven default composition
- **AND** vector search SHALL remain available through explicit `--mode vector`

### Requirement: ChromaDB removal SHALL be gated by verified replacement coverage

The system SHALL NOT remove ChromaDB from the product until the replacement runtime passes the defined replacement verification matrix for indexing, mutation handling, and end-to-end skill search workflows.

#### Scenario: Replacement verification is incomplete

- **WHEN** the replacement runtime has not yet passed the defined verification matrix
- **THEN** the system SHALL NOT claim ChromaDB is fully replaced
- **AND** the change SHALL remain in a pre-removal state
