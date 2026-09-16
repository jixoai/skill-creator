# Tasks

## C1 —— `$` 技能引用

- [x] 1.1 契约：AgentPromptReferenceSchema 增 skill 变体（strict 三元组）
- [x] 1.2 daemon：agent-sessions expandReferences skill 分支 + domain 装配 expandSkillReferences
- [x] 1.3 webui：composer-fuzzy 纯函数匹配器（子序列 + 加权）
- [x] 1.4 webui：TriggerMenu 增 matcher/key 泛化（缺省行为不变）
- [x] 1.5 webui：SkillMenu（懒加载 + Workspace 分组 + 模糊搜索）+ ComposerCard 接线
      （键盘先占、`$name ` 落稿、registry 入条、chip 绘制复用）
- [x] 1.6 webui：agent.svelte sendAgentPrompt 引用映射 + ComposerReference skill 形状
- [x] 1.7 测试：契约/展开/匹配器/registry + vision 走查
      （走查：916 skills · 44 组实载；模糊收窄/chip/原子退格全 PASS；console 零错误）

## C2 —— Settings Model 滚动修复

- [x] 2.1 SettingsDialog：右栏按分区切换 overflow（model=hidden），删 `-m-4` 逃逸
- [x] 2.2 NewRouteTab：画廊去独立滚动容器
- [x] 2.3 ModelSettingsSection：tab 条 wheel 条件劫持
- [x] 2.4 vision 逐容器走查（桌面/窄窗 × 明暗）+ P3 顺带
      （走查全 PASS：tab 内容 = 唯一纵滚、画廊无独立滚、无横滚；视觉工具两条 a3
      异议经 DOM 实测驳回为幻觉；P3：TriggerMenu 选中行改 bg-primary/15、QueueDock
      行操作 24px 底座 + 扩张热区 + steer 禁用态；附带修走查发现的 P1——面板在
      WS 连接前打开触发 effect_update_depth_exceeded 无限环，AgentPanel 惰性加载
      effect 加连接状态闸 + 回归测试）

## C3 —— MCP v2 迁移

- [x] 3.1 依赖替换：sdk → server@2 + node 适配包（client 入 devDep 供对拍测试）
- [x] 3.2 skill-creator-mcp：registerTool 形状迁移（tools + resources）
- [x] 3.3 web-server /mcp：createMcpHandler + toNodeHandler（Bearer 前置不变）
- [x] 3.4 cli stdio：serveStdio 迁移
- [x] 3.5 测试：单测双纪元迁移 + dev 栈内核 mcp 连通实测
      （modern 纪元回归测试绿：v2 client auto 协商 2026-07-28 经真实 HTTP 走通
      tools/list + tools/call；dev 栈日志零协议错误，内核 94 entries 挂载）

## C4 —— DSH_HOME 隔离

- [x] 4.1 resolveDefaultDshHome 默认 app home（env 覆盖保留）+ 单测
- [x] 4.2 dev 栈隔离目录自举实测（内核挂载 + 模型路由桥写入点核对）
      （不设 DSH_HOME 启动：<dev-home>/.skill-creator/dsh-home 自举，内核正常）

## 收尾

- [x] 5.1 全量门禁（check 945/945 + build + pack dry-run 依赖面核对）
- [x] 5.2 spec 同步（agent-surface / dsh-runtime-integration）+ AGENTS.md
      词汇（$ 引用语义、MCP v2、DSH_HOME 默认）+ 归档 + 提交
