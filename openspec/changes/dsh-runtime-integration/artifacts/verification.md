# dsh-runtime-integration verification（进行中）

记录日期：2026-09-06。

## 已完成任务

| Task                                     | 提交                        | 证据                                                                                                                                                                                                           |
| ---------------------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3.1 handshake                            | db13aa8 + 52ef2b1           | @deepseek-ai/* 八包精确锁定 0.1.2-rc.1；handshake 逐包校验版本+组合行导出；注入负例 MISSING_PACKAGE/VERSION_MISMATCH/COMPOSITION_ROW_MISSING；旧 dsh-acp 移除                                                  |
| 3.2 agent/session/stream/tool 适配       | 79b304f + bf5425b + 5701718 |
| 3.3 settings/credentials/session streams | 32992cb                     | 真实 cordis 六服务组合；deterministic LLM transport；agent scope 五域工具（output schema+render，全部回 Manager registry）；版本化 prompt section；tool round/replay/cancel/fail-closed/run record（10 tests） |

## 实测发现（与 tasks 文件列表的偏差）

- 3.2 的实际实现文件是 `src/daemon/steward/dsh-agent-runtime.ts`（tasks 写的 `dsh-events.ts` 未单独成文件：事件投影以 agent/status + Manager 审计记录承载，未发现需要独立事件文件的复杂度）。
- `tools.restrict({allow})` 校验的是全局注册表名；agent-scope 注册 + 空全局表构成最小能力集（代码内注记）。
- defineTool 的 parameters 是逐属性 ParameterSchemaSpec，不是裸 JSON Schema。
- cordis Context 无显式 dispose API；进程内组合随进程回收，agent-scope 效果经 disposers 同步清理。

## 门禁状态

- `pnpm exec vitest run test/dsh-runtime-integration.test.ts` → 10 passed。
- 全量 `pnpm test` 318/318（42 files）；`pnpm typecheck` 0 错误；`pnpm exec vp fmt --check` 全绿。
- 3.4/3.5 未完成（transcript artifact / 完整 focused gates）。

## 3.3 实测注记

- `@deepseek-ai/dsh-llm` 根导出 `normalizeApiKey`（无 `./api-key` 子路径导出）；凭据校验直接复用。
- DSH 官方 `agent-default-model` settings namespace 属于 dsh-web-app/boot 组合，不在锁定的五个 runtime 包内；Steward 的 model selection 因此由 Manager 自持（`DshStewardSettings.model`），agent 创建时映射进 AgentOptions——与研究文档「Skill Creator 可以把技能管家模型做成自己的 profile/选择层」一致。
- approvalPolicy（ask/never）只投影 runtime context；Manager apply 仍只认 human-only grant（skill-steward-contracts 不变量）。
- session stream 帧是进程内实时投影（ring buffer）；durable 回放事实归 DSH session event log 与 Manager audit store，帧协议不承载回放。
- audit 脱敏对 grants 免除：grant 是幂等回放协议且字段全为受控 ID/哈希。
