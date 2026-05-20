## ADDED Requirements

### Requirement: Search index freshness SHALL be deterministic

The system SHALL determine index freshness using persisted backend metadata plus a hash derived from the skill reference corpus.

#### Scenario: Existing index is still fresh

- **WHEN** the stored backend metadata and reference hash match the current skill references
- **THEN** the system SHALL reuse the persisted index
- **AND** it SHALL NOT perform a full rebuild

### Requirement: Persisted index artifacts SHALL be backend-neutral

The system SHALL store persisted search artifacts under a backend-neutral skill-local search directory rather than a backend-branded runtime directory.

#### Scenario: Index artifacts are written

- **WHEN** the system builds or updates a persisted search index
- **THEN** it SHALL write the artifacts under `assets/search/`
- **AND** the persisted state SHALL record the active backend identity and schema version

### Requirement: Content mutations SHALL invalidate or refresh index state

Any command that adds, removes, or replaces skill reference content SHALL invalidate or refresh persisted search index state before the next query.

#### Scenario: Context7 content is refreshed

- **WHEN** `download-context7` replaces or updates Context7 slices
- **THEN** the system SHALL invalidate or refresh the persisted search index state
- **AND** the next search SHALL observe the updated reference corpus

#### Scenario: User content is added or updated

- **WHEN** `add-skill`, `remove-skill`, or `remove-context7` changes reference files
- **THEN** the system SHALL invalidate or refresh the persisted search index state
- **AND** the next search SHALL observe the changed files

### Requirement: Search SHALL bootstrap missing indexes locally

If a required persisted index does not exist, `search-skill` SHALL build the required local index and continue the query without requiring a separate manual setup step.

#### Scenario: First search on a new skill

- **WHEN** a user runs `search-skill` for a skill that has no persisted search index yet
- **THEN** the system SHALL build the needed local index
- **AND** it SHALL complete the query in the same command flow
