# Tasks: skills-workspace-world-class

## 1. 批 A：Dashboard 三屏 + 壳 + Footer

### Skills Screen 打磨

- [x] duplicates 开关降级为高级过滤位 — webui/src/lib/apps/workspaces/screens/skills-screen.svelte — FD-01/FD-02 — skills-dashboard-css.test.ts
- [x] chips 横滚 affordance 增强 — webui/src/lib/apps/workspaces/screens/skills-screen.svelte — FD-06 — skills-dashboard-css.test.ts
- [x] header 计数视觉权重调整 — webui/src/lib/apps/workspaces/screens/skills-screen.svelte — FD-07 — skills-dashboard-css.test.ts
- [x] 补全条区分已载/未载图标 — webui/src/lib/apps/workspaces/screens/skills-screen.svelte — FD-04 — skills-dashboard.dom.test.ts
- [x] Chat 按钮启动后上下文衔接 — webui/src/lib/apps/workspaces/screens/skills-screen.svelte + skill-detail-panel.svelte — FD-05 — skills-dashboard.dom.test.ts
- [x] detail→list 焦点恢复加固（scrollIntoView 先于 focus） — webui/src/lib/apps/workspaces/screens/skills-screen.svelte — FD-11 — skills-dashboard.dom.test.ts
- [x] Load more 按钮反馈增强 — webui/src/lib/apps/workspaces/screens/skills-screen.svelte — FD-20 — skills-dashboard.dom.test.ts
- [x] duplicates truncated 提示信息改进 — webui/src/lib/apps/workspaces/screens/skills-screen.svelte — FD-15 — skills-dashboard.dom.test.ts
- [x] 行高/clamp 复查（若改 DASHBOARD_ROW_HEIGHT 则三处同步） — webui/src/lib/apps/workspaces/screens/skills-screen.svelte + lib/stores/dashboard-skills.svelte.ts + skills-dashboard-css.test.ts — FD-24 — skills-dashboard-css.test.ts

### Agents Screen 差异化强化

- [x] 卡片主/次操作区视觉分隔 — webui/src/lib/apps/workspaces/screens/agents-screen.svelte — FD-19 — skills-dashboard-css.test.ts
- [ ] View findings 改名 + 待审 proposals 计数徽标 — webui/src/lib/apps/workspaces/screens/agents-screen.svelte — FD-09 — skills-dashboard.dom.test.ts（2026-10-05 收口裁决：改名已落；徽标 deferred——proposals 投影无 providerId 字段、agents 屏无现有数据面，客户端全局过滤成本高；待 provider-catalog-dedup 或后续批补数据源后一行追加 Badge）
- [x] 卡片信息扩展（真实路径/可写性/磁盘可用性差异化呈现） — webui/src/lib/apps/workspaces/screens/agents-screen.svelte — FD-03（R-A1 处方）— skills-dashboard.dom.test.ts

### Repos Screen 改进

- [x] 最近扫描相对时间行 — webui/src/lib/apps/workspaces/screens/repos-screen.svelte — FD-10 — skills-dashboard.dom.test.ts
- [x] 新增源表单实时校验 + Add 按钮门控 — webui/src/lib/apps/workspaces/screens/repos-screen.svelte — FD-22（FD-22）— skills-dashboard.dom.test.ts

### 壳层改进

- [x] 深链滚动 prefers-reduced-motion 尊重 — webui/src/lib/apps/workspaces/SkillsDashboard.svelte — FD-17 — skills-dashboard.dom.test.ts
- [x] 单列切换器 ARIA role=navigation 语义 — webui/src/lib/apps/workspaces/SkillsDashboard.svelte — FD-23 — skills-dashboard.dom.test.ts
- [x] active screen 高亮对比度增强（可选） — webui/src/lib/apps/workspaces/SkillsDashboard.svelte — FD-12 — skills-dashboard-css.test.ts

### Footer + 内务清理

- [x] librarySnapshot 死分支删除（Imported ws 条件分支） — webui/src/lib/apps/workspaces/dashboard-footer.svelte — FD-21 — 无测试影响
- [x] skills-screen 重连补救段删除 — webui/src/lib/apps/workspaces/screens/skills-screen.svelte — FD-14 — skills-dashboard-coldboot.dom.test.ts

### i18n + 测试联动

- [x] 新建 skills-workspace domain 文件 — webui/src/lib/i18n/catalogs/domains/skills-workspace.ts + domains.ts 登记 — FD-01/02/04/07/09/10/15/20/22 相关 key — 无
- [x] skills-dashboard-css.test.ts 更新 — webui/src/lib/apps/workspaces/**tests**/skills-dashboard-css.test.ts — 覆盖 duplicates 降级/chips affordance/header 计数/行高/卡片分隔/active 高亮 — 无
- [x] skills-dashboard.dom.test.ts 更新 — webui/src/lib/apps/workspaces/**tests**/skills-dashboard.dom.test.ts — 覆盖补全条图标/Chat 衔接/焦点恢复/Load more/truncated 提示/Agents 徽标/Repos 时间/表单校验 — 无
- [x] skills-dashboard-coldboot.dom.test.ts 更新 — webui/src/lib/apps/workspaces/**tests**/skills-dashboard-coldboot.dom.test.ts — 移除重连补救段对应断言 — 无

<!-- 批 A 第一节落盘 -->

## 2. 批 B：RepositoryScan + IntelligenceView + WorkspaceManager

### RepositoryScan 子路由内修

- [x] ?session= 进 URL + 过期校验 — webui/src/lib/apps/workspaces/RepositoryScan.svelte — FP-01 — repository-scan-css.test.ts
- [x] targets sessionStorage 保活 — webui/src/lib/apps/workspaces/RepositoryScan.svelte — FP-01 — repository-scan-css.test.ts
- [x] sessionExpired 灰态 + 单一 Rescan 主路径 — webui/src/lib/apps/workspaces/RepositoryScan.svelte — FP-02 — repository-scan-css.test.ts
- [x] 安装结果失败分组前置 + 原因展示 — webui/src/lib/apps/workspaces/RepositoryScan.svelte — FP-03 — repository-scan-css.test.ts
- [x] 面包屑 Repos ‹ label（Discover 按钮语义并入） — webui/src/lib/apps/workspaces/RepositoryScan.svelte — FP-04 — repository-scan-css.test.ts
- [x] installing 内联进度提示 — webui/src/lib/apps/workspaces/RepositoryScan.svelte — FP-13 — repository-scan-css.test.ts

### IntelligenceView 重定位 + 分区 + 术语清理

- [x] 路由段 intelligence→insights 改名 — webui/src/lib/apps/workspaces/manifest.ts + 所有 goById 调用点 — FP-05（R-I1）— dashboard-manifest.test.ts
- [x] ?skill= 上下文参数（技能详情 Insights 按钮携带） — webui/src/lib/apps/workspaces/IntelligenceView.svelte + skill-detail-panel.svelte — FP-05（R-I1）— 无
- [x] 页内 Analysis/Proposals 两区锚点分区 — webui/src/lib/apps/workspaces/IntelligenceView.svelte — FP-06（R-I2）— 无
- [x] severity 空态区分「当前过滤无结果」 — webui/src/lib/apps/workspaces/IntelligenceView.svelte — FP-07 — 无
- [x] kind→用户动词（Edit skill / Disable skill 等） — webui/src/lib/apps/workspaces/IntelligenceView.svelte — FP-08 — 无
- [x] capability 名降级 tooltip — webui/src/lib/apps/workspaces/IntelligenceView.svelte — FP-08 — 无
- [x] siDraft→Draft 角标 — webui/src/lib/apps/workspaces/IntelligenceView.svelte — FP-08 — 无
- [x] observedRevision→Analyzed version + stale 前置说明 — webui/src/lib/apps/workspaces/IntelligenceView.svelte — FP-12 — 无

### WorkspaceManager 窄屏卡片化 + 交互修正

- [x] 窄屏表格→卡片式布局（<720px 所有信息可见，Remove 触达≥44px） — webui/src/lib/apps/workspaces/WorkspaceManager.svelte — FP-09 P0 — workspace-manager.dom.test.ts
- [x] 删除宽屏重复 path 列 — webui/src/lib/apps/workspaces/WorkspaceManager.svelte — FP-10 — workspace-manager.dom.test.ts
- [x] missing amber 化 + 行级 Refresh 按钮 — webui/src/lib/apps/workspaces/WorkspaceManager.svelte — FP-11 — workspace-manager.dom.test.ts

### 批 B 测试 + i18n 联动

- [x] repository-scan-css.test.ts 更新 — webui/src/lib/apps/workspaces/**tests**/repository-scan-css.test.ts — 覆盖 session URL/sessionExpired 灰态/失败分组/面包屑/installing 进度 — 无
- [x] workspace-manager.dom.test.ts 更新 — webui/src/lib/apps/workspaces/**tests**/workspace-manager.dom.test.ts — 覆盖窄屏卡片化/触达区/missing amber/Refresh — 无
- [x] dashboard-manifest.test.ts 更新 — webui/src/lib/apps/workspaces/**tests**/dashboard-manifest.test.ts — intelligence→insights 路由改名 — 无
- [x] skills-workspace domain i18n 追加 — webui/src/lib/i18n/catalogs/domains/skills-workspace.ts — RepositoryScan/IntelligenceView/WorkspaceManager 新 key（批 A 已建文件后追加；并行期可先写在各自节内标注合并） — 无

<!-- 批 B 第二节落盘 -->

## 3. 批 C：i18n 词典 + 契约测试联动 + 门禁（串行收尾批）

### i18n 完整性复核

- [x] skills-workspace domain 双语对齐检查 — webui/src/lib/i18n/catalogs/domains/skills-workspace.ts — 批 A+B 全部 key en/zh 成对 — 无
- [x] 所有组件 i18n 调用路径验证 — webui/src/lib/apps/workspaces/ 全部组件 grep `t(` 路径 — 无遗漏硬编码用户文案 — 无

### 契约测试联动

- [x] skills-dashboard-css.test.ts 全量复核 — webui/src/lib/apps/workspaces/**tests**/skills-dashboard-css.test.ts — DASHBOARD_ROW_HEIGHT/chips/header/active 高亮/卡片分隔 — 无
- [x] skills-dashboard.dom.test.ts 全量复核 — webui/src/lib/apps/workspaces/**tests**/skills-dashboard.dom.test.ts — 补全条/Chat/焦点/Load more/Agents 徽标/Repos — 无
- [x] skills-dashboard-coldboot.dom.test.ts 全量复核 — webui/src/lib/apps/workspaces/**tests**/skills-dashboard-coldboot.dom.test.ts — 移除重连补救段对应断言 — 无
- [x] repository-scan-css.test.ts 全量复核 — webui/src/lib/apps/workspaces/**tests**/repository-scan-css.test.ts — session/sessionExpired/失败分组/面包屑/installing — 无
- [x] workspace-manager.dom.test.ts 全量复核 — webui/src/lib/apps/workspaces/**tests**/workspace-manager.dom.test.ts — 窄屏卡片/触达区/missing/Refresh — 无
- [x] dashboard-manifest.test.ts 全量复核 — webui/src/lib/apps/workspaces/**tests**/dashboard-manifest.test.ts — intelligence→insights 路由改名 — 无

### 双源阈值一致性复查

- [x] 1044px / 692px 三处一致性检查 — SkillsDashboard.svelte + skills-screen.svelte + CSS 规则 — proposal.md §4 双源阈值（1044=宽屏 span 降档/692=单列触发） — skills-dashboard-css.test.ts

### 全量门禁

- [x] pnpm test — 仓库根 — 全量测试套件绿色通过 — 无
- [x] pnpm typecheck — 仓库根 — 类型检查零错误 — 无
- [x] pnpm --dir webui check — webui/ — SvelteKit check 零错误 — 无
- [x] pnpm build — 仓库根 — 生产构建成功 — 无
- [x] pnpm exec vp fmt --check — 仓库根 — 格式化检查通过 — 无
- [x] git diff --check — 仓库根 — 无尾随空白/冲突标记 — 无

### 走查验证清单（dev 沙箱）

- [x] 沙箱环境搭建 — SKILL_CREATOR_DEV_HOME=/tmp/skills-wc-home + SKILL_CREATOR_DISABLE_TRAY=1 — 新建隔离 home + 禁用 tray — 无
- [x] 桌面 1280px 三屏截图留证 — /tmp/skills-wc-evidence/desktop-1280/ — Skills/Agents/Repos 三屏完整交互验证 — 无
- [x] 窄屏 620px 单列截图留证 — /tmp/skills-wc-evidence/narrow-620/ — 单列切换器/卡片化/焦点恢复 — 无
- [x] 中档 1044px 边界截图留证 — /tmp/skills-wc-evidence/medium-1044/ — span 降档边界/chips 横滚/宽屏表格边界 — 无
- [x] WorkspaceManager 窄屏 <720px 验证 — /tmp/skills-wc-evidence/workspace-narrow/ — 卡片化/触达区≥44px/missing amber/Refresh — 无
- [x] RepositoryScan session 刷新恢复 — /tmp/skills-wc-evidence/repo-scan/ — ?session= URL 参数/targets sessionStorage/sessionExpired 灰态 — 无
- [x] IntelligenceView insights 改名 + 分区 — /tmp/skills-wc-evidence/intelligence/ — URL 路径/Analysis-Proposals 锚点分区/术语清理 — 无

<!-- 批 C 第三节落盘 -->
