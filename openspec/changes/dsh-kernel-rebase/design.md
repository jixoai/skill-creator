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
- DSH 0.1.2-rc.1 **没有内置 MCP client/connector**（dsh-tools 仅在工具描述处理注释中
  提及 MCP 格式）；agent 会话的工具来源是 `ctx.tools.register`（dsh-tools）。
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
- OpenTray 窗口 = Skill Creator shell + 面板；无第二窗口、无 iframe。

## D3 能力供给（定稿：能力定义层 + 双投影）

- **能力定义层**：以 skillSteward 工具 registry 为基础抽出 `capability-core`——
  领域能力 = 名称 + Zod 输入输出 + handler + authority 声明（只读 / 提案 / 需审批
  mutation）。skills.list/analyze/relations/inspect/propose/validate/approve/apply/
  rollback、workspace.list、creator 读写、repository 预览安装逐项登记。
- **投影 A（内置聊天框）**：capability-core → `ctx.tools.register`（dsh-tools），内核
  agent 会话直接可用；mutation 能力仍走审批链（现有 skillSteward 语义）。
- **投影 B（MCP）**：capability-core → 进程内 **MCP server**（transport：loopback
  streamable HTTP + stdio），同一 handler 集合暴露为 MCP tools；`resources` 暴露
  技能文档/快照等只读面。供外部 MCP-capable agent（Claude Code、Codex 等）与未来
  MCP-apps 接入；**MCP 面的 mutation 同样落 approval 链**（对外只产生提案，不直接
  写盘——与「Manager 永远拥有 authority」原文一致）。
- MCP-apps：第一期以 tools + resources 落地，app 形态（带 UI 的能力面）留
  `capability-core` 的扩展位（声明式 app manifest），不在本期实现。
- MCP SDK：`@modelcontextprotocol/sdk`（TypeScript 官方）进 dependencies；server 由
  daemon 持有，endpoint 鉴权与 loopback 红线一致。

## 退役清单（hosted 形态下线）

- `dsh-web-app` / `dsh-web-frontend` / `dsh-host-webserver` / `dsh-host-frontend-static` /
  `dsh-client-*` 全家：dependencies 移除（heal 镜像相应缩小）。
- `bootOfficialWebProfile` 的 web 双 bundle、web-runtime user patch、DSH web 鉴权代理
  （proxyToDsh/proxyUpgradeToDsh）、入口握手桥（needsDshEntryHandshake/401 自愈/cookie
  名计算）、`/manager/*` island 资产通道（serveManagerAsset）、`dist/dsh-client` vendor
  与消费者 node_modules 链接。
- webui：`dsh-island/`（entry/nav/IslandRoot/IslandShell）、`@skill-creator/dsh-client`
  plugin 包、`vite.island.config.ts` 通道。
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
4. MCP server 投影（capability-core → MCP tools/resources + 鉴权 + 测试）。
5. 退役 hosted 形态（依赖移除、island/桥/代理下线、vendor 清理、打包校验）。
6. 产品验收 + clean-install drill + 全量门禁。

每阶段独立可交付、独立提交；阶段 5 之前新旧路径并存但产品入口只指新面（避免双宿主
同时作为产品面）。

## 风险与对策

- 内核 rows 中 settings/credentials 的组合行为在无 web 模式下未经产品级使用 → 阶段 2
  首个任务即做 headless boot 的 capability handshake 实测，失败项进入 typed unavailable。
- MCP server 的 loopback 暴露面扩大攻击面 → 沿用 token-in-fragment 模式不适用于
  stdio；stdio 仅本机显式启动，HTTP 走既有 web token 鉴权 + loopback。
- 面板会话与 skillSteward run 的身份关系（同一 session 还是独立）→ 阶段 2 design
  note 定稿：steward run 继续绑定内核 session（session-binder 不变），面板会话是
  内核 session 的产品投影，不另造第二身份。
