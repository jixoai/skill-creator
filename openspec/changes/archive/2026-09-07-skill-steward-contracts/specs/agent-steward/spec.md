# Agent Steward Migration Boundary

## MODIFIED Requirements

### Requirement: Agent steward operates through Manager

The Agent steward MUST use the Manager-owned contracts in `../skill-steward-contracts/spec.md` and an immutable skill context snapshot. A provider-neutral runtime adapter MAY transport model sessions and events, but a generic ACP bridge MUST NOT be the product contract.

#### Scenario: agent opens a skill maintenance run

- **WHEN** the user starts an analysis or optimization run
- **THEN** the daemon records the selected skills, observed revisions, prompt/tool versions and adapter capabilities before prompting the Agent
