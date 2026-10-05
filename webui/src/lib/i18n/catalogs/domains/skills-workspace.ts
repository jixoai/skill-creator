/**
 * Skills Workspace 专属领域词典 [2026-10-05]。
 *
 * 用户原始需求：批 A Dashboard 三屏新增 i18n key 的收口（AGENTS §7.2 UI 法则：
 * 新 key 全部进 domains/；存量 base 禁改；zh 缺键=编译错）。
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
};
