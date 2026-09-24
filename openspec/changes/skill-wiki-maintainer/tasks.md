# Tasks（每项绿门 = 所列命令全绿；UI 项另加桌面+窄屏视觉走查）

- [ ] 1.1 SDK 契约层：DistillBudgets/PromotedFromEntry（parse/merge）/
      DistillProposal/ItemResult + planDistillation 纯函数
      门禁：`pnpm exec vitest run packages/skill-wiki && pnpm typecheck &&
pnpm exec vp fmt --check`
      （含：追加合并/锚点未中/model-invalid 诊断/预算超限/title≤120 +
      promotedFrom 四 fixture 必过——null/单条/双条/坏值 round-trip，
      spec 场景同步先行）
- [ ] 1.2 SDK 执行层：applyDistillation 幂等矩阵（typed ledgerRecord
      输入：首放/applying/applied×before-after 全分支，含 applied+
      beforeHash 人工回退 stale 零写）+ 足迹回填 + ledger 行产出 +
      IO typed
      门禁：同上（含：崩溃重放 absorb+create 双分支/人工编辑后 stale/
      人工回退不重放/同 target 竞争）
- [ ] 1.3a kernel ephemeral 面：DshKernelHandle.createEphemeralSession
      （deny-all + DistillReadonlyToolName closed union + 运行时注册名
      fail-closed 二次校验；不进面板/转录；dispose 有界）
      门禁：`pnpm exec vitest run test/dsh-kernel.test.ts`
      （allowlist 过滤/未知名创建即拒/propose 不可见/
      stop-timeout-cancel dispose 矩阵）
- [ ] 1.3 daemon DistillJobService：run registry（0700/0600/原子写/
      LRU≤20/purge + 活跃 run LRU 保护——引用真相 = 持久 ledger，先
      expired 收敛再 LRU）+ ephemeral job（120s）+ wiki.distill.start/
      status/cancel RPC（awaiting-approval 取消失效语义 + 重启 expired
      扫描 + McpProposalStore admitBatch 原子事务——terminal 回收与
      全批创建同临界区，不足零变更；distill_apply approved 入口 =
      per-run 队列 enqueue，与 cancel 同队列可串行化）
      门禁：`pnpm exec vitest run test/wiki-distill-service.test.ts
test/dsh-kernel.test.ts`（stop/timeout/restart/cancel-awaiting/
      容量事务「terminal 不足整批字节级不变 + 全 terminal 满载可回收」/
      决定 CAS：approve+reject 与 approve+approve 并发三面终态唯一/
      enqueue 完成语义 executed 仅在队列终态后投影/取消=expired vs
      人工拒绝=rejected 二分 + reject 队列 IO 失败 fail-closed/
      末项终态触发 completed + 终态后同 source 二次 start 允许 +
      零 proposal → failed(no-valid-proposals)/损坏 run 目录 pin
      fail-closed）
- [ ] 1.4 proposal 桥：容量 admission（§5/I）+ wiki.distill_apply
      capability（registry digest 校验；approved 入口 = per-run 队列
      enqueue）+ MCP 投影 + 伪造/跨 scope/stale 负面
      门禁：`pnpm exec vitest run test/skill-creator-mcp.test.ts
test/mcp-proposals.test.ts test/wiki-distill-service.test.ts`
      （DISTILL_* 错误码三面同码：RpcErrorCode 扩入/capability detail
      携带/MCP result code 字段——typecheck + 序列化负测）
- [ ] 1.5 CLI `wiki distill`（--workspace/--limit 默认20≤100/--json 同
      schema）+ 端到端（kernel stub：合法/混合非法/全非法）
      门禁：`pnpm exec vitest run test/skill-creator-wiki-cli.test.ts`
- [ ] 1.6 GUI 入口（WikiScopeView workspace scope「Distill to global」：
      start→进度→跳 proposal 面）+ route/store 测试
      门禁：`pnpm --dir webui check && pnpm exec vitest run
webui/src/lib/stores/__tests__/wiki-distill.test.ts` +
      桌面/窄屏走查（探针 + vision）
- [ ] 1.7 独立复核轮（codex；非自评）+ 全量 `pnpm check` + 归档
