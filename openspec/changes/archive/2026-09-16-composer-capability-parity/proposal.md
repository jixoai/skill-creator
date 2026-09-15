# Proposal: composer-capability-parity

## Why

用户指示 [2026-09-15]：「我们的 Agent Chat 输入框的能力，最好 100% 复刻官方
webui 的输入框能力的实现。」

官方 spec 源已锁定：deepseek-ai/deepseek-harness tag `dsh-v0.1.6-alpha.1`
（commit 0a15e36e）的 packages/client——composer 不是单包，而是以 ui-conversation
（InputBar + 输入状态机 + Lexical 编辑器）为中心、ui-input-trigger（/ 与 @
触发管线）供弹层、ui-commands / ui-skill / ui-reference / ui-model-selection /
ui-permission-presets / ui-plan / ui-goal / ui-attachment / file-upload 贡献特性
座位的组合。完整能力矩阵已在调研报告中按 file:line 固化。

官方**没有**的能力（已核实，实现对齐 = 不做）：字符/token 计数器、上箭头输入
历史、语音输入、消息引用回复。

现状缺口（差异基线）：我们的 ComposerCard 是 textarea——无 IME 组合守卫（中文
输入真实缺口：合成中的 Enter 会误提交）、无芯片引用模型、无 queue/steer 双模
提交、无忙碌 Enter 偏好、无乐观回显、无发送失败恢复、无按会话草稿持久化、
技能触发符是 `$` 而非官方 `/`、无 `@` 文件引用与目录下钻、附件无 DnD 覆盖层
与上传门控。

## What Changes

按官方能力矩阵分四波落地（Svelte 5 实现，能力 100% 对齐，技术底座按本仓栈适配）：

- **W1 编辑器内核**：富文本面（contenteditable + 芯片模型，对齐官方 Lexical
  语义：clipboard/detect 双投影、占位符字符消毒、发送后 undo 切断）；IME 守卫
  （isComposing + keyCode 229 + compositionend 后 10ms 窗口）；键位表（Shift+Enter
  无条件换行、Enter repeat 守卫、菜单仲裁）；粘贴（文本消毒 + 文件路由）。
- **W2 附件面**：intake 预检 + 服务端限额投影（整批拒绝语义）；拖放 DnD 全窗
  覆盖层（嵌套深度计数）；发送门控（uploading/failed 都拦）；纯附件发送；
  失败恢复（草稿按提交序还原、附件回队头）。路径通道沿用 daemon fs 语义，
  不引入浏览器式 staged receipt（差异记录于 design）。
- **W3 触发管线**：`/` 命令（claim 状态机 + popup/action/host 三类）+ `/` 技能
  （纯文本 `/name ` + 词法装饰 + 点击预览，服务端注入决定论）；`@` 引用（文件/
  会话芯片、目录下钻 + 面包屑、带引号路径）；`+` 编程式启动器。技能触发符
  `$` → `/` 对齐官方。
- **W4 提交与会话面**：queue/steer 双模 + 忙碌 Enter 偏好（持久设置）；乐观
  回显 + 撤退休止；QueueDock（编辑/移除/插话）；按会话草稿持久化 + 换轨携带；
  停止语义（queue 存活 FIFO 续跑）；占位符/禁用/阻塞状态矩阵。

每波交付后独立 vision 子代理走查（Owner 要求：每阶段独立走查）。

## Non-Goals

- 不移植 React/Lexical 本体——Svelte 5 等价实现，语义对齐矩阵为准。
- 不做官方也没有的四能力（计数器/历史/语音/引用回复）。
- 附件传输不采用浏览器 receipt 协议（产品是 daemon fs 桌面面，路径 + 服务端
  containment 已有安全边界）；差异在 design 记录。
- 权限座位适配为产品 proposal-authority 语义，不复刻官方 Full-Access 预设。
- `/plan` `/goal` 命令是否引入按官方命令目录裁剪后定（design 决定映射）。

## Impact

- specs：agent-surface（composer 能力面新增 requirements）。
- 依赖：可能新增 Lexical 家族包（若采用）——W1 设计决策。
- 风险：contenteditable 迁移是最重的单点（现 textarea 全量行为要平移）；
  以 W1 先行 + 每波聚焦测试钉住。
- 顺序：依赖 dsh-alpha-native-subagents 升级先行（queue/steer 语义按升级后
  内核会话 inbox 能力定形）。
