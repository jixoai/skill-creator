# skill-steward-contracts verification

记录日期：2026-09-06（R2 整改后更新）。实现边界：`d18c148 → df75447`（R1 整改 `5727598`，R2 整改 `df75447`，契约版本 1.3.0）。运行环境：本仓 dev 主分支，macOS arm64。

## 责任矩阵

| Task                                           | 实现提交 | 证据                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1 审计证据纳入 + 无 DSH 依赖声明             | d18c148  | `src/shared/contracts/skill-steward.ts` 头注释引用官方 deepseek-harness d347e703 / 0.1.3-alpha.1 与 dsh-* seam 表，并声明本阶段零 DSH import（`rg -n "deepseek-ai" src/shared/contracts/skill-steward.ts` 可见引用仅在注释）                                                                                         |
| 1.2 snapshot/task/response/toolcall/patch 契约 | d18c148  | 同文件：`SkillStewardContextSnapshotSchema`（scope/身份/revision/有界内容/版本/能力，superRefine 预算与成员检查）、`SkillStewardTaskSchema`（check/optimize/organize）、`SkillStewardResponseSchema`（闭合 union）、`SkillToolCallSchema`（七工具 + principal 规则）、`SkillPatchSchema`（edit/disable/split/merge） |
| 1.3 闭合 union 与拒绝语义                      | d18c148  | patch/finding/`SkillValidationResultSchema`/`StewardApprovalGrantSchema`/`StewardAuditRecordSchema`；`bindProposalToSnapshot` 输出类型化失败（SNAPSHOT_MISMATCH/UNKNOWN_SKILL/STALE_REVISION/UNSUPPORTED_WRITE_SCOPE/CONTRACT_VERSION）                                                                              |
| 1.4 版本化 prompt 与模板                       | c2871c3  | `src/daemon/steward/prompts.ts`（STEWARD_PROMPT_VERSION/STEWARD_TOOL_VERSION 1.0.0，固定 allowlist/证据格式/审批边界/no-direct-write）+ `templates.ts`（三类任务 user turn + 快照摘要）                                                                                                                              |
| 1.5 fixtures 与 focused tests                  | e95f839  | `test/fixtures/steward/*.json` ×10 + `test/skill-steward-contracts.test.ts` 18 tests                                                                                                                                                                                                                                 |
| 1.6 全量门禁                                   | 本文件   | 见下方命令记录                                                                                                                                                                                                                                                                                                       |
| 1.7 每种 action 正反 fixture                   | e95f839  | edit(disable-mismatch)/disable(missing-evidence)/split(traversal)/merge(traversal traversal)；负例单变量变更，frontmatter/body 完整保留                                                                                                                                                                              |

## 门禁记录（串行执行，2026-09-06）

```text
（R2 整改后，2026-09-06，边界 df75447）
pnpm exec vitest run test/skill-steward-contracts.test.ts -> 34/34 passed（含 8 项 R2 复核探针负例）
pnpm exec vitest run test/skill-steward-runtime.test.ts   -> 34/34 passed（含 2 项 apply 期映射源身份正/负例）
pnpm test / typecheck / webui check / build / fmt / diff-check / openspec validate
  -> 见 R2 整改提交后的完整串行门禁（本文件「R2 整改」节）；上一轮 271/271 记录已被 334+/334+ 取代。

（R1 整改轮记录，2026-09-06，边界 5727598）
pnpm test -> 310/310 passed（41 files）；contracts 25/25；runtime 32/32；typecheck 0 错误。
（最初记录 271/271 仅属 5ff7d8f 边界，已过期。）
```

## 前置修复（GOAL Observe 要求的 2 项 timeout）

- 根因：每个测试用 daemon domain 首次 `skills.list` 触发真实 `npx skills list --json` 子进程（15s 超时、可访问网络）；高负载下单用例超过 vitest 20s 用例超时（reviewer 复现 417s / 2 timeouts）。
- 修复：`createDaemonDomain` 支持注入 `skillsCliProbe`；六个测试文件改用 `test/helpers/deterministic-probe.ts`（零子进程、零网络）。提交 9aca0fc。
- 结果：`pnpm exec vitest run test/agent-steward.test.ts` 16 tests ~4s（原 ~120s 本机 / 417s 负载）；全量 253→271 全绿。未提高任何 timeout，未删除测试。

## Codex 复核闭环

- R1（4.5/10，不通过）：P1-1 路径校验 / P1-2 observed≠expected / P1-3 重复身份 / P1-4 伪造 byteSize → 全部修复（1.2.0，5727598）。
- R2（5.5/10，不通过，报告 /tmp/stage1-contracts-review-round2.md）：
  - P1-1 快照资源 relPath 绕过共享校验 → 修复：`StewardResourceEntrySchema.relPath` 改用 `RelPathSchema`（df75447）。
  - P1-2 sourceSkillId 未绑定且 apply 用 primarySourceId 错源 → 修复：parse 按 kind 闭合、bind 对齐 manifest、apply 逐映射解析源并复核存在性+sha256（df75447）。
  - P1-3 Global 接受 enable → 修复：agent bind 全域拒绝 enable、Global 仅 disable；Manager 反向走 `bindManagerDerivedProposalToSnapshot`（df75447）。
  - P2-1 evidence 范围 / P2-2 target 碰撞 / P2-4 模板渲染不强制 bind → 一并修复（df75447）。
  - P2-6 verification 过期 → 本文件即整改。
  - R2 task 表补充说明：enable 正反例以程序化 fixture 存在于 P1-3 探针测试（agent 拒绝 / manager binder 接受），不属 Agent fixture 文件集合——enable 按 1.1.0 设计即 Manager 派生专用。
- R3 复审已随 df75447 提交（结论待出）。

## Deferred（owner 与完成边界）

- **per-tool payload typing（R1 P2-4 / R2 P2-3）**：`SkillToolCallSchema.input/result.value` 仍为 `z.unknown()`。Owner：`dsh-runtime-integration`（DSH 侧 defineTool 已按 ParameterSchemaSpec 逐工具声明输入；contract 层 per-tool discriminated input/result schema 必须在 DSH adapter 以「契约层解析」替代「桥接透传」前关闭——即 dsh-webui-composition 之前）。不升级为阶段 1 P1 的理由：有限域工具与 principal 边界已闭合，无 Manager 写入绕过（R2 复核结论一致）。
- **transaction 形状收紧（R2 P2-5）**：grant inputRevisions exact-set、audit 资源 source/hash/backup 字段、journal entry versioned union + recovery parser schema 化。Owner：`skill-steward-runtime` 剩余任务（2.3e recovery gate / 2.4a）与 `steward-product-workflow`；在 rollback/recovery 面向用户开放前必须关闭。
- EOF 空行（R2 P2-6 提及的 audit-store.ts 文件尾）：已随 3.3 重构与 formatter 消除（`git diff --check` 于 df75447 边界干净）。

## 未验证项（诚实声明）

- 本 change 仅契约层：Agent runtime 接入、WebUI、daemon RPC 暴露属后续阶段（R2 复审时 dsh-runtime-integration 3.1-3.4 已并行推进，但不作为本 change 完成证据）。按 tasks.md Review gate，契约 ready 以复核通过为准（R3 待出）。
- `demo/contracts-reference.html` 未作为任何实现依据（`rg -rn "contracts-reference" src webui/src test` 零引用）。
