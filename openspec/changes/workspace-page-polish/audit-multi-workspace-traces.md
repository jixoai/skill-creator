# Multi-Workspace 痕迹走查（audit-multi-workspace-traces）

- 日期：2026-10-04；走查人：IA 走查子代理。
- 基线：HEAD ad3cccf（走查只读，未改任何产品文件；工作树中 evaluation 相关修改为并行任务所有，与本报告无关）。
- 背景：IA 重构后模型 = 每 tab 一个 workspace（tab 切换 ws），页面只服务当前 ws；跨 ws 管理收归顶栏。本清单盘点残留的 Multi-Workspaces 设计痕迹。
- 方法：静态审查（读码）+ 动态走查（沙箱 daemon + ego-browser）。动态证据全部来自 DOM 程序化取值（querySelector/innerText），非视觉判读；截图存档于 `/tmp/ia-redesign/screens-traces/`。
- 判定基准：违规 = 页面内出现其他 ws 的数据/入口/列表/切换器；合理 = 顶栏 tab 栏/＋菜单/右键、omnibox ws 补全（全局地址栏语义）、Agent 页 sessions 树 ws 分组（任务 A 域）、Global 页脚 ws 管理区（既有裁决，另列建议）。

## 1. 痕迹清单

### 1.1 违规（建议本轮处置）

| # | 位置 | 内容 | 出现 tab | 判定 | 处置建议 |
|---|------|------|----------|------|----------|
| V1 | `webui/src/lib/apps/wiki/WikiScopeView.svelte:249`（`goto("/wiki")`） | wiki 页「Back to wiki scopes」按钮指向已退役的全局路由 `/wiki` | 所有 ws 的 Wiki 页 | **违规**（动态实证：Alpha wiki 点返回 → `/wiki` 无路由 → route-hygiene 兜底改写为 `/w/~/wiki` → 用户被切到 **Global** 的 wiki） | 移除该返回按钮（wiki 已无 scope 索引上级），或改为返回当前 ws 的 skills/导航；同源死代码见 D1 |
| V2 | `webui/src/lib/shell/commands.ts:7,13,19,25,31` | `SHELL_COMMANDS` 五条 ws 作用域命令（skills/creator/wiki/evaluating/repository）全部硬编码 `/w/~/...` | 全局面：⌘K palette Navigate 组 + omnibox `>` 命令模式；**从 Alpha tab 执行「Creator」= 跳去 Global tab 的 creator** | **违规**（跨 ws 目的地；palette/omnibox 属全局浮层，但命令目的地应随当前 tab——同文件 pathSuggestions 已正确用 `currentWorkspaceId()`，SHELL_COMMANDS 是漏网） | 执行时解析 active tab 的 wsId 生成相对目的地；「Repository」一级导航已退役却仍在 palette，一并裁决 |
| V3 | `webui/src/lib/apps/creator/CreatorHome.svelte:100-102,163-177` | Global 空态列出**全部 Imported ws** 按钮（label + 原始 id）跳转各 ws creator | 仅 Global tab 的 Creator 页 | 边界偏违规（页内跨 ws 切换器，与顶栏职能重复） | 收敛为文案引导（「从顶栏 tab/＋菜单打开或导入 workspace」），移除页内 ws 列表；或与 R4 统一裁决 |
| V4 | `webui/src/lib/apps/workspaces/RepositoryScan.svelte:104,106-117,437-444` | 安装目标多选 = `writableWorkspaceProviders()` 全量（所有 Imported ws 的 providers）；Imported tab 预填当前 ws 但仍可勾选其他 ws；Global tab 引导「Pick one below」全列表 | 所有 tab 的 repos scan 实例 | 边界（页面级跨 ws 写入口） | Imported tab 上收敛为仅当前 ws providers（跨 ws 安装走各自 tab 发起）；Global tab 的列表引导同 V3 收归顶栏 |
| V5 | `webui/src/lib/components/agent/SkillMenu.svelte:123-149`；i18n `skillMenu.acrossWorkspaces`（en:326） | composer `$` 技能引用 = `skills.search` 跨 ws 全量，installations 全展开，组头 = `Workspace label / provider label` | Agent 页、Creator Chat、workspace attach 面板（所有 tab 的页面内） | 边界（引用语义可主张全局能力，但 UI 在页面内展示其他 ws 数据并可直接引用） | Owner 裁决：默认限当前 ws + 显式「search all workspaces」展开；或保留（全局引用是既有产品裁决 2026-09-16） |

### 1.2 合理域（记录，不处置）

| # | 位置 | 内容 | 出现 | 判定 |
|---|------|------|------|------|
| R1 | `webui/src/lib/shell/Omnibox.svelte:124-136,167-173,175-195` | omnibox ws 补全（label 前缀匹配→跳该 ws）+ 技能补全（跨 ws installations，label 显示**原始 ws id** `ws_2762…/amp`，走查实证） | 全局地址栏 | 合理（全局地址栏语义）。附注：label 用原始 ws id 不友好，建议改 ws label |
| R2 | `webui/src/lib/components/command-palette.svelte:167-234` | ⌘K palette：Workspaces 组（全量 ws）+ Skills 跨 ws 分组检索 | 全局浮层 | 合理（全局命令面板语义）。附注：与 omnibox、tab＋菜单三处切换入口重叠；且 Navigate 组受 V2 硬编码影响 |
| R3 | `webui/src/lib/shell/TabStrip.svelte`（tab 栏 / ＋菜单 / tab 右键 Copy path / Remove workspace…） | 跨 ws 管理唯一应许域 | 顶栏 | 合理（本轮基准） |
| R4 | `webui/src/lib/apps/workspaces/screens/dashboard-footer.svelte:108-145`（仅 `wsId === "~"` 挂载，`skills-screen.svelte:559-562` 闸） | Global 页脚「Imported workspaces」区：列出全部 Imported ws + 计数 + Remove 按钮 | 仅 Global tab 的 skills 屏 | 既有裁决 = Global 管理中枢（AGENTS §7.2 Remove 可达性由页脚承担）。**建议供 Owner 裁决**：tab 右键已有 Remove workspace…（`TabStrip.svelte:253`），两个 Remove 入口并存；可收敛——页脚保留库快照 + health check + self-skill banner，ws 管理（列表/Remove）收归顶栏，或页脚只留只读计数。若采纳，需同步处理 R5 冒烟锚点 |
| R5 | `dashboard-footer.svelte:26-41,76-104`；i18n `dashboard.librarySnapshot`（en:507「{skills} skills across {providers} agent locations.」）/ `dashboard.snapshotCounts` | 库快照行跨**全部** ws 聚合计数（沙箱实测「109 skills · 225 locations」） | 仅 Global tab | 合理（管理中枢摘要）。附注：多 ws 时代文案；providers 数按 provider 目录投影计（见 O1），「225 agent locations」含大量 Not-found 目录，数字水分大 |
| R6 | `webui/src/lib/apps/agent/SessionTree.svelte:51-53,66-73` | Agent 页 sessions 树按 ws 分组（动态实证：Global Workspace / Alpha Lab / Beta Studio / Unassigned read-only）+ 新建会话 target 选择器（可跨 ws / 无 target） | `/agent` 固定页 | **任务 A 域**（Owner 已裁决按 ZCode 1:1 重构：左栏无 ws 分组，会话列表+工具标签）。只标记不处置 |

### 1.3 死代码 / 孤儿（多 ws 时代残留，建议清理）

| # | 位置 | 内容 | 判定 |
|---|------|------|------|
| D1 | `webui/src/lib/apps/wiki/WikiHome.svelte`（全文件） | 老 `/wiki` scope 索引（Global 卡 + 各 ws 卡 = 典型多 ws 同屏设计）；manifest 只挂 WikiScopeView，无任何路由引用 | 死代码，删除（V1 的返回按钮即指向它） |
| D2 | `webui/src/lib/shell/EvaluatingPage.svelte` | 老 Evaluating stub（"being prepared for {workspaceId}"）；manifest 挂的是 EvaluatingOverview | 死代码，删除 |
| D3 | `webui/src/lib/components/shell/app-sidebar.svelte` | 老左侧 AppSidebar（含 import 入口）；layout 已改挂 TabStrip + WorkspaceNavigation，组件无引用 | 死代码，删除；`DevicePrefs.sidebarCollapsed` 偏好键（`appearance.svelte.ts`）同族残留，另行裁决 |

### 1.4 stores 层数据面（按 ws 过滤情况）

| 面 | 位置 | 作用域 | 判定 |
|----|------|--------|------|
| dashboard 技能列表 | `stores/dashboard-skills.svelte.ts` → `skills.listWorkspace({wsId,…})` | 服务端 per-ws | ✓ 正确 |
| dashboard 检索补全 | `skills-screen.svelte:150-154`（scopedSearchResults 按 installations 过滤当前 ws） | 全局 RPC + 前端 ws 过滤 | ✓ 消费侧已上下文化 |
| 内容重复组 | `stores/skills.svelte.ts:281-313` → `skills.duplicates({})` | **跨 ws 全局 RPC**（索引 contentHash 分组，设计如此） | 边界：skills 屏「Duplicates load all」后，行内 same-content 计数切换为跨 ws 计数（本屏出现其他 ws 的重复情报） |
| 评估总览 | `stores/evaluation-view.svelte.ts:215,249` → `evaluation.overview({wsId})` | 服务端 per-ws（`EvaluatingOverview.svelte:114` 前端再过滤为防御） | ✓ 正确 |
| agent 会话列表 | `stores/agent.svelte.ts:333-356` → `agent.sessions.list({})` | **全量拉取**，前端分组/过滤（SessionTree 按 ws 分组；CreatorHome `creatorSessionsForWorkspace` 前端滤） | 任务 A 域（无 per-ws RPC；ZCode 1:1 重构时一并裁决） |
| wiki | `stores/wiki.svelte.ts`（loadWiki(scope) / loadWikiScopes） | per-scope；loadWikiScopes 仅死代码 WikiHome 消费 | ✓（scopes 面随 D1 删除） |

### 1.5 文案层（多 ws 语义文案）

| 文案 | 键/位置 | 出现面 |
|------|---------|--------|
| 「{skills} skills across {providers} agent locations.」 | `dashboard.librarySnapshot`（en:507；web-mode 冒烟锚点 en 逐字，`test/web-mode-smoke.test.ts`） | Global 页脚 sr-only |
| 「Imported workspaces」 | `dashboard.importedWorkspaces`（en:512） | Global 页脚区块标题 |
| 「Skills — across workspaces」/「Skills across workspaces」 | `skillMenu.menuAria` / `skillMenu.acrossWorkspaces`（en:324/326） | composer `$` 菜单（V5） |
| 「Search navigation, workspaces and skills…」/「Type to search skills across workspaces…」 | `palette.placeholder` / `palette.typeToSearch`（en:108/117） | ⌘K palette（R2） |
| 「You are on the Global tab — installs target imported workspaces. Pick one below.」 | `reposScan.globalHint`（en:609） | repos scan（V4） |
| 「Create skills in an imported workspace / …Switch to an imported workspace…」 | `creatorHome.globalTitle/globalBody/globalNone`（en:677-681） | Global Creator 空态（V3） |

## 2. 动态走查记录

沙箱：`/tmp/ia-redesign/e2e-home`（HOME/SKILL_CREATOR_HOME/SKILL_WIKI_HOME/OPENTRAY_HOME 均指向沙箱，`SKILL_CREATOR_DISABLE_TRAY=1`，`pnpm dev`，vite `localhost:5173`）。种子：Alpha Lab（`.agents/skills` 3 技能 + `.claude/skills` 1）、Beta Studio（`.agents/skills` 2 + `.claude/skills` 1）。全部事实经 DOM 程序化取值：

- Global tab：页脚「Imported workspaces」= Alpha Lab 4 / Beta Studio 3 + Remove；快照行「109 skills · 225 locations」（01）。
- Alpha tab：DashboardFooter 未挂载（页内出现的 `<footer>` 为 SourceCard 自有元素，非页脚）；provider chips 76 个（02）；Agents 屏 75 张 provider 卡，同一物理目录 `/ws-alpha/.agents/skills` 被 Amp/Antigravity/Antigravity CLI/Cline/Codex/Cursor/Deep Agents/Dexto 等多卡重复计数（03）；repos 屏为全局源 feed（04）；creator（05）/wiki（06）/evaluating（07）均无页内 ws 切换元素。
- Beta tab：无页脚（08）。
- Agent 页：sessions 树 ws 分组 + Unassigned 只读组（09）（任务 A 域）。
- Omnibox（Beta tab 上）：输「al」→ 补全「Alpha Lab」+ 8 条 **Alpha** 技能行（原始 ws id label）；输「beta」→ Beta 行（10/11）（R1）。
- Global Creator 空态：Alpha Lab / Beta Studio 两按钮 + 原始 id（12）（V3）。
- Global wiki / wiki 返回按钮：Alpha wiki 点「Back to wiki scopes」→ URL 落 `/w/~/wiki`（Global wiki）——跨 ws 跳转实证（13/15）（V1）。
- ⌘K palette（Alpha tab 上）：Navigate 组含已退役「Repository」；Workspaces 组；Skills 组按「Alpha Lab / Amp…」跨 provider 分组（14）（R2+V2）。
- Settings（16）：General/Model/Agent/Sessions，无跨 ws 元素。

### 截图清单（`/tmp/ia-redesign/screens-traces/`，16 张，均 1932×1109 非平凡）

01-global-skills / 02-alpha-skills / 03-alpha-agents / 04-alpha-repos / 05-alpha-creator / 06-alpha-wiki / 07-alpha-evaluating / 08-beta-skills / 09-agent-page / 10-omnibox-completions / 11-omnibox-skill-crossws / 12-global-creator / 13-global-wiki / 14-palette / 15-wiki-back-dead-route / 16-settings

### Console 错误

0（CDP Runtime.consoleAPICalled / Log.entryAdded / exceptionThrown 全程监听，error+warning 均为 0）。

## 3. 附带观察（非多 ws，供参考）

- O1 Agents 屏 provider 目录投影：76 个社区 agent 根全部投影进每个 ws；同一物理 `.agents/skills` 被 ~10 个 provider 卡重复计数（Alpha「All 58」实际 3-4 个物理技能）。同 ws 内数据失真，直接拖累 R5「N agent locations」文案可信度。建议独立立项（catalog 投影去重）。
- O2 Settings 直达 `goto('/settings')` 出现 hydration 空屏，in-app 导航正常——dev 模式现象，另行跟踪。

## 4. 进程回收证据

- 沙箱 dev daemon：后台任务 `exec_bd640dd6` 经 TaskStop 终止；dev 日志尾部 `[daemon] received SIGTERM — stopping daemon`；`lsof :49501/:5173` 无监听残留。
- ego-browser：taskSpace(90) 内 p1 关闭，`finish({ keep: [] })` 收据 `closedManagedLabels: []`。
- 未触碰：Owner 的生产实例 `dist/daemon.js`（PID 64125，11:51 启动，真实 home）与并行任务的 evaluation 文件修改。

## 5. 建议的处置优先级

1. **V1 + D1/D2/D3**（死路由跳 Global + 三个死文件）——零风险清理。
2. **V2**（SHELL_COMMANDS 相对化 + Repository 条目裁决）——一次小改，消除 palette/omnibox 的跨 ws 跳转。
3. **V3/V4**（页内 ws 列表收敛顶栏）——与 R4 的 Global 页脚收纳裁决**合并为同一个 Owner 决策**（「Global 管理中枢保留多少页内 ws 管理」）。
4. **V5**（$ 菜单作用域）——单独 Owner 裁决（引用语义 vs 页面作用域）。
5. R6 归任务 A；O1 独立立项。
