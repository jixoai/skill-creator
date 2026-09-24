# Design: skill-wiki-maintainer（切片③ LLM 认知蒸馏）r2

> r2（2026-09-25）：按设计评审 r1（/tmp/maintain-design-review.md，5.0/10
> DESIGN-NEEDS-WORK）逐条闭合 P1-1..P1-6 与 P2-1..P2-6；章节编号对齐评审。
> r5（2026-09-25）：按 r4 评审（/tmp/maintain-design-review-r4.md，7.0/10）
> **直接改写** §2/§4/§5 与 H/I/K/M 旧文（r4 P2-5 裁决：全文只剩一套规范
> 值，不再以补丁覆盖补丁），并新增 r5 补遗 N-P。

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
ItemResult = { ordinal; status: DistillItemStatus; detail?; appliedHash? }
DistillItemStatus = applied|idempotent|stale|patch-failed|model-invalid|
                    rejected|expired|not-proposed   // counters 全键（O）
RunState = collecting|kernel-running|awaiting-approval|completed|
           failed|cancelled   // 无独立 phase 字段——RunState 即阶段真相（O）
DistillFailReason = no-valid-proposals|io|timeout|kernel-unavailable|
                    restarted|cancelled-by-shutdown
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
  重跑）；重启扫描见 B（awaiting-approval → cancelled(restarted)）
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

proposal 容量纪律（I/O 冻结的 admission 事务，废除「生成前预检」旧文）：
proposal 创建走 daemon 内 `mcpProposals.createBatch(wiki.distill_apply × N)`
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

### A. 崩溃提交协议（r2 P1-2/D2 FAIL）

applyDistillation 单项序列（ledger-先行 + 幂等恢复；ledger 由
DistillJobService 的 per-run 串行队列驱动——同 run 的 apply 永不并发，
无需 CAS）：

```text
1. ledger intent：{ordinal, status:"applying", beforeHash, afterHash}
   （proposals.jsonl 整文件原子重写；此步之后任何时刻崩溃都可恢复）
2. 页面原子写（temp+rename；SDK 既有纪律）
3. index rebuild（派生物）
4. ledger commit：{status:"applied", appliedHash}
恢复/重放判定（applyDistillation 入口统一执行）：
  ledger 该项 ∈ {applying, applied} 且 当前 bodyHash == afterHash
    → idempotent（补写 commit 即返回）
  ledger 该项 ∈ {applying, applied} 且 当前 == beforeHash
    → 重新执行（写入幂等）
  ledger 无记录（首放）：== beforeHash → 执行；== afterHash →
    idempotent（前次崩溃于 step1 之前；step1 之后的崩溃必有记录——
    「写前必 intent」是不变式）；其余 → stale 零写
```

`afterBodyHash` 由 planDistillation 必填（create 与 absorb 都是）；选项
取消。editPattern 不改签名——applyDistillation 自读目标页做哈希判定，
在钉死 body 上应用 edits 后走既有原子写原语。

### B. 容量原子预约（r2 P1-3 FAIL）

McpProposalStore 扩展（本 change 一并实现）：

- `pendingCapacity(): number`（剩余可创建数 = MAX - pending 数）
- `createBatch(items: {capability, input}[]): {created: ProposalView[];
refused: number}` —— 单次原子 admission：容量不足则整批拒绝
  （refused>0 时 created=[]，不部分创建、不淘汰任何既有项）
- 蒸馏路径：proposal 生成走 createBatch 一次预约（有效项 ≤ min(32,
  pendingCapacity())；不足 → typed DISTILL_LIMIT + ledger 记
  not-proposed），**消除预检-创建竞态**；其它 capability 的单条 create
  语义不变（容量满 → typed PROPOSAL_LIMIT，替代静默淘汰——容量纪律
  全局收紧，含负测试）
- daemon 重启丢 pending（store 内存态）：DistillJobService 启动扫描
  awaiting-approval 的 run → ledger 未决项标 expired、run →
  cancelled(reason=restarted)；approve 已失效引用 → DISTILL_RUN_NOT_FOUND

### C. 取消失效语义（r2 新 P1-1）

`wiki.distill.cancel` 在 awaiting-approval 亦可用且必须闭合：

- run → cancelled（原子）；ledger 全部 pending 项 → expired
- 对应 store 内未决 proposal 由 service 主动 reject（proposal 面 可见
  rejected）；已执行项保留结果
- approve handler 二次校验：run 状态非 awaiting-approval/completed →
  typed DISTILL_STALE 零写（取消/重启后不可再执行）
- 重启路径见 B（expired + cancelled(restarted)）

### D. Kernel 只读面（r2 P1-4/D4 FAIL——机制落地，不再「复用」措辞）

本 change 扩展 `DshKernelHandle`：`createEphemeralSession(options:
{ systemPrompt: string; toolAllowlist: readonly string[] }) →
EphemeralSession`：

- 工具面 = deny-all 基线 + allowlist 白名单（inverse of 现产品 deny-list
  机制；allowlist 仅含 wiki_list/wiki_read/wiki_scopes 三个 MCP 注册名 +
  模型调用本身）；propose/apply 全部不可见——负测试钉死
  （EphemeralSession 工具枚举不含 mcp__skill-creator__*_propose）
- EphemeralSession：不注册 agentSessions 列表/转录（一次性 ctx，接口层
  冻结「无持久化」），dispose 有界（stop/timeout/cancel 全路径）；
  dsh-kernel 单测覆盖（创建/allowlist 过滤/dispose 无泄漏）
- tasks 1.3 拆出 1.3a：kernel ephemeral 面 + 测试先行

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
DistillFailReason = no-valid-proposals | io | timeout | kernel-unavailable
                  | restarted | cancelled-by-shutdown
RunState = collecting | kernel-running | awaiting-approval | completed
         | failed | cancelled          // 终态幂等可轮询
DistillItemStatus = applied | idempotent | stale | patch-failed
                  | model-invalid | rejected | expired | not-proposed
DistillLedgerStatus = pending | applying | applied | idempotent | stale
                    | patch-failed | expired | rejected | not-proposed
                    // model-invalid 无 ledger 行（plan 期诊断，不产 plan
                    // item），故 LedgerStatus ⊂ ItemStatus
DistillLedgerRecord = strictObject({ ordinal; status:
  DistillLedgerStatus; beforeHash; afterHash; appliedHash? })  // H 输入
错误码（contracts 错误表）：DISTILL_IO / DISTILL_LIMIT /
DISTILL_RUN_NOT_FOUND / DISTILL_STALE / DISTILL_ACTIVE_RUN
```

### F. 字段级 Zod（r2 P2-1）与审计一致性（P2-3）

- title 上限对齐既有 frontmatter/RPC 契约：1..120（不是 200）；
  body 1..20_000；sourcePatternIds 1..50（元素 PatternName）；
  edits 1..10（WikiEdit）；Corpus 契约 {clusters: SimilarCluster[],
  candidates: Array<{name, body, contentHash}>（top-K=5 全文）,
  budgets: 消耗快照}
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

### H. 崩溃提交协议（r3 D2/P1-2；r4 P1-1 改写：index 恢复 + ledger 读取 + 人工回退）

applyDistillation 单项序列（ledger-先行 + 幂等恢复；ledger 由
DistillJobService 的 per-run 串行队列驱动——同 run 的 apply 永不并发，
无需 CAS）：

```text
1. ledger intent：{ordinal, status:"applying", beforeHash, afterHash}
   （proposals.jsonl 整文件原子重写；此步之后任何时刻崩溃都可恢复）
2. 页面原子写（temp+rename；SDK 既有纪律）
3. index rebuild（派生物）
4. ledger commit：{status:"applied", appliedHash}
```

- 任何 commit 之前 index 必为已重建状态：恢复分支
  `applying|applied 且 当前==afterHash` **必须先 rebuild index 再补写
  commit**；rebuild 失败 → typed DISTILL_IO，项保持 applying（仍可恢复）。
- `afterBodyHash` 必填（create 与 absorb 都是；§2 已改写，无旧可选态）。
- SDK/宿主边界：`applyDistillation(globalWikiDir, item, provenance,
options?)`——`options.hooks = { onIntent(record), onCommit(record) }`
  （可选）。SDK 驱动顺序契约：onIntent → 页原子写 → index rebuild →
  onCommit；ledger 的存储实现属宿主（DistillJobService），SDK 只承诺顺序
  与幂等，不落 ledger、不知道 run/MCP。无 options 调用 = 纯 SDK 写语义
  不变。
- **ledger 读取语义（r4 P1-1）**：宿主读 proposals.jsonl 该 ordinal 的
  最近行，作为 typed 输入 `options.ledgerRecord?: DistillLedgerRecord`
  （strictObject：ordinal/status/beforeHash/afterHash/appliedHash?）
  传入；整文件原子重写保证行只有旧/新两态，无半行。SDK 不读 ledger 存储
  （§7 边界不变）。

**恢复矩阵（入口统一执行；区分人工回退，r4 P1-1 裁决）**：

```text
ledgerRecord 无（首放）：==beforeHash → 执行；==afterHash → rebuild
  index + 补 commit（前次崩溃于 step1 前；step1 后崩溃必有记录——
  「写前必 intent」不变式）；其余 → stale 零写
status == "pending"    → 不执行（审批未决；approve 才驱动 apply）
status == "applying"（intent 后、commit 前崩溃）：
  ==afterHash  → rebuild index → 补 commit（idempotent）
  ==beforeHash → 重新执行（崩溃于页面写前；写入幂等）
  其余         → stale 零写（执行窗口内人工改页），行落终态 stale
status == "applied"（已 commit）：
  ==afterHash  → no-op idempotent（applied 蕴含 index 已重建）
  ==beforeHash → 人工回退检测：零写，报告 stale（detail=manual-
                 rollback），ledger 保持 applied——**绝不重放**（不覆盖
                 人工回退）；需再泛化 → 人工重跑产新提案
  其余         → stale 零写（人工编辑/竞争）
status ∈ 终态（stale/patch-failed/expired/rejected/not-proposed/
  idempotent）→ 报告原终态，零写（幂等重放不复活）
```

负测试：`applied` + 人工恢复 before 内容 → 重放必须零写 + stale
（manual-rollback）。

### I. 容量 slot 单一模型 + admission 全事务（r3 P1-3；r4 P1-2 改写）

容量以 store 全集计（含 terminal 历史，对齐 Map.size 事实）：

- `admissionCapacity() = MAX_PROPOSALS - size()`
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
    typed PROPOSAL_IO，不部分落盘
```

- pending 永不淘汰（全局废除静默淘汰的完成态表述）；蒸馏批量上限 =
  min(32, admissionCapacity())；普通单条 create 同一模型
- 负测试：pending 满载 create → PROPOSAL_LIMIT 且 store 逐字节不变；
  「terminal 不足整批」→ 拒绝后 terminal 全部仍在（字节级断言）

### J. cancel/approve 同队列串行（r3 P1-4/C）

run 的一切状态迁移（apply 执行、approve/reject 决定、cancel、重启
expired 扫描、LRU 淘汰判定）**全部经 DistillJobService 的同一 per-run
串行队列**（与 H 的 hooks 写同队列）——取消与审批执行不可能交错写入；
队列化负测试：cancel 与 approve 并发提交 → 结果可串行化（终态唯一）。

### K. EphemeralSession 完整接口（r3 P1-4/D）

```ts
// dsh-kernel 扩展（tasks 1.3a 实现 + 单测）
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

### L. promotedFrom 精确信封（r3 新 P2-8）

存储值恒为 **JSON 数组**（单条也是 `[{...}]`）；entry strictObject
（unknown 键拒绝）；解析失败（历史/手改坏值）→ 读投影 null、merge
typed WIKI_INVALID_PATTERN（提示人工修复，不覆盖）；同 run 重放 =
union sourcePatternIds 后**按 runId 升序**重排序落盘。spec 增加
null/单条/双条/坏值四个 round-trip fixture 场景。

### M. LRU pin 与 status 契约严格化（r3 新 P2-9/10；r4 P2-8 补真相源）

- **引用真相 = 持久 ledger（r4 P2-8）**：pin/淘汰判定读 proposals.jsonl，
  不信 store 内存态——重启后 store pending 为空 ≠ 无引用。pin 条件：
  run 非终态，或 ledger 存在 status ∈ {pending, applying} 的行。
  顺序不变式：LRU 扫描前先执行 B 的重启 expired 收敛（保证 pending 引用
  已被清理后再判淘汰）。活跃 run（collecting/kernel-running/
  awaiting-approval）恒 pin
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

### N. proposal store → per-run 队列接缝（r4 P2-3）

现 McpProposalStore.approve/reject 直接调用 registry 执行
（src/daemon/mcp/proposals.ts:42-53,96-112）；本 change 冻结执行入口归属：

- `wiki.distill_apply` 的 approved 执行入口 = DistillJobService 注册的
  **enqueue 函数**：capability registry 中该 capability 的 handler 不是
  直接写盘，而是 `enqueue(runId, ordinal)` 投递到对应 run 的 per-run
  串行队列（J）。store 的 approve 状态迁移 → registry 执行 → enqueue
  返回（apply 异步发生于队列）；reject 同理投递 `markRejected(ordinal)`
- 路由 = proposal input {runId, ordinal}（D5 冻结）；store 不需要知道
  run/proposalId→runId 映射（capability 名即路由键）
- 其它 capability 的 approve→registry 直执行语义不变（不引入新抽象）
- 可串行化保证：approve-decision 与 queued-apply 之间到达的 cancel 进入
  同一队列 → 先 cancel 后 apply 时，apply 任务按 C 的二次状态校验拒绝
  （DISTILL_STALE 零写）；负测试 = approve 与 cancel 并发提交终态唯一
- tasks 1.3 门禁补该接缝用例（enqueue 路由 + cancel 竞争终态断言）

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
