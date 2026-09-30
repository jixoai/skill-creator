# dsh-webui-composition Specification

## Purpose

以 headless DSH 内核组合承载 Agent 能力：DSH 提供 Agent runtime 服务（model/preset/session/stream/permission/approval，经 dsh-base rows），Skill Creator 以 Manager authority 提供 Workspace/Provider/Skill 身份、context snapshot、finding、proposal、revision-safe apply、rollback 与 audit。产品 UI 是 Skill Creator shell 内的 Agent 面板（2026-09-11 裁决后唯一 Agent 面），不经 DSH Web host 组合、无 island channel 与宿主握手桥。

## Requirements

### Requirement: DSH UI and Manager authority are composed

The kernel composition MUST provide model/preset/session/permission services to the Skill Creator Agent surface. Workspace, Provider, Skill identity, snapshot, findings, proposals, revision checks, apply, rollback and audit MUST remain Manager-owned.

**Reason**: Authority split is unchanged; the provider of Agent services changes from the DSH Web composition to the headless kernel, and the consumer becomes the in-shell Agent panel.

#### Scenario: Agent asks to mutate a skill

- **WHEN** an agent tool call proposes or applies a skill change
- **THEN** it is routed through the Manager capability layer and approval transaction
- **AND** kernel session state alone cannot mutate a Provider.
