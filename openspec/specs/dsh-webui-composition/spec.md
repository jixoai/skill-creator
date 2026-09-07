# dsh-webui-composition Specification

## Purpose

以官方 DSH Web profile 与 client plugin composition 作为 Agent 产品宿主：DSH 提供 Agent runtime/UI 基础设施（配置、模型/profile、session、stream、permission、approval），Skill Creator 以 Manager authority 提供 Workspace/Provider/Skill 身份、context snapshot、finding、proposal、revision-safe apply、rollback 与 audit，并在同一 daemon origin 以单一入口（DSH 鉴权握手桥）提供全部 Manager 面。

## Requirements

### Requirement: DSH UI and Manager authority are composed

The kernel composition MUST provide model/preset/session/permission services to the Skill Creator Agent surface. Workspace, Provider, Skill identity, snapshot, findings, proposals, revision checks, apply, rollback and audit MUST remain Manager-owned.

**Reason**: Authority split is unchanged; the provider of Agent services changes from the DSH Web composition to the headless kernel, and the consumer becomes the in-shell Agent panel.

#### Scenario: Agent asks to mutate a skill

- **WHEN** an agent tool call proposes or applies a skill change
- **THEN** it is routed through the Manager capability layer and approval transaction
- **AND** kernel session state alone cannot mutate a Provider.
