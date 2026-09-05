# Proposal: skill-intelligence

## Why

传统管理器只能让人逐个打开、启用、禁用和编辑技能。技能数量一多，真正的痛点变成：不知道哪些技能过时、重复、冲突、触发过宽、互相覆盖，或已经不再适合当前 Agent。Skill Creator 的差异化应是先把这些问题变成可解释的证据，再让 Agent 提出修改。

## What Changes

- 对一个或多个 Skill 生成结构、触发、引用、资源、重复、冲突、陈旧和校验报告。
- 提供 dependency/overlap/conflict graph 和可读的 finding 列表；每个 finding 绑定 Skill ID 与 observed revision。
- 提供只读分析、禁用建议、优化建议、拆分建议和合并建议。
- 所有优化只产生 Manager-owned draft/patch，必须经过 validation、revision check 和显式 approval。

## Non-Goals

- 本 change 不运行 Agent；先用确定性分析器验证 Manager 的证据模型。
- 不自动启用、禁用、删除、拆分或合并技能。
- 不做在线社区评分、排行榜或分享。

## Impact

新增 `src/shared/contracts/skill-intelligence.ts`、daemon analysis/proposal service、graph/report UI 和 focused tests。复用现有 SkillService、Creator revision 和 path safety，不新增第二套技能发现器。
