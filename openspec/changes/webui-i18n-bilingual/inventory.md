# webui-i18n-bilingual 文案面盘点表

分类口径（change design §1）：

- **A** = IA 基本不碰，本轮已适配（key 数 = 本 change 词典登记数）。
- **B** = IA 将重构，本轮禁改；列等待 IA 完成的检查点。
- **C** = IA 新增面，出生即 i18n（尚未存在）。
- **TBD** = 与 IA 耦合待裁决（本轮不动，原因见备注）。
- **SKIP** = shadcn-svelte 生成器属地，禁止手工改（AGENTS.md §6 物理隔离例外）。

词典事实：en/zh 各 **244 key**（编译期 `Record<keyof EnCatalog, string>` 强制齐全 +
运行时 key 集合相等测试双保险）；en 值与迁移前现网英文逐字节一致（既有测试全绿佐证）。

## 1. A 类（本轮已适配，22 个源文件 → 244 key）

| 文件                                        | key 域                  | key 数            | 测试锚点备注                                                                                                                                                      |
| ------------------------------------------- | ----------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/wiki/WikiHome.svelte`                 | wikiHome + common.retry | 13+1              | "Not initialized"、"~ global"、"fragments captured"、"Couldn't load wiki scopes" 均测试断言，en 逐字保留                                                          |
| `apps/wiki/WikiScopeView.svelte`            | wikiScope               | 60+2              | 蒸馏六态/七因全量；"Distill to global"、"awaiting approval"、"2 proposals ready for review" 等被 distill dom 测试断言                                             |
| `components/toast-container.svelte`         | toast                   | 1                 | 消息本体由调用方产生（A 类调用点已词典化；B 类调用点见 §2）                                                                                                       |
| `components/command-palette.svelte`         | palette                 | 13                | ⌘K 面板保留；与未来 omnibox 的耦合仅 placeholder/typeToSearch 两句，IA omnibox 落地时复用或改写 key                                                               |
| `components/agent/AgentPanel.svelte`        | agentPanel              | 4                 | aria "Agent panel" 被 resize 测试选择器依赖（en 保留）；新增 `data-agent-panel` 稳定锚点供 TranscriptView 编辑聚焦（locale 无关）                                 |
| `components/agent/AgentHeader.svelte`       | agentHeader             | 8                 | "New session" aria 测试断言                                                                                                                                       |
| `components/agent/AgentCard.svelte`         | agentCard               | 2                 | "Loading card…"/"Card unavailable: X" 测试断言                                                                                                                    |
| `components/agent/AgentApprovalCard.svelte` | agentApproval           | 7                 |                                                                                                                                                                   |
| `components/agent/AgentProposalCard.svelte` | agentProposal           | 7                 |                                                                                                                                                                   |
| `components/agent/AgentToolRow.svelte`      | agentTool               | 8                 | module 函数（todoSummaryOf/cardTitle）直调 t()                                                                                                                    |
| `components/agent/TodoDock.svelte`          | todoDock                | 2                 |                                                                                                                                                                   |
| `components/agent/QueueDock.svelte`         | queueDock               | 16                | "Queued messages"/"Queued"/"steer"/三个行操作 aria 均测试断言                                                                                                     |
| `components/agent/ContextMeter.svelte`      | contextMeter            | 12                |                                                                                                                                                                   |
| `components/agent/ComposerCard.svelte`      | composer                | 37+7              | textarea aria "Message"、附件双按钮 aria、mode chip aria 均测试断言                                                                                               |
| `components/agent/composer-keymap.ts`       | composer.placeholder*   | 4（并入上行的 7） | 占位符链；composer-keymap 测试断言 en 输出                                                                                                                        |
| `components/agent/TranscriptView.svelte`    | transcript              | 19                | 编辑聚焦选择器改 `aside[data-agent-panel]`（locale 无关）                                                                                                         |
| `components/agent/SlashMenu.svelte`         | slashMenu               | 9                 | "Commands"/"Skills" 组头测试断言；命令注册表 description 字段改为 descriptionKey（MessageKey）                                                                    |
| `components/agent/SkillMenu.svelte`         | skillMenu               | 9                 | **en 固定值锚点**：`typeToSearch`/`typeToSearchEmpty` 的 en 值 = 现网中文「输入关键词检索技能（…）」（skill-menu.test 断言该中文串；历史遗留，task 4.x 统一裁决） |
| `components/agent/ReferenceMenu.svelte`     | referenceMenu           | 8                 | 组头 Sessions/Files 数据行内 t()                                                                                                                                  |
| `components/agent/DropOverlay.svelte`       | dropOverlay             | 3                 |                                                                                                                                                                   |
| `components/agent/DisclosureRow.svelte`     | disclosureRow           | 1                 |                                                                                                                                                                   |
| `components/agent/ChipPaintLayer.svelte`    | chipPaint               | 2                 | 装饰层 tooltip                                                                                                                                                    |

基础设施文件（非文案面）：`lib/i18n/{index.ts, locale.svelte.ts, catalogs/{en,zh}.ts,
__tests__/i18n.test.ts}`、`lib/shell/device-prefs.ts`（language 字段最小扩展）+
`shell/__tests__/appearance.test.ts`（language 用例）。

不迁移的内容（by design）：数据驱动文本（workspace/skill/session label、模型 id、
provider id、counters key、session status 原文）、代码标识符（`/compact` 等命令
token、`$`/`@`/`/` 触发符）、daemon 透传错误原文（后端消息翻译 = task 4.5）。

## 2. B 类（IA 将重构，本轮禁改文案结构）

| 文件/面                                                                                                                                                                             | IA 动向                                                       | 检查点（IA 落定后）                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/shell/AppShell.svelte`、`TabOutlet.svelte`、`nav-controller.svelte.ts`、`components/shell/app-sidebar.svelte`、`components/window-drag-region.svelte`、`routes/+layout.svelte` | tab 栏 + 地址栏 + dashboard 平行化                            | 导航 aria（web-mode-smoke 断言 Workspaces/Creator/Repository）迁 `shell.*` 域；断言测试与词典同批更新                                                                                                                                           |
| `routes/+layout.svelte`（顶栏 Refresh/Agent 按钮 aria）                                                                                                                             | 顶栏重构                                                      | 同上                                                                                                                                                                                                                                            |
| `src/app.html`                                                                                                                                                                      | shell 属地                                                    | 不改（lang 由 i18n store 运行时同步，已生效）                                                                                                                                                                                                   |
| `apps/workspaces/**`（WorkspacesHome/ProviderView/IntelligenceView/finding-propose-templates）                                                                                      | → skills-dashboard（**已完成**，见 5.2）                      | **冒烟锚点已迁**：`dashboard.librarySnapshot` en 值逐字 `"{skills} skills across {providers} agent locations."`（Global 页脚 sr-only；web-mode-smoke 正则仍绿）；ProviderView 行内轻量编辑退役未迁移；IntelligenceView 本体文案仍为 B（后续批） |
| `apps/creator/**`（CreatorHome/CreatorWorkspace/manifest）                                                                                                                          | Creator AgentChat 化（**已完成**，见 5.4）                    | 整面文案随新形态重写后入词典（creatorHome/creatorChat/creatorEditor/creatorTabs 域）                                                                                                                                                            |
| `apps/repository/**`（RepositoryHome/RepositoryScan/manifest）                                                                                                                      | 迁入 dashboard（**已完成**，见 5.2 reposScreen/reposScan 域） | 扫描/安装状态文案族（AGENTS §7.2 可区分性要求）已随迁词典化；目录已删除                                                                                                                                                                         |
| `apps/settings/manifest.ts`                                                                                                                                                         | settings tab 化                                               | manifest 元数据文案 key 化                                                                                                                                                                                                                      |
| `components/creator/eval-view.svelte`                                                                                                                                               | → 独立 evaluating app                                         | 已迁移（2026-10-03 文件删除，转 C 类 5.3）                                                                                                                                                                                                      |
| `components/import-workspace-dialog.svelte`                                                                                                                                         | 挪顶栏                                                        | 随顶栏批迁移                                                                                                                                                                                                                                    |
| `components/creator/**` 其余（change-log/file-browser/markdown-editor/preview/sub-view-tabs/test-* /validation-view）                                                               | 随 Creator AgentChat 化                                       | sub-view-tabs 已随 5.4 词典化（creatorTabs 域）；change-log/file-browser/markdown-editor/preview/validation-view 的残留英文仍为 B（编辑页子视图，非本 change 的 AgentChat 面，后续小批收尾）                                                    |

toast 消息的 B 类调用点（repository/creator/workspaces 各 store 与组件）随各自批次
词典化；本轮这些 toast 仍输出英文原文（默认 locale 下无行为差异）。

## 3. TBD（本轮不动，待裁决）

| 文件/面                                                                                                                                             | 原因                                                                                                                                                                                                                                              |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/settings/SettingsPage.svelte` + `components/settings/**`（10 文件）                                                                           | 编排者分类段将 SettingsPage 内容文案标为 A 类，但「改动只限」穷举清单未列该文件且 settings 面正被 IA tab 化（manifest 为 B）。冲突按更严边界执行：**A-deferred**——IA settings 批落定后第一时间按 design §6 约定接入（建议 key 域 `settings.*`）。 |
| `apps/wiki/manifest.ts`（nav 标题 "Wiki"）                                                                                                          | nav 标签面归 IA tab 栏/导航重构；wiki app 视图本身是 A 类已适配，manifest 单独随导航批                                                                                                                                                            |
| `components/confirm-dialog.svelte`、`components/skill-card.svelte`、`components/source-card.svelte`、`components/self-skill-conflict-banner.svelte` | 主要消费方均为 B 类 App（workspaces/repository）；组件本身可能在 IA 后存活——IA 落定时按存活面归属 A 或随 App 批走                                                                                                                                 |

## 4. SKIP

| 文件/面                                      | 理由                                                                                                                                                                                                                                   |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `components/ui/**`（shadcn-svelte 生成原语） | 生成器属地，registry add/update 会覆盖手工改动（AGENTS.md §6 物理隔离例外）。原语内英文 a11y 文案（如 dialog close）经外围 wrapper/词典参数注入；当前 A 类面未发现必须改原语才能达到的文案（command/dialog 的 label 全部由调用方传入） |

## 5. C 类（IA 新增面，出生即 i18n）

dashboard、skills-dashboard、SkillsAgentPage、evaluating（eval-view 独立 app）、
terminal、omnibox——出生约定：第一 commit 起文案只写词典
（key 域按新 App 名）、组件零裸文案、测试断言走 en 事实源（design §6）。
已出生批次见下方 5.1-5.3。

### 5.1 已出生（skills-agent-page 2026-10-03）

| 面                                                                                                  | key 域                   | key 数（en=zh） | 备注                                                                                      |
| --------------------------------------------------------------------------------------------------- | ------------------------ | --------------- | ----------------------------------------------------------------------------------------- |
| `apps/agent/SkillsAgentPage.svelte`                                                                 | agentPage                | 8               | 布局壳工具钮/双开角标/树折叠 aria                                                         |
| `apps/agent/SessionTree.svelte`                                                                     | agentTree                | 13              | 分组树/续聊/新建带 target 选择；Unassigned 只读徽标                                       |
| `apps/agent/ExtensionPanel.svelte`                                                                  | extensionPanel           | 8               | panelTabs 三页（终端流/审批/卡片）                                                        |
| `components/agent/terminal/TerminalDock.svelte`、`TerminalPane.svelte`、`terminal-client.svelte.ts` | terminal                 | 14              | 多 tab/拖高/非 sandbox 首开提示（human-terminal spec「首开提示」场景）/limit 与错误 toast |
| `components/agent/AgentPanel.svelte`（workspace attach 化扩展）                                     | agentPanel（新增 4 key） | +4              | 双开角标/「在 Agent 页打开」深链/本 ws 会话空态                                           |

计数更新（本批 +47）：agentPage 8 + agentTree 13 + extensionPanel 8 + terminal 14

- agentPanel 新增 4（en=zh 齐全；i18n key 集合相等测试双保险）。

### 5.2 已出生（skills-dashboard 2026-10-03）

| 面                                                                 | key 域                      | key 数（en=zh） | 备注                                                                                                                |
| ------------------------------------------------------------------ | --------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------- |
| `apps/workspaces/SkillsDashboard.svelte` + `screens/*.svelte`      | dashboard（壳/切换器/页脚） | 15              | 库快照 sr-only 行 = web-mode 冒烟锚点（en 逐字 `"{skills} skills across {providers} agent locations."`，冒烟跑 en） |
| `screens/skills-screen.svelte`                                     | skillsScreen                | 23              | 平铺列表/搜索/chips/duplicates/load-more/master-detail 空态；sameContent 单复分支                                   |
| `screens/agents-screen.svelte`                                     | agentsScreen                | 9               | provider 卡片 + View findings（与 detail 面同链）                                                                   |
| `screens/repos-screen.svelte`（RepositoryHome 迁入）               | reposScreen                 | 25              | Discover feed/add/remove 源表单（B 类 repository 面随迁转 C）                                                       |
| `apps/workspaces/RepositoryScan.svelte`（迁移）                    | reposScan                   | 31              | pinned-clone 状态机/安装目标预填与 Global 引导/dry-run/汇总                                                         |
| `components/skills/skill-detail-panel.svelte`（抽自 ProviderView） | skillDetail                 | 27              | 只读文档 + 管理动作（toggle=唯一写）；name/description 行内轻量编辑退役未迁移                                       |

计数更新：skills-dashboard 批新增 **130 key**（en=zh；域计数见上表）。词典总
计数随并行批次（evaluating 等）动态增长，以 i18n.test 的 en=zh key 集合相等
断言为齐全性门，不在本表钉总数字。

### 5.3 已出生（evaluating-dashboard 2026-10-03）

| 面                                          | key 域     | key 数（en=zh） | 备注                                                                              |
| ------------------------------------------- | ---------- | --------------- | --------------------------------------------------------------------------------- |
| `apps/evaluating/EvaluatingOverview.svelte` | evaluating | 113（全域）     | 总览屏：技能卡五态徽标行/stale 黄标/相对时间/typed error 降级卡/load-more/空态    |
| `apps/evaluating/EvaluatingDetail.svelte`   | 同上       | （并入 113）    | 详情屏：三段路由身份/cases 表（R1-R3 revision 钉随迁）/失败断言展开/Global 只读门 |
| `apps/evaluating/run-confirm-dialog.svelte` | 同上       | （并入 113）    | Run 显式确认（三元组标注 + runner + case 勾选；禁自动运行）；toast 族             |
| `apps/evaluating/case-editor-dialog.svelte` | 同上       | （并入 113）    | case 新建/编辑（Imported-only）：五类断言编辑 + 前端校验 + 删除两步确认           |

计数更新：evaluating 批新增 **113 key**（en=zh；`evaluating.*` 单域）。`components/
creator/eval-view.svelte` 已删除（B 类行退役）——迁移源文案全部并入 evaluating 域。

### 5.4 已出生（creator-agent-chat 2026-10-03）

| 面                                                             | key 域                                          | key 数（en=zh） | 备注                                                                                      |
| -------------------------------------------------------------- | ----------------------------------------------- | --------------- | ----------------------------------------------------------------------------------------- |
| `apps/creator/CreatorHome.svelte`（重写：会话工作台 + 引导卡） | creatorHome                                     | 25              | capture 三输入/模板 seed 选项/Global 空态引导；会话行 Edit 深链 aria                      |
| `apps/creator/CreatorChat.svelte`（SessionFace 复用 + 护栏轨） | creatorChat                                     | 28              | 循环阶段 chip（提示性）/测试话术建议/草稿产出卡（Save via proposal）/双挂载拖放去重妥协面 |
| `apps/creator/CreatorWorkspace.svelte`（二级编辑页残留收编）   | creatorEditor                                   | 9               | 「View evaluation」硬编码 en 入词典（E 批遗留）+ 页头标题/复制 toast/非法 target          |
| `components/creator/sub-view-tabs.svelte`                      | creatorTabs                                     | 4               | file/history/preview/validate 四子视图标签                                                |
| `components/skills/skill-detail-panel.svelte`（Chat 入口实装） | skillDetail（chatSoon* 2 key 退役，+chatTitle） | +1/-2           | chatSoonTitle/chatSoonBadge 删除；chatTitle = Chat 入口 tooltip（resume 语义）            |
| `components/agent/ComposerCard.svelte`（1.7 底排重组，共用面） | （零新 key）                                    | 0               | 复用 composer.* 既有键；分组/胶囊纯结构改动                                               |

计数更新：creator-agent-chat 批新增 **66 key**（creatorHome 25 + creatorChat 28

- creatorEditor 9 + creatorTabs 4；en=zh；skillDetail 净 -1：+chatTitle/-chatSoon×2）。
  B 类 creator 面标记完成（apps/creator/** 全量 + sub-view-tabs）；components/creator
  其余子视图残留文案仍为 B，留后续小批。

## 6. 计数汇总

```text
A（已适配）  : 22 源文件 / 244 key（en=zh=244）
B（IA 禁改） : 10 个文件面（shell 族 / workspaces / creator / repository /
              settings manifest / eval-view / import-workspace-dialog / creator 组件族）
TBD          : 4 个裁决点（settings 内容文案、wiki manifest、4 个共享组件归属）
SKIP         : components/ui/**（生成器属地）
C（已出生）  : SkillsAgentPage + agentTree + extensionPanel + terminal +
              agentPanel 扩展 = +47 key（agentPage 8 + agentTree 13 +
              extensionPanel 8 + terminal 14 + agentPanel 4；en=zh；
              skills-agent-page 2026-10-03）
C（已出生）  : skills-dashboard = +130 key（dashboard 15 + skillsScreen 23 +
              agentsScreen 9 + reposScreen 25 + reposScan 31 + skillDetail 27；
              en=zh；skills-dashboard 2026-10-03）
C（已出生）  : evaluating = +113 key（evaluating.* 单域；en=zh；
              evaluating-dashboard 2026-10-03）
C（未出生）  : omnibox（shell 批）
```
