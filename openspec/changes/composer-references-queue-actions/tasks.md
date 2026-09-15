# Tasks

## C1 —— @ 引用芯片

- [x] 1.1 契约：AgentPromptReferenceSchema + prompt input references（≤4，default []）
- [x] 1.2 daemon：agent-files.resolvePromptReferences（file 展开守卫链）
- [x] 1.3 daemon：agent-sessions.prompt 引用参数 + session 摘要展开 + slash 分流守卫
- [x] 1.4 rpc-router 透传 references
- [x] 1.5 webui：agent-composer 引用 registry（有序消费/剪除）+ 草稿换轨/清轨面
- [x] 1.6 webui：ChipPaintLayer + composer-chips 纯函数（span 投影）
- [x] 1.7 webui：TriggerMenu 泛化（大小写不敏感 + headerRow）
- [x] 1.8 webui：ReferenceMenu（Sessions + Files 钻取）+ ComposerCard 接线
      （退格整删、提交引用、@ 键盘先占）
- [ ] 1.9 测试：daemon 展开链 + webui registry/绘制/菜单/退格
- [x] 1.10 vision 独立走查 + 全量门禁 + 提交

## C2 —— QueueDock 行级操作

- [ ] 2.1 契约：agent.queue.list/update（discriminated union）
- [ ] 2.2 daemon：inbox 面投影 + edit/remove/steer 实现
- [ ] 2.3 rpc-contract + rpc-router 接线
- [ ] 2.4 webui：queue store（list/refresh 时机）+ QueueDock 行操作 UI
- [ ] 2.5 测试 + vision 走查 + 提交

## C3 —— 技能装饰 + 忙碌 Enter 设置行

- [ ] 3.1 composer-chips 增 /name 技能 token 样式（skills 命中）
- [ ] 3.2 Settings→Agent Behavior 增 Busy Enter 行
- [ ] 3.3 测试 + vision 走查 + 提交

## 收尾

- [ ] 4.1 spec 同步（agent-surface / agent-kernel）+ 归档 + AGENTS.md 词汇
- [ ] 4.2 全量门禁 + 迭代报告
