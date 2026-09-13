# Tasks: add-agent-settings-modes

## 1. 共享契约

- [x] 1.1 `DshAgentModeSchema` 枚举 + `DSH_AGENT_MODES` browser-safe 目录
      （id/label/description/tokenHint）入 `dsh-runtime.ts`；帧 kind 增
      `mode-changed`；`DshStewardSettingsSchema` 增 `defaultMode`（default create）；
      `DshSettingsUpdate` 增 defaultMode 补丁。
- [x] 1.2 agent 契约：`AgentSessionSummary` 增 mode；`AgentSessionCreateInput` 增
      可选 mode；新增 `agent.session.setMode` procedure（rpc-contract + 输入/输出
      schema）。

## 2. daemon kernel

- [x] 2.1 `src/daemon/kernel/agent-modes.ts`：模式注册表（版本化 section 文本 ×
      3、工具名单、目录一致性导出、guard reason 构造）。
- [x] 2.2 `agent-sessions.ts`：create/resume 接受 mode（缺省 settings.defaultMode）；
      setup 注入模式 section + agent-scoped guard；`setMode`（running 拒绝、meta
      持久化、有界释放 live、mode-changed 帧）；摘要投影 mode。
- [x] 2.3 `session-transcripts.ts`：meta 增 mode（缺失/非法读 free）、
      `updateMode` 原子重写、摘要投影。
- [x] 2.4 `dsh-settings.ts`：defaultMode 补丁 + settingsEqual + 默认值。
- [x] 2.5 `rpc-router.ts`：`agent.session.setMode` 装配；domain.ts 传
      defaultMode 读取。

## 3. WebUI

- [x] 3.1 store：`agentRuntimeConfig` 面扩展 defaultMode；`setAgentSessionMode`
      （generation 门 + running 拒绝提示）；会话摘要/帧类型更新。
- [x] 3.2 AgentConfigSection 重设计：Model（provider datalist/model/effort/只写
      key + clear）、Default mode 四卡、Behavior（preset/approval）；rejected/
      error 可区分。
- [x] 3.3 AgentPanel：header mode chip + 菜单（当前会话切换，running 禁用）；
      `mode-changed` 帧分隔行渲染。

## 4. 验证

- [x] 4.1 单测：agent-modes（目录/名单/section 一致性）、agent-sessions（guard
      拒越权、setMode 生命周期、create/resume mode 注入）、transcripts（mode
      round-trip、缺省 free）、settings（defaultMode 补丁/相等比较）、契约 schema。
- [x] 4.2 webui 测试：store setMode 投影与 running 拒绝；config 面板 apply 路径。
- [x] 4.3 live 验证（本地 LLM）：四模式各起会话验证 section/工具面；会话内切换 +
      重启续聊；越权工具 guard 文案；设置面板模型/凭据/默认模式 round-trip；窄屏。
- [x] 4.4 门禁：pnpm test / typecheck / webui check / build / vp fmt / git diff
      --check / npm pack --dry-run。

## 5. 迭代（2026-09-09 用户反馈）

- [x] 5.1 流式渲染断裂修复：投影 assistant/chunk text-delta 为 assistant-delta
      合并帧（120ms 窗口）；store 增量累进 + 终帧整段替换；running 态轮询
      450ms；markstream 流式态 final=false。
- [x] 5.2 设置面升格为全局：侧栏底部齿轮入口 + shell 级 Dialog 的
      list-detail 结构（General/Model/Agent 分区）；Agent 面板移除内嵌设置节。
- [x] 5.3 Esc 归属修复：模态打开时 Escape 不再连带收起 Agent 面板。
- [x] 5.4 会话下拉短化（原生 select 无省略号，长 id 硬裁）+ title 完整提示。

## 6. 迭代二（2026-09-09 用户反馈）

- [x] 6.1 自由模式显示名改为开放模式（label Free→Open；id `free` 保持稳定——
      持久化契约不变）。
- [x] 6.2 thinking 展开面：assistant/chunk reasoning-delta 双缓冲合并帧 +
      assistant/message reasoning 终帧；面板折叠 <details> 展示，流式态带指示。
- [x] 6.3 session 自动命名接入：内核 session/title 行本就激活（dsh-base 自带
      first-prompt-llm），补消费——事件投影 session-title 帧 + live title +
      转录 updateTitle + 会话列表即时改名。
- [x] 6.4 bash 接入开放模式：tool-bash 行从 boot 禁用表移除（内核原生 bash 工具
      激活）；productToolDenyList 按模式计算 deny——专注模式拒 bash，开放模式
      放行；AGENTS.md 安全边界 #14 同步。

## 7. 迭代三（2026-09-11 用户反馈：模式改名 + provider 适配）

- [x] 7.1 Open(Heavy) → General（通用模式）：去 token-heavy 标签；默认模式改
      free/General（schema default + defaults）；轻量入口提示词（v2，只列专注
      模式为可切换 skill）。
- [x] 7.2 provider 预设两档（pi-ai 装配目录即 models.dev 镜像，实测提取）：
      CN 档 zai/kimi/deepseek/minimax/阿里百炼 + 标准档 OpenAI(Responses)/
      Anthropic/Gemini + Local/Custom；预设一键建路由（协议/baseURL/模型对齐），
      key 走 DSH 凭据热面。社区无第三方 dsh-llm-* 插件（npm 实查）。
