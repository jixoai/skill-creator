/**
 * 用户原始需求 [2026-10-04]：「继续打磨完善」——shell-extra 域 i18n 化
 * （webui-i18n-bilingual B 线收尾批；域文件规约见 catalogs/domains.ts）。
 * 修订 [2026-10-05]（task 4.1 shell 批）：shell 族（顶栏/tab 栏/工作区左导航/
 * AppShell 状态面）+ omnibox（C 类出生即 i18n）+ import 对话框（挪顶栏批遗留）
 * 文案迁入；en 值为现网英文逐字快照（web-mode-smoke 断言 Global workspace tab /
 * Agent tab / Skills / Creator / Wiki / Evaluating 依赖逐字节一致）。
 * 修订 [2026-10-05]（η 线 task 7）：settings 齿轮自 omnibox 迁顶栏——新增
 * shell.openSettings，退役 omnibox.openSettingsAria / omnibox.settingsLabel。
 * 正交意图：
 *   [1] shell-extra 域词典（en/zh 键成对，keyof 校验齐全）。
 */
export const shellExtraEn = {
  /** ---------- Shell：顶栏（+layout / WindowDragRegion） ---------- */
  "shell.brandName": "Skill Creator",
  "shell.openCommandPalette": "Open command palette",
  "shell.commandPaletteTitle": "Command palette (Cmd+K)",
  "shell.reloadApp": "Reload app",
  "shell.reload": "Reload",
  "shell.openSettings": "Open settings",
  "shell.titlebarAria": "window titlebar",

  /** ---------- Shell：AppShell 叶子状态面 ---------- */
  "shell.failedToLoad": "Failed to load: {error}",
  "shell.loadingAria": "Loading",
  "shell.noRouteMatched": "No route matched",

  /** ---------- Shell：TabStrip（tab 栏 + ＋菜单 + 右键菜单 + 移除确认） ---------- */
  "shell.openPagesAria": "Open pages",
  "shell.tabPanelAria": "Workspace page content",
  "shell.globalTabAria": "Global workspace tab",
  "shell.tabGlobal": "Global",
  "shell.agentTabAria": "Agent tab",
  "shell.tabAgent": "Agent",
  "shell.tabSettings": "Settings",
  "shell.closeTabAria": "Close {label} tab",
  "shell.closeTab": "Close tab",
  "shell.closeSettingsTabAria": "Close Settings tab",
  "shell.openTabMenuAria": "Open workspace tab menu",
  "shell.openTabTitle": "Open workspace tab",
  "shell.importDirectory": "Import directory…",
  "shell.copyWorkspacePath": "Copy workspace path",
  "shell.removeWorkspace": "Remove workspace…",
  "shell.pathCopiedToast": "Workspace path copied.",
  "shell.pathCopyFailedToast": "Could not copy workspace path.",
  "shell.removeFailedToast": "Could not remove workspace: {error}",
  "shell.removeConfirmTitle": "Remove workspace?",
  "shell.removeConfirmBody":
    "This removes the workspace from Skill Creator. Files in the directory remain untouched.",

  /** ---------- Shell：WorkspaceNavigation（工作区页左导航） ---------- */
  "shell.closeNavigationAria": "Close workspace navigation",
  "shell.workspacePagesAria": "Workspace pages",
  "shell.navSkills": "Skills",
  "shell.navCreator": "Creator",
  "shell.navWiki": "Wiki",
  "shell.navEvaluating": "Evaluating",

  /** ---------- Omnibox（C 类：地址栏 + 命令面；快捷键 token ⌘L/Enter 不译） ---------- */
  "omnibox.openNavigationAria": "Open workspace navigation",
  "omnibox.navigationTitle": "Workspace navigation",
  "omnibox.backAria": "Back in this tab",
  "omnibox.backTitle": "Back in this tab (⌘[)",
  "omnibox.forwardAria": "Forward in this tab",
  "omnibox.forwardTitle": "Forward in this tab (⌘])",
  "omnibox.inputAria": "Address and command input",
  "omnibox.placeholder": "Search pages, workspaces and skills; use > for commands",
  "omnibox.commandsAria": "Commands",
  "omnibox.suggestionsAria": "Suggestions",
  "omnibox.editAddressAria": "Edit address",
  "omnibox.moreActionsAria": "More page actions",

  /** ---------- Import workspace 对话框（挪顶栏批遗留） ---------- */
  "importDialog.title": "Import workspace",
  "importDialog.description":
    "Import a directory as a skill workspace. Its skills will be discovered and managed here.",
  "importDialog.pathRequired": "A directory path is required.",
  "importDialog.pathLabel": "Directory path",
  "importDialog.pathPlaceholder": "/Users/me/.claude/skills",
  "importDialog.browse": "Browse…",
  "importDialog.pathHint": "Absolute path to a directory containing skill folders.",
  "importDialog.nameLabel": "Display name",
  "importDialog.optional": "(optional)",
  "importDialog.namePlaceholder": "My Skills",
  "importDialog.import": "Import",
} as const;

export const shellExtraZh: Record<keyof typeof shellExtraEn, string> = {
  /** ---------- Shell：顶栏（+layout / WindowDragRegion） ---------- */
  "shell.brandName": "Skill Creator",
  "shell.openCommandPalette": "打开命令面板",
  "shell.commandPaletteTitle": "命令面板（Cmd+K）",
  "shell.reloadApp": "重新加载应用",
  "shell.reload": "重新加载",
  "shell.openSettings": "打开设置",
  "shell.titlebarAria": "窗口标题栏",

  /** ---------- Shell：AppShell 叶子状态面 ---------- */
  "shell.failedToLoad": "加载失败：{error}",
  "shell.loadingAria": "加载中",
  "shell.noRouteMatched": "没有匹配的路由",

  /** ---------- Shell：TabStrip（tab 栏 + ＋菜单 + 右键菜单 + 移除确认） ---------- */
  "shell.openPagesAria": "打开的页面",
  "shell.globalTabAria": "全局工作区标签页",
  "shell.tabPanelAria": "工作区页面内容",
  "shell.tabGlobal": "全局",
  "shell.agentTabAria": "Agent 标签页",
  "shell.tabAgent": "Agent",
  "shell.tabSettings": "Settings",
  "shell.closeTabAria": "关闭 {label} 标签页",
  "shell.closeTab": "关闭标签页",
  "shell.closeSettingsTabAria": "关闭 Settings 标签页",
  "shell.openTabMenuAria": "打开工作区标签页菜单",
  "shell.openTabTitle": "打开工作区标签页",
  "shell.importDirectory": "导入目录…",
  "shell.copyWorkspacePath": "复制工作区路径",
  "shell.removeWorkspace": "移除工作区…",
  "shell.pathCopiedToast": "工作区路径已复制。",
  "shell.pathCopyFailedToast": "无法复制工作区路径。",
  "shell.removeFailedToast": "无法移除工作区：{error}",
  "shell.removeConfirmTitle": "移除工作区？",
  "shell.removeConfirmBody": "这会从 Skill Creator 移除该工作区。目录中的文件保持原样。",

  /** ---------- Shell：WorkspaceNavigation（工作区页左导航） ---------- */
  "shell.closeNavigationAria": "关闭工作区导航",
  "shell.workspacePagesAria": "工作区页面",
  "shell.navSkills": "Skills",
  "shell.navCreator": "Creator",
  "shell.navWiki": "Wiki",
  "shell.navEvaluating": "Evaluating",

  /** ---------- Omnibox（C 类：地址栏 + 命令面；快捷键 token ⌘L/Enter 不译） ---------- */
  "omnibox.openNavigationAria": "打开工作区导航",
  "omnibox.navigationTitle": "工作区导航",
  "omnibox.backAria": "在此标签页中后退",
  "omnibox.backTitle": "在此标签页中后退（⌘[）",
  "omnibox.forwardAria": "在此标签页中前进",
  "omnibox.forwardTitle": "在此标签页中前进（⌘]）",
  "omnibox.inputAria": "地址与命令输入",
  "omnibox.placeholder": "搜索页面、工作区与技能；使用 > 进入命令",
  "omnibox.commandsAria": "命令",
  "omnibox.suggestionsAria": "建议",
  "omnibox.editAddressAria": "编辑地址",
  "omnibox.moreActionsAria": "更多页面操作",

  /** ---------- Import workspace 对话框（挪顶栏批遗留） ---------- */
  "importDialog.title": "导入工作区",
  "importDialog.description": "导入一个目录作为技能工作区。其中的技能将被发现并在此管理。",
  "importDialog.pathRequired": "目录路径为必填项。",
  "importDialog.pathLabel": "目录路径",
  "importDialog.pathPlaceholder": "/Users/me/.claude/skills",
  "importDialog.browse": "浏览…",
  "importDialog.pathHint": "包含技能文件夹的目录的绝对路径。",
  "importDialog.nameLabel": "显示名称",
  "importDialog.optional": "（可选）",
  "importDialog.namePlaceholder": "我的技能",
  "importDialog.import": "导入",
};
