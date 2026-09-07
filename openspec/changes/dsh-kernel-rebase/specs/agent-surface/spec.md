# Specification: agent-surface

## ADDED Requirements

### Requirement: Skill Creator shell is the sole product host

The Skill Creator shell (ChromeTabs apps + OpenTray window) MUST be the only production host and entry. The Agent surface MUST live inside this shell; no second window, iframe, or DSH-hosted page may serve as the product boundary.

#### Scenario: single entry

- **WHEN** a user opens the daemon WebUI
- **THEN** the Skill Creator shell loads directly with the Agent panel available in-shell
- **AND** no DSH web handshake, plugin boot, or island channel is required to reach product features.

### Requirement: agent panel is a first-class in-shell surface

The Agent panel MUST provide session list/switching, conversation stream with expandable tool rows, approval request cards, terminal narratives, and model/preset/permission configuration projection. It MUST survive tab navigation, degrade visibly on disconnect, and avoid stale projections after scope switches.

#### Scenario: conversation with tool round

- **WHEN** a session produces agent messages and tool calls
- **THEN** the panel renders ordered events with tool rows whose inputs/results are inspectable
- **AND** approval-requiring calls surface as decision cards routed to the Manager approval chain.

#### Scenario: narrow viewport

- **WHEN** the window is 680px wide
- **THEN** the panel switches to a single-screen overlay mode without horizontal overflow.

### Requirement: capabilities are defined once and projected twice

Skill Creator domain capabilities MUST be declared in one capability layer (name, Zod input/output, handler, authority class). The same declarations MUST be projected both as kernel tools for in-shell agent sessions and as MCP tools/resources for external MCP-capable clients.

#### Scenario: in-shell tool projection

- **WHEN** an agent session calls a Skill Creator capability
- **THEN** it executes through the capability layer with the declared authority class enforced.

#### Scenario: MCP projection

- **WHEN** an external MCP client lists tools or reads resources from the Skill Creator MCP server
- **THEN** it receives the same capability set with schema-faithful descriptors
- **AND** mutating capabilities produce proposals for Manager approval instead of direct writes.

### Requirement: MCP exposure keeps Manager authority

The MCP surface MUST NOT bypass Manager authority: loopback-only HTTP with daemon token auth, stdio only for explicit local launch, and every mutation routed through the proposal/approval/audit chain.

#### Scenario: external MCP mutation request

- **WHEN** an external client invokes a mutating capability over MCP
- **THEN** the result is a proposal awaiting human approval with audit records
- **AND** no filesystem write occurs outside the Manager-owned transaction path.

### Requirement: hosted-DSH product path is retired

After this change, the DSH web-hosted product path (web composition host, entry handshake bridge, Manager island channel, vendored client plugin) MUST be removed from the product and from the shipped package; kernel-side assets (version lock, heal, lifecycle) remain.

#### Scenario: package contents

- **WHEN** the production package is packed
- **THEN** it contains no dsh-client plugin vendor directory and no web-composition dependencies
- **AND** the clean-install drill boots the kernel form with the in-shell Agent panel.
