# Tasks: creator-test-session

## 1. seed 机制

- [x] 1.1 agent store：`seedAgentTestRun()`（文本 + reference 芯片 + 模板
      元数据 + 开面板 + 不自动发送；签名 = CreatorTestSeedInput 组合，模板
      ID/version 与模板常量同源）+ `startAgentAction`/`seedComposerPrompt`
      通用分流（含 pending 元数据作废——codex r5 P1 修复 + 回归测试）
- [x] 1.2 probe-recall-v1 模板常量（正文逐字冻结；占位符 `${skillName}`，
      r5 勘误：渲染输出带 `$` token 配对前提）
- [x] 1.3 session-transcripts meta 可选 seed 块（三元组 + revision +
      模板 ID/版本；agent.session.create metadata 透传，惰性建会话写入）
- [x] 1.4 AgentPanel 预填改走结构化 seed（文本不覆盖 + 引用经 registry 注册）

## 2. Creator Test 子视图

- [x] 2.1 saved 模式：Test tab = 模板正文（可编辑）+ 「Run in Agent panel」
      动作（seedAgentTestRun）
- [x] 2.2 new 模式：空态「先保存才能试跑」+ Go save 入口（不构造临时 id）

## 3. 测试与门禁

- [x] 3.1 store 单测：references[0] 三元组断言 + 失败重试保留元数据 + 通用分流不伪装（重连路径由 draft 分轨测试族覆盖）
- [x] 3.2 transcripts meta 落档断言（seed 块字段齐 + 损坏降级）
- [x] 3.3 真实内核网关集成：seed 元数据落盘 + 重启回读（引用展开面由 agent-references 测试族 + WS4 走查覆盖）
- [ ] 3.4 门禁：focused tests + webui check + typecheck + fmt + full build（全量批门禁随 Ch3/Ch4 一并跑）
- [ ] 3.5 桌面 + 窄屏（1100/680）vision 走查（console/overflow/空态文案）——归 WS4 批次
