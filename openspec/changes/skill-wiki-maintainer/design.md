# Design: skill-wiki-maintainer（切片③ LLM 认知蒸馏）r2

> r2（2026-09-25）：按设计评审 r1（/tmp/maintain-design-review.md，5.0/10
> DESIGN-NEEDS-WORK）逐条闭合 P1-1..P1-6 与 P2-1..P2-6；章节编号对齐评审。

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
  | { action:"create"; title(1..200); body(1..20_000);
      sourcePatternIds: string[] }
  | { action:"absorb"; targetPatternId: PatternName;
      edits: WikiEdit[](1..10);
      expectedBeforeBodyHash: sha256-hex;   // planDistillation 回填并校验
      sourcePatternIds: string[] }

DistillPlanItem = proposal + ordinal + digest + { afterBodyHash? }
ItemResult = { ordinal; status: applied|idempotent|stale|patch-failed|
               model-invalid|rejected; detail?; appliedHash? }
RunState = collecting|kernel-running|awaiting-approval|completed|
           failed|cancelled   // failed 带 reason: no-valid-proposals|
                              io|timeout|cancelled|kernel-unavailable
错误码族（daemon DomainError）：DISTILL_IO / DISTILL_LIMIT /
DISTILL_RUN_NOT_FOUND / DISTILL_STALE / WIKI_PATCH_FAILED（透传）
```

## 3. 幂等与并发（P1-2）

applyDistillation 的 absorb 判定（在 expectedBeforeBodyHash 之上）：

- 当前 body hash == afterHash 且 ledger 已记 → `idempotent`（零写）
- 当前 body hash == beforeHash → 执行（edits 作用于钉死的 body；
  任一锚点未中 → 该项 `patch-failed`，零写）
- 其余 → `stale`（人工编辑/竞争），零写；补偿 = 基于当前页重新生成提案
  （v1 = 重跑 distill 或人工编辑，不做隐式重基）

create 项幂等 = contentHash 去重（既有 appendPattern 语义）+ 命中时
`mergePromotedFromEntry` 回填足迹（P1-1 的新 SDK 操作，原子写）。
同 run 多项指向同一 target：每项独立钉原 beforeHash；后批必然 stale
（文档化；不隐式链式重基）。ledger（§5）是「已应用」的唯一判据。

## 4. Job 生命周期（P1-4 / P2-5）

DistillJobService（daemon 内，独立于 agentSessions/转录存储）：

- `wiki.distill.start { source: WorkspaceId } → { runId }`：同 source 同时
  至多 1 个活跃 run（重复 start → typed DISTILL_LIMIT）；corpus 落盘成功
  后才进 kernel
- `wiki.distill.status { runId } → { state, phase, items: ItemResult 计数,
proposalRefs[] }`；`wiki.distill.cancel { runId }`（kernel-running →
  dispose agent，run → cancelled）
- kernel 调用有界：默认 120s 超时；daemon stop → dispose + run 标记
  interrupted→failed(reason=io? no: cancelled-by-shutdown → failed/
  reason=kernel-unavailable)，重启后不自动续跑（corpus 快照在，人工重跑）
- distiller 会话**不进**面板列表与持久转录（一次性 ctx；原始输出只落
  run 目录）；工具面 allowlist = wiki.list/wiki.read/wiki.scopes（readonly）
  ——机制复用 agent-roles 的 toolFilter；deny 一切 propose/apply。
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

proposal 容量纪律：生成前预检——有效提案数 ≤ min(32, McpProposalStore
剩余容量 - pending 数)；超出 → typed DISTILL_LIMIT（提示 --limit），
**绝不**让 store 静默淘汰 pending。proposal 创建走 daemon 内
`mcpProposals.create(wiki.distill_apply, { runId, ordinal })`（输入不含
提案体——handler 从 registry 反查 digest 校验；伪造 runId/ordinal →
DISTILL_RUN_NOT_FOUND）。MCP 面自然出现 `wiki_distill_apply_propose`
（approved-mutation 自动投影，r1 指出的矛盾按此裁决：**暴露**，安全由
handler 的 registry 校验承担）。

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

### E. 共享契约冻结（r2 item-11/P2-5 FAIL）

新增 `src/shared/contracts/wiki-distill.ts`（RPC/CLI --json/GUI store 同源）：

```ts
DistillStartInput  = { source: WorkspaceId }          // 同 source 活跃 run ≤1
DistillStartOutput = { runId }
DistillStatusOutput = { runId; state: RunState; reason?: DistillFailReason;
  counters: Record<ItemResultStatus, number>;
  proposalRefs: Array<{ ordinal; proposalId: string | null }> }
DistillCancelOutput = { runId; state: "cancelled" }
DistillFailReason = no-valid-proposals | io | timeout | kernel-unavailable
                  | restarted | cancelled-by-shutdown
RunState = collecting | kernel-running | awaiting-approval | completed
         | failed | cancelled          // 终态幂等可轮询
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

### H. 恢复矩阵纳入 index + SDK/宿主边界（r3 D2/P1-2）

- 恢复分支 `ledger=applying|applied 且 当前==afterHash`：**必须先 rebuild
  index（派生物幂等重建）再补写 commit**；rebuild 失败 → typed DISTILL_IO，
  项保持 applying（仍可恢复）。任何 commit 之前 index 必为已重建状态。
- 旧 §2 的 `afterBodyHash` 可选标记作废：**必填**（本补遗显式覆盖旧文）。
- SDK/宿主边界冻结：`applyDistillation(globalWikiDir, item, provenance,
hooks?)`——hooks = `{ onIntent(record), onCommit(record) }`（可选）。
  SDK 驱动顺序契约：onIntent → 页原子写 → index rebuild → onCommit；
  ledger 的存储实现属宿主（DistillJobService），SDK 只承诺顺序与幂等，
  不落 ledger、不知道 run/MCP。无 hooks 调用 = 纯 SDK 写语义不变。

### I. 容量 slot 单一模型（r3 P1-3）

容量以 store 全集计（含 terminal 历史，对齐 Map.size 事实）：

- `admissionCapacity() = MAX_PROPOSALS - size()`
- create/createBatch 需要容量时**先释放 terminal**（最旧优先淘汰已决
  条目）；仅剩 pending 不足以容纳 → typed PROPOSAL_LIMIT（pending 永不
  淘汰——全局废除静默淘汰的完成态表述）
- 蒸馏批量上限 = min(32, admissionCapacity())；普通单条 create 同一模型
- 负测试：pending 满载 create → PROPOSAL_LIMIT 且 store 逐字节不变

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
  /** 传入完整 scoped 注册名：mcp__skill-creator__wiki_list /
   *  wiki_read / wiki_scopes（r3 指正：非裸 capability 名）。 */
  toolAllowlist: readonly string[];
}): EphemeralSession
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

### M. LRU pin 与 status 契约严格化（r3 新 P2-9/10）

- LRU 淘汰仅限 terminal 且无 pending proposal 引用的 run；活跃 run
  （collecting/kernel-running/awaiting-approval）恒 pin
- `DistillStatusOutput` strictObject：`counters` 为**全键 Record**
  （ItemResultStatus 枚举每个键必现，缺项 0 补齐；unknown 键拒绝）；
  `proposalRefs[].ordinal` int ≥0、`proposalId: string | null`；CLI
  --json / RPC / GUI store 三面同源推导自该 schema
