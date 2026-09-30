# WebUI 残留工作计划 r2（2026-09-30，已吸收 Codex r1 复核 6.2/10 全部 P1/P2）

> 用户原始需求 [2026-09-30]：「webui 里面还有一些残留的未完成的工作，比如 skill
> 测试与评估，你整理一份工作计划（可能是几个 changes），你和 codex 去讨论讨论。
> 等全部做好了再让我来参与走查验收。切记，你让 vision 子代理自己去尝试走查验收
> 确定使用体验没问题再来找我。」

r1 复核（Codex 大地三，ws3-codex-review）结论 NEEDS-WORK 6.2/10；本文 r2 逐条
落实其阻塞项：引用 registry 真实接线（P1-1）、探针模板可执行定义（P1-2）、评估
schema/revision 绑定/结果协议先行（P1-3）、双 proposal store 来源收口（P1-4）、
dsh-webui-composition 遗漏与「退役语义」边界（P1-5）、C5 拆分（P2-1）、analyzer
措辞修正（P2-2）。

## 事实基线（r1 已独立核对，修正 r0 两处错误）

1. Creator「Test」子视图是占位（CreatorWorkspace.svelte:146）；后端无 skills.test RPC。
2. IntelligenceView 只从 finding 创建 edit/disable；split/merge 仅有审查渲染。
3. rpc-contract 的 **steward.* 是 8 个 RPC**（r0 误写 7——7 是 Steward 域工具数）；
   WebUI 零消费；2026-09-11 裁决删除了 Steward UI，Agent 面板是唯一 Agent 面。
4. `steward-product-workflow` 的 Requirement 已改成 Skill Creator shell，仅 Purpose
   残留「DSH Web host」；**`dsh-webui-composition` 的 Purpose 仍完整描述旧 DSH
   Web host（r0 遗漏）**。
5. 评估 fixture（10 条期望矩阵）是**确定性 analyzer 回归**（steward-effectiveness
   3/3 绿）——不是产品语料面，无用户 CRUD、批量 runner 或模型评估 UI；「analyzer
   已产品化」的 r0 措辞不准确：它目前是 daemon 代码路径 + 测试 fixture。

## Changes（r2 重切：7 个，单一 owner/验收面）

### Ch1 `steward-surface-closure`（原 C4，语义收窄）

**退役的是旧 UI/hosted 语义，不是 Steward 领域**（Manager authority、proposal、
approval、audit、rollback 全部保留）：

- 改写 `steward-product-workflow` 与 `dsh-webui-composition` 两个 spec 的 Purpose
  （去除 DSH Web host 叙述）；`agent-steward` spec 只做核对——它描述权限与生命周期
  契约，不要求独立 UI route，**不整体退役**。
- 「后端保留为 agent internal」必须给出真实调用路径证明（capability/MCP 工具行），
  不得把 rpc.steward.* 无 WebUI 消费等同于 agent 内部面。
- SessionsSettings 的 kernel-only 提示是转录归属说明：保留并按需改写文案，
  不机械删除。
- 验收：`openspec validate --strict` 全绿；两个 Purpose 文本不再含 DSH Web host；
  调用路径证据（工具注册行）写入 change notes。

### Ch2 `creator-test-session`（原 C1，接线按 r1 P1-1/P1-2 冻结）

保留 Test tab，点击进入 Agent 面板试跑会话；**纯前端装配，不新增 RPC**：

- **引用接线（P1-1）**：`$` 引用不是 system prompt 文本——必须同时写入 composer
  文本与 ComposerReference registry，提交时携带
  `{workspaceId, providerId, skillId}` opaque 三元组（agent.svelte.ts:473 既有
  机制），由 daemon 展开为 `[reference: skill …]`。仅预填 `$name` 字符串 = 假完成，
  禁止。
- **未保存草稿（P1-1）**：new 模式无稳定 skillId——Test tab 显示「先保存才能试跑」
  的空态与保存入口，不做临时 id。
- **探针模板（P1-2）**：seed = **产品所有的版本化最小探针模板**（版本号 + 固定
  占位符，如「请阅读引用技能并复述其触发条件与工具清单」），用户可编辑后提交；
  不做「按 description 自动生成脚本」。
- **验收（r1 定义）**：真实 daemon 创建会话、提交真实 reference、转录出现
  `[reference: skill …]` 展开块、帧流可见、转录落盘且重连可回放。只证明会话链路，
  不证明技能质量（质量判定归 Ch3）。

### Ch3 `evaluation-corpus`（原 C2，schema/runner 先行，数据层不依赖 Ch2）

评估语料与跑分——**先冻结契约再做批量 UI**：

- **存储（r1 裁决）**：workspace-private、server-owned（不写技能目录
  `_evaluation/`）；逻辑键 `workspaceId/providerId/skillId/expectedRevision/caseId`。
- **case schema**：`schemaVersion`、输入（prompt/assertion 输入）、expected
  finding/assertion、`enabled`、创建/更新时间、来源与 revision 绑定。
- **结果协议**：`passed / failed / error / unavailable / stale` 五态判别；技能
  revision 变化后旧结果投影为 stale 不代表当前技能；**模型 unavailable 永不记
  passed**。
- 现有 10 条 fixture 只作内置回归样本导入，不是产品语料。
- 验收：schema 冻结（Zod + spec）、CRUD RPC、runner（确定性 analyzer 路径）、
  revision 绑定与结果协议各有负面与正面测试；批量 UI 在契约测试绿后另批任务。

### Ch4 `intelligence-proposal-parity`（原 C3，先收口双 store）

- **P1-4**：skillIntelligence.* 提案存储与 agent.proposals.* 存储是两套体系——
  change 内先裁决：统一投影（单一 proposal 视图 + origin 字段）或显式区分
  origin（finding-created / agent-created）并在 UI 标注来源；split/merge 的创建
  入口按该裁决实现（finding 发起表单或 agent-only 标注，二选一落 spec）。
- 验收：两套存储的投影/标注有测试；split/merge 不再是「能渲染不能创建」的
  悬空面（要么有入口，要么 UI 显式声明来源约束）。

### Ch5 `creator-editor-polish`（C5 拆分 1/3）

CodeMirror 懒加载 + new 模式草稿校验（validate 走草稿内容）。不并入 Ch2——
Test transcript 不依赖编辑器实现（r1 裁决）。

### Ch6 `shell-settings-ui`（C5 拆分 2/3）

AppSidebar 完整化 + General 偏好分区（主题/语言起步）。

### Ch7 `docs-archive-hygiene`（C5 拆分 3/3）

stale 注释清理、两处 archive 未勾 tasks 的补测试收尾（composer 1.9、redesign
5.2/5.3）。

## 序（r1 建议采纳）

```text
Ch1（边界/spec 收口，先行）
  -> Ch2 契约冻结（引用接线/探针模板/验收语义）   } 并行冻结
  -> Ch3 契约冻结（schema/runner/结果协议）        }
  -> Ch2 实现（Agent seed 试跑）
  -> Ch3 实现（corpus/runner/结果；数据层不依赖 Ch2）
  -> Ch4 实现（proposal 来源收口）
  -> Ch5/Ch6/Ch7（互不依赖，随时可插，最后清场）
```

## 验收纪律（用户指令，不变）

全部 changes 完成后：vision 子代理先自行走查（真实 daemon、桌面 + 窄屏、
console/overflow/contrast/disconnected 全查、Ch2 的会话链路端到端），确认使用
体验无问题后才请 Owner 参与走查验收。
