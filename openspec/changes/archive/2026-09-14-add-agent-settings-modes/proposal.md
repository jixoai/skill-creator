# Proposal: add-agent-settings-modes

## Why

用户原始需求 [2026-09-08]：「新增设置面板。要支持模型配置，参考 DSH 官方的 webui 的
配置逻辑。你可以把他那套 UI 移植过来。还有一些模式的支持也一并移植过来。特别是我们
需要提供 创作模式 、 管理模式 、 探索模式 、 自由模式 至少四种模式。创作模式就是指
创建技能……管理模式主要就是管理本地已有的技能……探索模式就是到上网搜索技能、阅读并
分析它们是否符合我们的要求；自由模式就是把各种能力都整合进来（可以理解成每一种模式
本质上都是一个 skill）……前面 3 种专有模式毕竟是把 skill 灌成系统提示词，所以它们的
专注度会更高一点。」

现状（dsh-kernel-rebase task 3.3 交付）的配置面只有只读模型投影 + preset/approval
两个开关；无任何模式概念。DSH 官方 webui 已验证的配置 UX（server-owned settings +
只写凭据 + 会话级 ModelSelection + agent preset chips）值得移植，但其 preset 模型
「会话开始后拒绝换装」不符合用户对模式「互相转换」的要求，需要以本产品的
dispose + resume 机制落地。

## What Changes

- **设置面板重设计**（AgentConfigSection）：模型配置可编辑（provider/model/
  reasoningEffort，DSH ModelSelection 形状）+ provider 凭据只写面（存/清，永不回显）；
  preset/approval 行保留；新增默认模式选择。全部经既有 `agent.settings.*` /
  `agent.credentials.*` RPC（server-owned 持久化 + revision）。
- **四种 Agent 模式**：`create | manage | explore | free`。每种模式 = 版本化
  system-prompt section（skill 灌成提示词）+ 工具面收窄（agent-scoped guard 按
  MCP 工具名拒越权调用）。专有三模式专注度高；free 模式全工具面（token 消耗大，
  UI 提示）。
- **模式可转换**：会话内切换 = meta 持久化 + dispose live 句柄 + 下一次 prompt 经
  内核 `agents.resume` 以新模式 setup 复活（LLM 历史由内核 session log 保留）；
  转换以 `mode-changed` 帧写入对话流。运行中拒绝切换（typed rejection）。
- **契约面**：`DshAgentMode` 枚举 + browser-safe 模式目录（shared 常量，UI 不再手抄）；
  settings 增 `defaultMode`；会话摘要/create/setMode RPC 增 mode。

## Non-Goals

- 不启用内核通用 web 工具行（tool-web 保持 disable）：探索模式的「上网搜索」经由
  Repository/Discover 的受控 Git 源扫描（repository__/sources__ 能力面），不是任意
  web 浏览。
- 不实现 DSH 的 settings path-ops 粒度/`llm.discoverModels` 端点发现——本产品 settings
  面小，整补丁 + revision 围栏已满足（设计记录差异）。
- 不做会话内多模式并存或按 turn 自动路由；模式是会话级单值。
