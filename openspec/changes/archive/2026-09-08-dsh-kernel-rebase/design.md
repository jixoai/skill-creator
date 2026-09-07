# Design: dsh-kernel-rebase

原始需求（2026-09-08）：「在现有 skill creator 的基础上实现一个 Agent 的产品……我需要
的是 DSH 的内核。把整个 skill creator 的各种能力内置成 MCP 和 MCP-apps，给到聊天对话
框。」方向锚点：「管理器首先得是管理器，然后接入 Agent 能力」（2026-09-05）。

本文定稿三个核心决策（D1–D3），并固化退役/保留清单与迁移顺序。

## 事实基础（2026-09-08 复核）

- `@deepseek-ai/dsh-base` 的 `cordis.patch.yml` 是 **85 rows 的纯服务侧内核**：
  llm / session（log、persistence、projection、query、telemetry）/ agent（default-model、
  instructions、presets 经 settings）/ jobs / settings / credentials / sandbox
  （policy、bash、pwsh、fs）/ approval / permission / shell-env / tool-bash / tool-fs /
  skill / skill-filesystem / commands / goal / plan-mode / token-meter / compaction /
  subagent / workflow / timeout。**零 web rows**（webserver/web-frontend/client-* 全部
  在 dsh-web-app 模式 bundle 叠加层）。
- `bootOfficialWebProfile` 现挂 `["dsh-base", "dsh-web-app"]` 两个 bundle；内核形态是
  同一机制只挂 `dsh-base`，web 相关 user patch（web-runtime flags）不再写入。
- **一切皆插件**：官方 `@deepseek-ai/dsh-mcp-client`（latest 0.0.1-rc.1 / next
  0.1.2-rc.1 与锁定家族同代，deps 含 `@modelcontextprotocol/sdk`）把 MCP server 的
  tools 注册到 `ctx.tools`——内核会话消费 MCP 能力走官方桥，零自研 client。
- **MCP Apps**（官方 MCP 扩展，SEP-1865，2026-01-26）：tool result 以
  `_meta.ui.resourceUri` 指向 `ui://` raw HTML+CSS/JS 资源；client/host 在沙箱
  iframe（严格 CSP）渲染，JSON-RPC over postMessage（`ui/initialize`、
  tool-input/result 通知）双向通信。与前端框架无关（纯 HTML 成立）；Claude/VS Code/
  Postman/M365 Copilot 均已实现 host 端，生态成熟。
- 既有可复用资产：版本锁定矩阵（`dsh-runtime.ts`）、heal + 闭包镜像
  （`completeTransitiveMirror`）、boot 生命周期与降级语义、`dsh-session-binder`（run↔
  session 绑定 + 事件投影）、skillSteward 工具 registry（typed tools + 审批链）。

## D1 内核取用范围（定稿）

- `dsh-host-lifecycle` 改为 **headless 内核组合**：`initProfile(["@deepseek-ai/dsh-base"])`
  单 bundle；不再 import/boot dsh-web-app；无 HTTP server 挂载（内核不需要端口）。
- 内核消费面（daemon 内）：`ctx.agents`（create/resume/cancel/事件）、settings/model/
  preset 投影、approval/permission 服务、`ctx.tools.register`（注册 Skill Creator 能力）。
- heal/闭包镜像/版本锁定原样保留（clean-install 证据链不变，镜像目标随 web rows
  缺席自然缩小）。
- **内核工具面策略（安全红线）**：dsh-base 85 rows 含 `tool-bash`/`tool-fs` 等通用
  工具行——产品组合**禁用这些行**（row `disabled: true`，与 hmr 行同法），产品 Agent
  会话的全局工具表只含 capability-core 经 MCP 桥注册的能力集；既有 steward 安全前提
  （「全局工具表为空、agent scope 只注册域工具」）平移为「全局表只含受控能力」。阶段 2
  首个任务以负面场景钉死：会话调用 bash/fs 类能力 → 拒绝并审计。
- 降级语义不变：内核 boot 失败 → typed reason + Manager-only 恢复面（现在恢复面就是
  产品本体，Agent 面板显示 unavailable）。

## D2 Agent 面板形态（定稿：全局右栏 + 会话切换）

- **全局 Agent 面板**：shell 级右栏 drawer（宽约 420–560px，可收起），跨 tab 存活；
  窄屏（<720px）切换为单屏覆盖模式。不做 per-tab 会话——会话与 workspace target 可
  在面板内切换绑定（与 skillSteward run 的 target 语义对齐）。
- 自研 Svelte 5 组件族：会话列表/切换、对话流（消息行 + 工具行可展开 + 审批请求卡
  - 终态叙述）、模型/preset/permission 配置投影（读写经 settings service，approval
    policy 的 ask/never 语义沿用）。**不依赖 DSH web 前端产物**。
- 数据通道：新 RPC namespace `agent.*`（会话 list/create/prompt/stream 投影/settings
  patch/decide），WS 流式（沿用 oRPC + 代次门；终态停轮询等 4.9 修复语义平移）。
- **MCP Apps host 渲染端**：面板按官方 spec 渲染 `ui://` 资源（沙箱 iframe + 严格
  CSP + postMessage JSON-RPC 通道）。卡片内「应用内跳转」意图经 ui 通道的自定义
  extension method 送达 host，由 host 翻译成 shell 路由（ChromeTabs 内导航），卡片
  本体不直接触达 shell。
- **第一期卡片清单**（DL-5）：skill 信息卡（名字/描述/启停/provider，跳技能详情）、
  finding 卡（severity/涉及技能/证据摘要，跳 Intelligence 定位）、proposal 卡
  （action + mutation/revision 摘要，跳审批工作流）、安装/更新结果卡（逐项
  succeeded/skipped/failed）；工作区概览卡视余量。
- OpenTray 窗口 = Skill Creator shell + 面板；无第二窗口。卡片沙箱 iframe 是 MCP
  Apps 协议的渲染单元，不是第二产品入口。

## D3 能力供给（定稿：官方 MCP 桥 + MCP Apps 卡片 + 提示词最佳实践）

- **能力定义层（capability-core）**：以 skillSteward 工具 registry 为基础抽出——
  领域能力 = 名称 + Zod 输入输出 + handler + authority 声明（readonly / proposal /
  approved-mutation）。skills/workspace/creator/repository/steward 逐项登记；模块
  不硬依赖 daemon 运行态（供独立 mcp-server 实例化）。
- **skill-creator-mcp（MCP server，双形态，同一实现）**：
  - 进程内优先（DL-4）：daemon 域模块，挂 web-server 的 `/mcp` 端点（streamable
    HTTP，loopback + 既有 token 鉴权）；dsh-mcp-client 连
    `http://127.0.0.1:<port>/mcp`。
  - 独立启用：CLI 子命令 `skill-creator mcp` 以 stdio transport 启动同一 server，
    供外部 client spawn；不依赖 daemon 常驻。
- **内核消费（官方桥）**：内核 profile 组合 `@deepseek-ai/dsh-mcp-client` 插件行
  （cordis row + 连接配置指向 skill-creator-mcp），其 tools 注册进 `ctx.tools`——
  内置会话与外部 client 走**同一条真 MCP 路径**，不自研投影桥。
- **MCP Apps 卡片**：能力声明可选携带 `ui://` HTML 资源（tool result
  `_meta.ui.resourceUri` 指向），按 D2 的 host 渲染端显示；卡片交互经 postMessage
  JSON-RPC 回 MCP server，跳转意图由 host 转 shell 路由。卡片是**提示词引导下的
  AI 自发行为**（见下），不是架构强制的类型系统。
- **提示词最佳实践（system prompt 注入）**：经 dsh-system-prompt 有序 section
  注入版本化最佳实践——告知 AI 可用的 skill-creator-mcp 能力面、何时用卡片代替
  纯文本（涉及领域对象展示、可跳转操作、结构化结果时）、卡片的使用约定。智能在
  模型侧；架构侧只提供能力与引导。
- **形态边界（DL-4 收窄）**：stdio 独立形态第一期为 **readonly + propose-only**
  ——mutation 仅经进程内 `/mcp`（与 daemon 审批链同进程，proposal 存储/审批/audit
  归属唯一）；完整独立 mutation 待后续 change 定义跨进程单写者协议后开放。stdio 形态
  的 propose 结果**返回给 client 自持**（不入 Manager 存储、不在 Manager 面板投影，
  无死信问题）；需要 Manager 审批链的提案走 `/mcp` 形态。
- **`/mcp` 鉴权**：streamable HTTP 走 `Authorization: Bearer <web-token>`（同一枚
  daemon web token；dsh-mcp-client 连接配置注入该头；外部 client 从 `skill-creator
status` 获取）。stdio 形态无网络面，进程由本机用户显式启动。
- **`ui://` 资源通道**：面板不是 MCP client——host 渲染所需的 `ui://` 资源经
  `agent.*` 代理 RPC（daemon 内读取同一 MCP server 的资源表）获取，协议形状与
  SEP-1865 一致。
- **authority 红线**：MCP 面（内置与外部一致）的 mutation 一律产 proposal 走
  Manager 审批链（「Manager 永远拥有 authority」原文）；MCP 暴露面遵守 loopback /
  token 鉴权红线。

## 退役清单（hosted 形态下线）

- `dsh-web-app` / `dsh-web-frontend` / `dsh-host-webserver` / `dsh-host-frontend-static` /
  `dsh-client-*` 全家：dependencies 移除（heal 镜像相应缩小）。**保留白名单**：
  `dsh-persona` / `dsh-tool-ask-user` / `dsh-agent-tool-presentation`（agent-presets
  行必需，不在 dsh-base 闭包内——dsh-official-profile.ts 头注的既有教训）与
  `@deepseek-ai/dsh-mcp-client` 及其 peer 四包；退役按显式清单执行，不按「非
  dsh-base 闭包皆删」推断。
- `bootOfficialWebProfile` 的 web 双 bundle、web-runtime user patch、DSH web 鉴权代理
  （proxyToDsh/proxyUpgradeToDsh）、入口握手桥（needsDshEntryHandshake/401 自愈/cookie
  名计算）、`/manager/*` island 资产通道（serveManagerAsset）、`dist/dsh-client` vendor
  与消费者 node_modules 链接。
- webui：`dsh-island/`（entry/nav/IslandRoot/IslandShell）、`@skill-creator/dsh-client`
  plugin 包、`vite.island.config.ts` 通道。归档本 change 时同步重写主线
  `dsh-webui-composition` capability 的 Purpose（宿主化表述过期）或整体退役该
  capability、authority 分句并入 manager-core/agent-kernel；同批重写主线
  `steward-product-workflow` 的 Purpose（「DSH Web host 的 Manager island」表述随宿主
  反转过期）。
- 对应测试改写为内核等价断言（dsh-manager-mount / dsh-official-profile 的 web 断言 →
  headless 内核断言）；steward-product-workflow 的 store/UI 测试平移到自有 shell。

## 保留清单

- Manager 全部 authority 与安全不变量；skillSteward contracts/runtime/audit/rollback。
- DSH 版本锁定矩阵、heal + completeTransitiveMirror、boot 降级语义、session-binder、
  deterministic fixture runtime（测试用）。
- OpenTray appMode 窗口模型、CLI 生命周期、clean-install drill（更新为内核形态断言）。

## 迁移顺序（阶段，对应 tasks.md）

1. capability-core 抽取（不动行为，纯重构 + 回归绿）。
2. headless 内核组合（dsh-host-lifecycle 改造 + `agent.*` RPC + 内核等价测试）。
3. Agent 面板（webui 组件族 + 1100/680 验收）。
4. MCP 供给（skill-creator-mcp 双形态 → dsh-mcp-client 组合 → ui:// 卡片 + 提示词；桥组合依赖 server 先立）。
5. 退役 hosted 形态（依赖移除、island/桥/代理下线、vendor 清理、打包校验）。
6. 产品验收 + clean-install drill + 全量门禁。

每阶段独立可交付、独立提交；阶段 5 之前新旧路径并存但产品入口只指新面（避免双宿主
同时作为产品面）。

## 风险与对策

- 内核 rows 中 settings/credentials 的组合行为在无 web 模式下未经产品级使用 → 阶段 2
  首个任务即做 headless boot 的 capability handshake 实测，失败项进入 typed unavailable。
- MCP server 的 loopback 暴露面扩大攻击面 → 沿用 token-in-fragment 模式不适用于
  stdio；stdio 仅本机显式启动，HTTP 走既有 web token 鉴权 + loopback。
- 面板会话与 skillSteward run 的身份关系 → 已定：steward run 继续绑定内核
  session（session-binder 不变），面板会话是内核 session 的产品投影，不另造第二身份。
- `dsh-mcp-client` 处于 0.0.x-rc（next 0.1.2-rc.1 与家族同代）且 peer 闭包含
  `dsh-scope`/`dsh-timeout`/`dsh-attachment`/`dsh-subprocess`（本仓 dependencies
  现缺，需一并入锁定矩阵——dsh-official-profile 既有缺包教训）→ 阶段 4 组合实测
  （连接 /mcp、tools 注册、tool round 全链）；漂移按 typed unavailable 处理。
- MCP Apps host 沙箱（CSP、postMessage 白名单）在 Svelte 面板内的实现细节 → 阶段 3
  以 spec 的 `ui/initialize` 握手为验收锚点，逐条对齐 spec MUST 项。
