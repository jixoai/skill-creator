# skill-wiki Specification (delta)

## ADDED Requirements

### Requirement: 蒸馏提案契约（SDK 冻结面）

skill-wiki MUST 冻结蒸馏契约（Zod，unknown 键拒绝，预算常量版本化导出）：
`DistillProposal`（create/absorb 判别联合——absorb 钉死
`expectedBeforeBodyHash` 与 edits 复用 WikiEdit 原语）、`PromotedFromEntry`
（canonical JSON 单行序列化，多次泛化追加合并不覆盖）、`ItemResult`
（applied/idempotent/stale/patch-failed/model-invalid/rejected）。
SDK MUST NOT 引入 LLM/网络依赖。

#### Scenario: promotedFrom 追加合并

- **WHEN** 同一 global pattern 经两次不同 run 泛化
- **THEN** promotedFrom 含两条足迹（按 runId 去重），既有足迹不被覆盖，
  frontmatter 单行标量约束保持

### Requirement: 两段式蒸馏执行（纯计划 + 单项事务）

skill-wiki MUST 提供 `planDistillation`（纯函数：Zod 收窄/锚点预算校验/
before-after hash/相似预警附注；model-invalid 项产出诊断）与
`applyDistillation`（单项原子落盘）。absorb 判定 MUST 三态：当前 ==
afterHash 且 ledger 已记 → idempotent；当前 == beforeHash → 执行（锚点
未中 → patch-failed 零写）；其余 → stale 零写。create 幂等 = contentHash
去重 + 命中回填足迹。IO 失败 typed 上抛。

#### Scenario: 人工编辑后重放

- **WHEN** 提案审批前目标页被人工编辑（body hash 不再等于 before/after）
- **THEN** 该项 stale 零写，其余项不受影响，ledger 记录 stale

#### Scenario: 崩溃后重放

- **WHEN** 页写入后进程崩溃，重启后重放同一提案
- **THEN** 结果 idempotent（ledger/afterHash 判定），不产生重复页

### Requirement: 宿主蒸馏编排（run registry + 审批红线）

daemon MUST 提供 DistillJobService（独立于 agentSessions；kernel 一次性
job 只读工具面、120s 有界、stop/cancel/timeout 全路径 dispose；不进面板
列表与持久转录）：run 目录 `<appDir>/wiki-distill/<runId>/`（0700/0600、
原子写、corpus/model-output/proposals.jsonl ledger——机器真相；
≤32 提案、≤20 run LRU + 显式 purge；IO typed DISTILL_IO）。提案生成前
MUST 预检 McpProposalStore 容量（不足 → typed DISTILL_LIMIT，绝不静默
淘汰 pending）。`wiki.distill_apply` capability 输入 = {runId, ordinal}，
handler 从 registry 反查 digest 校验（伪造 → DISTILL_RUN_NOT_FOUND）；
执行经 proposal 审批（human-ui）。`wiki.distill.start/status/cancel`
RPC/CLI 同一 schema（--limit 默认 20 ≤ 100）。workspace 原文 MUST 零改动。

#### Scenario: 手动蒸馏闭环

- **WHEN** 对某 workspace distill 并审批全部提案
- **THEN** global 出现泛化页（足迹引用来源 pattern），workspace patterns
  逐字节不变，ledger 逐项可审计

#### Scenario: 伪造提案引用

- **WHEN** agent 提交 wiki_distill_apply_propose {runId: 伪造, ordinal}
- **THEN** typed DISTILL_RUN_NOT_FOUND，零写

#### Scenario: 容量预检

- **WHEN** 有效提案数超过 store 剩余容量
- **THEN** typed DISTILL_LIMIT（含 --limit 提示），无 pending 被淘汰

#### Scenario: 模型输出混合有效性

- **WHEN** kernel 输出含部分非法提案
- **THEN** 非法项记 model-invalid 诊断，合法项照常生成 proposal；全部
  非法 → run failed(no-valid-proposals)，无半态
