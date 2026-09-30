# WebUI 残留工作计划 r3（2026-09-30；r1 6.2 → r2 7.0，本轮冻结全部余留接口）

> 用户原始需求 [2026-09-30]：「webui 里面还有一些残留的未完成的工作，比如 skill
> 测试与评估，你整理一份工作计划（可能是几个 changes），你和 codex 去讨论讨论。
> 等全部做好了再让我来参与走查验收。切记，你让 vision 子代理自己去尝试走查验收
> 确定使用体验没问题再来找我。」

r2 复核裁决 7.0/10 NEEDS-WORK：事实纠错/Ch1 边界/C5 拆分通过，但 r2 判定
「计划仍把关键接口与协议留给实现阶段选择」。r3 把 r2 七项阻塞**全部落为冻结契约**
（不再有二选一）；Ch1 已同步归档（commit e2eb536，agent-internal requirement 已
落主 spec）。

## 冻结契约 A：Ch2 `creator-test-session`（r2 项 1/2/6）

### A1 CreatorTestSeed 类型（冻结）

```ts
interface CreatorTestSeed {
  text: string;                       // 探针模板正文（占位符已替换；用户可编辑）
  references: ComposerReference[];    // 恰 1 条 kind:"skill" 完整三元组
  templateId: "probe-recall-v1";      // 模板 ID（产品所有）
  templateVersion: 1;                 // 模板版本（int）
}
```

### A2 统一 seed 入口（冻结）

- agent store 新增 `seedAgentTestRun(seed: CreatorTestSeed): void`——**唯一**把
  「文本 + ComposerReference + 模板元数据」同时写入 composer 的入口；
  `startAgentAction`（现仅 string，agent.svelte.ts:366）与 AgentPanel 预填
  （AgentPanel.svelte:61）都改走它，Creator Test tab 是首个调用方。
- 行为：写 composer 文本、注册 skill reference 芯片（composer-chips 既有
  registry）、打开面板、**不自动发送**（用户显式提交）。
- new 模式（无稳定 skillId）：Test tab 渲染空态「先保存才能试跑」+ 保存入口；
  不构造临时 id。

### A3 探针模板协议（冻结，可复现）

```text
templateId:   probe-recall-v1   version: 1
正文（逐字冻结）：
  请阅读引用的技能文档（${skillName} 芯片）。然后：
  1. 复述该技能的触发条件与适用场景；
  2. 列出它声明提供的工具与参考文件；
  3. 给出一个你会使用它的典型任务示例。
占位符集合：   {skillName}
替换规则：     纯文本替换（无模板引擎）；芯片本身经 references 通道提交
编辑语义：     用户编辑的是最终 prompt；模板版本与最终文本都记录在案
自动发送：     false
```

### A4 test-run 元数据（冻结，r2 项 6）

session-transcripts 的会话 meta 增可选块：
`{ kind: "test-run", workspaceId, providerId, skillId, revision: "sha256:…",
templateId, templateVersion }`——由 seed 入口建会话时写入；revision 取自
creator.load 已有的文档 revision（同源，不另算 hash）。

### A5 验收（冻结）

- 单测：拦截 `agent.session.prompt` payload，断言 `references[0]` 是完整
  `{workspaceId, providerId, skillId}` 三元组（禁止仅 `$name` 文本）；覆盖发送
  失败、切换会话、断线重连三路径。
- 集成：真实 daemon + Imported 技能——seed → 提交 → 转录出现
  `[reference: skill …]` 展开块 → 帧流可见 → 落盘 → 重启回放。
- 只证明会话链路，不证明技能质量（质量判定归 Ch3）。

## 冻结契约 B：Ch3 `evaluation-corpus`（r2 项 3/4/7）

### B1 存储路径与布局（冻结）

```text
appDir()/evaluation/<workspaceId>/<providerId>/<skillId>/
  cases.json      # case 信封（schemaVersion + 数组；原子写；server-owned）
  results.json    # 每 case 有界的最新结果列表（默认保留 20/run）
```

- CRUD 仅 Imported Workspace（安全不变量：写绑定 Imported）；Global（`~`）
  **只读**（可导入 builtin fixture 样本到 Imported 副本，不在 `~` 落写）。
- 重启恢复：纯文件事实源，每次 RPC 从盘读 + Zod safeParse（不兼容 → 空值
  重建语义，不迁移）；并发：单 daemon 进程内串行（无跨进程写者）。

### B2 case schema（冻结）

```ts
{ schemaVersion: 1,
  caseId: string,                    // ev_ opaque
  input: {
    prompt: string,
    assertions: Array<
      | { kind: "contains"; value: string; description?: string }
      | { kind: "not-contains"; value: string; description?: string }
      | { kind: "finding-severity"; value: "high"|"medium"|"low"; description?: string }>>
  },
  enabled: boolean,
  createdAt: string, updatedAt: string,
  source: "user" | "builtin-fixture",
  boundRevision: string }            // sha256:…（创建/编辑时技能文档 revision）
```

### B3 result schema（冻结；五态判别联合）

```ts
{ resultId, runId, caseId,
  target: { workspaceId, providerId, skillId },
  expectedRevision: string,          // case 身份绑定的 revision
  observedStartRevision: string,     // run 开始时实测
  observedEndRevision: string,       // run 结束时实测
  runner: { kind: "analyzer" | "provider-model"; version: string },
    // analyzer 版本 = 模块内冻结常量；provider-model 版本 =
    // `${promptVersion}/${toolVersion}/${DSH version}`（GOAL 107 实证字段）
  outcome: "passed" | "failed" | "error" | "unavailable" | "stale",
  assertions: Array<{ ref: number; outcome: "passed" | "failed" | "error" }>,
  failure?: { code: string; detail: string },   // error/unavailable 必填
  startedAt: string, endedAt: string }
```

**状态转移（冻结）**：run 前实测 revision ≠ boundRevision → `stale`（不执行）；
run 中 observedEnd ≠ observedStart → `stale`（执行作废）；run 后 revision 变化 →
结果不可变，展示层标 stale。`unavailable` = 外部依赖缺席（模型/DSH 不可达，
failure.code 枚举）；`error` = 执行异常。**passed 仅来自全部 assertion 通过**；
transcript 长度、文本相似度、unavailable 永不产生 passed。

### B4 runner（冻结）

- `analyzer`：确定性路径（analyzeDocuments；现 fixture 10 条作为
  `source:"builtin-fixture"` 样本导入 Imported 副本）。
- `provider-model`：经 Ch2 的 seed 机制在内核会话执行 case prompt，断言跑在
  会话产出上（GOAL 107 的真实模型证据归属；promptVersion/toolVersion/DSH
  version 入 runner.version）。
- 取消/重试：provider run 映射内核会话 cancel（有界）；重试 = 新 runId 新结果，
  旧结果保留。

### B5 RPC 面（冻结）

`evaluation.cases.list|create|update|remove`、`evaluation.run.start`、
`evaluation.results.list`——Imported-only 写；Zod 正负例、重启恢复、revision
漂移 stale、error/unavailable 区分、取消/重试全部有测试（r2 验收清单逐条落
tasks）。批量 UI 在契约测试绿后另批任务。

## 冻结契约 C：Ch4 `intelligence-proposal-parity`（r2 项 5 + GOAL 105）

**裁决（无二选一）**：GOAL 铁律「edit/disable/split/merge 均从实际 DSH tool
calls 形成方案」直接采信——四种 proposal 的创建**一律经内核 agent 会话的工具
调用**产生：

- IntelligenceView 的 finding 直连表单（现直接调 skillIntelligence.propose，
  IntelligenceView.svelte:233）**移除**；edit/disable/split/merge 四个动作统一
  改为「经 agent 发起」：用 Ch2 的 seed 机制打开面板，携带 finding 上下文 +
  对应 propose 工具的调用指令；proposal 由 agent tool call 产生。
- skillIntelligence.propose 直连 RPC 从 WebUI 侧退役（无兼容策略：不留 UI
  直连路径）；工具面（capability-core 投影的 kernel/MCP propose 工具）成为
  唯一创建向量。
- 双 store 收口：审批面统一走 agent.proposals.* 投影——skillIntelligence 的
  proposal 存储作为其数据源之一并入投影（origin=agent-tool 元数据），单一
  审批入口；spec 冻结「不存在 finding-created 第三条创建路径」。

## 序（r2 裁决采纳；Ch1 已完成并归档）

```text
[done] Ch1 steward-surface-closure（sync+archive：e2eb536）
  -> Ch2/Ch3/Ch4 契约冻结（change docs 三份并行；本文 A/B/C 即冻结体）
  -> Ch4 provenance 接线（seed 化四动作 + 投影统一）
  -> Ch2 实现（seed 入口 + 模板 + 元数据 + 测试矩阵 A5）
  -> Ch3 实现（存储/CRUD/双 runner/结果协议；数据层不依赖 Ch2 UI，复用其 seed）
  -> Ch5 creator-editor-polish / Ch6 shell-settings-ui / Ch7 docs-archive-hygiene
```

## Ch7 细目补全（r2 要求点名）

- composer-references-queue-actions 归档 tasks.md:14（1.9 引用链测试）补写。
- redesign-model-tabs-and-agent-panel 归档 tasks.md:46,48（5.2 codex R3 打分、
  5.3 全量门禁）补办或按归档规则注记。
- 三个 spec 占位 Purpose 重写：`@jixoai-search`、`gui-wiki`、`skill-wiki`
  （`openspec validate --all --strict` 当前 15/18，3 失败全为此债）。
- creator/manifest.ts:4 stale 注释清理。

## 验收纪律（用户指令，不变；GOAL 完成条件不缩减）

全部 changes 完成后：vision 子代理先自行走查（真实 daemon、1100px/680px、
console/overflow/contrast/disconnected、Ch2 会话链路端到端），确认体验无问题
后才请 Owner 走查验收；GOAL 的真实模型维护 run 与版本实证字段由 Ch3
provider-model runner 承接。
