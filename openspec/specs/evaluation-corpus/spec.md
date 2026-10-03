# evaluation-corpus Specification

## Purpose

Server-owned evaluation cases and five-state run results bound to skill revisions.

## Requirements

### Requirement: Evaluation cases are server-owned and Imported-scoped

Evaluation cases MUST persist under the daemon-owned evaluation directory
(`appDir()/evaluation/<workspaceId>/<providerId>/<skillId>/`), never inside a
skill directory. Case mutation MUST be limited to Imported Workspaces; the
Global Workspace is read-only. Persistence MUST round-trip through the current
schema with incompatible content projected to an empty envelope (no migration,
no write-back).

#### Scenario: global scope rejects writes

- **WHEN** a case create/update/remove targets the Global Workspace
- **THEN** the RPC rejects with a typed error and nothing is written

#### Scenario: restart recovery

- **WHEN** a cases file is corrupt or incompatible at read time
- **THEN** the store projects an empty envelope and subsequent writes rebuild
  the file from the accepted in-memory state

### Requirement: Run results use the five-state protocol with revision binding

Every run result MUST carry the case id, run id, target triple, expected
(bound) revision, observed start and end revisions, the runner kind and
version, and per-assertion outcomes. The outcome MUST be one of
passed/failed/error/unavailable/stale: `passed` only when every assertion
passed; `unavailable` only for absent external dependencies (distinct
failure code from `error` execution failures); `stale` when the target
revision diverges from the bound revision before or during the run. Results
are immutable once recorded; later revision drift marks display-level
staleness only.

#### Scenario: unavailable never passes

- **WHEN** the provider model is unreachable during a provider-model run
- **THEN** the result is `unavailable` with a MODEL_UNAVAILABLE-family failure
  code and no assertion is recorded as passed

#### Scenario: revision drift before the run

- **WHEN** the skill's current revision differs from the case's bound revision
- **THEN** the run records `stale` without executing assertions

#### Scenario: real-model evidence

- **WHEN** a provider-model run completes
- **THEN** the runner version records the prompt/tool/DSH version triple for
  GOAL completion audits

### Requirement: Evaluating 区块取代 Creator 内嵌评估视图

WebUI MUST 提供 `/w/:wsId/evaluating` 的 Evaluating 区块：总览屏（含语料
targets 的技能卡：通过摘要、最近 run 时间、stale 标记、断言失败摘要 +
有界近期 runs 行）与详情屏；详情屏 MUST 由 path 三段路由
`/w/:wsId/evaluating/:providerId/:skillId` 唯一确定（无歧义可深链，
总览卡片点击导航至此）。详情屏 MUST 列出全部 cases 与五态最新结果、
失败断言展开（含 observedEndRevision 对比），并提供 run 发起（显式
target 确认，绝不自动运行）与 cancel、case 创建/编辑；case 编写与 run
发起 MUST 限定 Imported Workspace（Global 只读）。Creator 内嵌 test/eval
子视图 MUST 退役并以深链接入本区块。

#### Scenario: 卡片深链详情

- **WHEN** 用户在总览屏点击某 target 卡片
- **THEN** 导航落在该三元组的
  `/w/:wsId/evaluating/:providerId/:skillId`

#### Scenario: Global 详情只读

- **WHEN** 详情屏展示 Global Workspace 的 target
- **THEN** run 与 case 编写入口缺席或禁用，并显示只读说明

#### Scenario: Creator 深链

- **WHEN** 用户从 Creator 编辑页点击「查看评估」
- **THEN** 打开同三元组的 Evaluating 详情屏

### Requirement: overview 聚合 per-target 评估状态

`evaluation.overview`（readonly）MUST 返回按 target 三元组字典序唯一排序
的 targets 摘要（opaque cursor 分页，页大小有界，末段 nextCursor 缺席）
与至多 20 条的 recentRuns 固定窗口（startedAt 降序 + runId 字典序
tie-break，不分页）。单 target 的 IO 失败 MUST 投影为该 target 的 typed
`error` 条目（`{code: "unavailable" | "io-error", message}`，schema 字段）
且其摘要字段缺席，响应整体成功。staleRatio MUST 按有界口径计算：每
case 取最新一条 result（caseId 分组、endedAt 最新），分母 = 有结果的
case 数，分子 = 其中 observedEndRevision ≠ 当前 revision 的条数；无任何
结果时 staleRatio 字段 MUST 缺席（零分母不定义）；「当前 revision」由
server 查询时现读（不缓存）。recentRuns MUST 限定 input.wsId 范围（不
读取其他 ws 的 evaluation 目录）、至多 20 条固定窗口（startedAt 降序 +
runId 字典序 tie-break，不分页），MUST 组合持久结果行（各 target 最近
endedAt）与内存 running/queued 投影；overview MUST NOT 承诺持久 run
历史——daemon 重启后运行中 run 不再出现。

#### Scenario: cursor 分页稳定

- **WHEN** 某 workspace 的 targets 多于页大小
- **THEN** 各页遵循三元组字典序，经 nextCursor 续拉恰好覆盖每个 target 一次

#### Scenario: 单 target IO 失败降级 error 行

- **WHEN** 某 target 的 cases 文件读取失败
- **THEN** 响应整体成功，该 target 携带 typed error 条目，其余 targets 正常投影

#### Scenario: 重启后仅运行中投影消失

- **WHEN** run 进行中 daemon 重启后读取 overview
- **THEN** recentRuns 不再包含该 run，已落盘的完成结果仍可见

### Requirement: Global target 在 run 排队前被拒

`evaluation.run.start` MUST 在排队与调用任何 runner 之前，对 Global
Workspace target 返回 typed 拒绝；被拒请求 MUST NOT 产生 run entry、
MUST NOT 调用 provider adapter 或 analyzer、MUST NOT 落任何结果。

#### Scenario: Global run 永不触达 adapter

- **WHEN** run.start 的 target 为 Global Workspace
- **THEN** RPC typed 拒绝，无 run entry 产生，provider adapter（与
  analyzer）从未被调用

#### Scenario: recentRuns 限当前 workspace 且有界

- **WHEN** overview(wsId=ws_a) 而其他 ws 存在更新的 run
- **THEN** recentRuns 仅含 ws_a 的 run，长度 ≤ 20，按 startedAt 降序排列
  （runId 字典序 tie-break）；不读取 input ws 之外的 evaluation 目录

#### Scenario: staleRatio 零分母缺席

- **WHEN** 某 target 有 3 个 case 但从未产生任何 result
- **THEN** 该 target 的 staleRatio 字段缺席（不返回 0 或 NaN）；有结果的
  target 正常返回，且计算仅涉每 case 最新一条（case 数量级）

#### Scenario: overview 页大小判别

- **WHEN** 某 workspace 有 250 个有语料 target，以默认 limit 调用
- **THEN** targets 长度 ≤ 50 且携带 nextCursor；续拉至末段累计恰为 250，
  序严格按三元组字典序
