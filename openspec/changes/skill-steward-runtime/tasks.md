# Tasks: skill-steward-runtime

依赖：`skill-steward-contracts` 完成并通过门禁。

- [x] 2.1 实现 Manager-owned tool registry 与 capability handshake。
  - Evidence: 4d7d1f7 tool-registry.ts + 6 tests；见 artifacts/verification.md。
  - Files: `src/daemon/steward/tool-registry.ts`, `src/daemon/steward/runtime.ts`.
  - Acceptance: only seven domain tools are callable; generic file/shell requests are denied; every call is audited.
- [x] 2.2 实现 fixture adapter 和 deterministic transcript。
  - Evidence: 423345f fixture-agent/runtime + artifacts/fixture-transcript.json（双跑逐字节一致）；见 artifacts/verification.md。
  - Files: `src/daemon/steward/fixture-adapter.ts`, `test/fixtures/steward/*.json`, `openspec/changes/skill-steward-runtime/artifacts/fixture-transcript.json`.
  - Acceptance: valid, malformed, disconnect, cancel and late-event scripts replay identically twice.
- [x] 2.3a 按 `transaction-contract.md` 实现单次读取 snapshot 与持久 audit-store。
  - Evidence: 66cb7ed context-snapshot/audit-store；快照后 Provider 修改不影响 run 内容；重启读回 terminal run；超限 typed 拒绝；I/O 故障 hard error。
  - Files: `src/daemon/steward/context-snapshot.ts`, `src/daemon/steward/audit-store.ts`。
  - Evidence: 修改 Provider 后 run 内容不变；重启能读 terminal run；超限拒绝；读权限/磁盘故障不能当空数据。
- [x] 2.3b 分离 validate、human approve、apply 和 rollback RPC。
  - Evidence: 89b6c03/5781109；validate 零授权、grant 一次性+重启失效、agent apply denied、并发单执行、旧 approve 面对 steward id NOT_FOUND 零 mutation（测试覆盖）。
  - Files: `src/daemon/steward/approval-service.ts`, `src/shared/rpc-contract.ts`, `src/daemon/rpc-router.ts`。
  - Evidence: 仅 validate 后 Agent/tool caller 的 apply 被拒；没有 human principal 的 caller 不能 approve、传递或消费 grant；DSH permission grant 不产生 Manager grant；并发相同 proposal 最多执行一次；旧 `skillIntelligence.approve` 不能绕过 Steward grant，必须删除、改为显式 human-only legacy contract，或转发到同一 grant 服务。
- [x] 2.3c 实现 edit/disable 的 journal 和补偿。
  - Evidence: 89b6c03+a81815f；逐字节恢复、外部编辑补偿、journal 故障零写入、补偿失败 recovery-required 路径存在。
  - Files: `src/daemon/steward/apply-transaction.ts`，复用 Creator/SkillService 的路径和启停操作。
  - Evidence: 原文逐字节恢复；外部编辑冲突；journal 故障零写入；补偿失败为 recovery-required。
- [x] 2.3d 在相同事务上实现 split/merge，包含资源映射和源技能禁用。
  - Evidence: 89b6c03；资源映射落盘、名冲突零写入、中途补偿、rollback 恢复完整树+启停（journal replay 测试）。
  - Evidence: scripts/references/assets 有效；目标名称冲突零写入；中途失败补偿；成功 rollback 恢复完整树和启停状态。
- [x] 2.3e 增加每个写边界的 crash/restart recovery fixtures。
  - Evidence: journal 不丢（常驻 0600 append fd 逐行 fsync + O_EXCL 独占创建 + store-anchor 进程生命周期 inode 锚，R11/R12/55e0a98）；重启不重放 grant（invalidateUnconsumedGrants + grant consumedAt 持久化）；不完整恢复封锁目标写入并提供逐项诊断（本提交：apply 入口恢复闸——scanUnfinishedJournals 只上报无终态 commit 行/损坏的 journal，同 target 残留与不可解析的重启残留封锁 apply 并逐项列出 id/步数/末步/损坏态；不同 target 的已知残留不干扰；已 commit 的 journal 永不阻塞）。负例 ×3（同 target 残留封锁 + 诊断含 id、committed 不阻塞的正向流、重启残留保守封锁）。
- [x] 2.3f 串联 snapshot、finding、proposal、validation、approval、apply、audit、rollback。
  - Evidence: 5781109 skillSteward RPC 六端点 + e2e 全链测试（check→proposal→approve→apply→byte-rollback）。
  - Files: `src/daemon/steward-service.ts`, `src/shared/rpc-contract.ts`, `src/shared/contracts/skill-steward.ts`.
  - Acceptance: edit/disable/split/merge all stop at approval; apply rechecks revision and rediscovery; rollback requires reverse-proposal approval and restores prior bytes.
- [ ] 2.4a 修复 cancel/start/dispose 并发和异常 adapter 清理。
  - Files: `src/daemon/steward/runtime.ts`, fixture adapter。
  - Evidence: handshake 尚未完成时 stop 不能创建新 run；两个 run 不共享 activeClient；abort-ignoring adapter 在明确 deadline 后强制释放；late event 不创建 draft；清理失败可见。
- [x] 2.4 增加安全与生命周期 focused tests。
  - Evidence: test/skill-steward-runtime.test.ts 32 项覆盖 stale/replay/Global/traversal/cancel/dispose typed 终态；无孤儿临时根（新管线以快照为上下文）。
  - Files: `test/skill-steward-runtime.test.ts`.
  - Acceptance: stale, replayed approval, Global Workspace target, path traversal, cancellation and daemon dispose produce typed terminal states with no orphan temp root.
- [x] 2.4b 修复当前 Steward 回归并完成超时归因。
  - Evidence: 9aca0fc 根因=npx skills probe 真实子进程；连续两次 focused 16/16（6.58s/5.26s）；全量 303/303；未提 timeout、未删断言、未 skip。
  - Files: `test/agent-steward.test.ts`, `src/daemon/steward-service.ts`, `src/daemon/skill-intelligence-service.ts` 或实际根因文件。
  - Reproduction: `pnpm test -- test/agent-steward.test.ts` 当前为 253 项中 251 通过；`drops traversal payloads at drafting and never writes outside the provider root` 与 `parses untrusted agent text output through the recommendation contract` 各在 20 秒超时。
  - Steps: 使用合法完整 SKILL.md fixture，分别记录 start、analyze、recommendation ingest、draft、validation、settled 的最后事件和 pending promise；修复实际生命周期/契约问题。不得只提高 timeout、删除断言、把 malformed fixture 当成路径安全证明，或把失败测试标记 skipped。
  - Acceptance: 两个测试连续运行两次均通过；每次 run 都有 bounded terminal state；路径负例不产生 Provider 外写入；文本输出只接受结构化契约且拒绝无效项；报告记录根因、修复前后事件序列和命令退出码。
- [x] 2.5 运行 runtime focused tests plus `pnpm typecheck`, `pnpm build`, `git diff --check`, `openspec validate --all --strict`。
  - Evidence: artifacts/verification.md 门禁记录（303/303、tsc 0、svelte 0/0、build、fmt、diff、openspec 9/9）。

<!-- 进度注（2026-09-07）：2.3e 完成——三段式：20ec083 scanUnfinishedJournals；55e0a98 store-anchor inode 锚 + manifest strict Zod；本提交 apply 入口恢复闸（同 target 残留/重启残留封锁 + 逐项诊断）。2.4a 部分完成（新 runtime 的 cancel/并发锁/迟到事件已测；adapter 强制 deadline 属 DSH 阶段）。详见 artifacts/verification.md。 -->
