# Tasks: skill-intelligence

依赖：`manager-core-consolidation` 与 `manager-workbench` 已通过验收。先完成确定性分析，再接 Agent。

- [ ] 1.1 新建 `src/shared/contracts/skill-intelligence.ts`，定义 `Finding`、`SkillSnapshot`、`IntelligenceReport`、`ProposalDraft`；每个 schema 使用 Zod 并保留 observed revision。
- [ ] 1.2 新建纯函数 analyzer：从已读取的 SkillDocument 提取 frontmatter、body、资源、触发词、引用路径和 validation findings；不得读写文件系统。
- [ ] 1.3 新增 `skillIntelligence.analyze` RPC：输入显式 Skill IDs，daemon 读取并锁定快照；分析失败按 skill 逐项 typed failure 返回。
- [ ] 1.4 增加多技能 overlap/conflict analyzer：覆盖重复 trigger、重复责任、互斥规则、同路径资源和相同名称；每个 finding 给出证据片段。
- [ ] 1.5 新增 report UI：单技能质量摘要、多技能关系图、finding severity/filter、跳转到 Skill detail；大图在窄屏可滚动且不遮挡恢复操作。
- [ ] 1.6 新增 `skillIntelligence.propose` RPC：支持 edit、disable、split、merge 四类 proposal；proposal 只进入 daemon draft store，不修改 Provider。
- [ ] 1.7 新增 proposal review UI：显示 before/after、affected skills、observed revisions、findings、预览和 approve/reject；stale proposal 只能重新分析。
- [ ] 1.8 新增 focused tests：只读保证、finding evidence、revision stale、split/merge path safety、禁用建议不自动执行。
- [ ] 1.9 视觉验收：桌面至少 1100px，窄窗口 680px；验证图谱、长 finding、空报告、失败报告和键盘焦点。
- [ ] 1.9a 以 `demo/skill-intelligence.html` 作为图谱、证据和 proposal review 的信息层级参考；生产验收必须来自真实 RPC 和 revision 测试。
- [ ] 1.10 验收：`pnpm test -- --runInBand`、`pnpm typecheck`、`pnpm --dir webui check`、`pnpm build`、`pnpm exec vp fmt --check`、`git diff --check`。
