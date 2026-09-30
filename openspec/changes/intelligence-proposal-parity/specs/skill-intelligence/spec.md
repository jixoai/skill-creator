# skill-intelligence 变更（增量：proposal 创建向量统一经 agent tool call）

## ADDED Requirements

### Requirement: All four proposal kinds originate from agent tool calls

Edit, disable, split and merge proposals MUST be created exclusively by agent
tool calls produced in kernel agent sessions (seeded from the Intelligence view
with finding context); the WebUI MUST NOT offer a direct proposal-creation
path. The `skillIntelligence.propose` direct RPC is retired from the WebUI
consumption surface. Approval MUST happen through the unified agent proposals
face, which merges the MCP mutation proposal store and the skill-intelligence
proposal store with `origin: agent-tool` metadata.

#### Scenario: finding action seeds an agent session

- **WHEN** the user picks edit/disable/split/merge from a finding
- **THEN** the Agent panel opens seeded with the finding context and the
  matching propose-tool instruction
- **AND** the resulting proposal is produced by a tool call, not by a form

#### Scenario: no direct creation path remains

- **WHEN** the WebUI is searched for direct proposal-creation calls
- **THEN** no `skillIntelligence.propose` consumer exists and the unified
  approval face is the only decision surface
