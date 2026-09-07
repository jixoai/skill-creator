# Proposal: skill-steward-runtime

## Why

在 contracts 稳定后，需要一个不依赖外部模型的 Manager vertical slice，证明技能管家确实能观察、提议、验证、审批、应用和回滚。fixture 不是 demo backend，而是可重复验证生产协议的 deterministic runtime。

## What Changes

- 实现 Manager-owned skill tool registry 与 capability handshake。
- 实现 fixture Agent adapter：按结构化事件调用专属工具，覆盖 check、optimize、organize。
- 串联 snapshot -> finding/proposal -> validation -> approval -> apply -> audit/rollback。
- 为断线、取消、过期 revision、重复 approval、越权路径和迟到事件建立终态。

## Non-Goals

- 不接入 DSH/Codex，不实现 WebUI。
- 不允许通用 filesystem/shell 工具进入 steward contract。

## Acceptance

在隔离 fixture Provider 中，对一个或多个 skill 运行三个任务，看到证据和 patch，显式批准后按 transaction-contract.md 的 journal/补偿流程执行，并能通过 audit rollback 恢复；无法补偿时进入 recovery-required，不能假报原子成功或盲目重试。
