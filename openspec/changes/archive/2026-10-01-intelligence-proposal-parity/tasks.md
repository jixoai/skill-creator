# Tasks: intelligence-proposal-parity

## 1. 模板与发起

- [x] 1.1 finding-propose-{edit,disable,split,merge}-v1 模板族（同 probe 协议：
      ID/版本/正文冻结、占位符、不自动发送）
- [x] 1.2 IntelligenceView 四动作改「经 agent 发起」（seed 面板 + finding
      上下文）；移除直连 propose 表单与调用

## 2. 投影统一

- [x] 2.1 agent.proposals.* 扩为统一审批面（skillIntelligence store 并入 +
      origin:agent-tool 标注；before/after + observed revisions + validation
      统一渲染）
- [x] 2.2 `skillIntelligence.propose` 从 rpc-contract 移除（破坏性）；webui
      引用清零

## 3. 测试与门禁

- [x] 3.1 四动作 seed 发起断言（模板版本 + 上下文注入 + 不自动发送）
- [x] 3.2 统一投影测试（双源合并、origin 标注、审批/拒绝路径不回退）
- [x] 3.3 直连路径清零断言（webui 无 skillIntelligence.propose 调用）
- [x] 3.4 门禁：focused tests + webui check + typecheck + fmt + full build

## 验收证据

- 3.1：`webui/src/lib/__tests__/agent-panel.test.ts`「finding-propose seed」
  四例（模板冻结渲染 + 不自动发送 + 惰性建会话元数据/引用透传 + 通用行动
  作废 pending seed）。
- 3.2：`test/agent-proposals-projection.test.ts` 投影单元（五态/失败结果/si
  草稿/前缀路由）+ 真实 domain 路由级双源合并（mcp:|si: 前缀 + origin 标注 +
  approve executed / reject rejected 不回退）；`test/e2e-authority-chain.test.ts`
  MCP 前缀消费链。
- 3.3：`webui/src/lib/__tests__/intelligence-direct-path-zero.test.ts` 源扫描
  零 `skillIntelligence.propose` 调用点。
- 3.4：pnpm test 1648/1648（168 files）→ r6/r7 处置后终值 1664/1664
  （170 files，本轮提交）；typecheck / webui check / vp fmt --check /
  git diff --check / pnpm build 全绿（archive 树入 .prettierignore，
  冻结历史不被 reflow）。

## r6 复核处置（2026-10-01，8.0 → 四 P1 全闭）

- [x] P1-1 capability 观察锁接线：单源 schema 补 target（C′1a 冻结形状），
      多源 targets/observedRevisions 等长 refine；assertSingle/TargetsAligned
      与 payload 受影响集严格对齐；propose 服务优先锁调用方 revision（存在性
      仍服务端复核；错位/缺项 typed 拒绝不静默回落）；输出收敛 {proposalId}。
- [x] P1-2 si stale approve → rejected + rejectCause:"stale"（草稿保留语义
      已注 design C′2）。
- [x] P1-3 evaluation appendResult 补 Imported-only 写门（Global 负例测试）。
- [x] P1-4 provider adapter 未见 turn-end → typed 超时 + cancel（半截回复
      不得进入断言判定；回归测试）。
- 回归：agent-proposals-projection 10/10（含观察锁/错位/等长/stale 四新例）、
  evaluation-service 9/9（adapter 终态闸 + finding-severity 服务级）、
  evaluation-store 7/7；全量 1661/1661（170 files）。

## r7 复核处置（2026-10-01，7.7 → 证据补强）

- [x] P1-1 补强：等长集合错位 + targets 自身重复 typed 拒绝（helper 自检
      长度≠集合大小）；callTool 两新负例。
- [x] P1-4 收口：ProviderTranscriptTimeout typed 类 + 服务级验收
      （outcome=error / RUNNER_ERROR / assertions 恒空）。
- [x] r7 新阻塞：run 前 stale 的 observedEndRevision 改记当前实际观察值
      （字段级回归）。
- [x] finding-severity 测试改按 caseId 查找 + 断言 analyzer 实际 severity
      （duplicate-name = error），消除 resultId 排序脆弱性。
- [x] 台账：creator-test-session 3.4/3.5 勾选（证据落链）；Ch3/Ch4 验收
      数字更新至终值。
