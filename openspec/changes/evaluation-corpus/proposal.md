# Proposal: evaluation-corpus — 技能评估语料与跑分（工作计划 Ch3 / 契约 B）

## Why

用户原始需求 [2026-09-30] 点名「skill 评估」。现状只有确定性 analyzer 回归
（10 条 fixture，steward-effectiveness 3/3）——无用户语料 CRUD、批量 runner、
结果协议或产品 UI（r0「analyzer 已产品化」措辞已被 r1 纠正）。GOAL.md 完成条件
还要求真实模型维护 run 与 promptVersion/toolVersion/DSH version 实证
（GOAL:107）——本 change 承接该证据归属。

## What Changes（契约体 = 工作计划 r3 §冻结契约 B）

- **存储**：`appDir()/evaluation/<wsId>/<pId>/<skillId>/{cases.json,results.json}`
  server-owned；写仅 Imported Workspace，Global 只读；文件事实源 + safeParse
  空值重建；单 daemon 串行。
- **case schema**（Zod 冻结）：caseId/prompt/assertions（contains /
  not-contains / finding-kind / finding-triggered（布尔）/ finding-severity，
  min(1)）/enabled/时间戳/source（user | builtin-fixture）/boundRevision（技能
  文档域）+ corpusDigest（语料域，仅 fixture 样本）。
- **result schema**（五态判别联合冻结）：passed/failed/error/unavailable/stale；
  携带 caseId/runId/目标三元组/expectedRevision + observedStart/EndRevision/
  runner{kind,version}/逐 assertion 结果/typed failure。stale 转移冻结：run 前
  revision ≠ bound → stale 不执行；run 中 revision 漂移 → stale 作废；run 后
  漂移 → 展示层标 stale（结果不可变）。**passed 仅来自全部 assertion 通过**。
- **双 runner**：`analyzer`（确定性；fixture 作 builtin-fixture 样本导入）+
  `provider-model`（经 creator-test-session 的 seed 机制跑内核会话；runner.
  version = promptVersion/toolVersion/DSH version——GOAL 107 实证字段）。
- **RPC（八过程）**：`evaluation.cases.list|create|update|remove`、
  `evaluation.run.start|status|cancel`、`evaluation.results.list`。
- 批量 UI 在契约测试绿后另批任务（本 change 交付契约 + runner + 测试）。

## Impact

- 新域模块 `src/daemon/evaluation/`（存储/CRUD/runner/协议）+ rpc-contract 面
  + contracts 文件；webui 侧仅最小查看入口（后续批任务）。
- 不写技能目录（禁止 `_evaluation/`）；数据层不依赖 Ch2 UI（复用其 seed）。
