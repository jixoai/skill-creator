# Proposal: repository-discover

## Why

当前 Repository 页面（`webui/src/routes/repository/+page.svelte`）就是一个空输入框 + 一个 "Scan" 按钮：顶部要求用户填一个完整的 Git URL，左侧列表为空时显示 "Scan a git repository to review its skills at a fixed commit."。新用户根本不知道该往里填什么——市面上有哪些技能源、哪些仓库值得扫、社区里流行什么技能，全都不可见。这不像一个「技能市场」，更像在跑一条 `git clone` 命令。

后端的扫描与安装能力其实早就完备：`repository.scan` 会 clone 并固定 commit（`RepositorySessionIdSchema`）、`repository.preview` 给固定快照、`repository.install` 支持多目标安装（`src/shared/contracts/repository.ts`）。缺的是入口侧的产品化——把"粘贴 URL"变成"浏览 + 一键安装"。本变更把 Repository App 改造成一个 Discover 体验：内置精选技能源目录、可浏览的源卡片、点击进入 tab-scoped 扫描会话、安装后自动跳转到 Workspaces 高亮新技能。

## What Changes

- 新增 Repository **home Tab（Discover 视图）**：顶部搜索框（跨全部源过滤）+ 精选源卡片网格（内置目录 + 用户自定义源）+ 最近扫描记录。
- 新增 **精选源目录**：随应用发布一份手工维护的「已知技能仓库」清单（如 `vercel-labs/skills`、`anthropics/skills`、社区仓库），每条含 `{ id, label, gitUrl, description, homepage }`，形态对齐 `src/shared/provider-catalog.ts`。
- 新增 **用户自定义源持久化**：用户可向 Discover feed 追加自己的 Git URL，跨重启保留；与内置目录在显示层合并（内置源不可删除）。
- 每个**源卡片**展示：label、description、缓存的技能数（来自上次扫描）、上次扫描固定的 commit 摘要；点击 "Scan" 打开一个实例 Tab。
- **Repository 实例 Tab（一次扫描一个源）**：复用现有 scan / preview / multi-target install 流程，但作用域收敛到单个 Tab 实例（依赖 change 1 `chrometabs-shell` 的 TabScope 状态隔离）。
- **安装后跳转**：安装结果摘要（`InstallSummarySchema`）旁新增 "View in Workspaces" 动作，打开 / 聚焦目标 Workspaces Tab 并高亮新装的技能。
- **BREAKING**：Repository 路由变 tab-scoped。home Tab = Discover；实例 Tab = 一次扫描会话。旧路由 `/repository` 由 tab 化路由层重定向到 home Tab。

## Capabilities

### New Capabilities

- `repository-discover` —— 精选源目录 + 浏览 + tab-scoped 扫描会话：内置 catalog、用户源持久化、Discover home Tab、源卡片、扫描实例 Tab、安装后跳转到 Workspaces。

### Modified Capabilities

- 安装流水线：`repository.install` 的结果摘要新增「跳转到 Workspaces」的客户端动作（动作在 WebUI 层，不动 RPC 契约；`InstallSummarySchema` 已含 `targets` 与每个 installed/overwritten 条目的 `skillId`，跳转信息可从既有响应推导）。

## Impact

- WebUI：新增 Discover home Tab、源卡片组件；现有 Repository 单页拆为 home Tab + 实例 Tab（消费 change 1 提供的 Tab 外壳与状态隔离层）；安装结果面板新增 "View in Workspaces" 跳转动作。
- 新增共享模块：`src/shared/curated-sources.ts`（内置精选源静态目录，对齐 `provider-catalog.ts` 的形态与文件意图法）。
- 新增 daemon RPC：`repository.sources.list` / `repository.sources.add` / `repository.sources.remove` —— 用户自定义源注册表（增删查），跨重启持久化。读路径 server-owned，复用既有 containment check。
- 持久化状态：`sources.json` 落在 app dir（`~/.skill-creator/sources.json`，`appDir()` 下），schema 版本化、`safeParse` 兜底，破坏性更新策略不变（schema 不兼容按空值加载）。
- 安全不变量：用户自定义源是新增的外部输入路径（Git URL 字符串），必须经 `unknown → Zod safeParse`；URL 形态受限（仅 https git URL，复用 `repository.scan` 既有的 clone 容器）。loopback / token-in-fragment / server-owned path 不变。WebUI 仍禁止 import daemon 实现或 `node:fs`——源注册表经 RPC 暴露。
- 测试：新增源持久化（增删查 + schema 不兼容降级）、Discover 渲染（卡片缓存元数据、搜索过滤）、安装后跳转（跨 App Tab 聚焦 + 高亮）三类测试；现有 Repository store 测试因 Tab 化需适配（由 change 1 主导，本变更为 Repository 的具体接线）。
