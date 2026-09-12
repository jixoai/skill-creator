# PRODUCT_MODEL.md — Skill Creator 产品模型（产品体验一致性真相源）

> 维护纪律：任何需求先回答「如何进入本模型」。模型变更需随 change 一起提交。
> PM 评审（记分卡 Product coherence 维）以此为基准。字段与工程契约同步见 AGENTS.md。

## 1. 产品一句话

本地优先的 Agent 技能工作台：管理本地技能库、创作/改进技能、发现外部技能，并与内嵌 Agent 对话完成这一切。

## 2. Core User Jobs（用户来干嘛）

1. **Manage**：看清技能库（哪些技能、健康状况）、去重/合并/优化/更新。
2. **Create**：把一个任务意图变成高质量的 SKILL.md。
3. **Explore**：从外部 Git 源发现、评估、安装技能。
4. **Converse**：与 Agent 协作完成 1-3（四种模式：General 默认 / Create / Manage / Explore）。

## 3. Core Objects 与所有权树

```text
Workspace（技能作用域；Global(~) 只读 + Imported 可写）
 └─ Provider（一个 Agent 的 skills root）
     └─ Skill（真相 = Workspace.Provider 内的目录）

AgentSession（agent 对话；真相 = transcript + 内核 session log）
 ├─ Mode（General/Create/Manage/Explore；会话级，可中途切换）
 ├─ Message / Turn（含 thinking、tool 调用、附件引用）
 ├─ Tasks（todo 快照，latest-wins）
 └─ Model 引用（指向 ModelRoute，非自有）

ModelRoute（模型端点配置 = Settings→Model 的每个 Tab）
 ├─ models[]（该端点模型目录）
 ├─ Credential 引用（per-provider env-key，热生效）
 └─ icon（目录默认或自定义）

Preset（= 预填的 ModelRoute 值包；New Tab 的起始态，不是运行时类别）

Proposal（MCP mutation 审批；不直接写盘）
```

**Configuration boundary**：Workspace/Provider/Skill 的配置归 Manager 域；ModelRoute/Credential/默认模式归全局 Settings；会话级（Mode、活动模型 per 会话）归 Agent 面板。

## 4. Mental Model 与导航

```text
左侧导航（三 App + Import + Settings 齿轮）
 ├─ Workspaces（首页：快速行动 + Continue + 库索引）
 ├─ Creator / Repository（创作/发现）
 ├─ 全局 Settings Dialog（General / Model / Agent）← list-detail
 └─ 右栏 Agent Panel（440px drawer；跨 tab 存活）
```

## 5. Canonical Locations（One Concept → One Location）

| 概念                       | Canonical 真源                                                                                                                             | 允许的快捷入口（只读/跳转）                |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| 模型路由/凭据/模型清单     | Settings → Model（RouteTabs；唯一可写路由配置面）                                                                                          | composer 的 model chip（跳转到 Model tab） |
| 活动模型（settings.model） | Settings → Model（tab 内 Set active）；会话运行时可在 composer model chip 下拉热切（design §3.4；只写 `settings.model`，绝不触碰路由字段） | —                                          |
| 默认模式/审批策略          | Settings → Agent                                                                                                                           | 面板模式 chip（会话级，非默认值）          |
| 会话列表/切换/历史         | Agent Panel header                                                                                                                         | 首屏 Continue 行（跳进面板会话）           |
| 技能真相（启停/校验）      | Workspaces → Provider                                                                                                                      | 创作卡/Agent 的 MCP 工具（走 Proposal）    |
| 连接状态                   | Settings → General                                                                                                                         | 顶部断连横幅（被动提示）                   |

新增配置入口前必须在此表登记；出现第二真源 = 结构性失败。裁决（2026-09-12，codex R1 阻塞 2 × PM canonical 审计）：「路由配置」与「活动模型选择」拆为两行——前者唯一真源不变；后者是会话运行时选择（同模式 chip 语义），composer 下拉热切允许存在，因为它只写 `settings.model` 这一个运行时字段，不构成路由配置的第二写入面。design.md §3.4 与本表按此对齐。

## 6. Terminology（术语表，UI 文案不得漂移）

Session / Turn / Mode（General·Create·Manage·Explore）/ Route / Preset / Provider / Workspace / Skill / Tasks / Thinking / compact / key（configured·missing）。

## 7. State Model（必须始终可见的状态）

- 连接：connected / connecting / disconnected（横幅 + General）。
- 会话：idle / running（running = 扫光，不用 spinner）；turn 内 thinking/tool 流式态。
- 路由：key ✓ / add key →；活动模型归属 tab（primary 下划线）；env 路由 amber 警示。
- 每轮用量：context 环 + last-turn tokens（composer 语境）。

## 8. Interaction Principles

1. **DisclosureRow 24px 语法**：折叠行 = `[icon] 标题 · 摘要`，hover 换 chevron，整行可点（thinking/tool/tasks/compaction 同构）。
2. **扫光是唯一运行 affordance**；shimmer 状态文字 + 15s 计时。
3. **热生效**：路由/凭据/活动模型改动即时生效（无重启话术=「Changes apply immediately」）。
4. **Mutation 必经 Proposal 审批**；面板错误可见可恢复。
5. Journey 连续性：动作完成后给「下一步」（如 Add route → 粘 key 高亮引导）。

## 9. Primary Journeys（骨架；评审按链走）

1. **Connect provider**：Settings→Model→+New→（预设|空白）→填/选模型→Add→粘 key→key ✓→设活动模型。
2. **Chat**：面板→选/建会话→(模式)→输入(附件)→发送→看 thinking/tool/回答→用量→继续/停止/compact。
3. **Create skill**：首页行动卡或面板 Create 模式→对话起草→（Proposal 审批）→Creator 深链复核。
4. **Manage library**：首页健康检查卡→面板 Manage→发现/提案→（审批）→Workspaces 复核。
5. **Explore**：Repository 扫描→预览→安装（Proposal）。

## 10. Design Principles（身份，不是竞品复刻）

本地优先的「工作台」气质：密度高但层次分明；一个绿色主 accent；文档级排版进入对话（markstream）；所有写操作人批；0.5px 发丝线；无营销式装饰。
