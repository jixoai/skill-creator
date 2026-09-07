# Specification: steward-product-workflow

## MODIFIED Requirements

### Requirement: Steward is a complete Manager workflow

The UI MUST provide task and scope selection, runtime configuration, event/tool visibility, evidence, patch diff, validation, approval, rollback and terminal recovery in one Manager-owned workflow.

This workflow MUST run inside the Skill Creator shell as a Manager surface, with the Agent panel available in the same shell. It MUST NOT depend on the DSH client composition, a Svelte island channel, or a DSH-hosted entry; store semantics (generation gates, terminal polling stop, scope guards) carry over unchanged.

**Reason**: Change `dsh-kernel-rebase` retires the DSH web-hosted product path; the workflow keeps its Manager-owned semantics but rebinds to the Skill Creator shell.

#### Scenario: User approves an optimization

- **WHEN** validation succeeds for the exact observed revisions
- **THEN** the UI shows the patch, affected skills and one explicit approval action before apply

#### Scenario: Workflow after host inversion

- **WHEN** the product runs in the Skill Creator shell
- **THEN** the steward workflow is reachable as a Manager surface with the Agent panel in-shell
- **AND** no DSH web composition, island channel, or entry handshake is required to operate the workflow.
