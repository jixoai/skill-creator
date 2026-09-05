# Proposal: agent-steward

## Why

在 Skill Intelligence 能产出可信报告后，Skill Creator 才需要让 Agent 成为技能管家。Agent 的职责是持续分析、提出禁用/优化/拆分/合并建议并维护运行记录；Manager 仍拥有文件、revision、approval 和应用权限。

## What Changes

- 新增 provider-neutral HarnessAdapter 和 capability handshake。
- 实现 Agent steward run：analyze、recommend、draft、validate、ask approval、apply。
- Agent 只能在隔离 execution root 或 Manager-approved patch context 中工作。
- DSH/Codex 作为独立 backend；一次只启用一个，显式选择，不自动 fallback。

## Acceptance

- Agent 可生成分析、禁用、优化、拆分、合并建议，所有建议都有 evidence、observed revisions 和 approval 状态。
- backend 缺失、版本不匹配、协议 handshake 失败均显示 typed unavailable。
- 同一 Manager workflow 可替换 backend 而不改变 Draft/approval 语义。

## Non-Goals

- 不自动执行高风险优化，不直接改写已安装 Provider。
- 不同时启用两个 backend 的 provider-specific UI。
- 不把 DSH profile 或 Codex `CODEX_HOME` 作为 Manager 数据库。
