/**
 * 用户原始需求 [2026-10-09]（creator-skill-store 批 2 / proposal）：「我们得有一个
 * 专门管理我们创建出来的这些 skills……然后再通过 ccski-sdk 将这些 skill 安装到
 * 本地 agent skills 目录……比方说……直接把技能放在 .agents/skills 目录，这属于
 * 我们可以自动化做到事情。」
 * 正交意图：
 *   [1] creatorStore 域词典（Creator store 列面 + 应用选择面 + 确认闸；en/zh
 *       键成对，keyof 校验齐全——域文件规约见 catalogs/domains.ts）。
 *   [2] creatorHome/creatorEditor/creatorLog/creatorValidation 的批 2 增量键
 *       （store 入口 / auto-apply toast / store 惰态）就近归本域，避免改 base。
 */
export const creatorStoreEn = {
  /** ---------- Creator store 列面（CreatorStore.svelte） ---------- */
  "creatorStore.title": "Creator store",
  "creatorStore.subtitle":
    "Skills created here live in one origin directory and reach agent skill folders through kernel projections.",
  "creatorStore.newSkill": "New skill",
  "creatorStore.refresh": "Refresh",
  "creatorStore.loading": "Loading store skills…",
  "creatorStore.empty": "No store skills yet. Create one to get started.",
  "creatorStore.skippedWarning": "{count} unreadable store entries were skipped.",
  "creatorStore.openEditorTitle": "Open this skill in the store editor",
  "creatorStore.statusLoading": "Checking status…",

  /** ---------- 状态角标（status RPC 投影） ---------- */
  "creatorStore.notApplied": "Not applied",
  "creatorStore.appliedBadge": "Applied to {count} scope(s)",
  "creatorStore.outdated": "Outdated",

  /** ---------- 应用选择面（roots 多选；默认勾选 ~/.agents/skills） ---------- */
  "creatorStore.applyTo": "Apply to…",
  "creatorStore.applyDialogAria": "Apply skill to agent roots",
  "creatorStore.applyDialogTitle": "Apply “{name}”",
  "creatorStore.applyDefaultHint":
    "The open-standard root ~/.agents/skills is checked by default; new skills auto-apply there on creation.",
  "creatorStore.applyGlobalSection": "Global agent root",
  "creatorStore.noTargets": "No agent roots or workspace providers are available.",
  "creatorStore.applyButton": "Apply ({count})",
  "creatorStore.applyResultSummary": "Applied {applied} · unchanged {unchanged} · failed {failed}",
  "creatorStore.toastApplied": "Applied to {count} target(s).",
  "creatorStore.toastApplyPartial": "{count} target(s) failed — see receipts.",

  /** ---------- sync / uninstall（逐收据反馈） ---------- */
  "creatorStore.sync": "Sync",
  "creatorStore.toastSynced":
    "Synced — {updated} updated · {unchanged} unchanged · {skipped} skipped.",
  "creatorStore.toastSyncFailed": "{failed} root(s) failed to sync — see the kernel receipts.",
  "creatorStore.uninstallScope": "Uninstall",
  "creatorStore.uninstallAll": "Uninstall everywhere",
  "creatorStore.toastUninstalled": "Uninstalled from {count} scope(s).",
  "creatorStore.toastUninstallFailed": "{count} scope(s) failed to uninstall.",

  /** ---------- delete-origin（确认闸列出剩余应用面；与卸载正交） ---------- */
  "creatorStore.deleteOrigin": "Delete origin",
  "creatorStore.deleteConfirmTitle": "Delete store skill",
  "creatorStore.deleteConfirmBody":
    "Delete “{name}” ({directory}) from the creator store? The store directory is removed from disk.",
  "creatorStore.deleteConfirmApplied":
    "It is still applied in {count} scope(s). Those applied copies stay until you uninstall them:",
  "creatorStore.toastDeleted": "Store skill deleted.",
  "creatorStore.toastDeleteRemained":
    "Store skill deleted — {count} applied copy/copies remain in agent roots.",

  /** ---------- CreatorHome 批 2 增量（store 入口 + 直建入口） ---------- */
  "creatorHome.storeLink": "Store",
  "creatorHome.storeLinkTitle": "Manage created skills — apply, sync, uninstall, delete origin",
  "creatorHome.createDirectPrefix": "Prefer the editor?",
  "creatorHome.createDirect": "Create directly in the editor",

  /** ---------- Creator 编辑族批 2 增量（auto-apply toast + store 惰态） ---------- */
  "creatorEditor.toastCreatedApplied": "Skill created — applied to {root}.",
  "creatorEditor.toastCreateApplyFailed": "Created, but auto-apply failed: {error}",
  "creatorLog.storeUnavailable":
    "Change history for store skills is not available yet — it returns with the store face.",
  "creatorValidation.storeUnavailable":
    "Validating a store skill here is not available yet; validation feedback returns on save.",
} as const;

export const creatorStoreZh: Record<keyof typeof creatorStoreEn, string> = {
  /** ---------- Creator store 列面 ---------- */
  "creatorStore.title": "Creator store",
  "creatorStore.subtitle": "在这里创建的技能只有一个根源目录，经内核投影到达各 agent 的技能目录。",
  "creatorStore.newSkill": "新建技能",
  "creatorStore.refresh": "刷新",
  "creatorStore.loading": "正在加载 store 技能…",
  "creatorStore.empty": "还没有 store 技能。创建一个开始。",
  "creatorStore.skippedWarning": "{count} 个无法读取的 store 条目已被跳过。",
  "creatorStore.openEditorTitle": "在 store 编辑器中打开此技能",
  "creatorStore.statusLoading": "正在检查状态…",

  /** ---------- 状态角标 ---------- */
  "creatorStore.notApplied": "未应用",
  "creatorStore.appliedBadge": "已应用 {count} 处",
  "creatorStore.outdated": "已过期",

  /** ---------- 应用选择面 ---------- */
  "creatorStore.applyTo": "应用到…",
  "creatorStore.applyDialogAria": "应用技能到 agent 目录",
  "creatorStore.applyDialogTitle": "应用「{name}」",
  "creatorStore.applyDefaultHint":
    "开放标准目录 ~/.agents/skills 默认勾选；新建技能时会自动应用到该处。",
  "creatorStore.applyGlobalSection": "全局 agent 目录",
  "creatorStore.noTargets": "没有可用的 agent 目录或 workspace provider。",
  "creatorStore.applyButton": "应用（{count}）",
  "creatorStore.applyResultSummary": "已应用 {applied} · 无变化 {unchanged} · 失败 {failed}",
  "creatorStore.toastApplied": "已应用到 {count} 个目标。",
  "creatorStore.toastApplyPartial": "{count} 个目标失败——见收据。",

  /** ---------- sync / uninstall ---------- */
  "creatorStore.sync": "同步",
  "creatorStore.toastSynced": "已同步——更新 {updated} · 无变化 {unchanged} · 跳过 {skipped}。",
  "creatorStore.toastSyncFailed": "{failed} 个 root 同步失败——见内核收据。",
  "creatorStore.uninstallScope": "卸载",
  "creatorStore.uninstallAll": "全部卸载",
  "creatorStore.toastUninstalled": "已从 {count} 处卸载。",
  "creatorStore.toastUninstallFailed": "{count} 处卸载失败。",

  /** ---------- delete-origin ---------- */
  "creatorStore.deleteOrigin": "删除根源",
  "creatorStore.deleteConfirmTitle": "删除 store 技能",
  "creatorStore.deleteConfirmBody":
    "从 creator store 删除「{name}」（{directory}）？store 目录会从磁盘移除。",
  "creatorStore.deleteConfirmApplied":
    "它仍应用在 {count} 处。这些已应用副本会保留，直到你卸载它们：",
  "creatorStore.toastDeleted": "store 技能已删除。",
  "creatorStore.toastDeleteRemained": "store 技能已删除——agent 目录中仍有 {count} 份已应用副本。",

  /** ---------- CreatorHome 批 2 增量 ---------- */
  "creatorHome.storeLink": "Store",
  "creatorHome.storeLinkTitle": "管理已创建的技能——应用、同步、卸载、删除根源",
  "creatorHome.createDirectPrefix": "想直接上手？",
  "creatorHome.createDirect": "在编辑器中直接新建",

  /** ---------- Creator 编辑族批 2 增量 ---------- */
  "creatorEditor.toastCreatedApplied": "技能已创建——已应用到 {root}。",
  "creatorEditor.toastCreateApplyFailed": "已创建，但自动应用失败：{error}",
  "creatorLog.storeUnavailable": "store 技能的变更历史暂不可用——将随 store 面回归。",
  "creatorValidation.storeUnavailable": "此处暂不支持校验 store 技能；保存时会返回校验反馈。",
};
