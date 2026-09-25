# Design: skill-wiki-maintainer（切片③ LLM 认知蒸馏）r2

> r2（2026-09-25）：按设计评审 r1（/tmp/maintain-design-review.md，5.0/10
> DESIGN-NEEDS-WORK）逐条闭合 P1-1..P1-6 与 P2-1..P2-6；章节编号对齐评审。
> r5（2026-09-25）：按 r4 评审（/tmp/maintain-design-review-r4.md，7.0/10）
> **直接改写** §2/§3/§4/§5 与 H/I/K/M 旧文（r4 P2-5 裁决：全文只剩一套规范
> 值，不再以补丁覆盖补丁），并新增 r5 补遗 N-P。
> r17（2026-09-25）：按 r16 评审（/tmp/maintain-design-review-r16.md，7.7/10）
> io-failed 可逆性裁决：永久终态（重启恢复仅限 applying 行；r16 的
> 「status 轮询再触发恢复」表述作废）；N/spec 同步双预算（页写走
> attempts 预留表 / rebuild-only 队列内 ≤2 独立上限）；tasks 补
> rebuild-only 三态验收（不改 attempts/耗尽三面终态/applying 可恢复
> vs io-failed 不复活）。
> r16（2026-09-25）：按 r15 评审（/tmp/maintain-design-review-r15.md，6.9/10）
> attempts 改预留制（写页尝试前原子 +1；崩溃窗口吃预算不超限——写页
> 上限 3 次跨重启恒成立；intent 示例注释同步）；rebuild-only IO 终止性
> 单列（不占写页预算，任务内 ≤2 重试后 io-failed，跨重启幂等无写页
> 副作用）；tasks 补 cluster 并列 tie-break fixture。
> r15（2026-09-25）：按 r14 评审（/tmp/maintain-design-review-r14.md，8.3/10）
> attempts 语义唯一化 = 已失败的写页尝试次数（失败后递增；剩余允许 =
> 3 - attempts；重启重放同一条计数规则，撤销 r13「不耗新预算」例外）；
> digest 段 clusters 排序同步全向量字典序键（与 SimilarCluster 同一
> 规则）。
> r14（2026-09-25）：按 r13 评审（/tmp/maintain-design-review-r13.md，7.2/10）
> N/spec 重试口径同步 H 计数表（最多 2 次重试/共 3 次写页——消除跨面
> 上限冲突）；U schema 块声明改依赖拓扑序（snapshot/detail 先于 view，
> 原样可编译无 TDZ）；slugifyPatternTitle 返回 raw string（空串不冒充
> PatternName，plan 收窄阶段单列）；cluster 排序全成员向量字典序（并列
> 唯一可序）；scoreVersion 格式冻结（TOKENIZER_VERSION 拼接）。
> r13（2026-09-25）：按 r12 评审（/tmp/maintain-design-review-r12.md，7.4/10）
> McpProposalViewSchema 完整五分支判别联合（failed 强制 failureDetail/
> rejected 携带 cause + McpProposalStatusSchema 定义）；attempts 计数表
> 冻结（1 首放 + 2 重试 = 3 次写页尝试）+ 同进程 store 投影异常处置
> （不回滚不阻塞、日志断言）；slugify raw 导出 + 空串策略二分（append
> 保留 pattern 回退，蒸馏 empty-slug）；SimilarClusterSchema 冻结；
> tasks 1.3 补三崩溃点/attempts 字节级/投影异常绿门。
> r12（2026-09-25）：按 r11 评审（/tmp/maintain-design-review-r11.md，7.2/10）
> 跨存储崩溃协议：run.json = ledger 派生缓存，启动无条件按 S 纯函数重算
> （三崩溃点 fixture）；H intent 示例补 attempts:0；U schema 去递归
> （ProposalDecisionSnapshot 快照 + discriminatedUnion 强制 currentView
> 条件 + 既有 result 不动新增 failureDetail 并行字段）；W digest 增
> clusters 排序键与 scoreVersion；slugify 冻结为现实现行为快照 v1
> （不虚构 transliteration）；spec 引用三 schema 名为外部契约。
> r11（2026-09-25）：按 r10 评审（/tmp/maintain-design-review-r10.md，7.0/10）
> H/V 两处旧 create 句归一为 targetPatternName+afterHash 口径；H 终态
> 集合补 io-failed（重放零写不复活）+ durable retry（attempts 持久化、
> 重启判定、三面原子迁移）；U 落 exact shared schemas（DistillErrorCode/
> CapabilityFailureDetail/reject 传输联合——设计即实现形状）；W 阈值改
> 原始 score 口径（不虚构归一化）+ digest 输入完整化（全 Corpus 对象）；
> slugifyPatternTitle 导出契约 + empty-slug model-invalid；spec ItemResult
> 补 io-failed；tasks 门禁改六码四面。
> r10（2026-09-25）：按 r9 评审（/tmp/maintain-design-review-r9.md，7.2/10）
> 终极归一：E 为状态/record 唯一规范源（create targetPatternName 入
> record；io-failed 入 ItemStatus；§2 引用 E）；H pending 优先红线 +
> create intent 带目标名；S 增 2.5 全-io-failed → failed(io)；U 六码
> 闭集（+PROPOSAL_STALE 409 + currentView detail）+ kernel-local 边界
>
> - PROPOSAL_IO 并入 DISTILL_IO；W Corpus score/阈值版本化/digest
>   输入冻结 + 同 run slug 冲突 plan 期拒绝；K 块声明 W 为规范源。
>   r9（2026-09-25）：按 r8 评审（/tmp/maintain-design-review-r8.md，7.1/10）
>   create targetPatternName 冻结（禁 -N 改名）/absorb 补 missing/invalid
>   target 分支与 applying 窗口语义裁决/late reject 统一抛 PROPOSAL_STALE/
>   apply IO 三面协议（io-failed 终态 + 有界重试）/CapabilityFailureCode
>   闭合 enum/W：Terminal 谓词集合 + Corpus 可复现冻结 + ephemeral 异步契约。
>   r8（2026-09-25）：按 r7 评审（/tmp/maintain-design-review-r7.md，7.0/10）
>   H 按 kind 分支重写（absorb/create 双序列双矩阵；create 无 beforeHash，
>   afterHash===contentHash 冻结）；R 增决定点胜者表；S 增终态判定优先级
>   （零合法→no-valid-proposals / 全 not-proposed→capacity / 全终态→
>   completed）；U 冻结 CapabilityFailureDetail + 五码传输状态 + cause
>   公开化（rejectedCause 字段 + reject async）。
>   r7（2026-09-25）：按 r6 评审（/tmp/maintain-design-review-r6.md，6.8/10）
>   新增补遗 Q-V（决定 CAS/取消-拒绝二分/completed 收敛式/admission API
>   统一 + terminal 闭合 + approved 瞬态/错误码接入/create record 判别联合）。
>   r6（2026-09-25）：按 r5 评审（/tmp/maintain-design-review-r5.md，7.2/10）
>   **废止旧 r3 补遗 A/B/D**（三套冲突规范值源头；重启语义并入 C）；
>   admissionCapacity 改含可回收 terminal；N 冻结 enqueue 完成语义/
>   reject seam（onRejected）/McpProposal↔Ledger 状态映射；L 键序精确化
>   （递归字典序 + exact bytes）；M 补损坏 pin fail-closed 边界。

## 0. 裁决沉淀（不可违背）

泛化 = LLM 蒸馏非机械 mv；workspace 原文永不删除；promotedFrom 溯源足迹；
SDK 纯领域库（无 LLM 依赖）；mutation 必经 proposal 审批红线。

## 1. 分层与职责

```text
GUI / CLI（wiki.distill.start/status/cancel 同一契约）
  └─ DistillJobService（daemon 专用服务，非 agentSessions）
       ├─ run registry（<appDir>/wiki-distill/<runId>/，daemon-owned）
       ├─ agent kernel 一次性 job（只读工具面 + 有界生命周期）
       └─ skill-wiki SDK（新增，两段式）：
            planDistillation(globalWikiDir, corpus, rawProposals)
              → 纯校验/哈希计算（不改盘）：逐项 beforeHash/afterHash/诊断
            applyDistillation(globalWikiDir, planItem, provenance)
              → 单项原子落盘 + promotedFrom 合并 + 幂等/STALE 判定
```

模型只产提案；所有写路径收敛到 applyDistillation 且必经 proposal 审批。

## 2. 契约（Zod 冻结；P2-1）

复用既有 `WikiEdit`（replace/insert_after/append 精确锚定原语）。
预算常量（SDK 导出，版本化 DISTILL_BUDGETS）：

```ts
DistillBudgets = { patternsPerRun: 100, corpusPatternDefault: 20,
                   patternBodyChars: 8_000, corpusTotalChars: 200_000,
                   modelOutputChars: 256_000, proposalsPerRun: 32 }

PromotedFromEntry = { runId: string(wd_[0-9a-f]{24}), sourceScope: string,
                      sourcePatternIds: string[] (1..50, PatternName) }
// 序列化（P1-1）：frontmatter 单行标量约束不变——存 canonical JSON 字符串；
// 多次泛化 = 追加合并（按 runId 去重，绝不覆盖既有足迹）。
parsePromotedFrom / mergePromotedFromEntry（SDK 导出，safeParse 收窄）

DistillProposal = 判别联合（unknown 键拒绝）：
  | { action:"create"; title(1..120); body(1..20_000);
      sourcePatternIds: string[] }
  | { action:"absorb"; targetPatternId: PatternName;
      edits: WikiEdit[](1..10);
      expectedBeforeBodyHash: sha256-hex;   // planDistillation 回填并校验
      sourcePatternIds: string[] }

DistillPlanItem = proposal + ordinal + digest + afterBodyHash（必填）
  + create 项额外冻结 targetPatternName: PatternName（r9-P1：plan 阶段由
    SDK 同源 slugify(title) 计算并写入 item 与 ledger intent——apply 写
    该确切 name，**禁止 appendPattern 的 -N 自动改名分支**（存在同名页
    即 stale 零写，spec「同名人工页零覆盖」）；重放目标因此确定）
ItemResult = { ordinal; status: DistillItemStatus; detail?; appliedHash? }
DistillItemStatus = applied|idempotent|stale|patch-failed|model-invalid|
                    rejected|expired|not-proposed|io-failed   // counters 全键（O；r9-P1.3）
RunState = collecting|kernel-running|awaiting-approval|completed|
           failed|cancelled   // 无独立 phase 字段——RunState 即阶段真相（O）
DistillFailReason = no-valid-proposals|capacity|io|timeout|
                    kernel-unavailable|restarted|cancelled-by-shutdown
错误码族（daemon DomainError）：DISTILL_IO / DISTILL_LIMIT /
DISTILL_RUN_NOT_FOUND / DISTILL_STALE / DISTILL_ACTIVE_RUN /
WIKI_PATCH_FAILED（透传）
```

## 3. 幂等与并发（P1-2）

applyDistillation 的 absorb 判定（在 expectedBeforeBodyHash 之上；完整
恢复矩阵以 §r3 补遗 H（r5 改写版）为唯一规范源，此处仅摘要）：

- 当前 body hash == afterHash 且 ledger ∈ {applying, applied} →
  `idempotent`（applying 补 rebuild+commit；applied 为 no-op；零写）
- 当前 body hash == beforeHash 且 ledger ∈ {无记录, applying} → 执行
  （edits 作用于钉死的 body；任一锚点未中 → 该项 `patch-failed`，零写）
- 当前 body hash == beforeHash 且 ledger == applied → **人工回退**：
  `stale` 零写，绝不重放（r4 P1-1 裁决）
- 其余（hash 两边都不匹配）→ `stale`（人工编辑/竞争），零写；补偿 =
  基于当前页重新生成提案（v1 = 重跑 distill 或人工编辑，不做隐式重基）

create 项幂等 = contentHash 去重（既有 appendPattern 语义）+ 命中时
`mergePromotedFromEntry` 回填足迹（P1-1 的新 SDK 操作，原子写）。
同 run 多项指向同一 target：每项独立钉原 beforeHash；后批必然 stale
（文档化；不隐式链式重基）。ledger（§5）是「已应用」的唯一判据。

## 4. Job 生命周期（P1-4 / P2-5）

DistillJobService（daemon 内，独立于 agentSessions/转录存储）：

- `wiki.distill.start { source: WorkspaceId } → { runId }`：同 source 同时
  至多 1 个活跃 run（重复 start → typed DISTILL_ACTIVE_RUN）；corpus 落盘成功
  后才进 kernel
- `wiki.distill.status { runId } → DistillStatusOutput`（E/O 冻结的
  strictObject；**无独立 phase 字段**，RunState 即阶段真相）；`wiki.distill
.cancel { runId }`：kernel-running → dispose agent + run → cancelled；
  awaiting-approval → C 的取消失效语义（ledger pending → expired + store
  未决 proposal 主动 reject）
- kernel 调用有界：默认 120s 超时；daemon stop → dispose + run → failed
  (reason=cancelled-by-shutdown)，重启后不自动续跑（corpus 快照在，人工
  重跑）；重启扫描见 C（awaiting-approval → cancelled(restarted)）
- distiller 会话**不进**面板列表与持久转录（一次性 ctx；原始输出只落
  run 目录）；工具面 allowlist = mcp__skill-creator__wiki_list /
  wiki_read / wiki_scopes 三个完整 scoped 注册名的 closed union
  （K/Q：编译期 + 运行时双重 fail-closed）——机制复用 agent-roles 的
  toolFilter；deny 一切 propose/apply。
  「prompt 要求只输出 JSON」不是 authority 边界（r1 D4 评语），工具面才是。
- CLI `wiki distill --workspace <ref> [--limit N(默认20,≤100)] [--json]`：
  --json 输出 = start+status 轮询终态 + ItemResult 全表（同一 schema）。

## 5. Run registry 与 proposal 容量（P1-3 / P1-5）

`<appDir>/wiki-distill/<runId>/`（daemon-owned；runId = wd_<24hex> 不可预测）：

- `run.json`：状态机 + 计数器（原子写）
- `corpus.json`：收集快照（相似簇预聚合 + global 候选 top-K=5 全文 +
  contentHash；D3——候选证据不足时 validateProposals 强制降级 create/
  丢弃 absorb）
- `model-output.txt`：原始输出（超预算截断并置 flag）
- `proposals.jsonl`：**机器真相 ledger**——每行 { ordinal, proposal,
  digest, status, result?, createdAt, decidedAt? }；审批/执行/淘汰都改写
  对应行（原子重写整文件，行数 ≤32）
- `logs.md` 仍只追加一行人读摘要（r1 P2-3：人读日志不作 machine truth）

proposal 容量纪律（I/T 冻结的 admission 事务，废除「生成前预检」旧文）：
proposal 创建走 daemon 内 `mcpProposals.admitBatch(wiki.distill_apply × N)`
单次原子 admission——有效项 ≤ min(32, admissionCapacity())；不足 → typed
DISTILL_LIMIT（提示 --limit）+ ledger 记 not-proposed，**绝不**部分创建、
**绝不**让 store 静默淘汰 pending（terminal 回收边界见 I）。输入不含提案体
——handler 从 registry 反查 digest 校验；伪造 runId/ordinal →
DISTILL_RUN_NOT_FOUND。MCP 面自然出现 `wiki_distill_apply_propose`
（approved-mutation 自动投影，r1 指出的矛盾按此裁决：**暴露**，安全由
handler 的 registry 校验承担；执行入口 = N 的 per-run 队列投递）。

## 6. 资源与敏感数据边界（P1-6）

预算见 §2；快照目录 0700、文件 0600、同目录临时文件 + rename 原子写；
runId 文件系统安全（无用户输入拼接）；EACCES/EIO/ENOSPC → typed
DISTILL_IO（run 标记 failed，不伪装空 run）；symlink run 目录 → 拒绝。
保留策略：最多 20 个 run（LRU 淘汰，淘汰动作进 daemon 日志）+
`wiki.distill.purge { before: ISO }` 显式清理；raw model output 本地保留
（本地优先产品，home 目录私有；不做脱敏——文档化该裁决）。

## 7. 两段式 SDK（P2-4）

- `planDistillation(globalWikiDir, corpus, rawProposals)`：纯函数（只读
  global 页）——逐项 Zod 收窄、锚点/预算/target 存在性校验、before/after
  hash 计算、相似预警附注；model-invalid 项产出诊断不产出 plan item
- `applyDistillation(globalWikiDir, item, provenance)`：单项 IO 事务——
  §3 判定 → 原子写/合并足迹/重建 index；IO 失败 typed（不吞）
- 宿主编排（daemon）负责 ledger/proposal/审批桥；SDK 不知道 MCP/proposal

## 8. 验收矩阵（P2-6；tasks 逐项对应）

每个 task 的绿门命令写入 tasks.md；实现完成后独立复核轮（非 tasks 内
自评）+ UI 面桌面/窄屏视觉走查（探针 + vision）+ daemon 生命周期 focused
tests（stop/cancel/timeout/restart 矩阵）+ 伪造与竞争负面用例
（P1-5/P1-2 列举的全部）。

---

## r3 补遗（闭合 r2 评审：/tmp/maintain-design-review-r2.md）

### A. 崩溃提交协议（r2 P1-2/D2 FAIL）——已废止（r6）

本节旧恢复矩阵（`applying|applied + beforeHash → 重新执行`）**作废**：
该分支会覆盖人工回退。唯一规范源 = r4 补遗 H（r5 改写版）：typed
`ledgerRecord` 输入 + `applying+before → 重做` / `applied+before →
manual-rollback stale 零写` 全矩阵。保留标题仅为评审对照。

### B. 容量原子预约（r2 P1-3 FAIL）——已废止（r6）

本节旧容量模型（`pendingCapacity`/`createBatch` 挂 pending 差额）**作废**。
唯一规范源 = r4 补遗 I（r5 改写版）：全集 slot + `admissionCapacity =
free + |terminal|` + admitBatch 单临界区全事务。重启扫描语义已并入 C。
保留标题仅为评审对照。

### C. 取消失效语义（r2 新 P1-1）

`wiki.distill.cancel` 在 awaiting-approval 亦可用且必须闭合：

- run → cancelled（原子）；ledger 全部 pending 项 → expired
- 对应 store 内未决 proposal 由 service 以 **cause=cancelled** 主动 reject
  （proposal 面 rejected；ledger 侧 **保持 expired**——用户取消与人工拒绝
  的 ledger 终态二分见 R）；已执行项保留结果
- approve handler 二次校验：run 状态非 awaiting-approval/completed →
  typed DISTILL_STALE 零写（取消/重启后不可再执行）
- 重启路径（自 r6 起本节持有）：daemon 重启丢 pending（store 内存态）→
  DistillJobService 启动扫描 awaiting-approval 的 run → ledger 未决项
  标 expired、run → cancelled(reason=restarted)；approve 已失效引用 →
  DISTILL_RUN_NOT_FOUND；扫描先于任何 LRU 淘汰判定（M 的顺序不变式）

### D. Kernel 只读面（r2 P1-4/D4 FAIL）——已废止（r6）

本节旧接口（`toolAllowlist: readonly string[]` + 裸 `wiki_list/...` 名）
**作废**。唯一规范源 = r4 补遗 K（r5 改写版）：`DistillReadonlyToolName`
closed union（三个完整 scoped 名）+ 运行时注册名 fail-closed 二次校验 +
EphemeralSession 完整接口。保留标题仅为评审对照。

### E. 共享契约冻结（r2 item-11/P2-5 FAIL；r5-O 统一 phase 契约）

新增 `src/shared/contracts/wiki-distill.ts`（RPC/CLI --json/GUI store 同源；
**单一 phase 契约——无独立 phase 字段，RunState 即阶段真相**）：

```ts
DistillStartInput  = { source: WorkspaceId }          // 同 source 活跃 run ≤1
DistillStartOutput = { runId }
DistillStatusOutput = strictObject({
  runId; state: RunState;
  reason: DistillFailReason | null;   // 仅 failed/cancelled 终态非 null
  counters: strictObject(全键 DistillItemStatus → int ≥0，缺项 0 补齐，
    unknown 键拒绝);
  proposalRefs: readonly Array<strictObject({
    ordinal: int ≥0; proposalId: string | null;
    status: DistillLedgerStatus })> })
DistillCancelOutput = { runId; state: "cancelled" }
DistillFailReason = no-valid-proposals | capacity | io | timeout
                  | kernel-unavailable | restarted | cancelled-by-shutdown
RunState = collecting | kernel-running | awaiting-approval | completed
         | failed | cancelled          // 终态幂等可轮询
DistillItemStatus = applied | idempotent | stale | patch-failed
                  | model-invalid | rejected | expired | not-proposed
                  | io-failed    // r10：与 §2 同集（E 为唯一规范源，§2 引用）
DistillLedgerStatus = pending | applying | applied | idempotent | stale
                    | patch-failed | expired | rejected | not-proposed
                    | io-failed
TerminalDistillLedgerStatus = applied | idempotent | stale | patch-failed
                    | expired | rejected | not-proposed | io-failed
                    // model-invalid 无 ledger 行（plan 期诊断，不产 plan
                    // item），故 LedgerStatus ⊂ ItemStatus
DistillLedgerRecord = 判别联合（r7-V；r10-P1：create 目标名持久化——
  重启后从 record 复原确切写路径）：
  | { kind:"absorb"; ordinal; status: DistillLedgerStatus;
      beforeHash; afterHash; appliedHash?; attempts: int ≥0 }
  | { kind:"create"; ordinal; status: DistillLedgerStatus;
      targetPatternName: PatternName; afterHash; appliedHash?;
      attempts: int ≥0 }
      // create 恢复 = contentHash 幂等（确切 name 占用检查，禁 -N 改名）；
      // attempts = durable retry 计数（H r11）
错误码（contracts 错误表，r10 终版闭集——见 U）：DISTILL_IO /
DISTILL_LIMIT / DISTILL_RUN_NOT_FOUND / DISTILL_STALE /
DISTILL_ACTIVE_RUN / PROPOSAL_STALE（RPC 面）
```

### F. 字段级 Zod（r2 P2-1）与审计一致性（P2-3）

- title 上限对齐既有 frontmatter/RPC 契约：1..120（不是 200）；
  body 1..20_000；sourcePatternIds 1..50（元素 PatternName）；
  edits 1..10（WikiEdit）；Corpus 契约以 W（r9）的 DistillCorpus 为
  唯一规范源（本条旧三字段形状作废；candidate 含 title/sourceScope/
  score，retrieval/阈值/digest 冻结见 W）
- promotedFrom 空值语义：无足迹 = null（非空数组/字符串）；canonical
  JSON = 键排序、无空白；同 run 重放 union sourcePatternIds
- ItemResultStatus 枚举即 E 的 counters 键；四文档（proposal/design/
  spec/tasks）审计表述统一为：ledger = machine truth，logs.md = 人读摘要

### G. tasks 门禁补全（r2 P2-6）

1.1/1.2 追加 `pnpm typecheck && pnpm exec vp fmt --check`；1.3 生命周期
门禁 = `pnpm exec vitest run test/wiki-distill-service.test.ts
test/dsh-kernel.test.ts`（stop/timeout/restart/cancel-awaiting 矩阵在
案）；1.6 门禁 = `pnpm --dir webui check && pnpm exec vitest run
webui/src/lib/stores/__tests__/wiki-distill.test.ts`；全 change 收口 =
`pnpm check`。

---

## r4 补遗（闭合 r3 评审：/tmp/maintain-design-review-r3.md）

### H. 崩溃提交协议（r3 D2/P1-2；r4 P1-1 改写；r8 按 kind 分支重写）

applyDistillation 单项序列（ledger-先行 + 幂等恢复；ledger 由
DistillJobService 的 per-run 串行队列驱动——同 run 的 apply 永不并发，
无需 CAS）。intent 行 = E 的 `DistillLedgerRecord` 判别联合（absorb 双
hash / create 带 targetPatternName + afterHash——create 无目标旧页
可比 beforeHash（r11 唯一口径）；`afterHash === contentHash(正文)`
字节级冻结，不做 beforeHash 伪装值）：

```text
kind="absorb"：
1. ledger intent：{kind:"absorb", ordinal, status:"applying",
   beforeHash, afterHash, attempts: 0}   // 首放恒 0；写页尝试前原子 +1（预留制，见 durable retry）
2. 目标页原子写（temp+rename；在钉死 body 上应用 edits）
3. index rebuild（派生物）
4. ledger commit：{status:"applied", appliedHash}

kind="create"：
1. ledger intent：{kind:"create", ordinal, status:"applying",
   targetPatternName, afterHash, attempts: 0}   // 目标名持久化（E 联合）
2. appendPattern 原子写（contentHash 去重原语；afterHash 即其锚）
3. index rebuild
4. ledger commit：{status:"applied", appliedHash}

（proposals.jsonl 整文件原子重写；step1 之后任何时刻崩溃都可恢复）
```

- 任何 commit 之前 index 必为已重建状态：恢复分支
  `applying|applied 且 已落盘` **必须先 rebuild index 再补写 commit**；
  rebuild 失败 → typed DISTILL_IO，项保持 applying（仍可恢复）。
- **durable retry（r11-P1.2；r12-P1.1 跨存储协议；r16 预留制终局）**：
  intent 行携带 `attempts: int ≥0`（r16 冻结：**已开始的写页尝试
  次数——预留制**：每次写页尝试**前**原子 +1（含首放 0→1）；「失败
  后计数」与「重试前计数」两歧义源全部废除——预留已持久，崩溃窗口
  吃预算但不产生超限写页，**写页上限 3 次跨重启恒成立**）：

```text
attempts=0  未开始（或纯恢复分支已闭环）
写页需要 → 先 +1 再执行：
 attempts=1  第 1 次写页尝试（首放）
 attempts=2  第 2 次写页尝试
 attempts=3  第 3 次写页尝试（最后一次）
 第 3 次仍失败（或矩阵不可恢复）→ io-failed 终态
（1 次首放 + 2 次重试 = 最多 3 次写页尝试；attempts = 已开始的
 尝试数；剩余 = 3 - attempts）
重启/重放入口（唯一规则）：
 按矩阵判定——afterHash 分支（页已写）= 纯恢复（rebuild+commit，
 不写页、不计数）；需写页分支 → attempts < 3：+1 后执行（新尝试，
 无论上次是干净失败还是崩溃——崩溃窗口的预留已计入）；
 attempts ≥ 3 且仍需写页 → io-failed
```

- **rebuild-only IO 的终止性（r16-P1；r17-P1 裁决可逆性）**：页已写
  （矩阵命中 afterHash/恢复分支）而 index rebuild 反复失败 → 不递增
  attempts（无新写页，预算独立：**页写走 attempts 预留表；rebuild-only
  走队列内独立上限**）；同一队列任务内 rebuild 重试 ≤ 2，仍失败 →
  `io-failed` **永久终态**（与通用终态矩阵一致：重放零写、不复活、
  不自动重试；人工修复后重跑 distill 产新提案）。**重启恢复仅限仍为
  `applying` 的行**（崩溃于队列内重试中、尚未落 io-failed——重启
  扫描按矩阵处理，可续完 afterHash 纯恢复或继续消耗剩余规则；r16 的
  「status 轮询可再次触发恢复重试」表述作废——它只描述 applying 行
  的恢复，不适用于已落 io-failed 的行）。

重试耗尽的写序与崩溃恢复：
**写序（ledger-first）**：① ledger 行 → io-failed → ② proposal store
投影 failed（内存态）→ ③ run.json 按 S 优先级重算。
**同进程投影异常（r13-P1.2）**：② store 投影更新抛错/失败 → 队列任务
捕获记 daemon 日志，**不回滚①、不阻塞③**——store 为内存态非真相
（M/LRU 同源哲学）；③ 照常执行；proposal 面短暂停留旧态（approved
瞬态），由下次 store 写入或重启收敛；不引入跨存储补偿事务。
**崩溃恢复 = run.json 是 ledger 的派生缓存（r12 裁决）**：store 为
内存态（重启即空，B 既有裁决）；run.json 非真相——启动扫描对每个 run
**无条件以 proposals.jsonl 全行按 S 优先级纯函数重算终态并回写**
run.json（幂等；ledger-first/②后/③后任何崩溃点都收敛到同一终态）。
三个崩溃点 fixture：①后②前 / ②后③前 / ③后——重启重算结果一致
（字节级 run.json 断言）。

- SDK/宿主边界：`applyDistillation(globalWikiDir, item, provenance,
options?)`——`options.hooks = { onIntent(record), onCommit(record) }`
  （可选）。SDK 驱动顺序契约：onIntent → 页原子写 → index rebuild →
  onCommit；ledger 的存储实现属宿主（DistillJobService），SDK 只承诺顺序
  与幂等，不落 ledger、不知道 run/MCP。无 options 调用 = 纯 SDK 写语义
  不变。
- **ledger 读取语义（r4 P1-1）**：宿主读 proposals.jsonl 该 ordinal 的
  最近行，作为 typed 输入 `options.ledgerRecord?: DistillLedgerRecord`
  （判别联合；整文件原子重写保证行只有旧/新两态，无半行）传入。SDK 不读
  ledger 存储（§7 边界不变）。

**absorb 恢复矩阵（当前页 body hash 判定；区分人工回退）**：

```text
前置分支顺序（r10-P1.3：pending 优先——审批红线，未审批项绝不
  被执行路径迁移状态）：status == "pending" → 不执行、零写、ledger
  不动（无论目标页状态；apply 只由 approve 驱动）；
此后（approved/applying/applied/重放路径）preflight：目标页不存在
  （readPattern NOT_FOUND）或 frontmatter 畸形（WIKI_INVALID_PATTERN
  typed 失败，仅 daemon 日志——item 结果 = stale detail=
  invalid-target，不跨面抛 transport error，r10-P2.5）→ stale 零写
  （detail=missing-target / invalid-target），行落终态 stale——缺页/
  坏页不可重建锚定，人工修复或重跑 distill；绝不凭空创建目标页
ledgerRecord 无（首放）：==beforeHash → 执行；==afterHash → rebuild
  index + 补 commit（前次崩溃于 step1 前；step1 后崩溃必有记录——
  「写前必 intent」不变式）；其余 → stale 零写
status == "pending"    → 不执行（审批未决；approve 才驱动 apply）
status == "applying"（intent 后、commit 前崩溃）：
  ==afterHash  → rebuild index → 补 commit（idempotent）
  ==beforeHash → 重新执行（语义裁决 r9：applying = 已批准未完成的意图，
    该窗口人工把页恢复为 before 内容时重放 = 执行既定审批意图，合法——
    与 applied+before（已完成后的人工回退，绝不重放）的区别在 commit）
  其余         → stale 零写（执行窗口内人工改页），行落终态 stale
status == "applied"（已 commit）：
  ==afterHash  → no-op idempotent（applied 蕴含 index 已重建）
  ==beforeHash → 人工回退检测：零写，报告 stale（detail=manual-
                 rollback），ledger 保持 applied——**绝不重放**（不覆盖
                 人工回退）；需再泛化 → 人工重跑产新提案
  其余         → stale 零写（人工编辑/竞争）
status ∈ 终态（stale/patch-failed/expired/rejected/not-proposed/
  idempotent/io-failed——E/W 全集，r11）→ 报告原终态，零写（幂等
  重放不复活；io-failed 行同样零写报告，人工修复后重跑 distill 产新
  提案——不自动复活、不自动重试）
```

**create 恢复矩阵（name = item/ledger intent 冻结的 targetPatternName
（r9-P1）；按存在性 + contentHash 判定；无 beforeHash 比较）**：

```text
写路径原语 = 确切 name 占用检查 + 原子写（禁止 appendPattern 的 -N
  自动改名——同名即 stale，绝不换名落盘）
ledgerRecord 无（首放）：name 不存在 → 执行；存在且 contentHash ==
  afterHash → rebuild index + 补 commit（idempotent）；存在但 hash 异
  → stale 零写（同名人工页，绝不覆盖）
status == "pending"    → 不执行
status == "applying"：
  存在且 hash == afterHash → rebuild index → 补 commit（idempotent）
  不存在 → 重新执行（崩溃于写前；applying 窗口人工删除 = 意图未完成，
    重放 append 是执行既定审批——与 applied+删除的绝不重放对称区别）
  存在但 hash 异 → stale 零写，行落终态 stale
status == "applied"：
  hash == afterHash → no-op idempotent
  不存在 → 人工删除检测：零写，报告 stale（detail=manual-rollback），
    ledger 保持 applied——绝不重放（与 absorb 对称）
  hash 异 → stale 零写（人工编辑）
status ∈ 终态 → 报告原终态，零写
```

负测试：absorb `applied` + 人工恢复 before 内容 → 零写 + stale
（manual-rollback）；create `applied` + 人工删除页 → 零写 + stale
（manual-rollback）；create 写后崩溃重放 → 去重 + idempotent（spec
fixture 已列）。

### I. 容量 slot 单一模型 + admission 全事务（r3 P1-3；r4 P1-2 改写；r6 修上限口径）

容量以 store 全集计（含 terminal 历史，对齐 Map.size 事实）：

- `admissionCapacity() = (MAX_PROPOSALS - size()) + |terminal 条目|`
  （r6：**含可回收 terminal**——`size=MAX` 且全 terminal 时上限非 0，
  r5 的 `MAX - size()` 口径会把可容纳批次错判为 0）
- **admitBatch(items) 单一临界区事务（r4 P1-2 裁决；create = admitBatch
  长度 1 的同一 primitive）**：

```text
free = MAX - size()；need = items.length
free ≥ need            → 同一临界区全批 create + 一次持久化提交
free < need            → 回收候选 = terminal 条目（decidedAt 升序）：
  free + |terminal| < need → 整批拒绝 typed PROPOSAL_LIMIT，
    store 逐字节不变——terminal 一个都不删（「释放后再失败」分支不存在：
    删除决策与容量计算同在提交临界区内，绝无先删后拒的中间态）
  否则 → 同一临界区：淘汰最旧 (need - free) 个 terminal + 全批 create，
    一次持久化提交；持久化 IO 失败 → 内存态回滚进入前快照，
    typed DISTILL_IO（detail.phase=admission，r10-P2.5：并入统一闭集，
    不另立 PROPOSAL_IO），不部分落盘
```

- pending 永不淘汰（全局废除静默淘汰的完成态表述）；蒸馏批量上限 =
  min(32, admissionCapacity())（即乐观上限含可回收 terminal；真正适配
  在临界区内按上式判定）；普通单条 create 同一模型
- 负测试：pending 满载 create → PROPOSAL_LIMIT 且 store 逐字节不变；
  「terminal 不足整批」→ 拒绝后 terminal 全部仍在（字节级断言）；
  全 terminal 满载 → admissionCapacity ≥ 1 且 admitBatch 正常回收执行

### J. cancel/approve 同队列串行（r3 P1-4/C）

run 的一切状态迁移（apply 执行、approve/reject 决定、cancel、重启
expired 扫描、LRU 淘汰判定）**全部经 DistillJobService 的同一 per-run
串行队列**（与 H 的 hooks 写同队列）——取消与审批执行不可能交错写入；
队列化负测试：cancel 与 approve 并发提交 → 结果可串行化（终态唯一）。

### K. EphemeralSession 完整接口（r3 P1-4/D；r9-W 异步化：Promise 创建/prompt signal+deadline/dispose deadline）

```ts
// dsh-kernel 扩展（tasks 1.3a 实现 + 单测）
// ⚠️ r10：本块签名以 W（r9）异步契约为唯一规范源——create 返回
// Promise（含 bridge ready）、prompt 带 signal/deadline、dispose 带
// deadline；下方同步形状为 r3 历史骨架，实现以 W 为准。
interface EphemeralSession {
  /** 单轮 prompt（无历史、无续写）；结果 = 模型最终文本（typed 失败上抛）。 */
  prompt(input: string): Promise<{ text: string }>;
  /** 实际可见工具名全集（断言面：allowlist 过滤后的注册名）。 */
  listTools(): readonly string[];
  /** 有界释放；重复调用幂等。 */
  dispose(): Promise<void>;
}
createEphemeralSession(options: {
  systemPrompt: string;
  /** closed union（r4 P2-4：编译期 fail-closed——调用方无法拼出
   *  mutation 工具名）。运行时二次校验：与实际 MCP 注册名逐一比对，
   *  未知/未注册名 → 创建即 typed 失败，绝不静默放行或静默丢弃。 */
  toolAllowlist: readonly DistillReadonlyToolName[];
}): EphemeralSession

type DistillReadonlyToolName =
  | "mcp__skill-creator__wiki_list"
  | "mcp__skill-creator__wiki_read"
  | "mcp__skill-creator__wiki_scopes";
```

隔离 context：per-session dsh context，不注册 agentSessions/transcripts
（接口层不存在列表面）；dispose 于 stop/timeout/cancel 全路径。负测试：
`listTools()` 不含任何 `*_propose`/`*distill*`。

### L. promotedFrom 精确信封（r3 新 P2-8；r6 键序精确化）

存储值恒为 **JSON 数组**（单条也是 `[{...}]`）；entry strictObject
（unknown 键拒绝）；解析失败（历史/手改坏值）→ 读投影 null、merge
typed WIKI_INVALID_PATTERN（提示人工修复，不覆盖）；同 run 重放 =
union sourcePatternIds 后**按 runId 升序**重排序落盘。**键序 = 递归
字典序（r6 P2-7）**：冻结序列化器 = 深层 sortKeys 后 `JSON.stringify`
（无空白），fixture 断言 exact bytes，坏值场景断言 merge 拒绝后原值
**逐字节保留**。spec 增加 null/单条/双条/坏值四个 round-trip fixture
场景。

### M. LRU pin 与 status 契约严格化（r3 新 P2-9/10；r4 P2-8 真相源；r6 边界）

- **引用真相 = 持久 ledger（r4 P2-8）**：pin/淘汰判定读 proposals.jsonl，
  不信 store 内存态——重启后 store pending 为空 ≠ 无引用。pin 条件：
  run 非终态，或 ledger 存在 status ∈ {pending, applying} 的行。
  顺序不变式：LRU 扫描前先执行 C 的重启 expired 收敛（保证 pending 引用
  已被清理后再判淘汰）。活跃 run（collecting/kernel-running/
  awaiting-approval）恒 pin
- **损坏边界（r6 P2-9）**：run 目录缺失、run.json/proposals.jsonl 解析
  失败 → typed DISTILL_IO 记 daemon 日志 + 该 run **pin fail-closed**
  （不淘汰、不入 LRU 候选，等待人工 purge；绝不因读取失败而误判「无
  引用」）；LRU 淘汰动作对该 run 的队列串行（淘汰经全局启动扫描投递，
  per-run 队列确认无 pending 后执行删除）。损坏恢复负测进 tasks 1.3
- `DistillStatusOutput` strictObject：`counters` 为**全键 Record**
  （DistillItemStatus 枚举每个键必现，缺项 0 补齐；unknown 键拒绝）；
  `proposalRefs[].ordinal` int ≥0、`proposalId: string | null`、
  `status: DistillLedgerStatus`（O）；CLI --json / RPC / GUI store
  三面同源推导自该 schema

---

## r5 补遗（闭合 r4 评审：/tmp/maintain-design-review-r4.md）

> 本轮**直接改写** §2/§3/§4/§5 与 H/I/K/M/E 旧文（r4 P2-5 裁决：全文只剩
> 一套规范值）；以下 N-P 为新增语义。P2-9（tasks.md fmt 门禁）已实修
> （skill-wiki-maintainer 与 windows-test-debt 两份 tasks.md 均过
> `vp fmt --check`）。

### N. proposal store → per-run 队列接缝（r4 P2-3；r6 冻结完成语义）

现 McpProposalStore.approve/reject 直接调用 registry 执行
（src/daemon/mcp/proposals.ts:42-53,96-112）；本 change 冻结执行入口
归属与完成契约：

- `wiki.distill_apply` 的 approved 执行入口 = DistillJobService 注册的
  **enqueue 函数**：capability registry 中该 capability 的 handler 不是
  直接写盘，而是 `enqueue(runId, ordinal)` 投递到对应 run 的 per-run
  串行队列（J）并**等待该队列任务终态后才返回**——store 的
  `executed/failed` 投影因此保持真相（r6 P1-1：入队受理 ≠ executed；
  approve 调用会阻塞到 apply 完成，apply 是本地文件操作，有界）
- **完成映射（r6 P2-4/P2-8；r7-R 二分；r9-P1.3 补 IO 分支）**：queue
  任务成功完成（item 终态无论 applied/idempotent/stale/patch-failed——
  item 级结果由 ledger/counters 呈现）→ registry 返回 ok → proposal
  `executed`；queue 任务 typed 失败（run 已 cancelled/restarted →
  DISTILL_STALE、DISTILL_RUN_NOT_FOUND）→ proposal `failed`。
  **apply IO 失败（页写/rebuild 抛 DISTILL_IO，双预算——r17 与 H
  同步）**：页写失败走 attempts 预留表（最多 2 次重试、共 3 次写页
  尝试）；rebuild-only 失败走队列内独立上限（≤2 重试，不占 attempts）；
  任一耗尽 → ledger 行落终态 `io-failed`（写路径状态未知，
  人工检查后重跑 distill——不自动恢复）+ proposal `failed`
  （result.detail.code=DISTILL_IO）+ io-failed ∈
  TerminalDistillLedgerStatus（W），run 可继续收敛；重启扫描不复活
  io-failed 行。
  McpProposalStatus ↔ DistillLedgerStatus 映射（r10 补 io-failed）：
  proposal `pending` ↔ ledger `pending`；`approved` = 瞬态（决定 CAS
  后、队列终态前——占 slot、不可回收、不进 LRU 候选，见 T）；
  `executed` ↔ ledger item 终态族 {applied/idempotent/stale/
  patch-failed}；io-failed 项的 queue 任务以 typed failed（DISTILL_IO）
  返回 → proposal `failed` + ledger `io-failed` +
  counters["io-failed"]++；`rejected`（cause=human）↔
  ledger `rejected`；`rejected`（cause=cancelled）↔ ledger `expired`；
  `failed` ↔ ledger {expired（取消/重启竞争）, io-failed（IO 重试耗尽）}
- **reject seam（r6 P2-5；r7-R awaitable + cause）**：McpProposalStore
  增加可选构造注入 `onRejected?: (view: ProposalView, cause: "human" |
"cancelled") => Promise<void>`（现有 reject 只改内存 view，无 registry
  路径）；reject 调用 await 该回调。daemon 接线 =
  DistillJobService：cause=human 且 capability == wiki.distill_apply 时
  按 input {runId, ordinal} 投递队列把 ledger 行 → `rejected`；cause=
  cancelled 时**不投递**（cancel 队列任务自身已把 ledger 行 → expired，
  C 冻结——回调 no-op 直接 resolve）；非 distill capability 无监听者
  行为不变。ledger 迁移失败（IO）→ typed DISTILL_IO 上抛 reject 调用方；
  proposal 保持 rejected（人的决定不可逆）+ ledger 行保持 pending
  （fail-closed pin，M 损坏边界同款：daemon 日志 + 人工 purge）
- 路由 = proposal input {runId, ordinal}（D5 冻结）；store 不需要知道
  run/proposalId→runId 映射（capability 名即路由键）
- 其它 capability 的 approve→registry 直执行语义不变（不引入新抽象）
- 可串行化保证：approve-decision 与 queued-apply 之间到达的 cancel 进入
  同一队列 → 先 cancel 后 apply 时，apply 任务按 C 的二次状态校验拒绝
  （DISTILL_STALE 零写）；负测试 = approve 与 cancel 并发提交终态唯一
- tasks 1.3 门禁补该接缝用例（enqueue 路由 + cancel 竞争终态断言 +
  executed-仅在-队列-终态后投影 + onRejected ledger 行收敛）

### O. 单一 status/ledger 契约（r4 P2-6）

E 已改写为唯一规范 schema：`DistillStatusOutput` 无 phase 字段
（RunState 即阶段真相；旧 §4 的 phase 废除）、`reason` 仅终态非 null、
`counters` 全键 strictObject、`proposalRefs[].status` 携带 ledger 状态、
`DistillItemStatus`/`DistillLedgerStatus`/`DistillLedgerRecord` 三个
closed enum/strictObject 同文件冻结（model-invalid 无 ledger 行的包含
关系已注明）。spec.md 的宿主编排 requirement 引用该 schema 名（不复制
字段清单——单一信源）。

### P. promotedFrom 四 fixture 进 spec + tasks（r4 P2-7）

spec.md 增补 requirement「promotedFrom 信封 round-trip」：null / 单条 /
双条 / 坏值四个场景为外部契约（canonical JSON 数组、键排序无空白、坏值
读投影 null + merge typed WIKI_INVALID_PATTERN）；tasks 1.1 门禁补
「四 fixture 必过」，且 spec 场景在实现提交前同步（不允许实现先行、
spec 补挂）。

---

## r7 补遗（闭合 r6 评审：/tmp/maintain-design-review-r6.md）

### Q. proposal 决定 CAS（r6 P1-1）

approve / reject / cancel（service 侧主动 reject）**先在同一串行决定点
原子迁移** proposal 状态（store 内单一 decision queue：读 pending →
写唯一终态/瞬态，无 await 间隙）：

- 决定成功发放 decision token（终态写入者身份）；后续 registry 执行结果
  / onRejected 队列结果**只提交给该 token**——无 token 的迟到结果丢弃
  （daemon 日志），不得覆盖较早决定
- 重复 approve/reject（同 id 二次调用）→ 幂等返回既有决定现状，不重放
  执行、不覆盖
- 决定点之后 approve 才进入 N 的 enqueue→await 队列路径；cancel 队列任务
  到达时若 proposal 已 approved（瞬态）→ 该项按 C 的二次状态校验
  DISTILL_STALE 零写，proposal 终态 failed（N 映射）
- 负测试（tasks 1.3）：approve+reject 并发、approve+approve 并发——
  proposal/ledger/run 三面终态唯一且可串行化

### R. 用户取消 vs 人工拒绝的 ledger 终态二分（r6 P1-2；r8 胜者表）

两条原因两个终态（N 映射表已同步）：

```text
用户取消（wiki.distill.cancel / 重启扫描）：
  proposal = rejected(cause=cancelled)   ledger = expired
人工拒绝（proposal 面 Reject 按钮）：
  proposal = rejected(cause=human)       ledger = rejected
```

**决定点胜者表（r8 P1-2：approve/cancel/reject 竞争的唯一规则；R 的
二分仅适用于 pending 决定，Q 的 token 不可覆盖）**：

```text
决定点时 proposal == pending：
  human reject 胜 → proposal rejected(cause=human) + ledger rejected
                   + run 不变（其余项继续走自己的决定）
  cancel 胜       → proposal rejected(cause=cancelled) + ledger expired
                   + run cancelled（R 二分）
决定点时 proposal == approved（token 已发放）：
  cancel 只迁移 run → cancelled（proposal/ledger 不在决定点变动）；
    其后 apply 队列任务二次校验 DISTILL_STALE 零写 → proposal failed +
    ledger 行 → expired（与取消语义一致；N 的 failed ↔ expired 映射）
  迟到的 human reject → **统一抛 typed PROPOSAL_STALE**（error detail
    携带 current view 投影；r9-P1.2：结果联合唯一——不返回 view 也不静默；
    GUI/RPC 面把该错误呈现为「该提案已进入执行」）
  迟到的重复 approve → 幂等返回现状（Q）
  重复同 cause reject（终态已 rejected）→ 幂等返回 view，不抛错
```

onRejected 为 awaitable（Promise），失败补偿见 N（proposal 决定不可逆 +
ledger pending fail-closed）。负测试：cancel-awaiting、direct-reject、
reject 时 ledger 队列 IO 失败、**approved 后 cancel → failed+expired、
approved 后迟到 reject 不覆盖**（tasks 1.3）。

### S. RunState.completed 收敛式（r6 P1-3；r8 终态优先级）

**终态判定顺序（唯一，自上而下首个命中生效——空集与全 not-proposed 的
歧义由优先级消解）**：

```text
1. validProposalCount == 0（零合法提案：model-invalid-only 或零提案）
   → failed(reason=no-valid-proposals)
2. ledger 全部行 status == not-proposed（容量整批拒绝）
   → failed(reason=capacity)
2.5 ledger 非空且全部行 io-failed（IO 重试全耗尽，无一成功）
   → failed(reason=io)（r10-P2.2；mixed applied+io-failed → 走 3
   completed——部分成功是有效收敛，io-failed 计数在 counters 呈现，
   失败项人工重跑 distill）
3. ledgerRows.length > 0 且全部 ∈ 终态 → completed
   （迁移由「末项终态写入」的队列任务执行——每项决定/执行完成的任务
   检查全终态，最后一项负责迁移；无需定时器）
```

- mixed（model-invalid + 合法提案）走 3 的正常路径（invalid 项无 ledger
  行，不参与判定）
- 终态幂等行为：completed/cancelled/failed 上 approve → typed
  DISTILL_STALE；cancel → 幂等返回既有终态（不报错）；status → 终态
  恒可轮询；同 source 活跃 run 解锁 = run 进入任一终态（之后 start 允许）
- 负测试（tasks 1.3）：末项 terminal 触发 completed；completed 后同
  source 二次 start 允许；零 proposal → failed(no-valid-proposals)；
  全 not-proposed → failed(capacity)；mixed → completed

### T. admission API 统一 + terminal 闭合集（r6 P2-2/P2-4）

- 全文唯一 primitive = `admitBatch(items)`（§5 已改写；create = admitBatch
  长度 1；参数 `{capability, input}[]`、返回 `{created: ProposalView[];
refused: number}`；单一临界区锁；旧 `createBatch` 名只存在于 B 墓碑，
  非实现接口）
- `MAX_PROPOSALS = 64`（冻结现 CAPACITY 常量值，导出常量化）
- **terminal 闭合集 = {executed, rejected, failed}**（可回收、参与
  admissionCapacity 与淘汰排序）；`approved` = 瞬态（决定 CAS 后、队列
  终态前）——占 slot、**不可回收**、不进 LRU 候选；`pending` 永不回收

### U. DISTILL 错误码接入闭合集合（r6 P2-3；r8 共享 schema 具体化）

- `src/shared/contracts/errors.ts` 的 RpcErrorCodeSchema 扩入六码
  （r10 终版），RpcErrorDefinitions 同步冻结传输状态：
  `DISTILL_RUN_NOT_FOUND: 404`、`DISTILL_STALE: 409`、
  `PROPOSAL_STALE: 409`（late reject 专用，R）、
  `DISTILL_ACTIVE_RUN: 409`、`DISTILL_LIMIT: 422`、`DISTILL_IO: 503`
  （message 文案实现轮随表登记；RPC 面可穿越）
- **kernel-local 边界（r10-P2.3）**：`DISTILL_TIMEOUT` /
  `DISTILL_CANCELLED`（W 的 ephemeral prompt typed 结果）仅 daemon
  内部（ephemeral 面 + daemon 日志 + run reason=timeout 投影），不进
  RPC/MCP 闭集；`WIKI_INVALID_PATTERN`（absorb 畸形目标）仅 daemon
  日志，item 结果 = stale(detail=invalid-target)
- capability 面：`CapabilityCallResult` 闭合码保持不动；shared contracts
  冻结 **`CapabilityFailureDetail` strictObject**（r8 P2-1）：
  `{ code: DistillErrorCode（**闭合 Zod enum**：DISTILL_IO/DISTILL_
LIMIT/DISTILL_RUN_NOT_FOUND/DISTILL_STALE/DISTILL_ACTIVE_RUN/
PROPOSAL_STALE/WIKI_PATCH_FAILED，r10——未知串拒绝）, message:
string, currentView?: ProposalView（仅 PROPOSAL_STALE 携带，R 的
late reject detail）, runId?: string, ordinal?: int ≥0 }`——
  `failed.detail` 携带该形状（TS + Zod 双冻结）；MCP text envelope =
  `{ detail }` 包一层、proposal result 与 RPC error 以同一 schema
  解析；reject 调用联合 = 成功路径 view / 失败路径 typed throw
  （late reject → PROPOSAL_STALE + currentView；ledger IO 失败 →
  DISTILL_IO）——不再有「返回 view 且报错」的歧义形状
- **exact shared schemas（r11-P1.3：设计即冻结实现形状，无「实现轮
  补」）**——`src/shared/contracts/wiki-distill.ts` 与 contracts 改动的
  唯一权威定义：

```ts
export const DistillErrorCodeSchema = z.enum([
  "DISTILL_IO",
  "DISTILL_LIMIT",
  "DISTILL_RUN_NOT_FOUND",
  "DISTILL_STALE",
  "DISTILL_ACTIVE_RUN",
  "PROPOSAL_STALE",
  "WIKI_PATCH_FAILED",
]);
// currentView 携带非递归快照（r12：避免 view↔detail 循环引用——
// 不含 result/failureDetail，仅决定时刻核心投影）
export const McpProposalStatusSchema = z.enum([
  "pending",
  "approved",
  "rejected",
  "executed",
  "failed",
]);
export const ProposalDecisionSnapshotSchema = z.strictObject({
  proposalId: z.string(),
  capability: z.string(),
  input: z.unknown(),
  status: McpProposalStatusSchema,
  rejectedCause: z.enum(["human", "cancelled"]).optional(),
  decidedAt: z.string().optional(),
}); // 从 view 核心字段派生的非递归快照（currentView 载荷）
export const CapabilityFailureDetailSchema = z.discriminatedUnion("code", [
  z.strictObject({
    code: z.literal("PROPOSAL_STALE"),
    message: z.string(),
    currentView: ProposalDecisionSnapshotSchema,
    runId: z.string().optional(),
    ordinal: z.number().int().nonnegative().optional(),
  }),
  z.strictObject({
    code: DistillErrorCodeSchema.exclude(["PROPOSAL_STALE"]),
    message: z.string(),
    runId: z.string().optional(),
    ordinal: z.number().int().nonnegative().optional(),
  }),
]); // currentView 条件由 discriminatedUnion 强制（非注释约束）
// r13-P1.1：完整 proposal view 判别联合——failed 分支 schema 级强制
// failureDetail，其余分支禁带；rejected 分支携带 cause。
// r14-P2.1：声明顺序 = 依赖拓扑序（snapshot/detail 先于 view，原样
// 可编译无 TDZ）。
export const McpProposalViewSchema = z.discriminatedUnion("status", [
  z.strictObject({
    proposalId: z.string(),
    capability: z.string(),
    input: z.unknown(),
    status: z.literal("pending"),
    createdAt: z.string(),
  }),
  z.strictObject({
    proposalId: z.string(),
    capability: z.string(),
    input: z.unknown(),
    status: z.literal("approved"),
    createdAt: z.string(),
    decidedAt: z.string(),
  }),
  z.strictObject({
    proposalId: z.string(),
    capability: z.string(),
    input: z.unknown(),
    status: z.literal("rejected"),
    createdAt: z.string(),
    decidedAt: z.string(),
    rejectedCause: z.enum(["human", "cancelled"]),
  }),
  z.strictObject({
    proposalId: z.string(),
    capability: z.string(),
    input: z.unknown(),
    status: z.literal("executed"),
    createdAt: z.string(),
    decidedAt: z.string(),
    result: CapabilityCallResultSchema,
  }),
  z.strictObject({
    proposalId: z.string(),
    capability: z.string(),
    input: z.unknown(),
    status: z.literal("failed"),
    createdAt: z.string(),
    decidedAt: z.string(),
    result: CapabilityCallResultSchema, // 既有字段保留
    failureDetail: CapabilityFailureDetailSchema,
  }), // failed 必带（强制）
]);
// proposal view 扩展（contracts/agent.ts）：既有 result?: CapabilityCall
// Result 在 executed/failed 分支保留（不改既有消费者）；failureDetail
// 由 failed 分支强制、rejectedCause 由 rejected 分支强制（上方判别联合
// 即唯一 wire 形状——r13，无注释级约束）
// reject 传输联合（store/RPC 同形）：
//   成功 → { view: McpProposalViewSchema }
//   late reject → typed throw PROPOSAL_STALE（oRPC error data =
//     CapabilityFailureDetailSchema，currentView = 快照）
//   ledger IO 失败 → typed throw DISTILL_IO
// CapabilityCallResult.failed 增补 detail?: CapabilityFailureDetailSchema
// RpcErrorCodeSchema 增六码（前列传输状态映射表）
```

- 三面同码可验证投影：capability result `failed.detail` ↔ MCP tool
  result text JSON 的 `detail` 字段（envelope = strictObject
  `{ detail: CapabilityFailureDetailSchema }`）↔ proposal view 的
  `result` ↔ RPC error `code`。tasks 1.4 四面（capability/MCP/
  proposal/RPC）负测以同一 Zod schema 解析断言（不是字符串包含）
- WIKI_PATCH_FAILED 透传既有 wiki 域码，不重复登记
- **cause 公开化（r8 P2-2）**：`McpProposalView` 与 shared 投影扩
  `rejectedCause?: "human" | "cancelled"`（audit 行 detail 同步）；
  store `reject(proposalId, cause?) → Promise<{view} | null>`
  （默认 human；await onRejected）；rpc-router 的 reject handler 变
  await 语义——契约清单与 tasks 1.3/1.4 同步

### V. create 项 ledger record 判别联合（r6 P2-1；r8 矩阵入 H）

E 已改写：absorb 带 beforeHash/afterHash；create 带 targetPatternName +
afterHash（无目标旧页不做 absent 哨铃；`afterHash === contentHash`
字节级冻结——r11 与 E/H 同一口径，本节历史描述作废）。create
恢复矩阵由 H（r8 kind 分支版）唯一持有；崩溃重放 fixture 补 create 分支
（tasks 1.2 + spec scenario 已列）。

---

## r9 补遗（闭合 r8 评审：/tmp/maintain-design-review-r8.md）

### W. 终态谓词集合 + Corpus 输入冻结 + ephemeral 异步契约（r8 P2-2/3/4）

**TerminalDistillLedgerStatus（共享契约导出，E 同步）**：

```text
TerminalDistillLedgerStatus = { applied, idempotent, stale, patch-failed,
  expired, rejected, not-proposed, io-failed }   // 闭合集，含 not-proposed
非终态 = { pending, applying }
S 的判定量冻结：ledgerRows = proposals.jsonl 全行（= plan item 总数）；
  「零合法提案」判据 = ledgerRows.length === 0（model-invalid 不产行）；
  mixed（部分 not-proposed + 部分其它终态）→ 走 completed 路径（全终态即真）
```

**Corpus 输入冻结（r8 P2-3；可复现性契约）**：

```ts
SimilarClusterSchema = strictObject({
  members: ReadonlyArray<PatternName>   // 1..50；成员 name 升序（组内
                                        // canonical 排序，去重）
  score: number,                        // 聚类代表分
})                                      // 数组序（r14-P2.3 完整键）：
                                        // score 降序 → members 全向量
                                        // 字典序升序（并列 cluster 唯一
                                        // 可序；成员已组内排序去重 →
                                        // 向量字典序无并列）
DistillCorpus = strictObject({
  clusters: ReadonlyArray<SimilarCluster>,
  candidates: ReadonlyArray<strictObject({
    name: PatternName; title: string; body: string;   // top-K 全文（模型可见
    contentHash: string; sourceScope: string;         // 语料边界 = 全文，非摘要
    score: number,                                    // 检索得分（排序键）
  })>,                                               // K = 5，稳定排序：
                                                    // score 降序 → name 升序
  retrieval: strictObject({ query: string; limit: 5 }),  // 相似检索参数
  evidenceThreshold: number,                        // 版本化常量
                                                    // DISTILL_EVIDENCE_THRESHOLD
                                                    // （v1 = 0.30，作用域 =
                                                    // @jixoai/search 冻结 BM25
                                                    // 打分的原始 score——r11：
                                                    // 仓库无归一化函数，不虚构；
                                                    // 阈值随 TOKENIZER/打分版本
                                                    // 联动重校准并 bump 版本）；
                                                    // 候选自身 score < 阈值 →
                                                    // 证据不足，禁对其 absorb
  budgets: 消耗快照,
  scoreVersion: string,        // 格式冻结：`${TOKENIZER_VERSION}/
                               // bm25-frozen`（@jixoai/search 导出的
                               // TOKENIZER_VERSION 常量拼接；digest 输入
                               // 含此字段——打分语义变更必致 digest 变）
  corpusDigest: string,        // r12：digest 输入 = 全 DistillCorpus 对象
                               // （clusters 按 score 降序→members 全
                               // 向量字典序升序——与 SimilarCluster
                               // 排序键同一规则；candidates 按 name 升序；
                               // retrieval/evidenceThreshold/budgets/
                               // scoreVersion 全纳入；排除 corpusDigest
                               // 自身）的 canonical JSON（递归字典序键、
                               // 无空白）sha256；写入 run.json（同语料
                               // 跨重启候选序/聚类序/参数/版本一致）
})
```

**slugify 共享契约（r11-P2.3；r12 冻结 = 现实现行为快照 v1）**：SDK
导出 `slugifyPatternTitle(title) → string`（**raw 变换**——可为空串，
PatternNameSchema 首字符 [a-z0-9] 不收空串，故返回类型不冒充收窄值；
plan 收窄阶段：raw 非空且过 PatternNameSchema 才得 PatternName，
exact-name 写只接收收窄值；现 workspace.ts 私有
slugify 提升为导出；**v1 行为 = 现实现逐字节快照**：小写化 + 连续
[a-z0-9] 之外字符折叠为分隔符 + 首尾分隔符剥离 + 截断至 PatternName
上限——非 ASCII（含汉字）被删除折叠，**不引入 transliteration/NFKC**
（r12 裁决：不虚构未实现的折叠算法）；空 title 由 Zod title(1..120)
拒绝）。**空结果的调用方策略二分（r13-P2.1 闭合同源冲突）**：导出的
`slugifyPatternTitle` 为**raw 变换**（空结果原样返回空串，不内建
fallback）——appendPattern 以 `slugifyPatternTitle(title) || "pattern"`
保留既有回退行为（调用方策略，行为不变）；蒸馏 plan 用 raw 结果，
空 → model-invalid(empty-slug)。同源 = 变换函数唯一；空串策略归属
调用方。apply 的 create 写路径 = exact-name 原语（占用检查 + 原子写），
不复用 appendPattern 的 -N 分支。fixture：纯汉字标题 → 蒸馏 empty-slug
且 append 落 pattern（双路断言）/非 ASCII 混合/截断/同名冲突。

**同 run target 冲突（r8-P2.4，r10 裁决：plan 期拒绝，不做审批序胜者）**：
planDistillation 检测同 run 内多 create 的 targetPatternName 相同、或
create 目标与某 absorb targetPatternId 相同 → 后 ordinal 项判
model-invalid（诊断 target-collision，确定性：ordinal 升序先到先得）；
冲突项不产 plan item、不进 proposal。负测：两 create 同 slug → 仅先项
成案，后项 model-invalid(target-collision)。

**EphemeralSession 异步契约（r8 P2-4；K 同步修正）**：

```ts
createEphemeralSession(options): Promise<EphemeralSession>
  // 内含 MCP tool bridge ready 等待；bridge 未就绪/注册名校验失败 →
  // 创建即 typed 失败（fail-closed，绝不半可用 session）
interface EphemeralSession {
  prompt(input: string, opts?: { signal?: AbortSignal;
    deadlineMs?: number }): Promise<{ text: string }>;
    // 超时/取消 → typed DISTILL_TIMEOUT / DISTILL_CANCELLED 结果上抛
  listTools(): readonly string[];
  dispose(opts?: { deadlineMs?: number }): Promise<void>;
    // 有界强制释放（超时后内核侧 session 销毁）；重复调用幂等
}
```

tasks 1.3a 补负测：bridge 未 ready 创建即拒 / prompt 超时 typed /
dispose 超时强制释放；tasks 1.1 补 Corpus fixture（同语料两次构建候选
序与 digest 一致）。
