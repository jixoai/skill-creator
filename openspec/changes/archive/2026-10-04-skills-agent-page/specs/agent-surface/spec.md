# agent-surface 变更（增量：Agent 工作台页面化）

## MODIFIED Requirements

### Requirement: agent panel is a first-class in-shell surface

The Agent surface MUST live as the fixed, non-closable SkillsAgentPage tab: a
left sessions tree grouped by workspace target binding (unattributed legacy
sessions grouped as read-only Unassigned), the center chat (transcript +
composer), a right extension panel (agent terminal narrative stream, proposal
approvals, ui:// cards), and a bottom human terminal region — with visibility
and sizing persisted in DevicePrefs. A per-workspace attach panel MUST live
inside workspace pages listing that workspace's sessions. Both surfaces MUST
consume the same kernel session identity: opening one session in both places
MUST project identical transcript streams, and each surface MUST badge the
concurrent open. The surface MUST degrade visibly on disconnect, avoid stale
projections after scope switches, and degrade the extension panel and terminal
to overlay drawers below 1024px width. The shell-level drawer form is retired.

#### Scenario: conversation with tool round

- **WHEN** a session produces agent messages and tool calls
- **THEN** the surface renders ordered events with tool rows whose
  inputs/results are inspectable
- **AND** approval-requiring calls surface as decision cards routed to the
  Manager approval chain.

#### Scenario: dual open projects one truth

- **WHEN** the same session is open in SkillsAgentPage and a workspace panel
- **THEN** both transcript projections render the same ordered frames and each
  surface shows the concurrent-open badge

#### Scenario: deep link opens the agent page

- **WHEN** the user follows `/agent?session=<id>` from a workspace panel
- **THEN** SkillsAgentPage activates that session

#### Scenario: narrow viewport

- **WHEN** the window is below 1024px wide
- **THEN** the extension panel and terminal degrade to overlay drawers without
  horizontal overflow, and the sessions tree collapses
