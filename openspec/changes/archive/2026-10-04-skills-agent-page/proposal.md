# Proposal: skills-agent-page — Agent 工作台（ZCode 布局 × dsh 内核）+ per-workspace AgentPanel

## Why

Owner 裁决（grill Q3/Q8/Q9/Q14/Q15/Q16）：SkillsAgentPage 是**固定不可关闭**的
tabPage——「布局用 zcode，Chat 和内核用 dsh，将 zcode 和 dsh 做完全地融合」：
左侧 workspaces + sessions 树、主体 Chat、主体右侧扩展面板（panelTab）、主体
下侧**人类终端**（独立 PTY，不对接 dsh）。会话**一份真相**（dsh 内核会话），
Agent 页是全局会话管理器；per-workspace AgentPanel 附加到 SkillsWorkspacePage，
可远程连接到任一 session（ZCode 移动端远程控制语义：多面一真相）。

## What Changes

- **SkillsAgentPage 实体化**（替换 shell-page-tabs 的占位）：
  - 左栏：workspaces 分组 + sessions 树（会话列表按 ws 过滤/续聊/新建）；会话
    归属 = server 可验证的 Workspace.Provider target binding（Codex r1 P0：
    现契约仅 cwd/mode/seed，无归属）。
  - 中部 Chat：composer + transcript 迁移复用（AgentPanel 的会话面组件化）。
  - 右侧扩展面板：panelTab 结构——Agent 终端流（内核 tool-bash 执行视图）/
    proposal 审批面 / ui:// 卡片渲染。
  - 下侧终端：**人类 PTY**（node-pty + xterm.js，复刻 jixoai-labs/openspecui
    的 terminal-shell-profiles 实现；独立终端管理，会话生命周期 daemon 侧
    有界回收；不对接 dsh 插件）。addressBarActions 的 terminal/rightPanel
    启用（显隐切换）。
- **会话契约扩展**（Codex r1 P0 落地；r2 修订：越权边界补齐为完整契约）：
  `agent.session.create` 增可选 `target: { workspaceId, providerId? }` 持久
  归属——创建时 server 校验存在性、创建后**会话生命周期内不可变**；sessions
  list 投影按 target 分组；**server enforcement**：每次 proposal/工具写入在
  执行前验证目标落在会话 target 允许范围内，越权 typed 拒绝且无 proposal
  落库；Global target 会话禁止一切写入 proposal；无 target 旧会话可读可
  续聊但一律只读（mutation 类拒绝，不从 cwd 反推归属）。
- **per-workspace AgentPanel**：从 shell 级 drawer 迁移为 SkillsWorkspacePage
  内 attach 面（当前 ws 的会话列表 + 快速会话）；「在 Agent 页打开」连接同一
  session 深链；地址栏 agent action 改为开关本 ws Panel。
- **subagent 会话投影**（r2 修订：裁决定稿）：**不改 list 过滤语义**（现状
  origin=subagent 不入列，agent-sessions.ts:1281-1285 维持）；sessions 树中
  subagent 不作为独立可续聊会话，只以父会话节点下的 subagent 帧事件投影
  呈现（现有帧机制：spawn/descriptor/catalog/settlement）。

## Impact

- daemon：agent-sessions 契约扩展（target binding + list 投影分组）+ 写入
  路径越权校验层（mcp *_propose 链 + 内核工具面 guard）；terminal PTY 域
  （新：专用 `/ws/terminal` 端点 + create/write/resize/exit/list 协议 +
  生命周期回收，r2 修订定稿）。
- webui：SkillsAgentPage 实体、AgentPanel 重构迁移、扩展面板 panelTab 组件、
  xterm 集成。
- 安全：PTY 进程 daemon-owned（cwd 限定用户 home 或所选 ws root；**如实
  声明非 sandbox——PTY 以 daemon 用户本地权限运行**，r2 修订）；并发/缓冲/
  回收全有界；会话 target binding 破坏性扩展（无兼容，旧会话无 target 投影
  为「未归属（只读）」组）。
- i18n：C 类面出生即双语。
