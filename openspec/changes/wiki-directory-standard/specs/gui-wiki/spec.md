# gui-wiki Specification (delta)

## ADDED Requirements

### Requirement: GUI 提供第四个一级 Wiki 面板

WebUI MUST 新增一级 App `wiki`（与 Workspaces/Creator/Repository 并列）：
home 路由 `/wiki` 为 scope 索引；detail 路由 `/wiki/:wsId`（参数
WorkspaceId，global 为 `~`）。面板结构与 Workspaces 面板同构——home 列
索引（Global wiki 卡 + 各 registry workspace 的 wiki 卡：label、pattern
计数、最近更新；未初始化的 workspace 显示空态而非隐藏），detail 为该
scope 的 patterns 列表（过滤、追加表单、相似警告、正文展开）。

#### Scenario: scope 索引

- **WHEN** 打开 /wiki
- **THEN** 呈现 global 卡与全部 registry workspace 的 wiki 卡（计数与
  label 来自 wiki.scopes RPC），点击进入 /wiki/:wsId

#### Scenario: workspace 级 detail

- **WHEN** 打开 /wiki/<wsId>
- **THEN** 该 scope 的 patterns 可过滤/追加（hash 幂等 + 相似警告）/
  展开正文；断线保留草稿，latest-request-wins 提交纪律与其他面板一致

### Requirement: wiki.scopes RPC

daemon MUST 提供 `wiki.scopes`：输入 `{}`，输出 `{ scopes: [{ id:
WorkspaceId, label, patternCount, exists }] }`——global 恒列；
registry workspaces 经目录映射标准解析（`<dir>/.agents/skill-wiki`），
`exists` 表示 wiki 目录已初始化。现有 `wiki.list/read/append` 的 scope
解析 MUST 同步改为目录映射（RPC 契约的 scope 参数仍为 WorkspaceId）。

#### Scenario: 宿主与 CLI 同一份数据

- **WHEN** daemon 经 GUI 写入某 workspace wiki 后，CLI 在该 workspace
  目录读取
- **THEN** 两者看到同一份 patterns（同一物理目录）

### Requirement: 旧 Workspaces 内 wiki 视图迁移

`/workspaces/wiki/:wsId` 路由与视图 MUST 迁移至新 App（组件与 store
逻辑平移）；WorkspacesHome 的 wiki 入口 MUST 改指 `/wiki/<wsId>`；旧
路由 MUST 删除（无双入口残留）。

#### Scenario: 旧地址不再挂载

- **WHEN** 导航至 /workspaces/wiki/~
- **THEN** 不再命中 wiki 视图（被 hygiene 清理到面板入口或 no-match），
  wiki 功能仅存在于 /wiki 面板
