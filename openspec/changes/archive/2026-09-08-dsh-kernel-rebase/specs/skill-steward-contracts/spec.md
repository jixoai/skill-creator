# Specification: skill-steward-contracts

## MODIFIED Requirements

### Requirement: Domain tools are finite

The Manager steward contract MUST expose only list_context, inspect, relations, propose, validate_proposal, apply_proposal and rollback as the steward protocol's agent-facing tool surface. Generic filesystem and shell operations MUST NOT be part of the steward protocol.

The capability layer exposed over MCP by change `dsh-kernel-rebase` is a separately governed superset for chat-panel and external consumption: every capability carries an explicit authority class, and mutating capabilities produce proposals for Manager approval rather than direct writes. This superset MUST NOT weaken or bypass the finite steward tool surface.

**Reason**: Scope the original global MUST to the steward protocol boundary; the MCP capability face (governed by authority classes in agent-surface) serves a different consumer set.

#### Scenario: Generic write request

- **WHEN** an Agent asks for a generic file write
- **THEN** the Manager returns a typed unavailable capability result and records the denied call

#### Scenario: MCP superset does not bypass the steward protocol

- **WHEN** an MCP client invokes a steward-domain mutating capability
- **THEN** the result is a proposal routed through the same approval transaction as the steward tool surface
- **AND** the seven-tool steward surface remains the only direct execution path inside steward runs.
