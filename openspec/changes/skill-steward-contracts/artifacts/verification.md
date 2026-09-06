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
- R3（6.5/10，不通过，报告 /tmp/stage1-contracts-review-round3.md；独立工作树 53bd73c）：
  - P1-1 observedRevisions 允许额外身份 → 修复：proposal superRefine 要求观察身份 ⊆ skillIds（与既有 exact 覆盖检查合成精确相等），1.4.0。
  - P1-2 同 target 重复 targetPath 静默覆盖 → 修复：`StewardPatchTargetDocumentSchema` 解析层拒绝 duplicate targetPath；apply 增加 seen-target 防御（手工构造/重放绕过解析时 typed 失败 + 补偿零残留）。
  - P2-1 finding evidence 身份未闭合 → 修复：finding superRefine 要求 evidence.skillId ∈ finding.skillIds。
  - P2-2 symlink/type/size 语义（原判 runtime-stage 延期）→ 提前关闭：apply 前 `lstat` 严格 regular file + manifest `kind:"file"` + `byteSize` 活体比对；负例（symlink 同字节换体）进 runtime 测试。
  - P2-3 Manager binder authority 依赖调用纪律 → 维持延期（capability 化归 steward-product-workflow；产品调用链 managerDerived 标记正确）。
  - P2-4 per-tool typing / P2-5 grant/audit/journal 形状 → 维持原 Deferred owner（见下节）。
  - 两个 disable fixture 自带的 patch 外观察（R3 探针起点）已重排为精确集合。
  - 门禁（整改后）：contracts 38/38、runtime 36/36、全量 371/371（47 files）、typecheck 0、webui check 0/0、目标文件 fmt 绿、`git diff --check` 干净、openspec 9/9。
- R4（6.0/10，不通过，报告 /tmp/stage1-contracts-review-round4.md；独立 worktree c9b4ce1）：
  - P1-1 父目录 symlink 换体 → 修复：apply 源读取改为「canonical realpath 必须落在 canonical root 同一相对位置（任一 symlink 祖先即拒绝）+ O_NOFOLLOW 描述符打开 + fstat regular/byteSize + 从 fd 读字节」，目标侧 mkdir 后同样校验父链无 symlink（1.5.0）。
  - P1-2 targetPath 可覆盖主文档 SKILL.md → 修复：target schema 拒绝 basename 大小写不敏感等于 skill.md 的映射；apply 防御同规则断然失败（负例：parse 与手工构造直达 apply 双覆盖）。
  - P1-3 edit 伪造 frontmatter 身份 → 修复：bind 层新增 EDIT_IDENTITY_MISMATCH（edit.frontmatter.name 必须等于快照条目 directoryName）；apply edit 分支保留同规则防御（负例：bind typed 失败 + 合法 edit 通过）。
  - P2-1 快照身份唯一性 → 修复：snapshot superRefine 要求 directoryName（大小写归一）、name、manifest (skillId, relPath) 唯一（三个负例）。
  - P2-2 大小写文件系统判重 → 修复：契约与 apply 的 duplicate targetPath 检测均按 lowercase 归一（负例：仅大小写不同的两条映射 parse 拒绝；apply 防御负例进 P2-3 compensation 测试）。
  - P2-3 move 假实现 → 修复：move 为真实移动语义（写目标 + journal 记账 + 删除源），compensation 以捕获字节还原源（负例：冲突 move 轮 compensated 后源字节零丢失、目标零残留）。
  - P2-4 verification 过期 → 本文件即整改（边界更新为 1.5.0；全量门禁见下）。
  - 门禁（R4 整改后）：contracts 42/42、runtime 40/40、全量 387/387（50 files）、typecheck 0、webui check 0/0、目标文件 fmt 绿、`git diff --check` 干净、openspec 9/9。全树 `vp fmt --check` 仍有 6 个并行文件失败（3 个 archive/demo、contracts demo html、runtime fixture-transcript.json、本 verification.md）——属跨 change 工作树卫生，不作为本 change 门禁事实。
- R5 复审已随 1.5.0 整改提交（结论待出；复核回调改为后台 codex-callback.sh 模式）。

## Deferred（owner 与完成边界）

- **per-tool payload typing（R1 P2-4 / R2 P2-3）**：`SkillToolCallSchema.input/result.value` 仍为 `z.unknown()`。Owner：`dsh-runtime-integration`（DSH 侧 defineTool 已按 ParameterSchemaSpec 逐工具声明输入；contract 层 per-tool discriminated input/result schema 必须在 DSH adapter 以「契约层解析」替代「桥接透传」前关闭——即 dsh-webui-composition 之前）。不升级为阶段 1 P1 的理由：有限域工具与 principal 边界已闭合，无 Manager 写入绕过（R2 复核结论一致）。
- **transaction 形状收紧（R2 P2-5）**：grant inputRevisions exact-set、audit 资源 source/hash/backup 字段、journal entry versioned union + recovery parser schema 化。Owner：`skill-steward-runtime` 剩余任务（2.3e recovery gate / 2.4a）与 `steward-product-workflow`；在 rollback/recovery 面向用户开放前必须关闭。
- EOF 空行（R2 P2-6 提及的 audit-store.ts 文件尾）：已随 3.3 重构与 formatter 消除（`git diff --check` 于 df75447 边界干净）。

## 未验证项（诚实声明）

- 本 change 仅契约层：Agent runtime 接入、WebUI、daemon RPC 暴露属后续阶段（R2 复审时 dsh-runtime-integration 3.1-3.4 已并行推进，但不作为本 change 完成证据）。按 tasks.md Review gate，契约 ready 以复核通过为准（R4 待出）。
- `demo/contracts-reference.html` 未作为任何实现依据（`rg -rn "contracts-reference" src webui/src test` 零引用）。
