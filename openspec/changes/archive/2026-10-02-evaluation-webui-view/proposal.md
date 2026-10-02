# Proposal: evaluation-webui-view — 评估语料最小只读查看入口（Ch3 后续批）

## Why

evaluation-corpus（archive 2026-10-01）交付了 server-owned 语料域（cases/results
存储、五断言、五态结果协议、双 runner、八过程 RPC），并在 proposal 中明确
「webui 侧仅最小查看入口（后续批任务）」——至今 WebUI 没有任何面可以看到某技能
的评估 case 与结果，用户只能经 CLI/MCP 盲读 JSON。本 change 承接该声明，交付
最小只读查看入口；不做创建/运行 UI（留在后续批）。

## What Changes

- **Creator 新增 `Eval` 子视图**（subview 枚举扩展 `file|log|preview|validate|test|eval`）：
  对当前编辑技能（edit 模式 + skillId）只读列出 `evaluation.cases.list` 的全部
  case，与 `evaluation.results.list` 按 caseId 取每案最新一条（endedAt 倒序，
  resultId 稳定 tie-break）合并成行。行内容：prompt 摘要、enabled 态、断言数、
  最新 outcome 五态徽标（passed 绿 / failed 红 / error 橙 / unavailable 灰 /
  stale 黄）+ observedEndRevision 短显。
- **store**：`webui/src/lib/stores/evaluation-view.svelte.ts`——照抄仓内
  latest-request-wins 代次门模式（request-generation + connection owner
  generation），loading/error/empty 三态；断线与被取代请求不伪造数据
  （rows 投影为无结果）。行合并与五态徽标映射导出为纯函数（单测覆盖）。
- **空态**：new 模式（无 skillId）显示「先保存」同族空态、不发 RPC；edit 模式
  无 case 显示「No evaluation cases for this skill yet — create them via
  CLI/MCP」；本批不提供任何创建/运行入口（红线）。

## Impact

- webui：creator manifest 两处 subview enum + `sub-view-tabs` + 新组件
  `components/creator/eval-view.svelte` + 新 store `stores/evaluation-view.svelte.ts`
  - `CreatorWorkspace.svelte` 子视图挂载。
- 契约零变更（evaluation namespace 既有只读过程直接消费；不动 rpc-contract）。
- 不动 ProviderView / WorkspacesHome / agent 面板（避免与并行 change 撞车）。
