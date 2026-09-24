# Tasks（每项绿门 = 所列命令全绿；UI 项另加桌面+窄屏视觉走查）

- [ ] 1.1 SDK 契约层：DistillBudgets/PromotedFromEntry（parse/merge）/
      DistillProposal/ItemResult + planDistillation 纯函数
      门禁：`pnpm exec vitest run packages/skill-wiki && pnpm typecheck &&
    pnpm exec vp fmt --check`
      （含：追加合并/锚点未中/model-invalid 诊断/预算超限/title≤120）
- [ ] 1.2 SDK 执行层：applyDistillation 三态幂等（idempotent/execute/
      stale）+ 足迹回填 + ledger 行产出 + IO typed
      门禁：同上（含：崩溃重放/人工编辑后 stale/同 target 竞争）
- [ ] 1.3a kernel ephemeral 面：DshKernelHandle.createEphemeralSession
      （deny-all + allowlist；不进面板/转录；dispose 有界）
      门禁：`pnpm exec vitest run test/dsh-kernel.test.ts`
      （allowlist 过滤/propose 不可见/stop-timeout-cancel dispose 矩阵）
- [ ] 1.3 daemon DistillJobService：run registry（0700/0600/原子写/
      LRU≤20/purge + 活跃 run LRU 保护）+ ephemeral job（120s）+
      wiki.distill.start/status/cancel RPC（awaiting-approval 取消失效
      语义 + 重启 expired 扫描 + McpProposalStore pendingCapacity/
      createBatch 原子预约）
      门禁：`pnpm exec vitest run test/wiki-distill-service.test.ts
    test/dsh-kernel.test.ts`（stop/timeout/restart/cancel-awaiting
      容量竞态矩阵）
- [ ] 1.4 proposal 桥：容量预检 + wiki.distill_apply capability（registry
      digest 校验）+ MCP 投影 + 伪造/跨 scope/stale 负面
      门禁：`pnpm exec vitest run test/skill-creator-mcp.test.ts
    test/mcp-proposals.test.ts test/wiki-distill-service.test.ts`
- [ ] 1.5 CLI `wiki distill`（--workspace/--limit 默认20≤100/--json 同
      schema）+ 端到端（kernel stub：合法/混合非法/全非法）
      门禁：`pnpm exec vitest run test/skill-creator-wiki-cli.test.ts`
- [ ] 1.6 GUI 入口（WikiScopeView workspace scope「Distill to global」：
      start→进度→跳 proposal 面）+ route/store 测试
      门禁：`pnpm --dir webui check && pnpm exec vitest run
    webui/src/lib/stores/__tests__/wiki-distill.test.ts` +
      桌面/窄屏走查（探针 + vision）
- [ ] 1.7 独立复核轮（codex；非自评）+ 全量 `pnpm check` + 归档
