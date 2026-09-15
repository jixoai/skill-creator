# Proposal: dsh-alpha-native-subagents

## Why

用户裁决 [2026-09-15]（grill-me Q3-R + 后续两条指示）：

- 「先不做，但是往 dsh 内置的子代理能力去靠。把子代理的能力对接上来就好。有了子代理的支持再说。」（Q3）
- 「关于 dsh 原生子代理，官方不是已经支持了吗？ https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/subagent 」（推翻产品侧 Roles 桥接提案）
- Q3-R：「A」（采纳 dsh-base@0.1.6-alpha.1，Roles 骑原生子代理）

现状：内核锁 @deepseek-ai/*@0.1.5-rc.2（next tag），无子代理能力；Roles 概念只有
提案文档（docs/research/2026-09-12-roles-as-subagents.md，§6 已裁决产品侧桥接
方案否决）。官方 0.1.6-alpha.1（alpha tag）全家族 22 包均已发布，包含
@deepseek-ai/dsh-subagent 原生子代理（ctx.subagents / ctx.tools 注册面）。

## What Changes

- **DSH 家族升级**：22 个 @deepseek-ai 依赖 0.1.5-rc.2 → 0.1.6-alpha.1；内核
  适配升版面的 breaking changes；capability handshake 版本矩阵同步；cordis 家族
  保持不动（4.0.2 / 1.0.3）。
- **原生子代理接入**：产品内核在 ctx 组装点注册产品子代理（经 dsh-subagent
  API），子代理生命周期（spawn/join/abort）与转录/事件流投影到 Agent 面板；
  工具面收窄法则对子代理工具行同样生效（专注模式 deny 收窄不因子代理旁路）。
- **Roles 骑原生子代理**：Role = 子代理定义（版本化 prompt section + 受限工具面
  - 明确的返回契约）；从会话内 spawn，结果以事件回到父转录；Roles 目录成为
    browser-safe shared 常量（UI 不手抄）。
- **面板 UI**：子代理活动可见（spawn 进度、转录摘要、取消），不引入第二宿主面。

## Non-Goals

- 不在本 change 内做 composer 能力矩阵复刻（独立 change：capability-parity，
  依赖本升级先行）。
- 不把官方 webui 的 subagent UI 整面移植——只投影产品面板需要的事件面。
- 不改动 MCP authority 红线：子代理的 mutation 仍走 *_propose 审批链。
- cordis 家族不升（alpha 家族对其无版本压力时不动）。

## Impact

- 依赖：package.json @deepseek-ai/* 22 项升版 + lockfile 再生。
- specs：agent-kernel（版本矩阵、子代理注册、工具面收窄对子代理的适用）、
  agent-surface（面板投影）。
- 风险：alpha tag 稳定性——以 capability handshake 的 typed unavailable 降级
  兜底；升级破坏面以官方两 tag 间 diff 审读结果为准（调研报告）。
