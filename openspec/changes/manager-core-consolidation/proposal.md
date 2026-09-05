# Proposal: manager-core-consolidation

## Why

Skill Creator v2 的代码已经包含 Workspace、Provider、Skill、Creator、Repository、source 和 update 模块，但这些能力来自多轮迁移，当前工作树仍混合了旧路由、旧 OpenSpec 计划和新 Shell 代码。继续增加 Agent 能力会把未冻结的 Manager 真相暴露给外部进程。

本 change 只做 Manager 核心收敛：定义稳定领域词汇、确认当前 daemon 是唯一 authority、清理已过期的 active changes，并让现有管理能力有可重复的 focused evidence。

## What Changes

- 建立当前 Manager 的最小公开契约：Workspace、Provider、Skill、Source、ScanSession、Revision。
- 复核现有 RPC 与 daemon service 的边界，删除死路由和重复类型；不新增 harness 依赖。
- 为每个 Manager mutation 补齐成功、冲突、无权限、路径逃逸和外部输入损坏的验收。
- 将旧的、全部标记完成但与当前工作树不一致的 changes 归档为历史资料。

## Non-Goals

- 不接入任何 Agent 或模型。
- 不重写 OpenTray 生命周期。
- 不迁移旧版用户数据，不保留兼容别名。

## Impact

影响 `src/shared/contracts/`、`src/shared/rpc-contract.ts`、`src/daemon/`、focused tests 和 `openspec/` 文档。保持 `shared contracts < domain < transport < entry` 依赖方向。
