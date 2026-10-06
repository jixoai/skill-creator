# Proposal: skills-tabs-redesign — Skills 工作区 Tabs 化重构落地

## Why

Owner 裁决（2026-10-06）：fuse2 融合稿（`/tmp/skills-redesign/fuse2/vision/`，本会话三轮 prototype 演化终稿）**从设计上没问题**，批准为布局基准落地。当前实现是「三屏并列网格 + 窄屏 segmented 切换」，把 Skills（高频库管理）、Agents（低频诊断）、Repos（偶发发现）三个不同频率的任务赋予了同等空间权；detail 是 Skills 屏内耦合面板。Owner 三条落地注意：

1. Agents 会到二三十个且持续增长——布局与组件要为规模设计。
2. Skills 默认不得出现重复 skill-name；同名技能跨 Agent 的差异属于 SkillDetail 的展示职责。
3. 安装维护以 npm:ccski 为主（npm:skills 无合理 SDK，CLI 子进程拖垮性能）；ccski 需对齐 npm:skills 架构、尽量兼容其 install/update/remove，必要时同步升级 ccski（../ccski 独立仓）。

分工裁决：vision 子代理负责开发与走查；涉及新接口或破坏数据接口的决策必须与 Codex 讨论定稿（讨论稿 `/tmp/skills-integration/INTERFACE-DRAFT.md`，五处 delta：Δ1 唯一技能投影、Δ2 文件树/文件读 RPC、Δ3 SkillDetail 独立路由、Δ4 ccski remove+update 对齐、Δ5 Agents 规模化）。

## What Changes

- **批 1 · TabsHeader chrome（无接口依赖，先行）**：SkillsDashboard 从三屏并列网格改为顶部 TabsHeader（`Skills / Agents / Discover repos`）三一等 Tabs，每 Tab 独占整幅画布；`?screen=` 参数与取值语义不变（深链兼容）；键盘 roving tabindex；窄屏三 tab 单行不换行；pulse 统计退役为页题行小字。三个 screen 组件内部本批不动（skills-screen 的 detail 面板保留到批 2）。
- **批 2 · 唯一技能列表 + SkillDetail 独立路由（依赖 Δ1/Δ3 定稿）**：`skills.listCanonical` 服务端分组投影（name 键，representative 规则：enabled 优先 → sourcePriority → path 稳定序）；Skills Tab 默认唯一 name 行（×N 副本徽标）；`/w/:wsId/skills/:skillId` 独立详情路由 + `?from=` 列表态回传；detail 面板从列表屏退役。
- **批 3 · SkillDetail CodeEditor（依赖 Δ2 定稿）**：`skills.files` / `skills.fileRead` 有界文件树与内容读；左文件树 + 中内容查看器（SKILL.md 默认、frontmatter 身份源块、代码等宽+行号、只读状态条）；副本组差异呈现（跨 provider 状态/描述差异，Owner 点 2 的第二半）。
- **批 4 · Agents 规模化（纯 UI，可并行）**：诊断行紧凑化 + 搜索过滤 + 可写/只读分组 + 计数；30+ provider 走查；不预设虚拟化。
- **批 5 · ccski remove/update 对齐（依赖 Δ4 定稿，跨仓）**：../ccski 新增 `removeSkills`（对齐 npm:skills uninstall 语义）与 apply 侧组合能力（check 留宿主、apply=remove+install 原子组合进 ccski，方向待 Codex 复核）；skill-creator 的 repository install / skills.update.apply / workspace remove 逐步换用；ccski minor 版本升级。
- **批 6 · 门禁与走查证据**：全量门禁（pnpm check 五件套）+ dev 沙箱桌面/窄屏走查截图留证（Tabs 深链/键盘/跨 Tab 联动/文件树/console）。

## Impact

- webui：`lib/apps/workspaces/`（SkillsDashboard 壳、screens/ 三屏迁移为 Tabs、skill-detail 新路由页）、`lib/shell/dashboard-manifest.ts`（detail 路由）、stores（canonical 分组消费）、i18n domain 双语 key。
- daemon/contracts：`shared/contracts/skills.ts`（canonical 投影 + 文件 RPC 契约，形态待 Codex 定稿）、`rpc-contract.ts`、`skill-service.ts`（listCanonical/files/fileRead）、路由注册。
- 跨仓：../ccski（removeSkills / apply 组合，2.5.0 → minor）。
- 非目标：搜索域 canonical 语义合并（skill-search 维持独立）；MCP/CLI 面的 canonical 投影同步（后续批）；npm:skills CLI 的完全替代。

## 状态

- 批 1 即刻开工（vision）；批 2/3/5 的接口形态以 Codex 复核结论（`/tmp/skills-integration/codex-review.md`）为准回填 design.md 后开工；批 4 与批 1 可并行。
- 前置 change `skills-workspace-world-class`（65/66）的成果是本 change 的改造对象基底，不回退其打磨项。
