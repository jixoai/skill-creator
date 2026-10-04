## ADDED Requirements

### Requirement: Workspace exposes physical-root aggregates beside provider declarations

The workspace read projection MUST expose a physical-root aggregate for each Workspace
scope. Each aggregate MUST represent one canonical physical root key (the resolved
realpath when the directory is available, otherwise a normalized absolute fallback),
its unique skill count and availability, and the complete provider declarations that
resolve to that root in catalog order. The existing provider declaration projection
MUST remain available for provider-scoped navigation and operations.

#### Scenario: shared root is one physical row

- **WHEN** multiple catalog providers in one Workspace resolve to the same directory
- **THEN** the physical-root projection contains one row with the union count of that
  root's skills and all declaring provider IDs and labels

#### Scenario: unavailable roots still have deterministic grouping

- **WHEN** a provider root cannot be realpathed because it is missing, broken, or
  inaccessible
- **THEN** the projection uses its normalized absolute fallback key, marks the row
  unavailable, and does not throw or merge it with an available realpath row

#### Scenario: Global and Imported scopes remain separate

- **WHEN** a Global root and an Imported Workspace root resolve to the same physical
  directory
- **THEN** each Workspace projection retains its own physical-root row and its own
  provider declarations; the rows are never merged across Workspace IDs

#### Scenario: provider targets remain addressable

- **WHEN** a caller submits an existing `{workspaceId, providerId}` target for a
  declaration shown inside a physical-root row
- **THEN** the daemon resolves and authorizes that provider target exactly as before,
  without substituting the physical-root row as a provider identity

### Requirement: Workspace location counts use physical roots

The Agents screen and workspace location summary MUST count one location per physical
root row within the relevant Workspace scope. Provider declaration counts MAY remain
available as secondary metadata, but they MUST NOT inflate the physical location count
or the physical-root skill count.

#### Scenario: location count ignores declaration aliases

- **WHEN** ten catalog declarations point to three available physical roots
- **THEN** the location summary reports three locations and the Agents screen renders
  three root rows

#### Scenario: root skill count is unioned once

- **WHEN** several declarations expose the same skill directory through one physical
  root
- **THEN** that skill contributes one to the physical-root count regardless of the
  number of declaring providers

#### Scenario: provider-scoped facets retain their identity

- **WHEN** a user filters skills, opens findings, evaluates a skill, or starts a
  mutation from a declaration label
- **THEN** the operation carries the original Workspace.Provider target and the
  physical-root aggregation does not broaden or rewrite its scope
