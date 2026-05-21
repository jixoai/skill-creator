# Skill Knowledge Management

## Purpose

Define the stable contract for how user-authored skill knowledge is added, deduplicated, replaced, and appended over time.

## Requirements

### Requirement: User knowledge writes SHALL operate on knowledge, not raw files

The system SHALL treat `add-skill` as a knowledge management command rather than a raw file append or overwrite primitive.

#### Scenario: A new user note is added

- **WHEN** a user runs `add-skill` with content that does not materially match an existing knowledge note
- **THEN** the system SHALL create a user knowledge note under `assets/references/user/`
- **AND** the note SHALL be rendered through the canonical knowledge note format

### Requirement: Duplicate knowledge SHALL be skipped before file conflicts surface

The system SHALL detect duplicate or already-comprehensive knowledge before falling back to filename-level conflicts.

#### Scenario: Same knowledge is submitted again

- **WHEN** a user runs `add-skill` with content that is materially duplicate to an existing user note
- **THEN** the system SHALL skip the write
- **AND** it SHALL report that the existing content is already comprehensive enough
- **AND** it SHALL NOT surface a raw `File already exists` conflict first

### Requirement: Knowledge replacement SHALL target the closest user note

The `--force` option SHALL replace the closest matching user-authored knowledge note rather than only overwriting a same-title file path.

#### Scenario: Force replacement uses the best user merge target

- **WHEN** a user runs `add-skill --force` with content that best matches an existing user note with a different title
- **THEN** the system SHALL replace that closest user note
- **AND** it SHALL preserve knowledge-level merge behavior independent of filename equality

### Requirement: Knowledge append SHALL use a stable update structure

The `--force-append` option SHALL append structured knowledge updates into the closest matching user-authored note.

#### Scenario: Force append targets an existing user note

- **WHEN** a user runs `add-skill --force-append` and the system finds a closest matching user note
- **THEN** the system SHALL append the new content under a stable `## Knowledge updates` section
- **AND** each appended entry SHALL use a deterministic `### Update N: <title>` heading
- **AND** it SHALL NOT fall back to raw markdown separators as the append contract

### Requirement: Canonical note rendering SHALL normalize repeated headings

The system SHALL normalize repeated top-level headings when rendering or updating a user-authored knowledge note.

#### Scenario: Content already contains the same leading heading

- **WHEN** a user submits content whose first heading matches the note title being rendered
- **THEN** the system SHALL strip the duplicated leading heading from the body before storing it
- **AND** the stored note SHALL keep a single canonical top-level heading

### Requirement: User knowledge mutations SHALL preserve search freshness

Any user-authored knowledge mutation SHALL invalidate persisted search state before the next query.

#### Scenario: User knowledge is replaced or appended

- **WHEN** `add-skill` adds, updates, replaces, or appends a user knowledge note
- **THEN** the system SHALL invalidate persisted search state
- **AND** the next `search-skill` query SHALL observe the updated knowledge corpus
