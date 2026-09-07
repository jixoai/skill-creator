# Specification: dsh-webui-composition

## REMOVED Requirements

### Requirement: DSH is the Agent host

**Reason**: The product host is inverted by change `dsh-kernel-rebase`; DSH serves as the headless agent kernel only.

### Requirement: Skill Creator is a DSH client plugin

**Reason**: Manager surfaces return to the Skill Creator shell; the DSH client plugin and island channel are retired.

### Requirement: one production entry

**Reason**: The single production entry becomes the Skill Creator shell itself; the DSH-hosted entry and its handshake bridge are retired.

## MODIFIED Requirements

### Requirement: DSH UI and Manager authority are composed

The kernel composition MUST provide model/preset/session/permission services to the Skill Creator Agent surface. Workspace, Provider, Skill identity, snapshot, findings, proposals, revision checks, apply, rollback and audit MUST remain Manager-owned.

**Reason**: Authority split is unchanged; the provider of Agent services changes from the DSH Web composition to the headless kernel, and the consumer becomes the in-shell Agent panel.

#### Scenario: Agent asks to mutate a skill

- **WHEN** an agent tool call proposes or applies a skill change
- **THEN** it is routed through the Manager capability layer and approval transaction
- **AND** kernel session state alone cannot mutate a Provider.
