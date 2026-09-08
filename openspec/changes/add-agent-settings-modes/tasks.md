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
