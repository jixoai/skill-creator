# Proposal: creator-test-session — Creator Test 子视图做实（工作计划 Ch2 / 契约 A）

## Why

Creator「Test」子视图是全 WebUI 唯一明式 "Not yet implemented" 占位
（CreatorWorkspace.svelte:146；五 tab 已注册可点击可入 URL），后端无对应面。用户
原始需求 [2026-09-30] 点名「skill 测试」为 webui 残留核心项。Codex r1/r2 复核
（6.2 → 7.0）裁定：保留 Test tab、Agent 面板 seed 会话、纯前端装配不新增 RPC，
但必须冻结引用接线与探针协议，杜绝「文本有 `$name`、registry 为空」的假完成。

## What Changes

- **CreatorTestSeed + 统一 seed 入口**（agent store 新增 `seedAgentTestRun`）：
  一次写入 composer 文本 + skill reference 芯片（完整
  `{workspaceId, providerId, skillId}` 三元组）+ 打开面板；不自动发送。
  `startAgentAction`（现仅 string）与 AgentPanel 预填路径一并收编。
- **探针模板 probe-recall-v1**：模板 ID/版本/正文/占位符/替换规则逐字冻结
  （见 design A3）；用户编辑的是最终 prompt，模板版本随会话落档。
- **test-run 会话元数据**：session-transcripts meta 增可选 test-run 块
  （目标三元组 + 文档 revision + 模板 ID/版本）。
- **new 模式空态**：未保存草稿无稳定 skillId——Test tab 显示「先保存才能试跑」
  与保存入口，不构造临时 id。
- 零新增 RPC（复用 agent.session.* 既有面）；Ch4 的 finding 发起与 Ch3 的
  provider runner 复用同一 seed 机制。

## Impact

- 代码：`webui/src/lib/stores/agent.svelte.ts`（seed 入口 + startAgentAction 收编）、
  `AgentPanel.svelte`/`ComposerCard`（预填走 seed）、Creator Test 子视图组件、
  `src/daemon/kernel/session-transcripts.ts`（meta 块）。
- 测试：store 层拦截 prompt payload 断言三元组（失败/切换会话/重连三路径）；
  真实 daemon 集成（展开块/帧流/落盘/回放）。
- 不做：自动判定技能质量（归 Ch3）、自动发送、新 RPC。
