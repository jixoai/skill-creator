# steward-product-workflow Specification

## Purpose

把技能管家做成可上线产品：在 DSH Web host 的 Manager island 中提供任务/scope/runtime 配置选择、事件与 tool call 证据链、finding、proposal diff、validation、approval、rollback 与失败恢复的完整工作流 UI；能力声明由实际 handler/restriction 决定，终态停止高频刷新，迟到响应不覆盖新 scope，窄窗口与真实 daemon 生命周期均有验收证据。

## Requirements

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

### Requirement: Failure states are actionable

The UI MUST distinguish unavailable, disconnected, cancelled, stale, conflict and failed states and provide a recovery action appropriate to each.

#### Scenario: Runtime disconnects after draft

- **WHEN** the adapter disconnects after producing a draft
- **THEN** the last accepted draft and its evidence remain reviewable, late events are ignored, and the UI offers retry or manual review
- **AND** retry creates a new snapshot without silently overwriting the prior draft; stale drafts cannot be applied

### Requirement: Analysis explains individual skills and their relationships

The product MUST visualize a selected skill's triggers, instructions and referenced resources, and the relationships among multiple selected skills. Relationship types MUST distinguish shared triggers, overlapping responsibilities, contradictions and explicit references. Every inferred relationship MUST identify the source snapshot and evidence and distinguish inference from confirmed facts. Similar wording alone MUST NOT establish contradiction or justify disabling a skill.

#### Scenario: User inspects one skill

- **WHEN** a user analyzes a single selected skill
- **THEN** the view shows its structure, resource references and findings
- **AND** selecting a finding opens the corresponding source evidence instead of only showing a score

#### Scenario: User investigates potentially conflicting skills

- **WHEN** a user analyzes multiple selected skills and selects a relationship
- **THEN** the view shows its type, both source excerpts and the reasoning with uncertainty
- **AND** any disable or merge proposal separately states its expected benefit and risk and requires approval

### Requirement: Product build is independent of demos

Production startup and build MUST NOT import demo HTML, mock adapters or development-only paths.

#### Scenario: Clean production build

- **WHEN** a release build is created in a clean directory
- **THEN** it contains only production bundles and starts without loading `demo/*.html`, fixture adapters or development paths

### Requirement: Skill improvements are evaluated against a baseline

Optimization review MUST compare baseline and candidate on explicit trigger and non-trigger cases, resource validity and task assertions. Text length estimates MUST NOT be represented as measured token savings or proof of effectiveness. Unknown usage history MUST remain unknown.

#### Scenario: Shorter candidate regresses triggering

- **WHEN** an optimized document is shorter but misses a required trigger case
- **THEN** the review reports that regression and does not claim the optimization improved skill effectiveness
