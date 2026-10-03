# Proposal: shell-page-tabs — workspace 平行化地基（Page 级 tab + omnibox 地址栏）

## Why

Owner 裁决（2026-10-03，逐字保真于 grill 四轮 17 题）：「目前 workspace 的概念
的存在导致管理起来非常费劲。我希望我 workspace 组成一个平行的概念：参考浏览器
的设计，最顶部这一栏变成标签栏」。经 Codex r1 联审（7.6/10，/tmp/ia-redesign/
codex-r1-full2.txt）与 Owner 四轮拍板，终局模型为 **tab = Page 级容器**（高于
左导航一层）：顶部 tab 栏承载异构 Page，第二行 omnibox 地址栏承载 Page 的路由
状态。本 change 是全部 IA 重构（skills-dashboard / skills-agent-page /
creator-agent-chat / evaluating-dashboard）的地基。

## What Changes

- **Page 类型模型**：tab 栏承载三类 Page——
  - `SkillsWorkspacePage`（`/w/:wsId/*`）：Global（`~`）为**固定不可关闭**的第
    一个 tab；每个 Imported Workspace 恰一个 tab（可关闭，关闭 ≠ remove
    workspace）。内含左侧导航（Skills / Creator / Wiki / Evaluating）与内容区。
  - `SkillsAgentPage`（`/agent/*`）：**固定不可关闭**（中枢管理器唯一性）。
    本 change 仅占位空态（实体归 skills-agent-page change）。
  - `SettingsPage`（`/settings/:section?`）：按需开启的 tab；右上角 settings
    按钮入口；addressBarActions = theme-toggle（lang-select 待 i18n 后批）。
- **tab strip**（第一行，~36px，兼窗口拖拽区）：tab = workspace 图标 + label
  +（Imported 才有）关闭 ×；胶囊形态；溢出横滚；`＋` 专注创建 workspace
  （导入/切到已导入）；关闭 tab 与 Remove Workspace 是两个动作（后者在 tab
  管理菜单）。
- **omnibox 地址栏**（第二行，~36px）：非聚焦态显示当前 Page 的真实 URL
  （`skill-creator://` scheme + path，如 `skill-creator://w/proj-a/skills`）；
  聚焦/⌘L 进入编辑，支持粘贴与补全（页面路由、workspace 切换、技能直达）；
  `> ` 前缀进入命令模式（与 CommandPalette **内核合并、表面分开**——共享
  命令注册表，⌘K 面板保留）。inline-end actions 按 Page 配置：
  SkillsWorkspacePage = agent（现 shell drawer AgentPanel，后续 change 迁移）；
  SkillsAgentPage = terminal + rightPanel（占位）；SettingsPage = theme-toggle。
- **每 tab 独立路由历史（app-owned 栈）**：每 tab 自持页面栈（entries+cursor，
  持久化）；应用内导航 push 入栈、Back/Forward 移动指针（omnibox 行左端导航
  钮 + ⌘[/⌘]）；浏览器 history 深度恒定（全部 replaceState）——从根上消灭
  跨 tab 串线；切回 tab 恢复栈顶。
- **tab session 持久化**：独立版本化存储（localStorage key
  `skill-creator.tabs.v1`，schema 带 version）：打开的 ws tabs、顺序、每 tab
  当前 route；刷新恢复；workspace 被移除后其恢复记录清理（恢复面对不存在
  workspace 时静默丢弃该 tab）。不进 DevicePrefs（Codex A3：生命周期不同）。
- **route registry 重构**：AppManifest absolutePattern 改造——skills 区块挂
  `/w/:wsId/skills*`、creator `/w/:wsId/creator*`、wiki `/w/:wsId/wiki*`、
  evaluating `/w/:wsId/evaluating*`（占位空态）；agent `/agent*`、settings
  `/settings*` 为 Page 级 app。旧路由（`/workspaces*` `/creator*` `/wiki*`
  `/repository*`）replace-redirect 到新 canonical（入口迁移语义，非兼容层；
  repository 重定向目标暂为 `/w/~/skills`，dashboard 落地后更新）。
- **冒烟锚点随迁**：WorkspacesHome 的 sr-only 行（`skills across \d+ agent
  locations`，test/web-mode-smoke.test.ts 断言）保持 en 逐字不变，迁移到新
  Global tab 的过渡挂载点（c062db3 教训）。
- **过渡策略**：本 change 内容区复用现有视图组件（ProviderView/Wiki 两视图/
  CreatorWorkspace 照旧挂载，仅路由前缀与导航壳变化）；dashboard、AgentChat、
  evaluating 实体由后续 change 替换内容。WorkspacesHome 退役为 Global tab 的
  skills 默认屏过渡挂载（其库快照/self-skill banner 保留至 skills-dashboard）。
- **窄屏/平台**：macOS traffic lights 与 Windows caption 几何让位（复用
  WindowDragRegion 的平台处理）；<720px tab 横滚、actions 收溢出菜单、左导航
  沿用现 drawer 语义。

## Impact

- **重写**：`webui/src/lib/shell/`（TabOutlet→PageOutlet、AppShell、新增
  tab-strip / omnibox / page-registry 组件）、五个 app manifest 的
  absolutePattern、`routes/[...catch]` 承载、nav-controller。
- **新增**：tab session store、omnibox 补全内核（与 command-palette 共享命令
  注册表）、redirect 表。
- **测试**：path-pattern / match / route-hygiene 三套测试重写；tab session
  持久化往返测试；redirect 表测试；web-mode-smoke 锚点迁移验证。
- **契约零变更**（daemon RPC 不动；workspace.* 现有过程直接消费）。
- **安全不变量**：Global 写闸、opaque ID、latest-request-wins 全部沿既有
  语义（视图组件未换，仅挂载壳变化）。
