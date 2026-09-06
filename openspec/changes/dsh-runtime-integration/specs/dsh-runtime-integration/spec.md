# DSH Runtime Integration

## ADDED Requirements

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

### Requirement: Stream continuity is terminally safe

Disconnect, cancellation, stale session and daemon stop MUST produce terminal run states; late DSH events MUST be ignored after the run loses ownership.

#### Scenario: Daemon stops during a run

- **WHEN** the daemon stop coordinator closes the DSH stream while a proposal is pending
- **THEN** the run becomes `stopped`, temporary resources are released, and no late event can apply the proposal
