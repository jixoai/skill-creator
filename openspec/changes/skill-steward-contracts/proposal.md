# Proposal: skill-steward-contracts

## Why

当前 `agent-steward` 把 ACP 当作 Agent 产品边界，却没有形成可供 fixture、DSH 和 Codex runtime 共同使用的 AI-SKILLS-MANAGEMENT 领域协议。若没有稳定契约，revision、evidence 与 approval 会在不同 adapter 中产生不一致，无法审计。

## What Changes

- 定义 Manager-owned 的上下文快照、任务、结构化响应、专属工具调用与 patch 契约。
- 固化 evidence、observed revision、prompt/tool version、approval token 和 terminal reason 的必填关系。
- 固化 check、optimize、organize 三类维护任务及 edit/disable/split/merge patch 语义。
- 为后续 fixture、DSH 和 Codex adapter 提供 provider-neutral boundary；本阶段不接入任何 Agent runtime。

## Non-Goals

- 不实现 DSH/Codex adapter、Agent session、WebUI 或分享能力。
- 不把 DSH store、profile、session log 或通用 filesystem/shell 工具作为 Manager 事实源。

## Product acceptance

后续实现者可以仅依据这些契约实现 fixture runtime，并能在不改协议的情况下替换成 DSH 或 Codex。任何缺少 identity、revision、evidence 或 version 的 Agent 输出都能被确定性拒绝；本阶段完成不代表 Agent runtime 或 WebUI 已接入。
