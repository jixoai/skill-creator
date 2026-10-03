# Tasks: skills-agent-page

- [x] 1.1 会话 target binding 契约 + daemon 校验（创建校验/不可变/无 target
      只读降级）+ 写入路径越权 enforcement（mcp *_propose 链 + 内核 guard）+
      list 分组投影（含旧会话 Unassigned 只读；server 单测覆盖设计 §6 六态）
- [x] 1.1b AgentSessionSummarySchema 投影扩展（target + seedSkill 直投影；
      现状 agent.ts:47 无此字段——UI 分组与 Creator 过滤的唯一合法数据面）
- [x] 1.2 SkillsAgentPage 布局壳（左树/Chat/右 panelTabs/下终端容器 + 三尺寸
      降级 + 显隐 DevicePrefs）
- [x] 1.3 左栏：workspaces+sessions 树（分组/续聊/新建；subagent 仅作父会话
      节点下帧事件投影，不改 list 过滤语义——r2 裁决）
- [x] 1.4 Chat 面组件化迁移（transcript/composer 自 AgentPanel 抽出复用）
- [x] 1.5 扩展面板 panelTabs（Agent 终端流/审批/卡片 + 自动切换与角标）
- [x] 1.6 PTY 终端（专用 /ws/terminal 端点 + typed JSON 协议 + 并发 ≤4 +
      10k 行环形缓冲 + stop/idle 有界回收 + 输出 batcher + xterm 前端 +
      多 tab + 拖高；首开非 sandbox 提示；开工前读 openspecui 参考实现）
- [x] 1.7 per-workspace AgentPanel 迁移（attach 到 WorkspacePage + 同 session
      双开角标 + 「在 Agent 页打开」深链；shell drawer 退役）
- [x] 1.8 addressBarActions terminal/rightPanel 启用
- [x] 1.9 i18n：完成时在 webui-i18n-bilingual 的 inventory.md 标记对应 C 类
      面完成并双语适配（唯一帐本 = 该 change）
- [x] 1.10 验证门：全量绿 + webui check + ego-browser（布局/终端/双开/深链）+ vision 验收 + PTY 进程回收证据（stop 后零孤儿进程）
