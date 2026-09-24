# skill-wiki Specification (delta)

## ADDED Requirements

### Requirement: 蒸馏提案契约（SDK 冻结面）

skill-wiki MUST 冻结蒸馏契约（Zod，unknown 键拒绝，预算常量版本化导出）：
`DistillProposal`（create/absorb 判别联合——absorb 钉死
`expectedBeforeBodyHash` 与 edits 复用 WikiEdit 原语）、`PromotedFromEntry`
（canonical JSON 单行序列化，多次泛化追加合并不覆盖）、`ItemResult`
（applied/idempotent/stale/patch-failed/model-invalid/rejected/expired/
not-proposed）。SDK MUST NOT 引入 LLM/网络依赖。

#### Scenario: promotedFrom 追加合并

- **WHEN** 同一 global pattern 经两次不同 run 泛化
- **THEN** promotedFrom 含两条足迹（按 runId 去重），既有足迹不被覆盖，
  frontmatter 单行标量约束保持

### Requirement: promotedFrom 信封 round-trip

frontmatter `promotedFrom` 的存储值 MUST 恒为 canonical JSON 数组（单条
也是 `[{...}]`；键排序、无空白）；entry strictObject（unknown 键拒绝）。
历史/手改坏值 MUST 读投影 null（不伪装空足迹、不覆盖原文），merge 时
typed WIKI_INVALID_PATTERN（提示人工修复）。四个场景为外部契约
（tasks 1.1 必过 fixture）：

#### Scenario: null round-trip

- **WHEN** pattern 无足迹（新页）
- **THEN** frontmatter 值为 null；经泛化合并后变为单条数组信封

#### Scenario: 单条 round-trip

- **WHEN** 已有单条足迹的 pattern 再次解析
- **THEN** 解析得单元素数组；追加不同 run 足迹后按 runId 升序重排落盘

#### Scenario: 双条 round-trip

- **WHEN** 数组含两条不同 runId 足迹
- **THEN** 解析保序不丢字段；同 run 重放 union sourcePatternIds 不产生
  第三条

#### Scenario: 坏值 round-trip

- **WHEN** 手改为非法 JSON 或缺必需键的对象
- **THEN** 读投影 null；merge 拒绝并 typed WIKI_INVALID_PATTERN，
  原值逐字节保留（等待人工修复）

### Requirement: 两段式蒸馏执行（纯计划 + 单项事务）

skill-wiki MUST 提供 `planDistillation`（纯函数：Zod 收窄/锚点预算校验/
before-after hash/相似预警附注；model-invalid 项产出诊断）与
`applyDistillation`（单项原子落盘；宿主以 typed `ledgerRecord` 输入传入
既有判定状态）。absorb 判定 MUST 按 ledger 状态区分：当前 == afterHash
且 ledger ∈ {applying, applied} → idempotent（applying 补 index rebuild +
commit）；当前 == beforeHash 且 ledger ∈ {无, applying} → 执行（锚点
未中 → patch-failed 零写）；当前 == beforeHash 且 ledger == applied →
人工回退：stale 零写，绝不重放；其余 → stale 零写。create 幂等 =
contentHash 去重 + 命中回填足迹。IO 失败 typed 上抛。

#### Scenario: 人工回退后重放

- **WHEN** 提案已 applied，人工把目标页正文恢复为 before 内容后重放
- **THEN** 该项 stale（manual-rollback）零写，页面保持人工回退态，
  ledger 保持 applied；重新泛化必须走新提案

#### Scenario: 人工编辑后重放

- **WHEN** 提案审批前目标页被人工编辑（body hash 不再等于 before/after）
- **THEN** 该项 stale 零写，其余项不受影响，ledger 记录 stale

#### Scenario: 崩溃后重放

- **WHEN** 页写入后进程崩溃，重启后重放同一提案（absorb 或 create）
- **THEN** 结果 idempotent（absorb 走 ledger/afterHash 判定；create 走
  contentHash 去重），不产生重复页

#### Scenario: create 同名人工页零覆盖

- **WHEN** create 项的目标 name 已存在且 contentHash 不等于 afterHash
- **THEN** 该项 stale 零写，既有同名页逐字节不变

### Requirement: 宿主蒸馏编排（run registry + 审批红线）

daemon MUST 提供 DistillJobService（独立于 agentSessions；kernel 一次性
job 只读工具面、120s 有界、stop/cancel/timeout 全路径 dispose；不进面板
列表与持久转录）：run 目录 `<appDir>/wiki-distill/<runId>/`（0700/0600、
原子写、corpus/model-output/proposals.jsonl ledger——机器真相；
≤32 提案、≤20 run LRU + 显式 purge；LRU 引用真相 = 持久 ledger，不信
store 内存态；IO typed DISTILL_IO）。提案创建 MUST 走 McpProposalStore
原子 admission 事务（admitBatch 单一临界区：terminal 回收与全批创建
同事务；回收后仍不足 → 整批拒绝 typed，store 逐字节不变；pending 永不
淘汰）。`wiki.distill_apply` capability 输入 = {runId, ordinal}，
handler 从 registry 反查 digest 校验（伪造 → DISTILL_RUN_NOT_FOUND）；
approved 执行入口 = per-run 串行队列投递（与 cancel/重启扫描同队列，
可串行化）；执行经 proposal 审批（human-ui）。`wiki.distill.start/
status/cancel` RPC/CLI 同一 schema（src/shared/contracts/wiki-distill.ts
冻结；无 phase 字段，RunState 即阶段真相；--limit 默认 20 ≤ 100）。
workspace 原文 MUST 零改动。决定竞争 MUST 按决定点胜者表唯一收敛：
pending 上 human reject → proposal rejected(cause=human) + ledger
rejected；pending 上 cancel → proposal rejected(cause=cancelled) +
ledger expired + run cancelled；approved（token 已发）后 cancel → run
cancelled + apply 二次校验失败 → proposal failed + ledger expired，
迟到 reject 不可覆盖 token。run 终态 MUST 按优先级判定：零合法提案 →
failed(no-valid-proposals)；全部 not-proposed → failed(capacity)；
全部 io-failed → failed(io)；ledger 非空全终态 → completed（末项终态
任务迁移；mixed 含 io-failed 亦 completed，计数在 counters）。
create 项的目标 name（targetPatternName）MUST 持久化于 ledger record
（重放写确切 name，禁止 -N 自动改名；同 run slug 冲突在 plan 期以
model-invalid(target-collision) 拒绝，ordinal 先到先得）。
DISTILL_IO / DISTILL_LIMIT / DISTILL_RUN_NOT_FOUND / DISTILL_STALE /
DISTILL_ACTIVE_RUN / PROPOSAL_STALE MUST 进 RPC 错误闭合集合
（404/409/409/422/503 家族；PROPOSAL_STALE = 迟到 reject，detail 携带
current view），capability 与 MCP 面以 CapabilityFailureDetail（闭合
enum）同码投影；DISTILL_TIMEOUT / DISTILL_CANCELLED /
WIKI_INVALID_PATTERN 为 kernel/daemon-local，不进跨面闭集。

#### Scenario: 手动蒸馏闭环

- **WHEN** 对某 workspace distill 并审批全部提案
- **THEN** global 出现泛化页（足迹引用来源 pattern），workspace patterns
  逐字节不变，ledger 逐项可审计，run 收敛 completed

#### Scenario: 伪造提案引用

- **WHEN** agent 提交 wiki_distill_apply_propose {runId: 伪造, ordinal}
- **THEN** typed DISTILL_RUN_NOT_FOUND，零写

#### Scenario: 容量 admission 事务

- **WHEN** 有效提案数超过「剩余容量 + 可回收 terminal 总量」
- **THEN** typed DISTILL_LIMIT（含 --limit 提示），store 逐字节不变
  （terminal 一个不删、pending 零淘汰）；部分可容纳时也不产生半批；
  run failed(reason=capacity)

#### Scenario: 审批与取消并发

- **WHEN** approve 与 cancel 对同一 run 并发提交
- **THEN** 两操作经 per-run 串行队列化，终态唯一可串行化；pending 上
  取消胜出 → rejected(cause=cancelled) + ledger expired；approve 已胜
  （token 已发）后取消 → run cancelled + 该项 proposal failed + ledger
  expired，迟到决定不覆盖 token

#### Scenario: 用户取消与人工拒绝二分

- **WHEN** 同一 awaiting-approval run 中一项被人在 proposal 面拒绝、
  其余项随后被用户取消 run
- **THEN** 前者 proposal rejected(cause=human) + ledger rejected；后者
  proposal rejected(cause=cancelled) + ledger expired；已执行项保留

#### Scenario: 零合法提案与容量失败的终态优先级

- **WHEN** kernel 输出全部非法（无合法提案），或全部合法项因容量整批
  拒绝（全部 not-proposed）
- **THEN** 前者 run failed(no-valid-proposals)、后者 run
  failed(reason=capacity)；两者都不是 completed；终态后同 source 可
  重新 start

#### Scenario: IO 重试耗尽的三面终态

- **WHEN** 某项 apply 的页写/rebuild IO 失败且有界重试（≤3）耗尽
- **THEN** proposal failed（detail.code=DISTILL_IO）、ledger 行终态
  io-failed、counters["io-failed"] 计入；全部项皆 io-failed → run
  failed(reason=io)；部分成功 → run completed 且失败计数可见

#### Scenario: pending 项绝不被执行路径迁移

- **WHEN** absorb 目标页在审批前被删除/损坏，随后任何 status 轮询或
  重放路径经过该项
- **THEN** pending 项零写、ledger 不动（缺页 preflight 只作用于已批准/
  applying/applied 路径）；只有 approve 才驱动 apply，apply 时才判
  missing-target → stale

#### Scenario: 同 run 目标名冲突 plan 期拒绝

- **WHEN** 模型输出两个 create 的 title 经 slugify 得同名（或与某
  absorb target 相同）
- **THEN** 后 ordinal 项 model-invalid(target-collision)（确定性
  先到先得），不产 plan item 不进 proposal；先项不受影响

#### Scenario: 迟到拒绝

- **WHEN** proposal 已 approved（token 已发）后人工点 Reject
- **THEN** typed PROPOSAL_STALE（detail 携带当前 view），不覆盖
  token、不改 ledger；重复同 cause 的终态 reject 幂等返回 view

#### Scenario: 模型输出混合有效性

- **WHEN** kernel 输出含部分非法提案
- **THEN** 非法项记 model-invalid 诊断，合法项照常生成 proposal；全部
  非法 → run failed(no-valid-proposals)，无半态
