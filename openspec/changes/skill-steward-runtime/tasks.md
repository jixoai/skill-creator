# Tasks: skill-steward-runtime

依赖：`skill-steward-contracts` 完成并通过门禁。

- [ ] 2.1 实现 Manager-owned tool registry 与 capability handshake。
  - Files: `src/daemon/steward/tool-registry.ts`, `src/daemon/steward/runtime.ts`.
  - Acceptance: only seven domain tools are callable; generic file/shell requests are denied; every call is audited.
- [ ] 2.2 实现 fixture adapter 和 deterministic transcript。
  - Files: `src/daemon/steward/fixture-adapter.ts`, `test/fixtures/steward/*.json`, `openspec/changes/skill-steward-runtime/artifacts/fixture-transcript.json`.
  - Acceptance: valid, malformed, disconnect, cancel and late-event scripts replay identically twice.
- [ ] 2.3a 按 `transaction-contract.md` 实现单次读取 snapshot 与持久 audit-store。
  - Files: `src/daemon/steward/context-snapshot.ts`, `src/daemon/steward/audit-store.ts`。
  - Evidence: 修改 Provider 后 run 内容不变；重启能读 terminal run；超限拒绝；读权限/磁盘故障不能当空数据。
- [ ] 2.3b 分离 validate、human approve、apply 和 rollback RPC。
  - Files: `src/daemon/steward/approval-service.ts`, `src/shared/rpc-contract.ts`, `src/daemon/rpc-router.ts`。
  - Evidence: 仅 validate 后 Agent/tool caller 的 apply 被拒；没有 human principal 的 caller 不能 approve、传递或消费 grant；DSH permission grant 不产生 Manager grant；并发相同 proposal 最多执行一次；旧 `skillIntelligence.approve` 不能绕过 Steward grant，必须删除、改为显式 human-only legacy contract，或转发到同一 grant 服务。
- [ ] 2.3c 实现 edit/disable 的 journal 和补偿。
  - Files: `src/daemon/steward/apply-transaction.ts`，复用 Creator/SkillService 的路径和启停操作。
  - Evidence: 原文逐字节恢复；外部编辑冲突；journal 故障零写入；补偿失败为 recovery-required。
- [ ] 2.3d 在相同事务上实现 split/merge，包含资源映射和源技能禁用。
  - Evidence: scripts/references/assets 有效；目标名称冲突零写入；中途失败补偿；成功 rollback 恢复完整树和启停状态。
- [ ] 2.3e 增加每个写边界的 crash/restart recovery fixtures。
  - Evidence: journal 不丢，重启不重放 grant；不完整恢复封锁目标写入并提供逐项诊断。
- [ ] 2.3f 串联 snapshot、finding、proposal、validation、approval、apply、audit、rollback。
  - Files: `src/daemon/steward-service.ts`, `src/shared/rpc-contract.ts`, `src/shared/contracts/skill-steward.ts`.
  - Acceptance: edit/disable/split/merge all stop at approval; apply rechecks revision and rediscovery; rollback requires reverse-proposal approval and restores prior bytes.
- [ ] 2.4a 修复 cancel/start/dispose 并发和异常 adapter 清理。
  - Files: `src/daemon/steward/runtime.ts`, fixture adapter。
  - Evidence: handshake 尚未完成时 stop 不能创建新 run；两个 run 不共享 activeClient；abort-ignoring adapter 在明确 deadline 后强制释放；late event 不创建 draft；清理失败可见。
- [ ] 2.4 增加安全与生命周期 focused tests。
  - Files: `test/skill-steward-runtime.test.ts`.
  - Acceptance: stale, replayed approval, Global Workspace target, path traversal, cancellation and daemon dispose produce typed terminal states with no orphan temp root.
- [ ] 2.4b 修复当前 Steward 回归并完成超时归因。
  - Files: `test/agent-steward.test.ts`, `src/daemon/steward-service.ts`, `src/daemon/skill-intelligence-service.ts` 或实际根因文件。
  - Reproduction: `pnpm test -- test/agent-steward.test.ts` 当前为 253 项中 251 通过；`drops traversal payloads at drafting and never writes outside the provider root` 与 `parses untrusted agent text output through the recommendation contract` 各在 20 秒超时。
  - Steps: 使用合法完整 SKILL.md fixture，分别记录 start、analyze、recommendation ingest、draft、validation、settled 的最后事件和 pending promise；修复实际生命周期/契约问题。不得只提高 timeout、删除断言、把 malformed fixture 当成路径安全证明，或把失败测试标记 skipped。
  - Acceptance: 两个测试连续运行两次均通过；每次 run 都有 bounded terminal state；路径负例不产生 Provider 外写入；文本输出只接受结构化契约且拒绝无效项；报告记录根因、修复前后事件序列和命令退出码。
- [ ] 2.5 运行 runtime focused tests plus `pnpm typecheck`, `pnpm build`, `git diff --check`, `openspec validate --all --strict`。
