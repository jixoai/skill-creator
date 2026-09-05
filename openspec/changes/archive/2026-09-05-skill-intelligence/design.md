# Design: skill-intelligence

## Pipeline

```text
selected Skill IDs
       |
       v
snapshot revisions + read documents
       |
       v
deterministic analyzers
  | structure | triggers | overlap | conflict | stale | validation
       |
       v
IntelligenceReport (daemon-owned, read-only)
       |
       v
ProposalDraft (split / merge / edit / disable recommendation)
       |
       v
validate + expected revisions + user approval -> Creator mutation
```

每个 finding 至少包含 `kind`、severity、message、skillIds、observedRevisions 和 evidence。分析器不能把相似文本直接判定为冲突；冲突必须有可解释证据。

## Safety

- 分析只读，不写 registry、skill 文件或 enabled 状态。
- proposal 锁定分析时的 revision；任何 revision 变化都使 proposal stale，不能 apply。
- split/merge 先生成多个完整文档草稿；目标路径和目录名由 Manager 派生并做 containment check。
- disable 是普通 Manager mutation，但 Agent 只能提出建议；用户确认后才调用现有 toggle RPC。

## Incremental delivery

先实现单技能结构/质量报告，再实现多技能 overlap/conflict graph，最后实现 proposal draft 和 apply。每一步都能独立展示和验收。

## Demo reference

`demo/skill-intelligence.html` is a standalone reference for the graph, evidence findings, severity filtering, and before/after proposal review. It is visual guidance only; production behavior must come from typed daemon RPC, revision checks, validation, and explicit approval.
