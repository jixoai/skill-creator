# Design: add-agent-settings-modes

事实源：`/tmp/deepseek-harness-review`（官方 webui 源码审计，2026-09-08）与
`node_modules/@deepseek-ai/dsh-tools`（guard 语义）。

## D1 模式 = prompt section + 工具面（DSH presets 的产品化）

DSH 官方的「模式」是 agent preset：persona + tools + prompt sections 的 agent-plane
组合，UI 为 chips；宿主在会话有历史后拒绝换装。本产品按用户定义把每个模式视为
一份被灌成系统提示词的 skill：

```text
agent-modes.ts（daemon kernel，权威注册表）
  create  : section "skill-creator-mode-create"  + MCP 名单（creator_*/skills 读面/workspace 列表）
  manage  : section "skill-creator-mode-manage"  + MCP 名单（skills 全量 + workspace + propose 面）
  explore : section "skill-creator-mode-explore" + MCP 名单（repository_*/sources_* + skills 读面）
  free    : 无专有 section（基础最佳实践即全部） + 全部 mcp__skill-creator__*
```

- section 文本版本化（`AGENT_MODE_PROMPT_VERSION`，内容变更必 bump）；
  free 模式不注入专有 section——「无收窄」就是它的定义。
- 模式目录（id/label/description/tokenHint）为 shared browser-safe 常量
  （`DSH_AGENT_MODES`），UI 从契约导入，不维护第二份手抄。

## D2 模式切换：dispose + 惰性 resume（与 DSH「拒绝换装」的差异）

内核 prompt section / guard 在 agent setup 时注册，live agent 不可热替换。切换路径：

```text
setMode(sessionId, mode)
  ├─ status === running → INVALID_OPERATION（typed rejection）
  ├─ transcripts.updateMode：meta.json 原子重写（mode 字段）
  ├─ live 句柄：释放待答（空答案）→ dispose → 移出 live 表
  ├─ append "mode-changed" 帧 {from, to}（live 环 + 转录落盘）
  └─ 返回新摘要（status 投影 disposed——下一次 prompt 经 agents.resume 复活）
```

LLM 历史事实归内核 session log（resume 重建），面板转录只是投影——与既有跨重启续聊
同一机制，无新增历史搬运。

## D3 工具面：全局 restrict 不变 + agent-scoped guard 收窄 MCP

`restrict` 管不到 scoped 注册（mcp 工具是 agent-plane 注册），但内核 `tools.guard`
在调度管线内求值、经 `agent.ctx` 注册只作用于该 agent、且「no guard can force-allow
a call another guard denied」——guard 是 scoped 工具收窄的正确 seam：

```text
setup(agentCtx):
  applyProductToolSurface(agentCtx)        // 既有全局 deny（fs/shell/web 行早已 disable）
  agentCtx.tools.guard?(exec =>
    exec.name 以 mcp__skill-creator__ 开头 且 不在 mode 名单
      ? `${exec.name} is not available in ${mode} mode; switch modes from the panel.`
      : undefined)
  registerProductPromptSections(agentCtx, mode)
```

模式名单以 `mcp__skill-creator__` 前缀 + capability 名（`skills.list → skills_list`）
表达；未知新 MCP 工具默认 deny（free 模式除外——前缀放行）。

## D4 模型配置（DSH webui UX 移植，收敛到既有 settings 服务）

| DSH 官方                           | 本产品移植                                                                          |
| ---------------------------------- | ----------------------------------------------------------------------------------- |
| settings mirror + path-ops         | 既有整补丁 `agent.settings.update` + revision                                       |
| 只写 API key（credentials/set）    | 既有 `agent.credentials.set/clear`（0600 私有文件，视图只回 configured）            |
| 会话级 ModelSelection 菜单         | 全局默认模型（settings.model）+ reasoningEffort 可选输入                            |
| provider 目录（llm.listProviders） | datalist：deterministic provider + 启动时 env 本地路由 provider + 已配凭据 provider |
| effort 二级菜单（adapter 目录）    | 自由文本 + placeholder（ReasoningEffortId 是 adapter-owned 品牌类型，无固定枚举）   |

既有跨字段校验（`PRESET_REQUIRES_CREDENTIAL` / `MODEL_PROVIDER_WITHOUT_CREDENTIAL`）
不动——live preset 与凭据的一致性由服务端裁决。

## D5 持久化与兼容

- `DshStewardSettingsSchema` 增 `defaultMode: DshAgentModeSchema.default("create")`
  （旧文件 safeParse 通过，additive）；`settingsEqual` 纳入该字段。
- 转录 meta 增 `mode`（外部输入收窄）：缺失/非法读为 `"free"`——旧会话创建时就是
  全工具面 + 基础提示词，free 是其能力的事实投影（不是迁移）。
- `AgentSessionSummary` 增 `mode`；`agent.session.create` 接受可选 mode（缺省取
  settings.defaultMode）；新增 `agent.session.setMode`。
- 会话流帧 kind 增 `"mode-changed"`（payload `{from, to}`，经 redactDshPayload）。

## D6 UI

- AgentConfigSection 重设计为分区设置面：Model（provider/model/effort/key）、
  Default mode（四卡）、Behavior（preset/approval）。key 输入 type=password 只写；
  configured 徽章来自 view.providers。
- 面板 header 增当前会话 mode chip + 菜单（切当前会话；running 时禁用并提示）；
  `mode-changed` 帧渲染为与 turn 分隔线同族的分隔行。
- 模式目录文案（label/description/tokenHint）由 shared 常量提供，free 卡明确
  token 成本提示。
