# dsh-webui-composition Specification

## Purpose

以官方 DSH Web profile 与 client plugin composition 作为 Agent 产品宿主：DSH 提供 Agent runtime/UI 基础设施（配置、模型/profile、session、stream、permission、approval），Skill Creator 以 Manager authority 提供 Workspace/Provider/Skill 身份、context snapshot、finding、proposal、revision-safe apply、rollback 与 audit，并在同一 daemon origin 以单一入口（DSH 鉴权握手桥）提供全部 Manager 面。

## Requirements

### Requirement: DSH is the Agent host

The production Agent surface MUST run on the official DSH Web client composition and its plugin/module lifecycle. A generic ACP session, iframe, or second independent chat shell MUST NOT be the Steward product boundary.

#### Scenario: DSH web boot

- **WHEN** the application starts with a compatible DSH installation
- **THEN** the official web profile boot graph activates the Skill Creator client plugin
- **AND** the app exposes one Agent session host and one Manager RPC owner.

### Requirement: Skill Creator is a DSH client plugin

Skill Creator Manager surfaces MUST be registered through the DSH client module/plugin graph with explicit `dsh.client` metadata, lifecycle disposal, and typed remote dependencies.

#### Scenario: plugin activation fails

- **WHEN** a required Skill Creator client bundle or dependency cannot load
- **THEN** boot reports the package/version and recovery command
- **AND** the app does not render a partial or fake-success Agent surface.

### Requirement: DSH UI and Manager authority are composed

The product MUST reuse the official DSH model/profile/session/stream/permission presentation through its client plugins. Workspace, Provider, Skill identity, snapshot, findings, proposals, revision checks, apply, rollback and audit MUST remain Manager-owned.

#### Scenario: Agent asks to mutate a skill

- **WHEN** a DSH tool call proposes or applies a skill change
- **THEN** it is routed through the Manager typed tool registry and approval transaction
- **AND** DSH session state alone cannot mutate a Provider.

### Requirement: one production entry

The product MUST expose one DSH-hosted Agent entry after migration. The previous SvelteKit shell and generic ACP Creator panel MUST NOT remain parallel production Agent surfaces.

#### Scenario: reconnect after daemon restart

- **WHEN** the daemon or DSH session restarts
- **THEN** the same Manager run/audit identity reconnects or reports a typed recovery state
- **AND** no duplicate shell or duplicate mutation owner is created.
