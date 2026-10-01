# Design: evaluation-corpus（契约体 = 工作计划 r3 §B + r4 补遗 B′）

## B′ wire 级补遗（r4；冲突处以本节为准；r4-codex 勘误已并入）

- **B′1 result schema 级收紧（Zod 判别联合 + 互斥 refine）**：
  `outcome=error` → `failure.code ∈ {RUNNER_ERROR, ASSERTION_ERROR}`（执行族）；
  `outcome=unavailable` → `failure.code ∈ {MODEL_UNAVAILABLE, DSH_UNAVAILABLE,
PROVIDER_ROUTE_MISSING}`（依赖族）；`passed | failed | stale` → `failure`
  缺席。**互斥**：error 不携带依赖族码、unavailable 不携带执行族码（refine）。
  `assertions.min(1)`——空断言集的 case 在 CRUD 校验即拒绝，passed 不可能来自
  空集合真值。
- **B′2 severity 值域 = `info | warning | error`**（对齐 analyzer 产出词表）。
- **B′3 stale 投影与双 hash 域**：`evaluation.results.list` 每条附计算字段
  `stale: boolean`（当前技能文档 revision ≠ observedEndRevision）；结果本体
  不可变。**boundRevision 一律是技能文档 revision 域**；fixture 导入样本另带
  `corpusDigest`（语料域，sha256 of fixture 语料文件集）——两域分字段，不混用。
- **B′4 run RPC 全集（八过程）与竞态胜者**：`run.start {target, caseIds,
runner} → {runId, status:"queued"}`；`run.status {runId} → {status:
queued|running|completed|cancelled, resultIds}`；`run.cancel {runId} →
{runId, status}`；竞态冻结——completed 后 cancel 幂等返 `{status:
"completed"}`；running 时 cancel → 内核会话 cancel（provider）或原子段收口
  （analyzer），终态 `cancelled` 且已写结果保留；unknown runId → NOT_FOUND。
- **B′5 fixture 映射（r4-codex 勘误：expectTrigger 是布尔）**：
  `expectTrigger: boolean` → 断言 `{kind:"finding-triggered", value:
<boolean>}`（**新增布尔断言**；analyzer 语义：该技能在语料上应/不应产生
  finding）；`expectedKinds: string[]` → `expectedKinds.map(k => {kind:
"finding-kind", value:k})`。多技能 fixture → synthetic target = 首个技能；
  boundRevision = 首个技能文档 revision（技能域）；corpusDigest = 语料 digest；
  source="builtin-fixture"。
- **B′6 IO 纪律与错误面**：解析不兼容/JSON 损坏 → 空信封（集合读取丢弃）；
  权限拒绝(EACCES/EPERM)/磁盘 IO/原子写 rename 失败 → typed hard error
  （errors 词表 UNAVAILABLE 家族 + detail 含阶段与路径）；原子写失败后内存
  不提交 next state（对齐 workspaces.json 纪律）。

## B1 存储布局（冻结）

```text
appDir()/evaluation/<workspaceId>/<providerId>/<skillId>/
  cases.json     # { schemaVersion: 1, cases: Case[] }；原子写；server-owned
  results.json   # { schemaVersion: 1, results: Result[] }；每 case 保留最新 20 条
```

- CRUD 仅 Imported Workspace；Global（`~`）只读；builtin fixture 样本导入为
  Imported 副本。重启恢复 = 每次从盘读 + safeParse（不兼容 → 空信封，不迁移
  不写回）；并发 = 单 daemon 进程内串行（域模块串行队列）。

## B2 case schema（冻结）

```ts
{ schemaVersion: 1, caseId /* ev_ */, enabled, createdAt, updatedAt,
  source: "user" | "builtin-fixture",
  boundRevision /* 技能文档 revision 域 sha256 */,
  corpusDigest /* 语料域 sha256；仅 builtin-fixture 导入样本携带 */,
  input: { prompt,
    assertions: Array<            /* min(1)；见 B′1 */
      | { kind: "contains"; value: string; description? }
      | { kind: "not-contains"; value: string; description? }
      | { kind: "finding-kind"; value: string; description? }
      | { kind: "finding-triggered"; value: boolean; description? }
      | { kind: "finding-severity"; value: "info"|"warning"|"error"; description? }>> }
```

## B3 result schema（冻结；五态；r5 勘误：failure 枚举补全 + 结构化版本）

```ts
// B′1：Zod discriminatedUnion 按 outcome 收紧（非注释约定）
{ resultId, runId, caseId, target: {workspaceId, providerId, skillId},
  expectedRevision, observedStartRevision, observedEndRevision,
  runner: {
    kind: "analyzer" | "provider-model",
    version: { promptVersion: string; toolVersion: string; dshVersion: string },
  },  // 结构化三元组（r5 勘误：不再拍平字符串；analyzer 路径 dshVersion="n/a"）
  outcome: "passed" | "failed" | "error" | "unavailable" | "stale",
  assertions: Array<{ ref: number; outcome: "passed"|"failed"|"error" }>,
    // unavailable/stale 结果的 assertions 为空数组（未执行）
  failure?: { code: EvaluationFailureCode; detail: string },
    // error|unavailable 时必填；passed|failed|stale 时缺席（schema refine）
  startedAt, endedAt }

// EvaluationFailureCode（全枚举；与 outcome 的合法配对由 refine 强制）：
//   error        → "RUNNER_ERROR" | "ASSERTION_ERROR"（执行族）
//   unavailable  → "MODEL_UNAVAILABLE" | "DSH_UNAVAILABLE" | "PROVIDER_ROUTE_MISSING"（依赖族）
// 互斥：error 不携带依赖族码；unavailable 不携带执行族码。
```

转移（冻结）：run 前实测 ≠ bound → `stale`（不执行）；run 中漂移 → `stale`
（作废）；run 后漂移 → 结果不可变、展示标 stale。`unavailable` = 外部依赖缺席
（依赖族 failure.code）；`error` = 执行异常（执行族）。**passed 仅来自全部
assertion 执行且通过**——unavailable/stale 结果的 assertions 恒空数组，不可能
出现 passed 断言；transcript 长度、文本相似度永不产生 passed。

## B4 runner（冻结；fixture 导入细则 r5 补全）

- `analyzer`：analyzeDocuments 确定性路径。
- **fixture 导入**（细则冻结）：`skill-creator` 侧导入器遍历
  `test/fixtures/steward/evaluation/{should-trigger,no-trigger}/` 十条语料；
  每条生成一个 case：`caseId = ev_<uuid>`；`prompt` = fixture 语料的任务
  描述文本（scenario 正文）；synthetic target = 语料目录内首个技能；
  `boundRevision` = 该技能 SKILL.md 字节 sha256（技能域）；
  `corpusDigest` = 语料目录全部文件内容拼接的 sha256（语料域，算法冻结为
  「相对路径排序 + 内容字节序拼接」）；断言集 =
  `[{kind:"finding-triggered", value: expectTrigger}] ∪
expectedKinds.map(k => {kind:"finding-kind", value:k})`；
  `source:"builtin-fixture"`；导入落 Imported Workspace（用户显式选择的目标
  workspace+provider；Global 只读不落）。
- `provider-model`：B7 adapter 跑内核会话 → 断言跑在会话产出文本上；取消映射
  内核会话 cancel（有界）；重试 = 新 runId，旧结果保留；版本三元组如实写入
  runner.version。

## B5 RPC（冻结，八过程，含 B′4 run 全集与竞态胜者）

`evaluation.cases.list|create|update|remove`（Imported-only 写）；
`evaluation.run.start {target, caseIds, runner} → {runId, status:"queued"}`；
`evaluation.run.status {runId} → {status: queued|running|completed|cancelled,
resultIds}`；`evaluation.run.cancel {runId} → {runId, status}`（竞态见 B′4）；
`evaluation.results.list`（target + 可选 caseId；每条附 B′3 计算字段
`stale: boolean`）。错误走既有 errors 词表（NOT_FOUND/VALIDATION/
UNAVAILABLE 家族），不新造传输形状。

## B7 daemon 侧 provider-model 会话 adapter（r4 必修 #4；r5 生命周期冻结）

runner **不依赖 webui store**——daemon 进程内经既有
`AgentSessionsService`（agent-sessions.ts）驱动：

```ts
interface ProviderSessionAdapter {
  create(input: { cwd?: string; metadata?: AgentSessionSeedMetadata }): Promise<{ sessionId }>;
  prompt(input: {
    sessionId: string;
    text: string;
    references: Array<{ kind: "skill"; workspaceId; providerId; skillId }>;
  }): Promise<void>;
  /** 轮询 stream 至终态：读到 turn-end（或 status 稳定 idle 且无 pending 轮）
   * 即终止；投影 = 依序拼接 user-text/assistant-text/tool-result 帧 text 字段。 */
  readTranscript(sessionId: string): Promise<string>;
  /** 竞态胜者：completed 后 cancel 为 no-op；running → 内核会话有界 cancel，
   * 既有帧保留；unknown sessionId → NOT_FOUND。 */
  cancel(sessionId: string): Promise<void>;
  /** wire 形状 = B3 runner.version 的结构化三元组（无拍平）。 */
  versions(): { promptVersion: string; toolVersion: string; dshVersion: string };
}
```

实现 = createAgentSessionsService 既有 create/prompt（references 展开）/
stream 读帧拼文本/cancel 的薄封装；`versions()` 取内核与产品 prompt 模块
常量。Ch2 的 seed 是 **webui 入口**，本 adapter 是 **daemon 入口**——同一
agent.session.* 契约面，两个合法调用方，无第三协议。结果写入时序：case
断言全部裁决后一次性写 results.json（无部分写）。
