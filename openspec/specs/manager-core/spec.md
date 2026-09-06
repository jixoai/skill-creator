# manager-core Specification

## Purpose

Consolidate the Skill Creator Manager as the single authority over skills, workspaces, revisions, and enablement.

## Requirements

### Requirement: Manager owns skill authority

The system MUST resolve Workspace, Provider, Skill, Source and Revision identities in the daemon and MUST NOT accept caller-composed mutation paths.

#### Scenario: mutation uses an opaque target

- **WHEN** a caller submits a skill mutation with a Workspace Provider target
- **THEN** the daemon resolves the target from its registry and performs containment checks before touching the filesystem

### Requirement: Invalid external snapshots fail safely

The system MUST parse external snapshots as unknown and project schema-incompatible data to the documented empty or typed-failure result without hiding filesystem or permission errors.

#### Scenario: malformed registry snapshot

- **WHEN** the registry JSON is syntactically valid but does not satisfy the current schema
- **THEN** the daemon starts with an empty current registry and does not rewrite the source file

### Requirement: Mutations are revision safe

The system MUST reject stale Creator mutations and MUST preserve the current file when the expected revision does not match.

#### Scenario: stale update

- **WHEN** an update supplies an old SHA-256 revision
- **THEN** the daemon returns a conflict and leaves the current document unchanged
