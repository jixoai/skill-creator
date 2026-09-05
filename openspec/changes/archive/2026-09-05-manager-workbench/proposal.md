# Proposal: manager-workbench

## Why

Manager 的价值不是“能列出几个 SKILL.md”，而是让用户可以发现、理解、修改、验证、安装和更新技能，并且知道每次 mutation 的真实结果。当前 v2 已有不少 daemon 能力，但 UI 仍在 Shell 迁移中，Creator、Workspace 和 Repository 的完成闭环尚未以一个统一工作流呈现。

## What Changes

- 完成 Workspaces、Creator、Repository 三个 Manager surface 的稳定导航和 URL 状态。
- Workspace/Provider 技能浏览支持详情、校验、启停和错误分类。
- Creator 支持 draft、revision-safe save/delete、validation 和冲突恢复。
- Repository 支持 source、pinned scan、preview、dry-run、multi-target install 和 provenance。
- 所有 mutation 明确展示 succeeded、skipped、conflict、failed。

## Non-Goals

- 不在本 change 中生成或执行 Agent prompt。
- 不把业务数据放入 localStorage。
- 不把 Global Workspace 作为 Creator/Repository 写入目标。

## Impact

影响 WebUI routes/apps/components、Manager stores、shared contracts 的少量字段和现有 focused tests。daemon 的路径与 revision 安全边界不放宽。
