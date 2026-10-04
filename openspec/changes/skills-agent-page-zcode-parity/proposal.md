<!--
文件意图（2026-10-04）
用户原始需求：「任务 A 第一阶段（源码对照审计，严峻模式）」；产出源码依据清单及 OpenSpec proposal/tasks；本轮不改运行时代码。
正交意图：[1] 明确审计缘由；[2] 固定本轮文档范围；[3] 记录 DSH renderer 的前置条件。
妥协声明：无。
-->

## Why

Owner 已明确否决当前 Agent 页的 ZCode 布局复刻程度：ZCode 提供 Chat 之外的导航、底部终端和右侧面板，DSH 提供 Chat 主体，而 Chat 自身也尚未完成对照。需要先以固定版本源码逐项核销真实布局与交互，形成可执行的复刻清单，避免把猜测、过期设计或未实现的 DSH UI 当成基准。

## What Changes

- 新增 `design.md`：针对左侧导航、底部终端、右侧面板、Chat 主体和整体框架建立「ZCode 行为 → 本仓现状 → 差距 → 复刻动作」源码对照表，并记录版本、路径、行号和未验证项。
- 新增 `tasks.md`：按可独立验收的复刻单元拆分后续实现任务，每项附 ZCode 源文件依据；本轮仅建立计划，不修改运行时代码。
- 核验 daemon 实际加载的 DSH profile 和本机 heal 镜像。若没有可定位的 harness WebUI renderer，则将 Chat 1:1 比对标记为前置阻塞，不用 `dsh-web` 能力包替代 UI 基准。

## Capabilities

### New Capabilities

None. This change records a source-based audit and design plan; it does not introduce product behavior.

### Modified Capabilities

None. `.openspec.yaml` sets `skip_specs: true` because this round changes documentation only.

## Impact

- Change artifacts: `openspec/changes/skills-agent-page-zcode-parity/{proposal.md,design.md,tasks.md}` only.
- Future implementation targets identified by the design: `webui/src/lib/apps/agent/` and `webui/src/lib/components/agent/`.
- No runtime code, RPC contract, dependency, or user-visible behavior changes in this round.
