# steward-product-workflow 变更（增量：Manager surface → agent-internal 收口）

## REMOVED Requirements

### Requirement: Steward is a complete Manager workflow

**Reason**: The owner decision (2026-09-11) removed the standalone Steward UI;
requiring one Manager-owned workflow UI contradicts the current product. The
replacement requirement below keeps the pipeline and authority semantics while
binding the product face to agent-internal surfaces.

## ADDED Requirements

### Requirement: Steward workflow is agent-internal with Manager authority

The steward analysis pipeline (snapshot, evidence, finding, proposal, validation,
approval, apply, audit, rollback) MUST remain Manager-owned and complete, and
MUST operate as an agent-facing internal surface (capability/MCP tools and
kernel agent runs) instead of a dedicated Manager workflow UI. Steward
proposals MUST surface to the user through the proposal approval faces (the
MCP mutation proposal chain and the skillSteward grant chain). The WebUI MUST
NOT add a steward entry that consumes the `steward.*` RPC face; the daemon
keeps that face as an internal/diagnostic surface.

**Reason**: The owner decision (2026-09-11) removed the standalone Steward UI;
the in-shell Agent panel is the only agent face. Codex review r1 (2026-09-30)
scoped the retirement to UI/hosted semantics — Manager authority, proposals,
approval, audit and rollback all stay.

#### Scenario: Agent-initiated proposal reaches approval

- **WHEN** a steward run produces a proposal
- **THEN** it reaches the user through a proposal approval face with validation
  results and revision bindings
- **AND** no standalone steward workflow view is required to operate the
  pipeline

#### Scenario: No standalone steward entry

- **WHEN** the WebUI is navigated
- **THEN** no route or activity consumes the `steward.*` RPC face, and the
  daemon retains the steward services as an internal surface
