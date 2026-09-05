# Tasks: skill-intelligence

依赖：`manager-core-consolidation` 与 `manager-workbench` 已通过验收。先完成确定性分析，再接 Agent。

- [x] 1.1 新建 `src/shared/contracts/skill-intelligence.ts`，定义 `Finding`、`SkillSnapshot`、`IntelligenceReport`、`ProposalDraft`；每个 schema 使用 Zod 并保留 observed revision。
  - Evidence: contracts 落地 branded `FindingId fn_[a-f0-9]{16}` / `ProposalId pr_[a-f0-9]{24}`；`Finding.observedRevisions`（skillId → sha256）、`SkillSnapshot.revision`、`ProposalDraft.observedRevisions` 全部保留 revision 语义（commit be41aba）。
- [x] 1.2 新建纯函数 analyzer：从已读取的 SkillDocument 提取 frontmatter、body、资源、触发词、引用路径和 validation findings；不得读写文件系统。
  - Evidence: `src/daemon/skill-intelligence/analyzer.ts` 纯函数 `analyzeDocuments(documents)`，零 node:fs import；`test/skill-intelligence.test.ts` 含纯 analyzer 直测（overlapping-responsibility 投影为 info）。
- [x] 1.3 新增 `skillIntelligence.analyze` RPC：输入显式 Skill IDs，daemon 读取并锁定快照；分析失败按 skill 逐项 typed failure 返回。
  - Evidence: rpc-contract/rpc-router/domain wiring；测试断言 UNAVAILABLE skill 以 `{code:"NOT_FOUND"}` typed failure 出现在 `analyzeFailures` 且不进 snapshots。
- [x] 1.4 增加多技能 overlap/conflict analyzer：覆盖重复 trigger、重复责任、互斥规则、同路径资源和相同名称；每个 finding 给出证据片段。
  - Evidence: analyzer pairwise 覆盖 duplicate-name(error)/duplicate-trigger(warning)/mutually-exclusive-rules(error)/shared-resource-path(info)/overlapping-responsibility(info, Jaccard≥0.6)；每条 finding evidence ≥1 片段；实机分析 20 skills → 3 findings 各含证据行。
- [x] 1.5 新增 report UI：单技能质量摘要、多技能关系图、finding severity/filter、跳转到 Skill detail；大图在窄屏可滚动且不遮挡恢复操作。
  - Evidence: `IntelligenceView.svelte` summary chips + Relations 椭圆图谱 + severity segmented filter（URL search param）+ finding 跳转链接；图谱 canvas 随节点数扩展（20→1440px）置于 overflow-x 容器内，窄屏 680px 文档零横向溢出（docOverflowX=false，实测）。
- [x] 1.6 新增 `skillIntelligence.propose` RPC：支持 edit、disable、split、merge 四类 proposal；proposal 只进入 daemon draft store，不修改 Provider。
  - Evidence: `ProposalPayloadSchema` discriminated union 四类；draft Map 上限 20 淘汰最旧；测试断言 disable proposal 存续期间 SKILL.md 字节未变、无 .SKILL.md 生成。
- [x] 1.7 新增 proposal review UI：显示 before/after、affected skills、observed revisions、findings、预览和 approve/reject；stale proposal 只能重新分析。
  - Evidence: 实机流程 propose disable → 展开显示 affected/revision/rationale → reject 后清空；stale 测试：外部改文件后 approve 全量 conflict 并提示重新分析、文件不被覆盖。
- [x] 1.8 新增 focused tests：只读保证、finding evidence、revision stale、split/merge path safety、禁用建议不自动执行。
  - Evidence: `test/skill-intelligence.test.ts` 8 tests + `webui/src/lib/stores/__tests__/intelligence-focused.test.ts` 3 tests（latest-request-wins / connectionGeneration 失效 / 结构化错误），全套 237 passed。
- [x] 1.9 视觉验收：桌面至少 1100px，窄窗口 680px；验证图谱、长 finding、空报告、失败报告和键盘焦点。
  - Evidence: 桌面 1280px：空报告态 → Analyze 20 → 图谱/摘要/3 findings（含长 shared-path finding 完整换行）→ severity=error 空态文案 → propose/expand/reject 全链 + 零 console 错误。窄屏 680px：Analyze 可达、图谱容器内横向滚动（1440 vs 567 clientW）、docOverflowX=false、4 severity 按钮在位、svg 节点 tabindex=0 且 focus() 落在 `g[role=button]`、恢复操作不被遮挡；vision 复核双端 verdict acceptable（含修复：图谱由固定圆布局改为随节点数扩展的椭圆布局 + 标签上下交替，标签零同侧碰撞）。
- [x] 1.9a 以 `demo/skill-intelligence.html` 作为图谱、证据和 proposal review 的信息层级参考；生产验收必须来自真实 RPC 和 revision 测试。
  - Evidence: `rg "demo/skill-intelligence" src webui/src` 零引用；全部验收证据来自真实 daemon RPC（oRPC over WS）与 revision 测试。
- [x] 1.10 验收：`pnpm test -- --runInBand`、`pnpm typecheck`、`pnpm --dir webui check`、`pnpm build`、`pnpm exec vp fmt --check`、`git diff --check`。
  - Evidence: 237/237 tests（38 files）、tsc 0 错误、svelte-check 0/0、build + webui staged 5 entries、fmt --check 全绿、git diff --check 干净、`openspec validate --all --strict` 4/4。
