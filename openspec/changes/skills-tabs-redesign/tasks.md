# Tasks: skills-tabs-redesign

> 接口形态以 design.md（Codex 评审收窄版）为准。

## 批 1 · TabsHeader chrome（无接口依赖，已完成）

- [x] TabsHeader 组件：三一等 Tabs（Skills / Agents / Discover repos），tablist/tab/tabpanel ARIA + roving tabindex（←→/Home/End），切换瞬时 — webui/src/lib/apps/workspaces/ — 新组件 + SkillsDashboard 改造 — skills-dashboard-css.test.ts + skills-dashboard.dom.test.ts
- [x] SkillsDashboard 三屏并列网格退役：每 Tab 独占整幅画布（grid 布局，禁绝对定位）；窄屏 segmented 切换器退役为同一 TabsHeader 单行形态 — SkillsDashboard.svelte — skills-dashboard-css.test.ts
- [x] **`?tab=` 直切**（Codex Δ3 裁决）：`screen` 参数同版本退役，manifest zod 字段改名 `tab`（值 skills|agents|repos 不变），route-hygiene/测试同步；不做双读别名 — SkillsDashboard.svelte + manifest.ts + route-hygiene — dom/manifest 测试
- [x] 页题行统计小字（现有 store 真实数据；无数据的徽标留空不造假） — SkillsDashboard.svelte — skills-dashboard-css.test.ts
- [x] i18n：新 key 进 domains/skills-workspace.ts（en/zh 成对，base 不动） — i18n domain — 无
- [x] 受影响测试全量复核（css/dom/coldboot/manifest + route-hygiene） — tests/webui/ — 绿
- [x] 走查证据：dev 沙箱桌面 1280 三 Tab 切换/深链/键盘 + 620 窄屏单行 Tabs — /tmp/skills-tabs-evidence/ — 截图 + console 干净

## 批 2 · 唯一技能投影 + SkillDetail 路由（Δ1+Δ3 定稿）

- [x] `skills.listCanonical` 契约 + daemon 投影：复用 skills.listWorkspace/workspace-aggregate（不建第二套扫描）；workspace-scoped 输入 `{wsId,q?,pagination?}`；group 项（representative+每个 copy）都携带完整 WorkspaceProviderTarget；name 精确匹配分组、plugin namespace 原样；groupCount/copyCount 分开 — contracts/skills.ts + skill-service.ts + rpc-contract.ts — daemon 契约测试（含 unavailable provider、conflict copy、代表顺延规则）
- [x] Skills Tab 默认唯一 name 行 + ×N 副本徽标 + 两量纲计数明示（技能组/安装副本）；chips/搜索/启停作用于组代表 — screens/skills-screen.svelte + stores — skills-dashboard.dom.test.ts
- [x] 路由 `/w/:wsId/skills/:providerId/:skillId`：load-time 三 schema 收窄、非法身份 typed not-found/redirect；manifest 登记 — manifest.ts + shell route registry — manifest 测试
- [x] `?from=` 白名单 `{tab,q,p,dup,scroll,sel,file}`：≤512 字符、未知/重复键丢弃、枚举校验、状态对象重组 route、不拼 href；detail 返回完整还原列表态；浏览器原生 back 并存 — detail 页 + skills-screen — dom 测试
- [x] detail 面板从 skills-screen 退役 — screens/skills-screen.svelte — dom/coldboot 测试更新

## 批 3 · SkillDetail CodeEditor（Δ2 定稿，已完成）

- [x] `skills.files` / `skills.fileRead` 契约 + daemon：每次调用重解析（不信任先前列表）；lstat 拒文档 symlink + O_NOFOLLOW + fstat 身份校验；相对路径校验（拒绝对对/`..`/NUL/反斜杠）；预算 4 深/300 项/树 64KB/单文件 256KiB 超限截断；二进制 typed 拒读；conflict 双文件展示；typed errors 六类（NOT_FOUND/UNAVAILABLE/INVALID_PATH/BINARY/TOO_LARGE/TRUNCATED） — contracts + skill-service + path-safety — daemon 契约测试（含 symlink 三层/TOCTOU/越界/超限/二进制负例）
- [x] detail 页编辑器布局：左文件树（折叠+高亮+?file= 深链）+ 中内容查看器（SKILL.md 默认、frontmatter 身份源块、代码等宽+行号、只读状态条）+ 元信息/校验/副本收纳 — detail 页组件 — dom 测试
- [x] 副本组差异呈现（跨 provider disabled/描述差异；conflict 标记） — detail 页 — dom 测试
- [x] 620 窄屏：树降级横向 chips、内容单列、动作 ≥44px — detail 页 — css 测试

## 批 4 · Agents 规模化（Δ5 路径 1：现有字段收窄，已完成）

- [x] 诊断行紧凑化（标识/路径/可写徽标/技能数——只用现有投影字段）+ 搜索过滤 + 可写|只读分组头 + 计数 — screens/agents-screen.svelte — dom/css 测试
- [x] provider 行点击（跳 Skills Tab 带 provider 筛选）与行尾动作是两个独立可聚焦操作；往返保留 — agents-screen + SkillsDashboard — dom 测试
- [x] 30+ provider fixture 走查（行 DOM/键盘导航/搜索响应测量记录；不虚拟化为当前假设） — 走查证据 — 无
- [x] 【不做】健康点/finding 短标（无数据源，假数据禁令）；providerHealth projection 另立 change — 记录在案 — 无

## 批 5 · ccski remove 原语 + install 审计（Δ4 定稿，跨仓 ../ccski）

- [ ] ../ccski：`removeSkills` 安全原语（受限 name schema + 已解析 root + direct-child containment + lstat/symlink 策略 + 幂等 typed per-item + 可选 content-hash/inode guard） — ../ccski src/api/remove.ts + types + vitest — ccski 测试（含换体/越界/symlink 负例）
- [ ] ../ccski：`installSkillDir` 审计加固（name/path containment、源 symlink、部分覆盖失败恢复） — ../ccski src/api/install.ts — ccski 测试
- [ ] 【不做】原子 reinstallSkills、update check 迁移、第三方 lock 写入（维持 hashOverlay 现状；另立裁决） — 记录在案 — 无
- [ ] ccski 版本策略按语义定（纯 additive 才 minor）+ 本仓依赖升级 + 宿主换用点评估（workspace remove 路径优先） — 两仓 package.json + daemon — build + daemon 测试

## 批 6 · 门禁与收尾

- [ ] pnpm check 全量五件套绿 — 仓库根 — 无
- [ ] dev 沙箱全量走查证据（验收十项：桌面+窄屏真实交互/路由冷加载/provider unavailable fixture/symlink+TOCTOU 负例/30+ provider/断线态） — /tmp/skills-tabs-evidence/ — 无
- [ ] openspec archive + git commit（仅本任务文件，staged 清单审查） — 仓库 — 无
