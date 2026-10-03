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

| 文件 | key 域 | key 数 | 测试锚点备注 |
| --- | --- | --- | --- |
| `apps/wiki/WikiHome.svelte` | wikiHome + common.retry | 13+1 | "Not initialized"、"~ global"、"fragments captured"、"Couldn't load wiki scopes" 均测试断言，en 逐字保留 |
| `apps/wiki/WikiScopeView.svelte` | wikiScope | 60+2 | 蒸馏六态/七因全量；"Distill to global"、"awaiting approval"、"2 proposals ready for review" 等被 distill dom 测试断言 |
| `components/toast-container.svelte` | toast | 1 | 消息本体由调用方产生（A 类调用点已词典化；B 类调用点见 §2） |
| `components/command-palette.svelte` | palette | 13 | ⌘K 面板保留；与未来 omnibox 的耦合仅 placeholder/typeToSearch 两句，IA omnibox 落地时复用或改写 key |
| `components/agent/AgentPanel.svelte` | agentPanel | 4 | aria "Agent panel" 被 resize 测试选择器依赖（en 保留）；新增 `data-agent-panel` 稳定锚点供 TranscriptView 编辑聚焦（locale 无关） |
| `components/agent/AgentHeader.svelte` | agentHeader | 8 | "New session" aria 测试断言 |
| `components/agent/AgentCard.svelte` | agentCard | 2 | "Loading card…"/"Card unavailable: X" 测试断言 |
| `components/agent/AgentApprovalCard.svelte` | agentApproval | 7 | |
| `components/agent/AgentProposalCard.svelte` | agentProposal | 7 | |
| `components/agent/AgentToolRow.svelte` | agentTool | 8 | module 函数（todoSummaryOf/cardTitle）直调 t() |
| `components/agent/TodoDock.svelte` | todoDock | 2 | |
| `components/agent/QueueDock.svelte` | queueDock | 16 | "Queued messages"/"Queued"/"steer"/三个行操作 aria 均测试断言 |
| `components/agent/ContextMeter.svelte` | contextMeter | 12 | |
| `components/agent/ComposerCard.svelte` | composer | 37+7 | textarea aria "Message"、附件双按钮 aria、mode chip aria 均测试断言 |
| `components/agent/composer-keymap.ts` | composer.placeholder* | 4（并入上行的 7） | 占位符链；composer-keymap 测试断言 en 输出 |
| `components/agent/TranscriptView.svelte` | transcript | 19 | 编辑聚焦选择器改 `aside[data-agent-panel]`（locale 无关） |
| `components/agent/SlashMenu.svelte` | slashMenu | 9 | "Commands"/"Skills" 组头测试断言；命令注册表 description 字段改为 descriptionKey（MessageKey） |
| `components/agent/SkillMenu.svelte` | skillMenu | 9 | **en 固定值锚点**：`typeToSearch`/`typeToSearchEmpty` 的 en 值 = 现网中文「输入关键词检索技能（…）」（skill-menu.test 断言该中文串；历史遗留，task 4.x 统一裁决） |
| `components/agent/ReferenceMenu.svelte` | referenceMenu | 8 | 组头 Sessions/Files 数据行内 t() |
| `components/agent/DropOverlay.svelte` | dropOverlay | 3 | |
| `components/agent/DisclosureRow.svelte` | disclosureRow | 1 | |
| `components/agent/ChipPaintLayer.svelte` | chipPaint | 2 | 装饰层 tooltip |

基础设施文件（非文案面）：`lib/i18n/{index.ts, locale.svelte.ts, catalogs/{en,zh}.ts,
__tests__/i18n.test.ts}`、`lib/shell/device-prefs.ts`（language 字段最小扩展）+
`shell/__tests__/appearance.test.ts`（language 用例）。

不迁移的内容（by design）：数据驱动文本（workspace/skill/session label、模型 id、
provider id、counters key、session status 原文）、代码标识符（`/compact` 等命令
token、`$`/`@`/`/` 触发符）、daemon 透传错误原文（后端消息翻译 = task 4.5）。

## 2. B 类（IA 将重构，本轮禁改文案结构）

| 文件/面 | IA 动向 | 检查点（IA 落定后） |
| --- | --- | --- |
| `lib/shell/AppShell.svelte`、`TabOutlet.svelte`、`nav-controller.svelte.ts`、`components/shell/app-sidebar.svelte`、`components/window-drag-region.svelte`、`routes/+layout.svelte` | tab 栏 + 地址栏 + dashboard 平行化 | 导航 aria（web-mode-smoke 断言 Workspaces/Creator/Repository）迁 `shell.*` 域；断言测试与词典同批更新 |
| `routes/+layout.svelte`（顶栏 Refresh/Agent 按钮 aria） | 顶栏重构 | 同上 |
| `src/app.html` | shell 属地 | 不改（lang 由 i18n store 运行时同步，已生效） |
| `apps/workspaces/**`（WorkspacesHome/ProviderView/IntelligenceView/finding-propose-templates） | → skills-dashboard | **冒烟锚点**：`skills across {n} agent locations`（web-mode-smoke 正则断言）迁词典时 en 值逐字保留 |
| `apps/creator/**`（CreatorHome/CreatorWorkspace/manifest） | Creator AgentChat 化 | 整面文案随新形态重写后入词典 |
| `apps/repository/**`（RepositoryHome/RepositoryScan/manifest） | 迁入 dashboard | 扫描/安装状态文案族（AGENTS §7.2 可区分性要求）随迁 |
| `apps/settings/manifest.ts` | settings tab 化 | manifest 元数据文案 key 化 |
| `components/creator/eval-view.svelte` | → 独立 evaluating app | 随新 app 出生即 i18n（转 C 类） |
| `components/import-workspace-dialog.svelte` | 挪顶栏 | 随顶栏批迁移 |
| `components/creator/**` 其余（change-log/file-browser/markdown-editor/preview/sub-view-tabs/test-* /validation-view） | 随 Creator AgentChat 化 | 随 Creator 批迁移 |

toast 消息的 B 类调用点（repository/creator/workspaces 各 store 与组件）随各自批次
词典化；本轮这些 toast 仍输出英文原文（默认 locale 下无行为差异）。

## 3. TBD（本轮不动，待裁决）

| 文件/面 | 原因 |
| --- | --- |
| `apps/settings/SettingsPage.svelte` + `components/settings/**`（10 文件） | 编排者分类段将 SettingsPage 内容文案标为 A 类，但「改动只限」穷举清单未列该文件且 settings 面正被 IA tab 化（manifest 为 B）。冲突按更严边界执行：**A-deferred**——IA settings 批落定后第一时间按 design §6 约定接入（建议 key 域 `settings.*`）。 |
| `apps/wiki/manifest.ts`（nav 标题 "Wiki"） | nav 标签面归 IA tab 栏/导航重构；wiki app 视图本身是 A 类已适配，manifest 单独随导航批 |
| `components/confirm-dialog.svelte`、`components/skill-card.svelte`、`components/source-card.svelte`、`components/self-skill-conflict-banner.svelte` | 主要消费方均为 B 类 App（workspaces/repository）；组件本身可能在 IA 后存活——IA 落定时按存活面归属 A 或随 App 批走 |

## 4. SKIP

| 文件/面 | 理由 |
| --- | --- |
| `components/ui/**`（shadcn-svelte 生成原语） | 生成器属地，registry add/update 会覆盖手工改动（AGENTS.md §6 物理隔离例外）。原语内英文 a11y 文案（如 dialog close）经外围 wrapper/词典参数注入；当前 A 类面未发现必须改原语才能达到的文案（command/dialog 的 label 全部由调用方传入） |

## 5. C 类（IA 新增面，出生即 i18n）

dashboard、skills-dashboard、SkillsAgentPage、evaluating（eval-view 独立 app）、
terminal、omnibox——均尚未存在。出生约定：第一 commit 起文案只写词典
（key 域按新 App 名）、组件零裸文案、测试断言走 en 事实源（design §6）。

## 6. 计数汇总

```text
A（已适配）  : 22 源文件 / 244 key（en=zh=244）
B（IA 禁改） : 10 个文件面（shell 族 / workspaces / creator / repository /
              settings manifest / eval-view / import-workspace-dialog / creator 组件族）
TBD          : 4 个裁决点（settings 内容文案、wiki manifest、4 个共享组件归属）
SKIP         : components/ui/**（生成器属地）
C（未出生）  : dashboard / skills-dashboard / SkillsAgentPage / evaluating /
              terminal / omnibox
```
