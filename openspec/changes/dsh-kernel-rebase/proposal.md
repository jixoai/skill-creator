# Proposal: dsh-kernel-rebase

## Why

用户原始需求 [2026-09-05]（manager-workbench）：「管理器首先得是管理器，然后接入 Agent 能力；我要的是产品级的可上线应用。」
用户原始需求 [2026-09-05]（agent-steward）：「让 Agent 成为我的技能管家；它应该能禁用、分析、优化、拆分、合并 skills，但必须服务于管理器。」
用户原始需求 [2026-09-06]（GOAL.md）：「以 DSH 为 Agent 开发基础，合并 Agent 配置/交互面板，提供技能分析、禁用、优化、拆分、合并；产品级应用而非 DEMO。」

现行实现把第 3 句的「合并」方向做反了：`dsh-webui-composition` 把 DSH 完整 Web 组合
（149 entries 的 dsh-web-app + client-modules 体系）当作产品宿主，Skill Creator 的
Manager views 以 island 插件嵌在 DSH WebUI 里。用户明确否定了这个形态：**不需要完整
的 DSH WebUI（它本身也是个插件），需要的是 DSH 的内核**。正确形态是反过来的——
Skill Creator 自己的 shell 是产品主体，Agent 的配置与交互面板作为一块能力面接入；
DSH 以内核形式（agent runtime、session、tools、system-prompt、presets、approval、
sandbox）作为这块能力面的驱动底座。

本 change 把产品 rebase 回用户原文的方向，同时保留既有 Manager authority、技能管家
协议、确定性 runtime 与全部安全不变量——它们与宿主形态无关。

## What Changes

- **宿主反转**：Skill Creator 自有 shell（ChromeTabs + Workspaces/Creator/Repository
  三 App + OpenTray 窗口）恢复为产品唯一宿主与唯一入口；移除 DSH Web 组合宿主化的
  产品路径（daemon 不再默认挂载 dsh-web-app 完整 profile；入口握手桥、Manager
  island、sidebar 注入随之下线）。
- **DSH 角色重定为内核**：只组合官方内核 seam（`dsh-agent`/`dsh-agent-loop`/
  `dsh-session`/`dsh-tools`/`dsh-system-prompt`/`dsh-agent-presets`/approval/sandbox，
  以 2026-09-06 audit 的 seam 表为准），在 daemon 内以 headless 组合驱动 Agent 会话；
  不挂载其 WebUI、不复制其 store、不接管其 boot kernel。
- **Agent 面板（新能力面）**：在 Skill Creator shell 内提供 Agent 会话的交互面板
  （对话流、工具行、审批请求、模型/preset 配置投影）——自研 Svelte 组件，消费 DSH
  内核事件投影；具体形态（全局侧栏 / per-tab 面板 / 两者兼有）在 design 定稿。
- **能力供给**：把 Skill Creator 的领域能力（skills/workspaces/creator/repository/
  steward 的确定面）以 **MCP server + MCP-apps** 形式供给 Agent 会话——Manager 仍
  拥有全部 mutation authority（用户原始需求 [2026-09-05]：「Manager 永远拥有路径、
  文件、revision、启停、安装、更新、draft、approval 和 audit authority。」），Agent
  经 MCP 调用只获得受作用域限制的只读 + 提案能力；具体协议切面（MCP transport、
  app 形态、与既有 skillSteward 工具面的关系）在 design 定稿。
- **复用与退役清单**：保留 DSH 版本锁定矩阵、heal/闭包镜像、headless boot 生命周期、
  session-binder、确定性 steward runtime 与全部产品测试；退役 dsh-web-app 宿主路径、
  入口桥、island bundle 通道（`/manager/*`）与 DSH web 鉴权代理面。

## Capabilities

- 新增：`agent-kernel` —— daemon 内 DSH 内核 headless 组合：capability handshake、
  agent/session 生命周期、事件投影、配置（model/preset/permission）service 的受控取用。
- 新增：`agent-surface` —— Skill Creator shell 内的 Agent 交互面板与 MCP 能力供给
  （面板组件、MCP server、MCP-apps 注册面）。
- 修改：`dsh-webui-composition` —— 宿主化 requirements 标记退役（入口桥、island、
  DSH Web 宿主）；其内核侧事实（版本锁定、seam 审计）并入 `agent-kernel`。
- 不变：Manager authority（`manager-core`）、技能管家协议（`skill-steward-contracts`）、
  确定性 runtime（`skill-steward-runtime`）、产品工作流语义（`steward-product-workflow`
  的 store/代次门/终态停轮询等修复全部保留，仅换宿主）。

## Impact

- `src/daemon/`：dsh-host-lifecycle 从「web profile 宿主」改为「headless 内核组合」；
  web-server 退役 DSH 代理/握手桥/`/manager/*` 分区；新增 agent-kernel 域模块与 MCP
  server 模块。
- `webui/`：三 App 回归自有 shell 布局；新增 Agent 面板组件族（对话流/工具行/审批/
  配置）；dsh-island 通道退役。
- 契约：`dsh-runtime.ts` 重组为 agent-kernel 投影；新增 `agent-surface` 契约（面板
  RPC + MCP 供给声明）。
- 测试：dsh-webui-composition 的宿主类测试（mount/island/入口桥）随宿主退役移除或
  改写为内核等价断言；steward 全链测试换宿主后必须保持通过。
- 打包：`dist/dsh-client`（client plugin vendor）退役；内核组合的依赖闭包进入
  bundle externals 校验；clean-install drill 更新为内核形态。

## Non-goals

- 不维护双宿主（DSH WebUI 与 Skill Creator shell 二选一，本 change 后者为唯一产品面）。
- 不把 DSH session/settings/profile 文件写入 Manager registry（既有红线不变）。
- 不在本 change 决定 MCP 之外的外部生态策略（市场/分享/多租户，另行规划）。
- 不削弱任何安全不变量：loopback-only、token-in-fragment、server-owned path、
  containment、审批与审计链全部保留。
