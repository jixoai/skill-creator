# Design: repository-discover

## Context

Repository 当前是单页连续任务：顶部一个 Git URL 输入框，左侧 discovered skills 列表，右侧 skill snapshot 预览（`webui/src/routes/repository/+page.svelte`）。后端三件套（`repository.scan` clone 并固定 commit、`repository.preview` 返回固定快照正文、`repository.install` 多目标安装）已就绪（`src/shared/contracts/repository.ts`），但入口侧没有任何「市场感」——新用户面对空输入框不知道该填什么。

对照 `src/shared/provider-catalog.ts`：那是一份随应用发布的、手工维护的「已知 Agent skills 目录」快照（`PROVIDER_CATALOG`，浏览器安全），daemon 与 WebUI 共享。本变更照搬这个形态——新增 `src/shared/curated-sources.ts` 作为「已知技能仓库源」快照，并补一层用户自定义源持久化（**daemon 侧 `sources.json`，不写 localStorage**）+ Discover home Tab。

本变更是 change 6 序列中的第 6 个，依赖 change 0（`chrometabshell-standard`）+ change 1（`chrometabs-shell`）提供的 Shell 标准 + 三个 App manifest 接入（Repository App 拥有自己的 Tab 栈，home Tab 恒在、实例 Tab 视图状态来自 URL）。

```text
┌────────────────────────────────────────────────────────────────┐
│ Shell (from change 0 + change 1)                               │
│ ┌──────────────┬─────────────────────────────────────────────┐ │
│ │ Left Nav     │ Tabs Bar                                    │ │
│ │ • Workspaces │ [Discover/home] [vercel-labs/skills] [+]    │ │
│ │ • Creator    ├─────────────────────────────────────────────┤ │
│ │ • Repository │                                             │ │
│ │              │ home Tab  → Discover grid                   │ │
│ │              │   ├ search (filters across all sources)     │ │
│ │              │   ├ curated source cards (built-in)         │ │
│ │              │   ├ user source cards (+ add/remove)        │ │
│ │              │   └ recent scans                           │ │
│ │              │ instance Tab → scan + preview + install     │ │
│ │              │   ├ discovered skills list (multi-select)   │ │
│ │              │   ├ skill snapshot preview                  │ │
│ │              │   └ install result ─ "View in Workspaces"   │ │
│ └──────────────┴─────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────┘
```

## 状态分层（来自 config.yaml 原则）

| 状态                                                | 存储层                                                                                                               | 说明                                                                         |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Curated sources（内置精选源目录）                   | **`src/shared/curated-sources.ts`**（静态快照，daemon 与 WebUI 共享）                                                | 随发布版本固化，不持久化                                                     |
| User sources（用户自定义源）                        | **daemon**（`appDir()/sources.json`，server-owned）                                                                  | 持久 + 共享；浏览器经 `repository.sources.*` RPC 读写，**不写 localStorage** |
| Scan session（pinned clone + discovered skills）    | **daemon**（`repository.scan` / `repository.preview`）                                                               | 持久 + 共享；浏览器按需拉取，不缓存到前端 memory 跨渲染周期                  |
| Install 记录                                        | **daemon**（`repository.install` 写盘）                                                                              | 持久                                                                         |
| 选中待安装的 skills                                 | **URL search param** `?selected=rsk_1,rsk_2,...`（短列表）或 **daemon session**（超 URL 长度时，URL 只存 sessionId） | 视图状态真相源，刷新可恢复                                                   |
| 安装目标选择（targets 表单）                        | **URL search param** `?targets=<encoded>` 或组件级 `$state`（表单）                                                  | 视图状态 / 临时表单；提交时走 `repository.install` RPC                       |
| 搜索框未提交文本、dropdown 开关                     | **组件级 `$state`**                                                                                                  | 瞬时 UI                                                                      |
| 源卡片缓存元数据（skillCount / commit / scannedAt） | **daemon session**（扫描结果）或 URL（若需跨刷新）                                                                   | 不写 localStorage；当前会话内可见即可                                        |

**禁止**：把 user sources、scan session、install 记录、selected skills 缓存在前端 memory 跨渲染周期或写入 localStorage。

## Goals

- Repository home Tab 呈现 Discover 体验：搜索 + 精选源卡片 + 用户源 + 最近扫描。
- 用户可向 Discover feed 追加 / 删除自定义 Git 源，跨重启保留——**持久化在 daemon 侧 `sources.json`**（非 localStorage），浏览器经 `repository.sources.add` / `remove` RPC 操作。
- 每个源卡片显示上次扫描的技能数与 commit（来自 daemon scan session）；点 "Scan" 打开实例 Tab。
- 扫描会话隔离到实例 Tab（视图状态来自 URL，scan session daemon-owned）；关闭即清。
- 选中待安装的 skills 与安装目标选择编码到 URL search params（短列表）或 daemon session（超长时），刷新可恢复。
- 安装成功后，结果摘要提供 "View in Workspaces" 动作，打开 / 聚焦目标 Workspaces Tab 并高亮新技能。

## Non-Goals

- 源评分 / 社交特性（点赞、评论、安装数排行）。
- 自动化的源新鲜度监控（不后台轮询；只在用户主动打开或刷新时扫描）。
- 源分类 / 标签（不引入 taxonomy）。
- 跨源聚合搜索（搜索只过滤 Discover home Tab 的源卡片，不跨源检索技能正文）。
- 自定义源同步 / 分享（不支持导入他人源清单）。
- 把 user sources / scan session / install 记录 / selected skills 写入 localStorage 或前端 memory 跨渲染周期缓存（违反状态分层）。

## Decisions

### D1. 精选源目录：`src/shared/curated-sources.ts`

形态对齐 `provider-catalog.ts`：浏览器安全的纯静态目录，daemon 与 WebUI 共享，文件顶部按文件意图法维护正交意图。

```ts
export interface CuratedSourceEntry {
  id: string; // 稳定 slug，作为 instanceKey 的源
  label: string; // 卡片标题
  gitUrl: string; // https git URL，喂给 repository.scan
  description: string; // 一句话卡片描述
  homepage?: string; // 可选的项目主页链接
}
export const CURATED_SOURCES: readonly CuratedSourceEntry[] = [/* ... */];
```

- 内置条目随发布版本固化，不持久化（改目录即换版本，破坏性更新策略一致）。
- 内置源在 UI 上标记为 `builtIn: true`，不可被用户删除。
- 维护成本与 `provider-catalog.ts` 同级：手工快照，无运行时拉取。

### D2. 用户自定义源持久化：`sources.json` + 三个 RPC

落盘位置：`appDir()/sources.json`（即 `~/.skill-creator/sources.json`），与 `run/`、`logs/` 同级。schema 版本化，`safeParse` 兜底，schema 不兼容按空值加载（破坏性更新策略不变，AGENTS.md）。

```ts
const SourcesFileSchema = z.object({
  version: z.literal(1),
  sources: z.array(
    z.object({
      id: z.string(), // 用户源 id，与 curated 命名空间隔离（前缀 `user_`）
      label: z.string(),
      gitUrl: z.string().url(), // 仅 https
      description: z.string().default(""),
      addedAt: z.string().datetime(),
    }),
  ),
});
```

新增 daemon RPC（`src/shared/rpc-contract.ts` 的 `repository` 下）：

```text
repository.sources.list   -> { builtIn: CuratedSourceEntry[], user: UserSource[] }
repository.sources.add    (input: { label, gitUrl, description? }) -> UserSource
repository.sources.remove (input: { id }) -> { removed: true }
```

- 写路径在 daemon 侧，server-owned，复用既有 `path-safety.ts` 的 containment check；WebUI 永远不直接读盘。
- `gitUrl` 入参经 Zod 校验（仅 https 形态），失败的 add 直接 RPC 拒绝（不写盘）。
- 用户源 id 与 curated id 命名空间隔离（`user_` 前缀），避免删除误伤内置源。

### D3. Discover home Tab：搜索 + 卡片网格 + 最近扫描（源数据来自 daemon RPC）

- 路由：`/repository`（home activity，change 1 声明）。
- 顶部搜索框：按 label / description 过滤当前 home Tab 投影的全部源（curated ∪ user）。**不跨源检索技能正文**（Non-Goal）。搜索框未提交文本是组件局部 `$state`（瞬时 UI）；提交后可作为 URL search param `?q=<filter>` 保留视图状态。
- 卡片网格数据来自 `repository.sources.list` RPC（返回 `{ builtIn, user }`）——**不缓存在前端 memory 跨渲染周期**，每次 home Tab 渲染按需拉取；user sources 持久化在 daemon 侧 `sources.json`，不写 localStorage。
- 卡片网格：每个源一张卡，展示 label、description、扫描元数据（skill 数 / commit，来自 daemon scan session）、内置/用户徽标；用户卡多一个删除按钮。
- 最近扫描区：列出本会话内已打开过的实例 Tab（按打开时间倒序），点击聚焦对应 Tab（视图状态来自 URL）。
- "Scan" 按钮：调 `navigate.go` 推 URL 到 `/repository/scan/<source-id-or-session>`，并在 daemon 侧触发 `repository.scan`（pinned clone session）。

### D4. 源卡片扫描元数据（daemon session，不写 localStorage）

扫描完成时（`repository.scan` 返回 `RemoteRepoScan`），扫描结果（discovered skills + skillCount + commit + scannedAt）由 **daemon session 持有**（pinned clone session）；浏览器按需从 `repository.preview` RPC 拉取渲染，**不缓存到前端 memory 跨渲染周期、不写 localStorage**。

```text
scan session (daemon-owned):
  sessionId -> { gitUrl, commit, discoveredSkills[], scannedAt }
  浏览器按需 repository.preview(sessionId) 拉取；刷新可恢复（URL 持 sessionId）
```

- stale 判定：`scannedAt` 超过阈值或 commit 与远端 default ref 不一致时显示刷新提示（refresh 仅是 UI hint，不触发自动扫描）。
- 卡片层的 skillCount / commit 摘要若需在 home Tab 跨刷新可见，由 daemon 维护一份「最近扫描摘要」投影（随 `repository.sources.list` 或单独 RPC 返回）；不在前端 localStorage 持久化。

### D5. 扫描实例 Tab：复用现有流程，视图状态 → URL

- 路由：`/repository/scan/<source-id-or-session>`（change 1 声明的扫描 activity）。源 id（curated 或 user）或显式 sessionId 均可作为 path param（change 1 的 Tab 唯一性约束）。
- 内容 = 现有 `repository/+page.svelte` 的扫描 + 预览 + 安装三件套，搬进实例 activity；scan session daemon-owned，浏览器按需拉取 `repository.scan` / `repository.preview` RPC，**不缓存到前端 memory 跨渲染周期**。
- **选中待安装的 skills 编码到 URL search param** `?selected=rsk_1,rsk_2,...`（视图状态真相源，刷新可恢复）；若选中列表超 URL 长度，转 daemon session（URL 只存 sessionId 引用）。
- **安装目标选择（targets 表单）编码到 URL search param** `?targets=<encoded>` 或组件级 `$state`（表单输入），提交时走 `repository.install` RPC。
- 从 home Tab 点源卡片打开实例 Tab 时，自动用该源的 `gitUrl` 触发首次扫描；实例 Tab 不再需要顶部 Git URL 输入框（源已确定）。
- 自定义源（用户在 home Tab 搜索框旁的 add 入口）走 ad-hoc 扫描：仍可临时粘贴 URL 扫描，扫描结果不沉淀为持久源（除非用户显式 `repository.sources.add`）。

### D6. 安装后跳转到 Workspaces（targets 来自 install RPC 响应）

`InstallSummarySchema`（`src/shared/contracts/repository.ts`）已含 `targets: WorkspaceProviderTarget[]` 与每个 installed/overwritten 条目的 `target` + `skillId`。跳转信息可从既有响应推导，**不改 RPC 契约**。

- 安装成功后，结果摘要旁新增 "View in Workspaces" 按钮（单目标）/ 下拉（多目标）。
- 点击触发跨 App Tab 动作（change 0/1 的 `navigate.goById`）：
  1. 计算目标 Workspaces 实例 Tab 的 instanceKey（`{workspaceId}/{providerId}`）。
  2. 若该 Tab 已存在则聚焦（`navigate.go`），否则打开。
  3. 通过 URL search param `?skill=<skillId>&highlight=1` 通知该 Tab 高亮指定 `skillId`（与 change 2 `workspaces-skill-preview` 的技能选中语义对齐——视图状态走 URL，不用 in-memory token）。
- 高亮是一次性的：聚焦后短暂高亮目标技能卡片，滚动入视。

### D7. 安全 / 不变量

- 用户自定义 Git URL 是新增外部输入路径：`repository.sources.add` 入参经 Zod 严格校验（仅 https、URL 形态、长度上限），失败即 RPC 拒绝，不写盘。
- `sources.json` 读取走 `unknown → Zod safeParse`，schema 不兼容按空值加载（与既有 lock 文件读取策略一致，change 5 `skills-cli-compat`）。
- clone 与安装仍走 `repository-service.ts` 既有容器与 containment check，token 不进 URL fragment 之外。
- WebUI 仍禁止 import daemon 实现或 `node:fs`——源注册表只经 `repository.sources.*` RPC 暴露。

## Risks

- **R1. 精选源目录维护成本**。和 `provider-catalog.ts` 一样是手工快照，源会失效、迁移、更名。缓解：源失效时 `repository.scan` 按既有错误路径降级（卡片显示错误态，不阻塞其它源）；目录随版本发布更新，不做运行时拉取。
- **R2. 多源扫描成本**。Discover home Tab 不主动后台扫描全部源（Non-Goal：不做新鲜度监控）；只在用户点 "Scan" 时扫单个源。缓解：卡片缓存元数据（D4）让 home Tab 在无主动扫描时仍有信息密度。
- **R3. 依赖 change 0（`chrometabshell-standard`）/ change 1（`chrometabs-shell`）/ change 2（`workspaces-skill-preview`）尚未落地**。跳转到 Workspaces 高亮依赖 change 2 的技能选中语义（URL `?skill=...`）；Shell 标准 + Repository App manifest 依赖 change 0/1。缓解：本变更的 catalog / 持久化（daemon `sources.json`）/ 卡片组件可独立先行；Tab 接线与跳转部分以前三者落地为前置条件，在 tasks 中标注 gating 依赖。
- **R4. 用户自定义源的 clone 安全**。用户可填任意 https git URL，`repository.scan` 会真实 clone。缓解：clone 走既有 `repository-service.ts` 的临时容器 + containment check（已就绪），不写入用户工作区之外的路径；URL 形态在 add 时即校验。
- **R5. 旧路由 `/repository` 的重定向可能破坏外部深链**。缓解：tab 化路由层为旧路由保留内部重定向到 home Tab；OpenTray 桌面打开窗口时使用新路由。
