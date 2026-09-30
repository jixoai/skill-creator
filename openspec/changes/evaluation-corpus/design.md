# Design: evaluation-corpus（契约体 = 工作计划 r3 §B + r4 补遗 B′）

## B′ wire 级补遗（r4；冲突处以本节为准）

- **B′1 result schema 级收紧**：Zod discriminatedUnion——`outcome ∈ error |
  unavailable` → `failure` 必填且 `code ∈ {MODEL_UNAVAILABLE, DSH_UNAVAILABLE,
  PROVIDER_ROUTE_MISSING, RUNNER_ERROR}`；`passed | failed | stale` →
  `failure` 缺席。
- **B′2 severity 值域 = `info | warning | error`**（对齐 analyzer 产出词表）。
- **B′3 run 后 stale 投影**：`evaluation.results.list` 每条附计算字段
  `stale: boolean`（当前技能 revision ≠ observedEndRevision）；结果本体不可变。
- **B′4 run RPC 全集**：`run.start {target, caseIds, runner} → {runId,
  status:"queued"}`；`run.status {runId} → {status: queued|running|completed|
  cancelled, resultIds}`；`run.cancel {runId}`（provider→内核会话 cancel；
  analyzer→幂等返终态）。
- **B′5 fixture 映射**：`{expectTrigger, expectedKinds}` → 断言集 =
  `expectedKinds.map(k => {kind:"finding-kind", value:k})` ∪ `[{kind:
  "contains", value: expectTrigger}]`；**新增 assertion kind `finding-kind`**
  （analyzer runner：产出 findings 的 kind 集合含 value）；多技能 fixture →
  synthetic target = 首个技能；boundRevision = 语料 digest；
  source="builtin-fixture"。
- **B′6 IO 纪律**：解析不兼容 → 空信封；权限/磁盘/原子写失败 → typed hard
  error（对齐 workspaces.json 纪律，绝不静默空值）。


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
  source: "user" | "builtin-fixture", boundRevision /* sha256:… */,
  input: { prompt,
    assertions: Array<
      | { kind: "contains"; value; description? }
      | { kind: "not-contains"; value; description? }
      | { kind: "finding-kind"; value; description? }              /* B′5 新增 */
      | { kind: "finding-severity"; value: "info"|"warning"|"error"; description? }>> }
```

## B3 result schema（冻结；五态）

```ts
// B′1：Zod discriminatedUnion 按 outcome 收紧（非注释约定）
{ resultId, runId, caseId, target: {workspaceId, providerId, skillId},
  expectedRevision, observedStartRevision, observedEndRevision,
  runner: { kind: "analyzer" | "provider-model"; version },
    // analyzer: 模块冻结常量; provider-model:
    // `${promptVersion}/${toolVersion}/${DSH version}`
  outcome: "passed" | "failed" | "error" | "unavailable" | "stale",
  assertions: Array<{ ref: number; outcome: "passed"|"failed"|"error" }>,
  failure?: { code: "MODEL_UNAVAILABLE" | "DSH_UNAVAILABLE" |
    "PROVIDER_ROUTE_MISSING" | "RUNNER_ERROR"; detail: string },
    // error|unavailable 时必填；passed|failed|stale 时缺席（schema refine）
  startedAt, endedAt }
```

转移（冻结）：run 前实测 ≠ bound → `stale`（不执行）；run 中漂移 → `stale`
（作废）；run 后漂移 → 结果不可变、展示标 stale。`unavailable` = 外部依赖缺席
（MODEL_UNAVAILABLE / DSH_UNAVAILABLE / PROVIDER_ROUTE_MISSING…failure.code
枚举）；`error` = 执行异常。passed 仅来自全部 assertion 通过；transcript 长度、
文本相似度、unavailable 永不产生 passed。

## B4 runner（冻结）

- `analyzer`：analyzeDocuments 确定性路径；fixture 10 条以
  `source:"builtin-fixture"` 导入。
- `provider-model`：seed 机制（creator-test-session）跑内核会话 → 断言跑在
  会话产出文本上；取消映射内核会话 cancel（有界）；重试 = 新 runId，旧结果
  保留；版本三元组如实写入 runner.version。

## B5 RPC（冻结，含 B′4 run 全集）

`evaluation.cases.list|create|update|remove`（Imported-only 写）；
`evaluation.run.start {target, caseIds, runner} → {runId, status:"queued"}`；
`evaluation.run.status {runId} → {status: queued|running|completed|cancelled,
resultIds}`；`evaluation.run.cancel {runId}`；
`evaluation.results.list`（target + 可选 caseId；每条附 B′3 计算字段
`stale: boolean`）。错误走既有 errors 词表（NOT_FOUND/VALIDATION/
UNAVAILABLE 家族），不新造传输形状。
