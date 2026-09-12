# Design: redesign-model-tabs-and-agent-panel

> 交付物：两大战场（Model 配置 tabs 化 / Agent 面板推倒重设计）+ 一个统一理念（RouteTab）。
> 本文档是组件级规格，不含实现代码。所有路径为绝对路径，指向现有资产。

## 0. 护栏（不可违反的边界）

| 护栏          | 内容                                                                                                                                                                                                                           |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 宽度轴        | 面板是 440px 窄栏（`min-[720px]:w-[440px]`，见 `/Users/kzf/Dev/GitHub/jixoai-labs/skill-creator-v2/webui/src/lib/components/agent/AgentPanel.svelte`）。dsh-webui 是全宽主列——**宽度布局不照抄，解剖语法/节奏/状态语言照抄**。 |
| 依赖          | 不新增 npm 依赖。无 Lexical；composer 保持 textarea（入卡内）。斜杠菜单用绝对定位列表，不引入新的菜单原语。                                                                                                                    |
| 后端桥        | daemon 的模型路由/凭据热桥（`/Users/kzf/Dev/GitHub/jixoai-labs/skill-creator-v2/src/daemon/steward/dsh-settings.ts`）存储与热加载机制不动；本轮只做契约增量（§4）。                                                            |
| 密度基调      | 全局保持 12px 密度基调；**转录正文升到 13px/20（dsh secondary tier）**；meta 行 11px；disclosure 行 12px。                                                                                                                     |
| Settings 容器 | Dialog 维持 `sm:max-w-3xl` + 左 176px 导航；右内容区实际可用宽约 560px（768 − 176 − padding），tab 溢出策略按此设计。                                                                                                          |
| 数据真相源    | `settings.modelRoutes`（经 `agentRuntimeConfig.view` 投影）即 tabs 唯一真相源；`settings.model` 为全局活动模型单例。不引入第二份本地路由状态。                                                                                 |

---

## 1. 统一理念落地：RouteTab

### 1.1 定义

**RouteTab = 一份路由配置的完整自持单元**。一个 tab 承载一条 `DshModelRoute` 的全部横向：图标、名字、key 状态、端点、模型清单、活动切换、删除。用户在 tab A 里永远看不到也不操作 tab B 的任何字段——「不乱窜」的形式化表述。

**NewTab = 预设选择页与空白表单是同一表单的两个入口态**。Provider 预设（`agent.models.catalog` 目录，36 家含内联 dataURL 图标）与 Custom 不是两种配置类型，而是同一份 Custom 表单的「预填」与「空白」两种起始态：

```
DshModelRoute（全集 = Custom 能做的一切）
  ├─ provider（路由名）
  ├─ baseURL
  ├─ api（协议；目录路由可省略，自定义路由必填）
  ├─ models[]
  └─ icon（本地 UI 字段；桥接层已剥离，不进 DSH settings.yaml）
Provider 预设 = { 上述字段的默认值包 } —— 只是填表起点，不是运行时类别
```

推论：**ModelSettingsSection 里不再有「画廊 / Routes 列表 / Custom 表单」三块混排**。画廊只活在 NewTab 的 `pick` 态里；Routes 列表被 tab 条取代；Custom 表单与 tab 内容是同一组件的两个实例化（新建态 vs 编辑态）。

### 1.2 自定义 Provider（含图标）的路径

- 任意 route（无论起点是预设还是空白）持久化后即为一个「provider」。`DshModelRoute.icon` 字段已存在且桥已处理（`dsh-settings.ts` 第 89 行注释确认剥离）——本轮只需 UI 消费它。
- 「另存为预设」：tab 内容页提供 `Save as preset`，把当前 route 的 `{provider, label, api, baseURL, models[].id, icon}` 写入**本地 presets**（`localStorage["skill-creator.providerPresets.v1"]`，新模块 `webui/src/lib/stores/provider-presets.svelte.ts`）。NewTab 画廊多一个「Your presets」分组，卡片可删除。本地 presets 是纯 UI 概念，不进 daemon——自定义 provider 的运行时身份就是持久化 route 本身。
- 图标三级回退：`route.icon`（覆盖）→ 目录图标（catalog entry.icon）→ 字母头像（现有 `avatarHue` 确定性色相逻辑保留）。

### 1.3 tabs 数据流

```
RouteTabs (UI)
  │  updateAgentSettings({ modelRoutes: 全量替换 })        ← add/remove/edit 均全量补丁（既有语义）
  ▼
daemon steward settings（持久，revision +1）
  │  dsh-settings 桥（剥离 icon/api 可省略字段）
  ▼
DSH $DSH_HOME/settings.yaml llm-pi-ai: 段（热加载）

credentials 旁路：
setAgentCredential(provider, key) / clearAgentCredential(provider)
  → view.providers[{provider, configured}] → tab 内 key 状态 pill（值永不回流）
```

UI 本地态只有三样：当前选中 tab、NewTab 的 `mode(pick|form)` 与表单草稿、icon picker 开合。**tab 的选中是纯视图状态，永不写 settings**。

### 1.4 Active model 的归属（论证）

**结论：操作归属 tab 内；真相是全局单例 `settings.model`；可见性全局化（tab 条标记 + composer chip 同步）。**

论证：

1. **内核只有一份 `settings.model`**。任何「每个 tab 各自的活动模型」都是未持久化的假状态，重载/重启后必然漂移——这正是「乱窜」的根源之一。真相只能是单例。
2. **操作 locality**：切活动模型的意图几乎总是「用这家的某个模型」，而用户此刻正盯着该 tab。`Set active` 放在 tab 内一步完成；放全局下拉（现状）则要在跨 provider 的长列表里找模型——现状痛点。
3. **不选「tab 选中即激活」**：浏览/编辑其他 route 的配置不得有切换活动模型的副作用。配置浏览（视图状态）与状态变更（settings 写入）必须解耦，这是「不乱窜」的第二形式化表述。
4. **可见性全局化**：active 是跨 tab 单例，其标记必须跨 tab 可见——tab 条上活动路由的 tab 带 primary 下划线 + 圆点；Agent 面板 composer 的 model chip 同步显示全局 active（§3.4）。两处只读，一处可写（tab 内）。

边界情形：活动模型引用 Routes 之外的 provider（env 注入）→ tab 条右端显示 amber 警示 chip「active outside tabs」（title 说明），点击跳 NewTab 并预填 provider 名。composer model chip 同步降级为警示色。

---

## 2. Model 区信息架构（组件级规格）

重写 `/Users/kzf/Dev/GitHub/jixoai-labs/skill-creator-v2/webui/src/lib/components/settings/ModelSettingsSection.svelte`，拆为四个组件：

| 组件                                  | 职责                                           |
| ------------------------------------- | ---------------------------------------------- |
| `ModelSettingsSection.svelte`（重写） | 分区骨架 + tab 条 + 组件路由                   |
| `RouteTabContent.svelte`（新）        | 单个已建路由的完整编辑面                       |
| `NewRouteTab.svelte`（新）            | 统一建路由体验（pick / form 两态）             |
| `IconPicker.svelte`（新）             | 图标选择 popover（目录图标 + 上传 + 字母回退） |

`ModelTagsInput.svelte` 原样保留复用。

### 2.1 分区骨架

```
┌ Model 分区（滚动容器，~560px 宽）─────────────────────┐
│ Model                                      [active⚠︎] │  ← 标题行 + 外置活动警示 chip（仅异常时）
│ ┌ tab 条（36px 高，底部对齐 2px 下划线 active）────────┐│
│ │ ▸[icon Route] [icon Route] [icon Route]│ [ + New ] ││  ← 左：横滚区；右：固定 + 按钮
│ └────────────────────────────────────────┴────────────┘│
│ ┌ tab 内容（RouteTabContent | NewRouteTab | 空态）─────┐│
│ │ …                                                    ││
│ └──────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────┘
```

### 2.2 Tab 条

- 结构：flex 行 = [横滚 tab 区 `overflow-x-auto` 隐滚动条 + 两侧 8px 渐隐 mask（可滚动时）] + [固定 `+ New` 按钮]。
- 单个 tab（高度 36px，底部对齐内容）：
  - 16px 图标（三级回退，`h-4 w-4 object-contain dark:invert`）；
  - 名字 12px medium，`max-w-[120px] truncate`；
  - 徽标（右上角 4px 圆点叠加在图标上，或名后小点）：amber = key 未配置；primary = 该 tab 持有全局活动模型。两态可并存（amber 点在图标右上、primary 用下划线着色表达）。
  - active tab：2px primary 下划线（对齐 dsh 会话 tab 语法）+ 文字 `text-foreground`；非 active 文字 `text-muted-foreground`，hover 换 `text-foreground`。
- 溢出策略：超出 560px 可视宽即横滚；滚轮垂直事件转横滚（`onwheel` 消费 deltaY）；不换行、不折叠为下拉。
- 键盘：←/→ 在 tab 间移动焦点，Enter 选中；Delete 在 active tab 上触发删除确认。
- `+ New`：ghost 按钮，h-7 px-2，`text-[11px]`，点击进入 NewTab（`pick` 态，除非 tab 条为空则直接 `form` 空白态，见 §2.5 空态）。
- 无路由空态：tab 条只有 `+ New`；内容区显示 onboarding（不是旧画廊）：标题「Add your first model route」+ 两个大按钮「Browse providers」（→ pick 态）/「Custom endpoint」（→ form 空白态）。

### 2.3 RouteTabContent（tab 内布局，自上而下六个块）

**块 1 · Identity（无卡身，行布局）**

- 28px 图标按钮：点击开 `IconPicker` popover；hover 出现右下角 8px 铅笔角标。
- provider 名：14px semibold，**只读**（title：「Route name keys the credential mapping — duplicate this route to rename it」。理由：provider 名 = DSH providers 键 = `dshRouteApiKeyEnv` 凭据名，改名等于换身份需重粘 key，本轮以复制重建覆盖改名需求）。
- 右侧 key 状态 pill：`configured`（primary/10 底）或 `add key →`（amber 底，点击展开块 2 并聚焦）。
- 次行 meta：`baseURL 去协议 · N models`，10px muted。

**块 2 · Credential（bordered，默认折叠为 pill；展开后）**

- password Input（h-8）+ `Save key` 按钮 + （已配置时）`Clear` outline 按钮——搬现有逻辑原样。
- 辅助文案保留：「Keys are stored locally (0600), never echoed back, and apply immediately.」
- 保存成功 → pill 翻绿（`configured`），输入框清空，块保持展开 800ms 后自动折叠。

**块 3 · Endpoint（bordered）**

- `Base URL` Input（mono 12px），脏态启用 `Save` 按钮，保存 = `modelRoutes` 全量补丁。
- `API protocol` 字段**仅当该 provider 不在目录中时渲染**（自定义路由必填；目录路由继承 pi-ai 装配协议，不显示以免误导）。控件：Input + datalist（候选 = 目录出现过的 api 值并集）。

**块 4 · Models**

- **R7+ 重构落地（取代初版单 tags-input 描述）**：Models 块 = `ModelListItem` 列表 + Add model。每个条目默认折叠（ModelName + dirty 点 + test/edit/remove 三个 44px icon-button），展开为全表单：modelId（datalist 补全——当前 provider 模型置顶，跨 provider 候选剔除 `/`、`@` 命名空间 id）、ModelName（自动生成可改）、efforts（tags-input + 补全：标准档位 minimal/low/medium/high/xhigh/max ∪ 目录 effortTiers ∪ 路由并集；默认 `low/high/max` 三档——用户裁定）、上下文窗口与最大输出 token（`0.5M`/`253k` 简写，目录预填 contextWindow/maxTokens）、输入类型 chips（目录 inputTypes 预填；text 锁定选中）、输出类型 chips（text 锁定选中 + image 可切换持久化——pi-ai 镜像无 output 数据，默认 `["text"]`，codex R11 P1）、连接测试（已存 key → provider 注入；草案 → test-only key 直传）。
- **即时应用**：每次 add/remove tag 即发 `modelRoutes` 全量补丁（低风险字段，无 Save 按钮）。补丁期间 `agentRuntimeConfig.updating` 置灰输入。

**块 5 · Active model**

- 本 tab 持有活动模型（`route.provider === view.settings.model.provider`）时：
  - 头部 badge「Active route」（primary/10）；
  - 模型 select（本 route 的 models）+ `Effort` Input（h-8，placeholder `low / medium / high`）+ `Apply` 按钮（脏态启用）——搬现有 `saveModel` 逻辑；此块仅在**活动 tab** 展开。
- 非 active tab：紧凑形态——模型 chip 行（每 model 一个 chip，hover 浮现 `Use`）+ 底部 `Set active` 按钮（以第一个 model 为默认值）。点击 = `apply({ model: {provider, model} })`，成功 toast + tab 条 primary 下划线迁移。

**块 6 · Danger / Preset（行布局，右对齐）**

- `Save as preset`（ghost，11px）：写本地 presets；已存在同名 preset 时变 `Saved ✓`（1s）。
- `Remove route`（ghost-destructive）：弹 `confirm-dialog.svelte` 复用；确认 = 全量补丁移除。若移除的是活动路由 → 全局 active 变 dangling，§1.4 警示 chip 出现（预期行为，不阻止）。

### 2.4 NewRouteTab（两态）

**状态机**：`mode: 'pick' | 'form'`；`preset: ModelProviderCatalogEntry | LocalPreset | null`。pick 选卡 → form 并预填；form 的 `Back` 回 pick；`Start from scratch` = preset=null 进 form。

**pick 态**：

- 顶部：搜索 Input（autofocus，h-8）+ 右侧 `Start from scratch →` ghost。
- 主体：2 列卡片网格（`min-[520px]:grid-cols-2`，`max-h-[52vh]` 内滚）。卡片 = 28px 图标 + label + 去协议 baseURL + 右下角 models 计数徽标；已建路由的目录卡显示 `Added ✓` 置灰。
- 「Your presets」分组置于目录之上（有本地 presets 时），卡片同构 + hover 右上 `×` 删除。
- 目录数据沿用 `agent.models.catalog` RPC + `createRequestGenerationGate` 代次门（现有逻辑整体搬入）。

**form 态**（与 RouteTabContent 同一字段集，新建语境）：

1. Identity：`IconPicker`（预设带入图标）+ `Route name` Input（必填；与现有路由重名 → 内联 amber 错误「Route "x" already exists.」，沿用现有校验文案）。
2. Endpoint：`Base URL`（必填，`/^https?:///` 校验，错误文案沿用）+ `API protocol`（预设命中目录时隐藏，自定义必填，默认 `anthropic-messages`）。
3. Models：`ModelListItem` 列表（与 RouteTabContent 同款表单集），预设带入 top-4 模型（目录命中预填 name/contextWindow/maxOutputTokens/inputTypes/effortTiers，efforts 默认 `low/high/max`）；名字命中目录 provider 时自动出补全候选（当前 provider 置顶 + 跨 provider 剔命名空间 id）。
4. 底部：`Add route` primary（校验通过启用）+ `Back` ghost。成功 → 关闭 NewTab、自动选中新 tab、展开块 2 并聚焦 key 输入（替代现有 `routeAddedFor` + `scrollIntoView` 引导）。

**IconPicker**（两处复用）：

- 触发：28px 图标按钮。
- Popover（用现有 DropdownMenu 体系渲染定宽 280px 内容面板）：当前图标大图 48px + 「Catalog」网格（36 个目录图标 24px 网格）+ 「Upload」文件按钮（accept `.svg,.png,.webp`；读为 dataURL，> 64KiB 拒绝并 toast）+ 「Letter」字母回退项。
- 选中即写：编辑态 = `modelRoutes` 补丁（route.icon）；新建态 = 草稿字段。

### 2.5 与 Agent 分区的联动

- **不动**：Agent 分区（`AgentSettingsSection.svelte`）的 defaultMode / preset / approvalPolicy 原样。
- 唯一联动是只读展示级的：NewTab 或 tab 内容不做任何模式默认值推导；模式系统（DSH_AGENT_MODES）与模型系统正交，本轮不搭桥。
- Agent 面板 composer 的 model chip（§3.4）读取 `agentRuntimeConfig.view`，与 Model 分区共享同一投影——改一处，两处同步（既有共享行为，无新代码路径）。

---

## 3. Agent 面板 IA 蓝图

### 3.1 面板骨架（440px drawer，flex column）

```
┌ header（40px）───────────────────────────────┐
│ [session select ▾ (flex-1)]        [+] [×]  │
├ transcript（flex-1, px-4 py-3, 内滚）────────┤
│  …row 序列（见 3.2）…                        │
│  [back-to-bottom FAB（右上浮，上滚>200px 时）]│
├ error banner（仅错误时，destructive 条）─────┤
├ TodoDock（折叠卡，有 todos 时）──────────────┤
│ [✓ Tasks  done 2 · active 1 · pending 0  ⌄] │
├ edit-mode 注记条（仅编辑态，amber）──────────┤
├ composer 卡（rounded-[22px], mx-3 mb-3）─────┤
│  [附件条]                                    │
│  [textarea]                                  │
│  [⊕mode] [📎] [📄]      [model chip][⌾][●↑] │
└──────────────────────────────────────────────┘
```

现状的「上下文条」（header 下 last turn tokens + compact 链接）**移除**，职责并入 composer 的 ContextMeter（§3.4）。

### 3.2 转录流 row 解剖（全部对齐 DisclosureRow 24px 语法）

通用行语法（dsh 语法移植）：`[icon 14px] 标题 [·] 摘要`，行高 24px（h-6），hover 整行 `bg-muted/50 rounded-md` + chevron 显形（可折叠行），运行态 = `.sweep` 300px 扫光（唯一运行 affordance，**无 spinner、无 animate-pulse**）。

| Row 类型                             | 解剖规格                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **TurnDivider**（turn-start）        | 24px：hairline `─` flex-1 + 12px muted uppercase `tracking-wide` 标签 + hairline。替换现有同类行，样式收敛。                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **TurnEnd 药丸行**（turn-end）       | 20px 行，左对齐 muted 药丸组：`↑ 1.2k · ↓ 340 · 8.4s`（tabular-nums 11px，`.turn-pill` h-5 rounded-full bg-muted px-2）。usage 取自本轮 assistant-text 终帧 payload（§3.5 store 变更）；elapsed = turn-start.at → turn-end.at。reason（cancelled 等）进 title。**替换现有第二根 "Turn end (reason)" 分隔线**。                                                                                                                                                                                                                            |
| **UserMessage**                      | 容器 `ml-auto max-w-[85%]`（≈347px）。附件行在气泡**上方**：图片 = `h-16 w-16 object-cover rounded-xl border` 缩略组（justify-end）；文件 = 240×64 卡（icon + name + remove）。气泡 = `.bubble-user` `rounded-[22px] bg-primary/10 px-3.5 py-2 text-[13px] leading-5 whitespace-pre-wrap`，`max-h-40` 内滚（超长折叠保留）。气泡**下方** icon 操作行（20px）：copy / edit / resend，14px 图标，`opacity-0` → hover 显现，**最新一条常显**；copy → check 1s（新增反馈）。edit 的 tooltip 统一为「Edit & resend — keeps history」（§4.3）。 |
| **AssistantMessage**                 | **全宽无气泡**：`.msg-body` 13px/20 markstream（htmlPolicy=escape 不变；密度覆写样式从 AgentPanel 的 scoped style 迁入 TranscriptView，基字号改 13px）。操作脚标 = 气泡下方 20px icon 行（copy；hover/最新常显）。usage 不在此渲染（归 TurnEnd 药丸）。                                                                                                                                                                                                                                                                                   |
| **ThinkingRow**                      | DisclosureRow：`[sparkles] Thinking · 摘要`。流式：自动展开（现有 `open={streaming}` 语义）+ 摘要 = **末行**；定稿：收起 + 摘要 = **首行**（dsh 语义）。运行中摘要文字加 `.sweep`。展开体 = 11px muted mono-ish pre-wrap，`max-h-48` 内滚（沿用）。                                                                                                                                                                                                                                                                                       |
| **ToolRow**                          | **一次调用一行**（call+result 合并，现状两行推倒）。折叠态：`[分型 icon] displayName · 摘要`；运行中（call 已到无 result）= 摘要 `.sweep`。摘要分型：bash → `args.description                                                                                                                                                                                                                                                                                                                                                             |     | command 首行`；read/write/edit → cwd 相对化路径；其他 → 首个字符串参数截 64ch。displayName 去 MCP 前缀（沿用）。展开态分型卡（各 `max-h 150–260px`内滚，mono 11px）：terminal（暗底 pre + 头条`bash · exit 0`）/ diff（+/- 行 emerald/rose 10% 底色 + 文件头）/ read（文件头 + 内容 pre）/ image（`max-h-40` contain）/ 通用 IN-OUT 卡（Input/Output 两段）。S4 前参数未流式时，折叠摘要在 tool-call 到达时一次性给出。 |
| **ApprovalCard**                     | 保留 `AgentApprovalCard.svelte`，重排版：正文升 13px，待答 = amber 左边线 2px + 头部「Your decision」；resolved = `opacity-60` + 头部「Answered」。逻辑不动。                                                                                                                                                                                                                                                                                                                                                                             |
| **ModeRow**                          | 24px 居中：`[mode icon] Create → Explore` 12px muted + 两侧 hairline（保留现有语义，收敛到 DisclosureRow 视觉语法，无 chevron）。                                                                                                                                                                                                                                                                                                                                                                                                         |
| **ErrorRow**                         | `[alert-triangle] message`，12px destructive，`bg-destructive/8 rounded-lg px-2 py-1.5`，全宽。                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **TurnStatus**（替换 "working…" 行） | running 时缀于流尾：`.sweep` 渐变文字「Working」；**15s 后**追加计时「· 18s」（1s tick；reduced-motion 降级为静态文字）。                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **TodoDock**                         | **移出转录流**：todo-snapshot 不再进 items，改投影 `agentSession.todos`（latest-wins）。dock 卡在 composer 上方（mx-3 mb-1.5），默认折叠，头部 28px：`[check-circle] Tasks  done N · active M · pending K  [chevron]`；展开体 `max-h-40` 内滚，行 = 12px + 状态点（completed 划线灰 / in_progress primary 空心 / pending 灰空心，沿用现有三态样式）。无 todos 时 dock 整体隐藏。                                                                                                                                                          |

**空会话态**：现有四模式启动卡保留，重排版为居中 280px 宽卡列（样式对齐 §2 卡片语言）。composer 的 mode chip 在无会话时点击 = 以该模式创建会话（与空态卡等价的第二入口）。

### 3.3 组件处置表

| 处置                 | 组件                                                                                                                                                                                                                                                                                                                             |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **保留（原样）**     | `AgentApprovalCard.svelte`（逻辑）、`AgentCard.svelte`、`AgentProposalCard.svelte`、`ModelTagsInput.svelte`、markstream-svelte 渲染链路、附件读取/校验链路（4×4MiB 图 + 2×512KiB 文件）、`provider-icons.generated.ts`、settings/credentials RPC 桥、`pendingUserEcho` 乐观回声去重、滚动跟随（增高前贴底判定 + ResizeObserver） |
| **保留（重排版）**   | `AgentApprovalCard.svelte`（13px/左边线/resolved 态）、Tasks 三态样式（迁入 TodoDock）、模式切换 chip 逻辑（迁入 composer，running 拒绝语义不变）                                                                                                                                                                                |
| **改造（拆分重写）** | `AgentPanel.svelte` → 拆为 `AgentHeader` / `TranscriptView` / `ComposerCard` / `TodoDock` / `ContextMeter` / `SlashMenu`（新文件均入 `webui/src/lib/components/agent/`）；`AgentToolRow.svelte` → `ToolDisclosureRow.svelte` + 分型展开卡（terminal/diff/read/image/generic）                                                    |
| **新写**             | `DisclosureRow.svelte`（24px 语法原子）、`TurnDivider.svelte` + `TurnPills.svelte`、`agent-flow.css`（§3.6）、`provider-presets.svelte.ts`、settings 侧 §2 四组件                                                                                                                                                                |
| **删除**             | 面板 header 下独立上下文条（并入 ContextMeter）、转录内联 todo 卡（并入 TodoDock）、`ModelSettingsSection` 旧画廊/Routes 列表/同页 key 盒（被 tabs 取代）、`AgentToolRow` 的 phase 徽标双行形态                                                                                                                                  |

### 3.4 Composer 卡（控件级）

卡身：`mx-3 mb-3 rounded-[22px] border border-border bg-card shadow-sm`，纵排 [附件条 → textarea → 工具行]。

- **附件条**（非空时渲染，`px-3 pt-3`）：图片 56×56 缩略（rounded-lg，hover × 移除，沿用）；文件 chip（icon + name + ×）。与转录 UserMessage 附件行同视觉语言。
- **textarea**：无边框透明，`px-3.5 py-2.5 text-[13px] leading-5`，`maxlength 20000`，min-h 44px（1 行）max-h 160px 自动长高（4 行封顶内滚）；Enter 发送 / Shift+Enter 换行（沿用）；paste 图片 / drop 混合文件（沿用）。placeholder：有会话「Message the agent…」，无会话「Pick a mode to start…」。
- **工具行**（h-11，`px-2.5 items-center gap-1`）：
  - 左簇：**模式 chip**（`General ▾`，h-7 rounded-full border px-2.5 text-11；DropdownMenu 列 DSH_AGENT_MODES；running 置灰 + title「Switch after the current turn ends」；**无会话时点击 = 以该模式建会话**）+ **📎 图片**（32px icon 按钮，44px 外扩命中区沿用）+ **📄 文件**。
  - 右簇：**model chip**（h-7 rounded-full，`provider · model` 截断 + effort 后缀；DropdownMenu 按 routes 分组列模型；选中 = `updateAgentSettings({model})` 热切；running 置灰；active 悬空于 Routes 外 = amber 警示态。canonical 裁决 [2026-09-12]：活动模型选择是会话运行时字段，composer 热切只写 `settings.model`、不构成路由配置的第二写入面——见 PRODUCT_MODEL.md §5 修订；R1 实现「只读 chip 跳设置」属实现偏差，R2 已按本规格落地）+ **ContextMeter**（14px SVG 环：`lastUsage.inputTokens / contextWindow`；contextWindow 取活动 route 匹配 model 的 `contextWindow`，缺省 128k 常量且 popover 标注 assumed；点击弹用量面板：in/out/capacity + `compact` 按钮——原上下文条的 compact 迁入此处，语义不变）+ **主按钮**（**34px 圆形** `rounded-full`：默认发送 ↑（有稿可用）；running + 空稿 → 变停止 ■（destructive 底）；running + 有稿 → 禁用置灰，title「Wait for the current turn」）。
- **edit-mode 注记条**（composer 卡上方，amber tint，h-7）：`Editing — resending keeps your full history  [× cancel]`（§4.3）。
- **SlashMenu**：稿文以 `/` 开头且光标在首行时，于 composer 上方锚定浮现（绝对定位列表，非新依赖）：当前命令 `/compact`（执行并发送）；↑↓ 导航 + Enter 执行 + Esc 关闭；结构开放供后续命令注册。

### 3.5 Store 变更（`agent.svelte.ts`）

- `PanelItem.tool` 重构为合并单行：

```ts
{ kind: "tool"; seq: number; toolCallId?: string; toolName: string;
  argsText?: string;          // 累积的参数 JSON 文本（S4 流式渐进）
  result?: unknown; phase: "calling" | "done" | "error";
  startedAt: string; endedAt?: string }
```

- `tool-call` 创建（phase=calling）；`tool-result` 回填 result/phase（匹配：优先 `toolCallId`，否则本轮内同 toolName 最近一个无 result 的项）。错误判定：result payload 含 `isError`/error 字样 → phase=error（折叠态名后红点）。
- `turn-end` 独立 item：`{ kind: "turn-end"; seq; reason; usage?; elapsedMs? }`；assistant-text 终帧的 `payload.usage` 暂存 `pendingUsage`，turn-end 到达时合入（替换现有「Turn end (reason)」假分隔行）。
- todo 出列：`todo-snapshot` → `agentSession.todos`（不再 push item）；删除 PanelItem 的 todo 分支。
- `agentSession.turnStartedAt`（turn-start 帧时间戳）驱动 TurnStatus 计时。
- ContextMeter 数据：`lastUsage`（现有）+ 新 derived `contextWindow`（settings view 的活动 route + model 匹配）。

### 3.6 CSS 类命名约定（dsh 语义）

新文件 `webui/src/lib/components/agent/agent-flow.css`（由 AgentPanel 一次性 import；只放结构性原子，其余样式留在组件 Tailwind utilities）：

| 类名（kebab，对应 dsh camel 语义） | 定义                                                                                                                                                                                                      |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.flow-item`                       | 转录行基类：`relative w-full`                                                                                                                                                                             |
| `.disclosure-row`                  | 24px 语法：`grid h-6 grid-cols-[14px_auto_4px_1fr_14px] items-center gap-1.5 text-xs select-none cursor-pointer rounded-md`；summary `truncate text-muted-foreground`；hover `bg-muted/50` + chevron 显形 |
| `.sweep`                           | 运行态扫光：`::after` 300px 线性渐变（transparent → primary/8 → transparent）`translateX` 1.6s 循环；`prefers-reduced-motion` 降级为 50% 透明度静态文字                                                   |
| `.turn-pill`                       | `h-5 rounded-full bg-muted px-2 text-[11px] tabular-nums text-muted-foreground`                                                                                                                           |
| `.bubble-user`                     | `rounded-[22px] bg-primary/10`                                                                                                                                                                            |
| `.msg-body`                        | `text-[13px] leading-5`（markstream 容器）                                                                                                                                                                |
| `.tool-card`                       | 分型展开卡基类：`rounded-lg border bg-muted/30 mono text-[11px]` + 各分型 max-h 修饰                                                                                                                      |

---

## 4. 差距收尾（S4）

### 4.1 工具参数流（tool-call-delta → 参数摘要渐进）

- **契约**（`/Users/kzf/Dev/GitHub/jixoai-labs/skill-creator-v2/src/shared/contracts/dsh-runtime.ts`）：`DshSessionStreamFrameKindSchema` 枚举增 `"tool-call-delta"`；帧携带 `toolName` + `text`（参数 JSON 的增量片段）+ 可选 `payload.callId`。同时为 `tool-call`/`tool-result` 增顶层可选 `toolCallId`（§3.5 匹配用）。
- **daemon**：dsh session 投影层把内核 tool 参数分片转发为该帧（callId 透传）。
- **store**：`tool-call-delta` 追加到本轮内最近一个同 callId/toolName 的 `calling` 项 `argsText`。
- **UI**：折叠态摘要 = `digest(argsText 前缀)`（bash：已到手的 description/command 首行渐进变长；write/edit：路径一旦可解析即显示）；展开态 IN 卡流式渲染 `argsText` 前缀（pre-wrap，光标处 `.sweep` 细条）。终帧 tool-call 到达时以完整参数收敛。

### 4.2 assistant 附件回显

问题：乐观气泡带图/文件预览，但会话切换/重连后 `user-text` 帧不含附件 → 回放丢回显。

- **契约**：`user-text` 帧 `payload.attachments?: Array<{ kind: "image" | "file"; name?: string; thumb?: string }>`——`thumb` 为 daemon 侧生成的 ≤96px JPEG dataURL（≤16KiB，仅 image；file 只带 name）。不回传全量 base64。
- **daemon**：prompt 落 attachment 时在对应 user-text 投影帧 payload 里附带上述元数据。
- **UI**：UserMessage 渲染优先级 = 乐观 preview（本地）> payload.attachments（回放）> 仅文件名 chip。live 路径 `pendingUserEcho` 去重逻辑不变（帧只做确认）。

### 4.3 edit-resend 语义标注

- 现状问题：pen 图标只回填 composer，用户无法得知「编辑重发**不会**截断历史」。
- 规格：pen 点击 → composer 进入 `editing` 态：注记条（§3.4，amber）+ placeholder 变「Edit your message — sending will resend it as a new message」；发送/取消均退出 editing 态。tooltip 与 aria-label 统一文案：`Edit & resend — resends as a new message, keeps history`。resend 按钮同理标注 `Resend — keeps history`。

---

## 5. 切片计划（每片可独立验收合入）

| 切片               | 范围                                                                                                                                                             | 依赖                                 | 退出标准                                                                                              |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| **S1 Model tabs**  | §2 全部四组件 + 本地 presets store + settings 分区重写。**不碰面板**。                                                                                           | 无（契约 icon 字段已存在，桥已剥离） | 旧 ModelSettingsSection 的画廊/Routes/key 盒三块全部消失；路由 CRUD/图标/key/活动切换全在 tabs 内闭环 |
| **S2 面板转录流**  | §3.1 骨架 + §3.2 全 row 类型 + §3.3 拆分 + §3.5 store 重构（tool 合并行、turn-end 药丸、todo 出列）+ §3.6 CSS。composer 维持旧 footer 简化挂底（不阻断面板可用） | S1 无依赖，可与 S1 并行              | 面板视觉/交互与 §3.2 表逐行对齐；无 "working…" 纯文字行、无双 tool 行、无内联 todo 卡                 |
| **S3 composer 卡** | §3.4 全部（模式 chip 迁移、model chip、ContextMeter、34px 主按钮形态、SlashMenu、edit-mode 注记条、附件条入卡）+ 上下文条删除                                    | S2（骨架就位）                       | composer 单卡承载输入/附件/模式/模型/上下文/发送停止；旧 footer 与上下文条删除                        |
| **S4 差距收尾**    | §4.1 契约+daemon+store+UI；§4.2 契约+daemon+UI；§4.3 标注                                                                                                        | S2（行结构）、S3（注记条）           | 三项差距在发布会演示脚本中可复现且语义正确                                                            |

---

## 6. 验收清单（发布会截图测试标准）

通用前置：light + dark 双主题截图；440px 常驻栏与 <720px 覆盖态各一组；`prefers-reduced-motion` 下扫光降级不残影。

### S1 · Model tabs

**PM 功能点**

- [ ] 新建路由三条路径齐通：预设选卡、空白 Custom、另存预设后再用。
- [ ] 每 tab 闭环：换图标 → 粘 key（pill 翻 configured）→ 增删模型 tag（即时生效，kernel 热加载，面板 composer model chip 同步出新模型）→ Set active（tab 条下划线迁移 + toast）。
- [ ] 删除路由有确认；删除活动路由后「active outside tabs」警示出现。
- [ ] env 注入活动模型（无对应 tab）→ 警示 chip 常显。
- [ ] 重复 provider 名内联报错；非法 URL/空 models 报错文案与现有一致。
- [ ] 上传 >64KiB 图标被拒并 toast。

**视觉验收**

- [ ] 截图 A：3 路由 tabs（其一 key 缺失 amber 点、其一活动 primary 下划线）+ NewTab pick 态搜索 + 2 列卡片网格。
- [ ] 截图 B：NewTab form 态（预设预填：图标/名/URL/模型 tags 带 vision 徽标）。
- [ ] 截图 C：IconPicker popover（目录网格 + Upload + Letter）。
- [ ] 截图 D：tab 溢出横滚 + 渐隐 mask + 固定 `+ New`。

### S2 · 面板转录流

**PM 功能点**

- [ ] 一轮完整对话回放：TurnDivider → ThinkingRow（流式自动展开 → 定稿收起+首行摘要）→ ToolRow ×N（call/result 单行，展开分型卡）→ AssistantMessage（13px markdown）→ TurnEnd 药丸（↑/↓/时长）。
- [ ] 运行态唯一 affordance = 扫光（thinking 摘要 / tool 摘要 / Working 文字）；全程无 spinner/pulse。
- [ ] Working 15s 后出现计时并每秒跳动。
- [ ] TodoDock：有 todos 显示折叠头 `done N · active M · pending K`，展开三态样式正确；无 todos 隐藏。
- [ ] 上滚脱离贴底后 back-to-bottom FAB 出现，点击回底并恢复跟随。
- [ ] 审批卡待答/已答两态；resolved 半透明。

**视觉验收**

- [ ] 截图 A（流式中）：thinking 展开 + tool 行扫光 + assistant 半段 markdown + Working 行。
- [ ] 截图 B（定稿后）：thinking 收起带首行摘要、tool 行完整摘要、TurnEnd 药丸。
- [ ] 截图 C：user 消息（附件上图下气泡 + 下方 hover 操作行）、assistant 全宽无气泡对同屏对比。
- [ ] 截图 D：bash 展开暗底 terminal 卡 + diff 卡（+/- 配色）。

### S3 · composer 卡

**PM 功能点**

- [ ] 模式 chip：切模式（idle 成功 / running 拒绝）；无会话时点击 = 以该模式开新会话。
- [ ] model chip：热切模型后面板下一轮即用新模型；running 置灰；悬空路由警示态。
- [ ] ContextMeter 环随 lastUsage 变化；点击弹用量面板 + compact 可用（原上下文条语义无回归）。
- [ ] 主按钮形态机：空稿禁用 → 有稿发送↑ → running 空稿停止■ → running 有稿置灰。
- [ ] Enter 发送 / Shift+Enter 换行 / 粘贴图片 / 拖入混合文件（守卫与 toast 文案沿用）。
- [ ] `/` 触发 SlashMenu，Enter 执行 /compact。

**视觉验收**

- [ ] 截图 A：composer 卡全貌（附件条 + 文本 + 左右簇完整），34px 圆形按钮特写。
- [ ] 截图 B：model chip 菜单（routes 分组）与 ContextMeter 用量面板展开。
- [ ] 截图 C：edit-mode 注记条（amber）叠加态。

### S4 · 差距收尾

**PM 功能点**

- [ ] 长命令 bash 调用：折叠摘要随参数流渐进变长；展开 IN 卡流式渲染。
- [ ] 发图后切换会话再切回：图片缩略回显（payload.thumb）；文件名 chip 回显。
- [ ] edit 注记条出现/消失正确；发送后历史完整保留（含被编辑的原消息）。
- [ ] 契约测试更新：新帧 kind / attachments / toolCallId 进 zod schema 与 daemon 单测（`test/dsh-kernel.test.ts`、`test/dsh-session-binder.test.ts`、`webui/src/lib/__tests__/agent-panel.test.ts` 相应扩展）。

**视觉验收**

- [ ] 截图 A：bash 参数流式中（摘要 + 展开卡光标扫光条）。
- [ ] 截图 B：回放会话的图片回显 vs 发送时原图缩略（同视觉语言）。

---

## 7. 风险与妥协声明

- **原生 select 会话选择器保留**（无省略号问题已有 title 兜底）：本轮不换自定义下拉，聚焦两大战场。
- **route 改名不支持**：身份字段（provider = 凭据 env 映射键）改名等于重建，以「复制重建」覆盖；title 文案明示。
- **ContextMeter 精度**：inputTokens 是近似上下文占用（无 cache 命中细分）；环图 75%+ 变 amber 提示，不自动 compact（手动 compact 保留）。
- **tool 合并行的无 callId 回退匹配**（同 turn 内同 toolName 最近未闭合项）在并行同名工具时可能错位——S4 契约落地 callId 后消除；S2 阶段为已知妥协。
- **本地 presets 不跨设备**：localStorage 作用域即设计意图（个人开发者预设），不入 daemon 持久层。
