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

### Requirement: capabilities are served over MCP via the official bridge

Skill Creator domain capabilities MUST be declared in one capability layer (name, Zod input/output, handler, authority class) and exposed by the skill-creator-mcp MCP server. In-shell agent sessions MUST consume them through the official `@deepseek-ai/dsh-mcp-client` plugin composed into the kernel; external MCP clients use the same server. No bespoke tool-projection bridge may be interposed.

#### Scenario: in-shell consumption through the official bridge

- **WHEN** an agent session calls a Skill Creator capability
- **THEN** the call travels the MCP path via dsh-mcp-client and executes through the capability layer with the declared authority class enforced.

#### Scenario: external MCP client via the daemon endpoint

- **WHEN** an external MCP client connects to the daemon `/mcp` endpoint
- **THEN** it receives the full capability set with schema-faithful descriptors
- **AND** mutating capabilities produce proposals for Manager approval instead of direct writes.

#### Scenario: external MCP client via standalone stdio

- **WHEN** an external MCP client spawns `skill-creator mcp` (stdio)
- **THEN** it receives the first-phase standalone subset: readonly plus propose capabilities
- **AND** proposals created in this form are returned to the client for its own handling rather than persisted to Manager storage; the full set awaits a cross-process single-writer protocol in a later change.

### Requirement: agent output uses MCP Apps cards when guided

The system prompt MUST include versioned best-practice guidance telling the agent when to answer with MCP Apps cards (`ui://` HTML resources) instead of plain text. The panel MUST render such cards per the MCP Apps specification (sandboxed iframe, postMessage JSON-RPC) and translate in-card navigation intents into shell routes.

#### Scenario: card-worthy answer

- **WHEN** the agent presents a skill, finding, proposal, or install/update result in a session
- **THEN** guided output carries the `ui://` card resource and the panel renders it with in-app navigation
- **AND** the same resource remains protocol-valid for any MCP Apps capable host.

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
