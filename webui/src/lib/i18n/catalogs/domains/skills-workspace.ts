/**
 * Skills Workspace 专属领域词典 [2026-10-05]。
 *
 * 用户原始需求：批 A Dashboard 三屏新增 i18n key 的收口（AGENTS §7.2 UI 法则：
 * 新 key 全部进 domains/；存量 base 禁改；zh 缺键=编译错）。
 * 修订 [2026-10-06]（skills-tabs-redesign 批 1）：TabsHeader chrome 新增 key
 * （三 tab 文案 / tablist aria / 页题行统计小字；徽标数据缺席不造 key）。
 * 修订 [2026-10-06]（skills-tabs-redesign 批 2）：唯一 name 列表两量纲计数
 * （groupsCopies/showingGroupsCopies/copiesBadge/allCopiesUnavailable）+
 * SkillDetail 独立路由页 key（not-found / 面包屑 / 副本组差异 / 内容占位）。
 *
 * 正交意图：
 *   [1] 批 A 三屏新增 key（补全条图标 title / Chat 启动反馈 / Agents 按钮改名 /
 *       Repos 相对时间 + 表单校验），en/zh 成对。
 *   [2] 结构仿 domains/dash-counts.ts（namespace 扁平，按屏分段注释）。
 */

export const skillsWorkspaceEn = {
  // ---- Skills Screen ----
  "skillsWorkspace.skillsScreen.completionLoaded": "Jump to this skill (already loaded)",
  "skillsWorkspace.skillsScreen.completionSearch": "Search for this skill (not yet loaded)",
  "skillsWorkspace.skillsScreen.chatOpenedInPanel": "Chat session opened in the agent panel",

  // ---- Agents Screen ----
  "skillsWorkspace.agentsScreen.analysisAndProposals": "Analysis & proposals",

  // ---- Repos Screen ----
  "skillsWorkspace.reposScreen.justNow": "just now",
  "skillsWorkspace.reposScreen.minutesAgo":
    "{minutes, plural, one {# minute ago} other {# minutes ago}}",
  "skillsWorkspace.reposScreen.hoursAgo": "{hours, plural, one {# hour ago} other {# hours ago}}",
  "skillsWorkspace.reposScreen.daysAgo": "{days, plural, one {# day ago} other {# days ago}}",
  "skillsWorkspace.reposScreen.urlMustHttps": "URL must start with https://",

  // ---- Skills Screen (Load more) ----
  "skillsWorkspace.skillsScreen.loadedMore":
    "Loaded {count, plural, one {# skill} other {# skills}}",

  // ---- Skills Screen (Filter menu) ----
  "skillsWorkspace.skillsScreen.filterMenu": "Filter options",
  "skillsWorkspace.skillsScreen.sameContentOnly": "Same content only",
  "skillsWorkspace.skillsScreen.searchConfig": "Search config",

  // ---- Repository Scan ----
  "skillsWorkspace.reposScan.installed": "Installed",
  "skillsWorkspace.reposScan.sessionExpired": "Scan session expired. Rescan to continue.",
  "skillsWorkspace.reposScan.rescan": "Rescan",
  "skillsWorkspace.reposScan.refresh": "Refresh",
  "skillsWorkspace.reposScan.installing":
    "Installing {count, plural, one {# skill} other {# skills}} to {targets, plural, one {# location} other {# locations}}…",
  "skillsWorkspace.reposScan.breadcrumbRepos": "Repos",
  "skillsWorkspace.reposScan.breadcrumb": "Repository scan breadcrumb",
  "skillsWorkspace.reposScan.failedGroup": "{count, plural, one {# failed} other {# failed}}",
  "skillsWorkspace.reposScan.skippedGroup": "{count, plural, one {# skipped} other {# skipped}}",
  "skillsWorkspace.reposScan.installedGroup":
    "{installed, plural, one {# installed} other {# installed}}{overwritten, plural, =0 {} other { ({overwritten} overwritten)}}",
  "skillsWorkspace.reposScan.overwritten": "overwritten",
  "skillsWorkspace.insights.viewingSkill": "Viewing: {skill}",
  "skillsWorkspace.insights.clearFilter": "Clear",
  "skillsWorkspace.insights.analysisSection": "Analysis",
  "skillsWorkspace.insights.proposalsSection": "Proposals",
  "skillsWorkspace.insights.noResultsForFilter": "No results for current filter",
  "skillsWorkspace.insights.analyzedVersion": "Analyzed version",
  "skillsWorkspace.insights.staleWarning":
    "This proposal is based on an older version of the skill.",
  "skillsWorkspace.insights.kindEdit": "Edit skill",
  "skillsWorkspace.insights.kindDisable": "Disable skill",
  "skillsWorkspace.insights.kindSplit": "Split skill",
  "skillsWorkspace.insights.kindMerge": "Merge skills",
  "skillsWorkspace.insights.draft": "Draft",

  // ---- Workspace Manager ----
  "skillsWorkspace.workspaceManager.missing": "Not found on disk",
  "skillsWorkspace.workspaceManager.refreshWorkspace": "Refresh",
  "skillsWorkspace.workspaceManager.remove": "Remove",
  "skillsWorkspace.workspaceManager.colUniqueSkills": "Unique skills",
  "skillsWorkspace.insights.pageTitle": "Insights",

  // ---- Repos Screen (Empty states) ----
  "skillsWorkspace.reposScreen.noSourcesYet": "No sources yet — add a source to get started.",

  // ---- Dashboard TabsHeader (skills-tabs-redesign batch 1) ----
  "skillsWorkspace.tabs.tablistAria": "Workspace views",
  "skillsWorkspace.tabs.skills": "Skills",
  "skillsWorkspace.tabs.agents": "Agents",
  "skillsWorkspace.tabs.repos": "Discover repos",

  // ---- Canonical skills list + SkillDetail route (skills-tabs-redesign batch 2) ----
  "skillsWorkspace.skillsScreen.groupsCopies":
    "{groups, plural, one {# skill group} other {# skill groups}} · {copies, plural, one {# installation} other {# installations}}",
  "skillsWorkspace.skillsScreen.showingGroupsCopies":
    "Showing {visible} of {groups, plural, one {# skill group} other {# skill groups}} · {copies, plural, one {# installation} other {# installations}}",
  "skillsWorkspace.skillsScreen.copiesBadge": "{count, plural, one {# copy} other {# copies}}",
  "skillsWorkspace.skillsScreen.allCopiesUnavailable": "All copies unavailable",
  "skillsWorkspace.skillDetail.backToSkills": "Back to Skills",
  "skillsWorkspace.skillDetail.notFoundTitle": "Skill not found",
  "skillsWorkspace.skillDetail.notFoundBody":
    "This skill copy is not present in the Workspace Provider. It may have been removed or renamed.",
  "skillsWorkspace.skillDetail.copiesHeading": "Copies in this workspace",
  "skillsWorkspace.skillDetail.copiesHint": "Cross-provider copies of the same skill name",
  "skillsWorkspace.skillDetail.representativeMark": "Representative",
  "skillsWorkspace.skillDetail.conflictMark": "Conflict",
  "skillsWorkspace.skillDetail.unavailableMark": "Unavailable",
  "skillsWorkspace.skillDetail.openCopy": "Open this copy",
  "skillsWorkspace.skillDetail.viewerTitle": "Content viewer",

  // ---- SkillDetail CodeEditor (skills-tabs-redesign batch 3, Δ2) ----
  "skillsWorkspace.skillDetail.fileTree": "Files",
  "skillsWorkspace.skillDetail.fileTreeEmpty": "No readable files",
  "skillsWorkspace.skillDetail.treeTruncated": "File list truncated",
  "skillsWorkspace.skillDetail.readonlyStatus": "Read-only — editing lives in Creator",
  "skillsWorkspace.skillDetail.frontmatterSource": "Identity source",
  "skillsWorkspace.skillDetail.binaryFile": "Binary file — preview unavailable",
  "skillsWorkspace.skillDetail.fileReadFailed": "Could not read this file",
  "skillsWorkspace.skillDetail.truncatedNote": "truncated",
  "skillsWorkspace.skillDetail.linesCount": "{count, plural, one {# line} other {# lines}}",
  "skillsWorkspace.skillDetail.conflictDisabledHint":
    "Inactive identity document (SKILL.md/.SKILL.md conflict)",
} as const;

export const skillsWorkspaceZh: Record<keyof typeof skillsWorkspaceEn, string> = {
  // ---- Skills Screen ----
  "skillsWorkspace.skillsScreen.completionLoaded": "跳转到此技能（已加载）",
  "skillsWorkspace.skillsScreen.completionSearch": "搜索此技能（尚未加载）",
  "skillsWorkspace.skillsScreen.chatOpenedInPanel": "会话已在右侧面板打开",

  // ---- Agents Screen ----
  "skillsWorkspace.agentsScreen.analysisAndProposals": "分析与建议",

  // ---- Repos Screen ----
  "skillsWorkspace.reposScreen.justNow": "刚刚",
  "skillsWorkspace.reposScreen.minutesAgo": "{minutes} 分钟前",
  "skillsWorkspace.reposScreen.hoursAgo": "{hours} 小时前",
  "skillsWorkspace.reposScreen.daysAgo": "{days} 天前",
  "skillsWorkspace.reposScreen.urlMustHttps": "URL 必须以 https:// 开头",

  // ---- Skills Screen (Load more) ----
  "skillsWorkspace.skillsScreen.loadedMore": "已载入 {count} 条",

  // ---- Skills Screen (Filter menu) ----
  "skillsWorkspace.skillsScreen.filterMenu": "过滤选项",
  "skillsWorkspace.skillsScreen.sameContentOnly": "仅显示相同内容",
  "skillsWorkspace.skillsScreen.searchConfig": "搜索配置",

  // ---- Repository Scan ----
  "skillsWorkspace.reposScan.installed": "已安装",
  "skillsWorkspace.reposScan.sessionExpired": "扫描会话已过期，请重新扫描以继续。",
  "skillsWorkspace.reposScan.rescan": "重新扫描",
  "skillsWorkspace.reposScan.refresh": "刷新",
  "skillsWorkspace.reposScan.installing": "正在安装 {count} 个技能到 {targets} 个位置…",
  "skillsWorkspace.reposScan.breadcrumbRepos": "仓库",
  "skillsWorkspace.reposScan.breadcrumb": "仓库扫描面包屑",
  "skillsWorkspace.reposScan.failedGroup": "{count} 个失败",
  "skillsWorkspace.reposScan.skippedGroup": "{count} 个跳过",
  "skillsWorkspace.reposScan.installedGroup":
    "{installed} 个已安装{overwritten, plural, =0 {} other {（{overwritten} 个覆盖）}}",
  "skillsWorkspace.reposScan.overwritten": "覆盖",
  "skillsWorkspace.insights.viewingSkill": "正在查看：{skill}",
  "skillsWorkspace.insights.clearFilter": "清除",
  "skillsWorkspace.insights.analysisSection": "分析",
  "skillsWorkspace.insights.proposalsSection": "建议",
  "skillsWorkspace.insights.noResultsForFilter": "当前筛选下无结果",
  "skillsWorkspace.insights.analyzedVersion": "分析版本",
  "skillsWorkspace.insights.staleWarning": "此建议基于较旧版本的技能。",
  "skillsWorkspace.insights.kindEdit": "编辑技能",
  "skillsWorkspace.insights.kindDisable": "禁用技能",
  "skillsWorkspace.insights.kindSplit": "拆分技能",
  "skillsWorkspace.insights.kindMerge": "合并技能",
  "skillsWorkspace.insights.draft": "草稿",

  // ---- Workspace Manager ----
  "skillsWorkspace.workspaceManager.missing": "磁盘上未找到",
  "skillsWorkspace.workspaceManager.refreshWorkspace": "刷新",
  "skillsWorkspace.workspaceManager.remove": "删除",
  "skillsWorkspace.workspaceManager.colUniqueSkills": "技能（去重）",
  "skillsWorkspace.insights.pageTitle": "洞察",

  // ---- Repos Screen (Empty states) ----
  "skillsWorkspace.reposScreen.noSourcesYet": "还没有源——添加一个源开始发现技能。",

  // ---- Dashboard TabsHeader (skills-tabs-redesign batch 1) ----
  "skillsWorkspace.tabs.tablistAria": "工作区视图",
  "skillsWorkspace.tabs.skills": "Skills",
  "skillsWorkspace.tabs.agents": "Agents",
  "skillsWorkspace.tabs.repos": "发现仓库",

  // ---- Canonical skills list + SkillDetail route (skills-tabs-redesign batch 2) ----
  "skillsWorkspace.skillsScreen.groupsCopies": "{groups} 个技能组 · {copies} 个安装副本",
  "skillsWorkspace.skillsScreen.showingGroupsCopies":
    "显示 {visible}/{groups} 个技能组 · {copies} 个安装副本",
  "skillsWorkspace.skillsScreen.copiesBadge": "{count} 个安装副本",
  "skillsWorkspace.skillsScreen.allCopiesUnavailable": "全部副本不可用",
  "skillsWorkspace.skillDetail.backToSkills": "返回 Skills",
  "skillsWorkspace.skillDetail.notFoundTitle": "技能未找到",
  "skillsWorkspace.skillDetail.notFoundBody":
    "该技能副本不在当前 Workspace Provider 中，可能已被移除或改名。",
  "skillsWorkspace.skillDetail.copiesHeading": "工作区内的副本",
  "skillsWorkspace.skillDetail.copiesHint": "同名技能的跨 provider 副本",
  "skillsWorkspace.skillDetail.representativeMark": "组代表",
  "skillsWorkspace.skillDetail.conflictMark": "冲突",
  "skillsWorkspace.skillDetail.unavailableMark": "不可用",
  "skillsWorkspace.skillDetail.openCopy": "打开此副本",
  "skillsWorkspace.skillDetail.viewerTitle": "内容查看器",

  // ---- SkillDetail CodeEditor (skills-tabs-redesign batch 3, Δ2) ----
  "skillsWorkspace.skillDetail.fileTree": "文件",
  "skillsWorkspace.skillDetail.fileTreeEmpty": "没有可读文件",
  "skillsWorkspace.skillDetail.treeTruncated": "文件列表已截断",
  "skillsWorkspace.skillDetail.readonlyStatus": "只读 — 编辑入口在 Creator",
  "skillsWorkspace.skillDetail.frontmatterSource": "身份源",
  "skillsWorkspace.skillDetail.binaryFile": "二进制文件 — 无法预览",
  "skillsWorkspace.skillDetail.fileReadFailed": "无法读取该文件",
  "skillsWorkspace.skillDetail.truncatedNote": "已截断",
  "skillsWorkspace.skillDetail.linesCount": "{count} 行",
  "skillsWorkspace.skillDetail.conflictDisabledHint": "非激活身份文档（SKILL.md/.SKILL.md 冲突）",
};
