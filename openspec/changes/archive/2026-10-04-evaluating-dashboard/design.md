# Design: evaluating-dashboard

## 1. 数据契约（r2 修订：定稿）

```ts
// evaluation.overview（新增，readonly）
input:  { wsId: WorkspaceIdSchema, cursor?: string, limit?: number /* targets 分页：默认 50 上限 200 */ }
output: {
  targets: Array<{
    target: { workspaceId, providerId, skillId },
    skillName: string,
    caseCount: number,
    lastRun?: { endedAt, status, passedCount, failedCount, errorCount, unavailableCount },
    staleRatio?: number,           // 可选：零结果（零分母）时缺席；算法见下
    error?: { code: "unavailable" | "io-error", message: string }  // r2 修订：schema 字段
  }>,
  recentRuns: Array<{ runId, target, status, startedAt, endedAt?, resultIds[] }>,  // 固定窗口 20 条，仅当前 ws（r3）
  nextCursor?: string
}
```

- **cursor 语义（r2 定稿）**：targets 按 (workspaceId, providerId, skillId)
  字典序升序唯一排序（三元组唯一，无 tie）；cursor 为 opaque 续段游标
  （回传上页 nextCursor，缺席即末段）。
- **recentRuns 不分页且收窄当前 ws（r3 修订）**：固定窗口 20 条，**仅
  input.wsId 范围内**（跨 ws 全局窗口扫描成本不可界——每个 ws 目录都要开
  results）；排序 = startedAt 降序 + runId 字典序 tie-break。理由：分页锚
  不稳定（新 run 插入推移任何游标），「最近活动」语义用固定窗口表达即足；
  全量结果历史走各 target 详情的 results 行。
- **targets[].error（r2 定稿：从注释升格 schema 字段，体例同
  skills-dashboard providers[].error）**：单 target IO 失败（skill info
  读取失败 / cases.json 读取失败 / 目标技能已不可解析）投影为该 target 的
  typed error 行（code 闭集），其摘要字段缺席，整页不失败。
- **staleRatio 分母有界化（r3 修订）**：= 该 target **每 case 最新一条**
  result（caseId 分组取 endedAt 最新，与 eval-view 行合并同语义）中
  observedEndRevision ≠ 当前 revision 的条数 / **有结果的 case 数**；无任何
  结果 → staleRatio 缺席（零分母不定义，不返回 0/NaN）；case 无结果不进
  分母。「当前 revision」= server 每次 overview 计算时现读
  `skills.info(target, skillId).revision`（不缓存）；revision 读取失败 →
  该 target error 行，staleRatio 缺席。有界性：读取规模 = caseCount 上限
  （与 cases.list 同阶），非全部持久 results 累积。
- Global（~）读取与其他 ws 同形；运行/写入门控见 §3。

### 1.1 数据来源（r2 修订：写实）

```text
recentRuns 组合来源（现状取证）：
- 持久部分：各 target 的 results.json 中最近 endedAt 的结果行按 runId 聚合
  （store 按 target 读 cases/results，src/daemon/evaluation/store.ts:147-150）
- 内存部分：running/queued 态只存在于 service 的内存 Map
  （src/daemon/evaluation/service.ts:98-100）
```

推论（如实承诺）：daemon 重启后 running/queued 投影消失属正常（daemon 内存
态不持久）；overview **不承诺持久 run 历史**——已完成 run 的可见性 = 其结果
行落盘的可见性（每 case 有界保留，超出自然滚出）。

## 2. Global run 前置闸（r2 修订：真实缺口）

现状取证：`evaluation.run.start` 只做 caseIds/fixture 组合校验
（src/daemon/rpc-router.ts:218-241）后直接 startRun 排队
（src/daemon/evaluation/service.ts:356-391：runs.set → 逐 case 执行 →
appendResult）；Global 写闸只在结果落盘时生效
（src/daemon/evaluation/store.ts:173-176 assertWritable）。后果：Global
target 的 run 会真实执行全部 case（provider-model 会真实建会话）才在首个
appendResult 抛 EvaluationStoreError，且异步执行体无兜底——run entry 永远
停在 running。

设计（SHALL）：server 在排队与调用 runner 之前拒绝 Global target 的
run.start，返回类型化错误（沿「Global 可读禁运行」语义前移到入口）；测试
断言 providerAdapter 未被调用、runs Map 无 entry、无任何结果落盘。

## 3. 视图

```text
总览屏 /w/:wsId/evaluating
  顶行：ws 名 + 「Run…」入口（显式选 target 确认）+ 刷新
  主体：技能卡网格（通过率环形/五态徽标行 + stale 黄标 + 最近 run 相对时间）
       ↓ 点卡（r2 修订：跳三段路由详情）
详情 /w/:wsId/evaluating/:providerId/:skillId（r2 定稿：path 三段——
  ?skill= 单参数在同 ws 多 provider 同名技能下有歧义且不可深链；
  三段唯一确定三元组）
  cases 表（prompt 摘要/enabled/断言数/最新结果五态）
  失败断言展开：期望 vs 观测 + observedEndRevision 对比
  动作：Run（target 确认弹层，三段标注 workspace/provider/skill）/ Cancel /
       case 新建编辑（Imported only；Global 只读）
```

- store：照抄 latest-request-wins + 连接门范本（Svelte 5.57 防线）；运行中
  run 经现有 status 轮询/事件投影刷新。

## 4. 迁移

- eval-view.svelte 自 components/creator/ 迁 apps/evaluating/ 详情面
  （Creator 的 test/eval 子视图退役，subview 枚举收窄）；Creator 编辑页保留
  「查看评估」深链到本区块（三段路由）。
- 残留台账「非零 errors 红 chip」项顺带（真实语料抽查断言）。

## 5. 测试

- overview：正常 / 分页 cursor 稳定（字典序续拉无重无漏）/ 单 target IO
  失败（typed error 行 + 该 target 摘要缺席）/ staleRatio 分母（revision
  现读对比）/ recentRuns 固定窗口与内存+持久组合（重启后 running 态消失）
  / 空态。
- Global 前置闸（r2 修订）：run.start Global target → typed 拒绝 + adapter
  未被调用 + runs Map 无 entry + 零落盘。
- 详情：五态渲染/stale 投影/三段路由深链/run 竞态 cancel（completed 后
  cancel 幂等——沿 evaluation-corpus spec 语义回归）。
- 迁移：Creator subview 收窄无死链；深链直达。
