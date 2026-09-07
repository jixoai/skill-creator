# capability map（tasks 1.1 / 1.2 差异表）

对照基线：迁移前 `createStewardToolRegistry` 的闭合工具面（`SKILL_DOMAIN_TOOLS` ×
`AGENT_ALLOWED_TOOLS` 契约）。

## 1.1 steward 面（迁移完成，2026-09-08）

| capability | authority | 既有工具面 | agent 可调用 | 差异 |
| --- | --- | --- | --- | --- |
| skills.list_context | readonly | ✓ | ✓（原 AGENT_ALLOWED_TOOLS） | 无 |
| skills.inspect | readonly | ✓ | ✓ | 无 |
| skills.relations | readonly | ✓ | ✓ | 无 |
| skills.validate_proposal | readonly | ✓ | ✓ | 无 |
| skills.propose | proposal | ✓ | ✓（产出待审批 proposal） | 无 |
| skills.apply_proposal | approved-mutation | ✓ | ✗（原 principal-forbidden） | 无 |
| skills.rollback | approved-mutation | ✓ | ✗（原 principal-forbidden） | 无 |

一致性由 `test/capability-core.test.ts` 钉死（registry.names == SKILL_DOMAIN_TOOLS；
agentToolNames == AGENT_ALLOWED_TOOLS）。principal-forbidden 语义从「工具名单硬编码」
上移为 authority class 的 registry 统一执行——值级行为不变（steward 回归 133 tests 不改断言全绿）。

## 1.2 领域面（登记中）

待 workspace/creator/repository/skills-update 能力登记后补全。
