# Tasks: creator-test-session

## 1. seed 机制

- [ ] 1.1 agent store：`CreatorTestSeed` 类型 + `seedAgentTestRun()`（文本 +
      reference 芯片 + 模板元数据 + 开面板 + 不自动发送）；`startAgentAction`
      预填路径收编
- [ ] 1.2 probe-recall-v1 模板常量（正文逐字冻结 + `{skillName}` 替换）
- [ ] 1.3 session-transcripts meta 可选 test-run 块（三元组 + revision +
      模板 ID/版本；seed 建会话时写入）
- [ ] 1.4 AgentPanel 预填改走 seed 入口（不重复写文本）

## 2. Creator Test 子视图

- [ ] 2.1 saved 模式：Test tab = 模板正文（可编辑）+ 「在 Agent 面板试跑」动作
      （seedAgentTestRun）
- [ ] 2.2 new 模式：空态「先保存才能试跑」+ 保存入口（不构造临时 id）

## 3. 测试与门禁

- [ ] 3.1 store 单测：references[0] 三元组断言 + 发送失败/切换会话/重连三路径
- [ ] 3.2 transcripts meta 落档断言（test-run 块字段齐）
- [ ] 3.3 真实 daemon 集成：展开块/帧流/落盘/重启回放
- [ ] 3.4 门禁：focused tests + webui check + typecheck + fmt + full build
- [ ] 3.5 桌面 + 窄屏（1100/680）vision 走查预演（console/overflow/空态文案）
