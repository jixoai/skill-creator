# Design: webui-i18n-bilingual

## 0. 目标与非目标

目标：

1. WebUI 用户可见文案中/英双语，默认 `en`。
2. 语言偏好持久化到 DevicePrefs（设备偏好，同 theme/sidebarCollapsed 先例）。
3. 动态切换语言不刷新页面（Svelte 5 runes 细粒度更新）。
4. `document.documentElement.lang` 与 locale 同步（a11y / 语音朗读正确换语）。
5. 三线协同：A 类本轮适配；B 类（IA 重构面）等 IA 落定后按本设计约定接入；
   C 类（IA 新增面）出生即消费本基建。

非目标：

- 不做 SSR 文案面（webui `+layout.ts` 已 `ssr = false; prerender = false`，
  纯 SPA，无服务端文案渲染）。
- 不做日期/数字本地化格式、RTL、ICU MessageFormat 完整复数规则（当前文案
  复数仅 fragment/proposal/todo 三处，组件侧单复分支即可覆盖；zh 无复数形）。
- 不改 daemon / 契约层；不做 daemon 侧消息翻译（错误透传保持英文原文 +
  中文词典只覆盖 WebUI 自有文案；后端错误消息翻译属后续批）。
- 本轮不交付语言切换 UI（Settings 面 IA tab 化未落定）；只交 `setLocale()`
  API + 持久化。UI 入口在 tasks 中标注为 IA 后批任务。

## 1. A/B/C 分类表（编排者给定 + 落地核对）

| 类   | 定义                    | 文件面                                                                                                                                                                                                                                                                          | 本轮动作                                                                     |
| ---- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| A    | IA 基本不碰             | `apps/wiki/WikiHome.svelte`、`apps/wiki/WikiScopeView.svelte`、`components/agent/**`（含 composer 家族 ts 内核中含文案的 `composer-keymap.ts`）、`components/toast-container.svelte`、`components/command-palette.svelte`                                                       | 全量迁词典                                                                   |
| B    | IA 将重构，禁改文案结构 | `lib/shell/**`（AppShell/TabOutlet/AppSidebar/WindowDragRegion…）、`apps/workspaces/**`、`apps/creator/**`、`apps/repository/**`、`apps/settings/manifest.ts`、`components/creator/eval-view.svelte`、`components/import-workspace-dialog.svelte`、`+layout.svelte`、`app.html` | 不碰；inventory 列 IA 后检查点                                               |
| C    | IA 新增面               | dashboard / SkillsAgentPage / evaluating / terminal / omnibox（尚未存在）                                                                                                                                                                                                       | 出生即 i18n，消费本设计 §6 约定                                              |
| SKIP | 生成器属地              | `components/ui/**`（shadcn-svelte registry generator 属地，AGENTS.md §6 物理隔离例外）                                                                                                                                                                                          | 不手工改；原语内英文 a11y 文案经外围 wrapper / 词典参数注入，动不了的记 SKIP |
| TBD  | 与 IA 耦合待裁决        | `components/settings/**` 与 `apps/settings/SettingsPage.svelte`（内容分区文案偏 A，但「改动只限」边界未列且 settings tab 化会移动分区）、`apps/wiki/manifest.ts`（nav 标签面归 IA tab 栏）                                                                                      | 本轮不动，inventory 记检查点                                                 |

边界裁决记录：编排者分类段把 SettingsPage 内容文案标为 A 类（「先做文案词典
抽取不动布局」），但同一简报的「改动只限」穷举清单未列该文件且明确「凡 B 类
文件一律不碰」。冲突按更严边界执行：本轮不动 SettingsPage / settings 组件，
inventory 中标 `A-deferred`（待 IA settings tab 化落定后立刻按 §6 约定接入——
这些文件不在 IA 重构的删除路径上，只是分区会动）。

DevicePrefs 边界裁决：`shell/device-prefs.ts` 物理上在 shell/ 目录，但 IA 改的
是 shell 布局而非 prefs schema；按编排者明示允许做 `language` 字段最小扩展。

## 2. 选型

### 2.1 候选对比（评估维度 × 候选）

| 维度                | paraglideJS (@inlang) v2                                                                                                                          | svelte-i18n                            | typesafe-i18n                   | 自研 typed catalog（选定）                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ------------------------------- | -------------------------------------------------------------- |
| Svelte 5 runes 兼容 | 好（编译期函数，框架无关）                                                                                                                        | 可用（store 底座，runes 代码库里显旧） | 差（长期无维护，无 runes 适配） | 原生（$state locale，模板/derived 自然追踪）                   |
| TS 类型安全         | 编译期生成函数，key 安全；翻译侧齐全性依赖 lint 配置                                                                                              | 弱（key 为 string，无编译期校验）      | 好（codegen）                   | 编译期完整：`zh: Record<keyof typeof en, string>` 双语齐全强制 |
| bundle 体积         | 极小（tree-shake 编译产物）                                                                                                                       | 运行时 + 全量 JSON                     | 小 + generator                  | 极小（两份扁平 TS 对象 + ~30 行运行时）                        |
| 动态切换不刷新      | 支持                                                                                                                                              | 支持                                   | 支持                            | 支持（$state 细粒度更新）                                      |
| 构建管线影响        | **需要 vite 插件 + 生成目录**（本项目 vite 管线特殊：config/daemon-dev.ts 内嵌 daemon 监督器 + 自定义 vitest projects，代码生成目录还要配 alias） | 无                                     | 需 codegen watcher              | **零**                                                         |
| 维护活跃度          | 活跃（生态事实标准）                                                                                                                              | 维护中但节奏放缓                       | 事实停滞                        | N/A（自有 ~100 行）                                            |
| SSR 收益            | 大（locale 协商/路由）                                                                                                                            | 中                                     | 中                              | 本项目无 SSR，收益为零                                         |
| 与本仓铁律契合      | 生成物进 `src/lib/`（与「不维护第二份类型」文化有摩擦）                                                                                           | 弱类型摩擦                             | codegen 摩擦                    | 单源 en 事实源 + 类型约束，零第二源                            |

### 2.2 结论：自研 typed message catalog

理由：

1. **本项目是 daemon 内嵌 SPA**（`ssr=false`），paraglide 的核心卖点（SSR locale
   协商、server hooks、本地化路由）全部落空；剩下的价值只有编译期 tree-shake，
   而两份扁平词典的体积收益在本规模（~300 key）可忽略。
2. **webui 构建管线高度定制**（Vite 8 + daemon-dev 监督器 + 三段 vitest
   projects + $shared/$lib/$app alias）。引入编译期 i18n 插件 = 在一条精心
   调稳的管线上新增代码生成 + 别名 + 测试解析三处耦合，风险不对称于收益。
3. **类型安全可以自持**：en catalog 是 key 事实源；`type MessageKey =
keyof typeof en`；`zh: Record<MessageKey, string>` 让「zh 缺 key」成为编译
   错误（tsc/svelte-check 门禁即词典齐全性门禁），不需要外部 lint。
4. **零依赖**与仓库「type-safe = runtime-safe、无第二份手写类型」的文化一致。
5. 复数/ICU 需求极小（三处，组件侧单复分支即可），CLDR 级消息格式是过度工程。

如果未来出现 SSR、按需 locale 加载或 >5 语言需求，迁移路径清晰（词典已是
扁平 key→string，可机械转换到 paraglide 的 inlang 格式）。

### 2.3 落选记录

- typesafe-i18n：维护停滞（Svelte 5 支持议题长期无响应），排除。
- svelte-i18n：store 底座与 runes 代码库错代、类型弱、运行时较重，排除。
- paraglideJS：优秀但为 SSR/路由型 SvelteKit 应用设计；本 SPA + 定制管线
  场景下引入构建耦合不值得（见 §2.2），排除。

## 3. 基建结构

```text
webui/src/lib/i18n/
|-- index.ts            [2] 公共 API 再导出（t / locale / setLocale / Locale）
|-- locale.svelte.ts    [2] locale store：$state locale + DevicePrefs 读写
|                          + document.documentElement.lang 同步
`-- catalogs/
    |-- en.ts           [1] 英文词典 = key 事实源（原文从 A 类组件逐字迁入）
    `-- zh.ts           [1] 中文词典：Record<MessageKey, string>（编译期齐全）
```

（`[n]` = 文件意图数；每个文件带 §6 文件意图头。）

```text
app boot
   |
   v
import locale.svelte.ts（任意 A 类组件首挂载即初始化；appearance store 同模式）
   |
   +-- locale = DevicePrefs.language ?? "en"     （localStorage 缺省/不兼容 → en）
   +-- document.documentElement.lang = locale     （运行时同步，app.html 保持 lang="en" 兜底）
   |
   v
t(key, params?) ──读──> $state locale ──映射──> catalogs[locale][key] ──插值──> string
   |
   +-- 模板调用：locale 变化 → 模板表达式重算（细粒度更新，无整页刷新）
   +-- 事件处理器调用（toast 等）：读当前 locale 快照
   |
setLocale("zh")
   |-- locale = "zh"（$state 写）
   |-- updateDevicePrefs({ language: "zh" })    （持久化，safeParse 失败静默不写——既有语义）
   `-- document.documentElement.lang = "zh"
```

### 3.1 t() 契约

```ts
export type Locale = "en" | "zh";
export type MessageKey = keyof typeof en; // en = key 事实源
export function t(key: MessageKey, params?: Readonly<Record<string, string | number>>): string;
export function currentLocale(): Locale; // 响应式读（模板/$derived 内追踪）
export function setLocale(next: Locale): void;
```

- 插值：`{name}` 占位符（`"wikiHome.toastAdded": "Added “{title}” to the wiki."`），
  未提供的占位符保留原样（可检测的翻译缺陷，不静默吞）。
- 缺 key：类型层已排除；运行时防御性回退 en（unknown 未来 key 不可能进入，但
  catalog 加载态无异步——不存在运行时缺失路径）。
- **en 值必须与现网英文逐字节一致**：组件测试断言 textContent/aria-label/占位符
  的英文原文（wiki-home/wiki-scope-view/skill-menu/queue-dock/slash-menu/
  agent-card/composer-model-chip/web-mode-smoke 等），en 词典改动等同文案改动，
  需同步过测试。
- **测试锚点固定值**：个别已被测试钉死的中文/特殊值（SkillMenu 空态占位
  「输入关键词检索技能」被 skill-menu.test 断言）在 en 词典中固定为当前线上
  值（即中文），inventory 标注；后续批任务统一裁决测试与文案。

### 3.2 DevicePrefs 扩展

```ts
export const DevicePrefsSchema = z.object({
  version: z.literal(1),
  theme: z.enum(["light", "dark", "system"]).default("system"),
  sidebarCollapsed: z.boolean().default(false),
  language: z.enum(["en", "zh"]).default("en"), // 新增：带默认值
});
```

旧 v1 存量（无 language 字段）safeParse 通过并取默认 `"en"`——无迁移、无
版本号变更，符合「带默认值的加法演进」既有先例（theme.default 同法）。
不兼容存量（schema 整体失败）仍按 Incompatible Persisted State → 默认值。

## 4. A 类适配面（本轮落地清单）

| 文件                                      | 词典 key 数（估） | 备注                                                     |
| ----------------------------------------- | ----------------- | -------------------------------------------------------- |
| apps/wiki/WikiHome.svelte                 | 13                | 含 Not initialized 空态、fragments 计数单复分支          |
| apps/wiki/WikiScopeView.svelte            | 45                | 含蒸馏六态徽标、七种失败原因、幂等 toast                 |
| components/toast-container.svelte         | 1                 | Dismiss 通知（消息本体由调用方词典化）                   |
| components/command-palette.svelte         | 14                | ⌘K 面板；omnibox 耦合文案 TBD 见 inventory               |
| components/agent/AgentPanel.svelte        | 7                 | 面板容器 + edit-mode 注记条                              |
| components/agent/AgentHeader.svelte       | 8                 | 会话 select 选项文案（New session…/No sessions/· ended） |
| components/agent/AgentCard.svelte         | 3                 | Loading card…/Card unavailable                           |
| components/agent/AgentApprovalCard.svelte | 7                 | ask_user_question 决定面                                 |
| components/agent/AgentProposalCard.svelte | 6                 | Approve/Reject + 结果 toast                              |
| components/agent/AgentToolRow.svelte      | 8                 | Input/Output/running/todo 摘要（module 函数直调 t）      |
| components/agent/TodoDock.svelte          | 4                 | done/active/pending 计数行                               |
| components/agent/QueueDock.svelte         | 14                | 队列行操作 + steer 说明                                  |
| components/agent/ContextMeter.svelte      | 11                | 用量环 popover + tooltip                                 |
| components/agent/ComposerCard.svelte      | 26                | 占位符链/附件/模式/model chip/主按钮                     |
| components/agent/TranscriptView.svelte    | 22                | 转录流行渲染器集合                                       |
| components/agent/SlashMenu.svelte         | 8                 | 命令注册表描述 + 组头                                    |
| components/agent/SkillMenu.svelte         | 8                 | 含测试锚点固定值（§3.1）                                 |
| components/agent/ReferenceMenu.svelte     | 7                 | @ 菜单 sourceLabel/组头                                  |
| components/agent/DropOverlay.svelte       | 3                 | 拖放覆盖层                                               |
| components/agent/DisclosureRow.svelte     | 1                 | Tool error 红点                                          |
| components/agent/ChipPaintLayer.svelte    | 2                 | 芯片 title                                               |
| components/agent/composer-keymap.ts       | 4                 | 占位符优先级链（纯函数内直调 t）                         |

不动数据流：latest-request-wins 代次门、IME 守卫、claim 机、focus 语义全部
保持；只替换字符串字面量为 `t()` 调用（模板插值 `{title}` 形态保持）。

## 5. 翻译准则（zh 词典）

1. 术语对照仓库 `i18n.zh.md` Canonical Glossary：Workspace=工作区、
   Provider=Provider、Skill=技能、Repository=仓库、Preview=预览、
   Fragment=碎片、Distill=蒸馏、Proposal=提案、Mode=模式、Session=会话、
   Turn=轮次、Context=上下文、Compact=压缩（compact 命令 token 本身保留
   `/compact` 不译）。
2. 路由名/一级导航名（Workspaces/Creator/Repository/Wiki）在 zh 中保留英文
   专名（与 i18n.zh.md「路由和一级导航名固定为 Creator/Repository」一致）。
3. 命令 token（`/compact` `/queue` `/steer` `$` `@` 触发符）、代码标识符
   （counter key、mode id、provider id）不译。
4. 技术约束随文（≤4 MiB、≤512 KiB、append-only）保留单位与英文限定词。
5. zh 标点用全角（，。：；？！），引号用「」或保留专名引号；数字/单位半角。

## 6. B/C 类使用约定（后续批任务的接口）

1. **key 命名**：`<domain>.<file|feature>.<purpose>` 小驼峰，domain = app 或
   组件族（`wikiHome.` / `agentPanel.` / `composer.` / `settings.general.` …）；
   单复分支后缀 `.one` / `.many`；带插值的 key 在 en 值中显式 `{param}`。
2. **消费方式**：模板 `{t("key")}`、属性 `aria-label={t("key")}`、脚本
   `$derived` 与事件处理器直接调用；**禁止**在组件内保留裸英文用户可见文案
   （代码注释不算）；新 C 类面 PR 自检 `grep -P '>[A-Z][a-z]+ ' --include=*.svelte`
   级别的走查。
3. **测试**：断言文案的组件测试默认在 en locale 下跑（en=事实源）；需要断言
   zh 的测试显式 `setLocale("zh")` 并在 after 恢复。
4. **sr-only / 冒烟锚点**：被 test/ 断言的锚点文案（如 WorkspacesHome
   `skills across {n} agent locations`）词典化时 en 值固定原句，zh 值正常
   翻译；冒烟测试跑 en。
5. **语言切换 UI**：入口收敛到 Settings → General（IA tab 化后落位），
   segmented control（EN / 中文），写 `setLocale()`；不得散落第二个切换点。

## 7. 测试与验证

- 新增 `webui/src/lib/i18n/__tests__/i18n.test.ts`：插值、locale 持久化
  （DevicePrefs.language）、document.lang 同步、en/zh key 集合相等
  （运行时双保险，类型层之外）。
- A 类组件既有测试（wiki-home、wiki-scope-view、wiki-scope-distill.dom、
  skill-menu、slash-menu、queue-dock、agent-card-disconnected、composer 族、
  command-palette-search 等）不改断言全绿——en 词典值逐字保留是硬门。
- `pnpm --dir webui check`（svelte-check）覆盖 zh catalog 类型齐全性。
- fmt：仅对显式改动文件 `pnpm exec vp fmt --write <files>`。
- 视觉验证（语言切换桌面 + 窄屏）在本轮 UI 入口（切换器）未交付前不适用；
  zh 渲染正确性由 en/zh key 对齐测试 + 后续批走查承接。

## 8. 风险

| 风险                                | 缓解                                                                                              |
| ----------------------------------- | ------------------------------------------------------------------------------------------------- |
| en 值手抄偏差弄断测试               | 逐文件迁移 + 该文件聚焦测试即时跑；en 值从源文件复制粘贴不重打                                    |
| 词典 key 漂移（B/C 接入时命名混乱） | §6 约定进 design + inventory 检查点                                                               |
| IA 重构删改 A 类文件造成词典死 key  | 死 key 无运行时危害（纯对象属性）；批任务收尾以 `tsc` 未引用检查 + 定期清点；不为此引入 lint 依赖 |
| zh 翻译质量                         | 术语表 §5 对照；Owner 走查批任务兜底                                                              |
