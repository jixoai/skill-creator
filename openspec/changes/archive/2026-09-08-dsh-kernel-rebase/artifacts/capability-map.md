# capability map（tasks 1.1 / 1.2 差异表）

对照基线：迁移前 `createStewardToolRegistry` 的闭合工具面（`SKILL_DOMAIN_TOOLS` ×
`AGENT_ALLOWED_TOOLS` 契约）。

## 1.1 steward 面（迁移完成，2026-09-08）

| capability               | authority         | 既有工具面 | agent 可调用                | 差异 |
| ------------------------ | ----------------- | ---------- | --------------------------- | ---- |
| skills.list_context      | readonly          | ✓          | ✓（原 AGENT_ALLOWED_TOOLS） | 无   |
| skills.inspect           | readonly          | ✓          | ✓                           | 无   |
| skills.relations         | readonly          | ✓          | ✓                           | 无   |
| skills.validate_proposal | readonly          | ✓          | ✓                           | 无   |
| skills.propose           | proposal          | ✓          | ✓（产出待审批 proposal）    | 无   |
| skills.apply_proposal    | approved-mutation | ✓          | ✗（原 principal-forbidden） | 无   |
| skills.rollback          | approved-mutation | ✓          | ✗（原 principal-forbidden） | 无   |

一致性由 `test/capability-core.test.ts` 钉死（registry.names == SKILL_DOMAIN_TOOLS；
agentToolNames == AGENT_ALLOWED_TOOLS）。principal-forbidden 语义从「工具名单硬编码」
上移为 authority class 的 registry 统一执行——值级行为不变（steward 回归 133 tests 不改断言全绿）。

## 1.2 领域面（登记完成，2026-09-08）

与 `docs/manager-contract-map.md` 的 procedure 一一对应（20 项）。authority 判定口径：
**底面真相是否落 Manager 数据/用户磁盘**。

| capability                | authority         | contract-map authority 列 | 差异/依据                                                                                                                                     |
| ------------------------- | ----------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| workspace.list            | readonly          | registry 只读投影         | 一致                                                                                                                                          |
| workspace.add             | approved-mutation | registry 原子持久化       | 一致（tasks 未列；按 mutation 口径归入）                                                                                                      |
| workspace.remove          | approved-mutation | registry 持久化           | 同上                                                                                                                                          |
| workspace.setActive       | approved-mutation | registry 持久化           | 同上                                                                                                                                          |
| skills.list               | readonly          | registry 扫描             | 一致                                                                                                                                          |
| skills.info               | readonly          | containment 读            | 一致                                                                                                                                          |
| skills.toggle             | approved-mutation | fs 启停标记               | 一致（tasks 明示）                                                                                                                            |
| skills.validate           | readonly          | 只读校验                  | 一致                                                                                                                                          |
| skills.update.check       | readonly          | 只读 lock hash 对比       | 一致（tasks 明示）                                                                                                                            |
| skills.update.apply       | approved-mutation | fs 重装写入               | 一致（tasks 明示）                                                                                                                            |
| creator.load              | readonly          | 只读 round-trip 基线      | tasks 字面「creator 读写（approved-mutation）」**窄化为写面**：读面与 skills.info 同级 readonly，且 task 4.1 resources 明示「技能文档只读面」 |
| creator.save              | approved-mutation | fs direct child + 原子写  | 一致                                                                                                                                          |
| creator.remove            | approved-mutation | fs revision 删除          | 一致                                                                                                                                          |
| creator.revisions         | readonly          | 只读历史快照              | 同 creator.load 口径                                                                                                                          |
| repository.scan           | readonly          | session shallow clone     | tasks 未列 scan；按发现面归 readonly（临时 clone 是 session 内部态，不落 Manager 数据）                                                       |
| repository.preview        | approved-mutation | session pinned clone      | tasks 明示                                                                                                                                    |
| repository.install        | approved-mutation | fs 全链验证写入           | tasks 明示                                                                                                                                    |
| repository.sources.list   | readonly          | fs 只读                   | 一致                                                                                                                                          |
| repository.sources.add    | approved-mutation | fs sources.json           | tasks 未列；按 mutation 口径归入                                                                                                              |
| repository.sources.remove | approved-mutation | fs sources.json           | 同上                                                                                                                                          |

不在 MCP 供给范围的 procedure（保持 RPC 面，不登记 capability）：`daemon.status`（运行时
状态函数）、`steward.*` / `skillSteward.*`（steward 协议面，由 run-scoped registry
拥有）、`skillIntelligence.*`（Manager 内部审批流）、`dsh.*`（阶段 2 收敛为 `agent.*`，
属内核控制面而非 Manager 能力）、`acp.*`（internal legacy，产品入口已移除）。

一致性由 `test/capability-domain.test.ts` 钉死（names == contract-map 四域全集；
authority 逐项断言；agent principal 对 approved-mutation 的拒绝；DomainError 归一）。
