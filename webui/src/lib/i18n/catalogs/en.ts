/**
 * 用户原始需求 [2026-10-03]（Owner 裁决）：「WebUI 做中英双语（i18n）」。
 * 正交意图：
 *   [1] 英文词典 = key 事实源（en 值从组件原文逐字迁入，测试锚点依赖逐字节一致）。
 */

/**
 * key 命名约定（change webui-i18n-bilingual design §6）：<domain>.<feature>.<purpose>
 * 点分扁平；单复分支 .one/.many；插值用 {param}。en 值是现网英文的事实快照，
 * 改动等同文案改动（需同步过断言该文案的测试）。
 */
export const en = {
  /** ---------- 通用 ---------- */
  "common.retry": "Retry",
  "common.cancel": "Cancel",
  "common.dismiss": "Dismiss",

  /** ---------- Wiki 首页（scope 索引） ---------- */
  "wikiHome.title": "Wiki",
  "wikiHome.subtitle":
    "Fragment insights collected per wiki — global notes and workspace-local knowledge.",
  "wikiHome.refreshTitle": "Refresh wiki scopes",
  "wikiHome.loadErrorTitle": "Couldn't load wiki scopes",
  "wikiHome.loadingAria": "Loading wiki scopes",
  "wikiHome.emptyTitle": "No wiki scopes yet",
  "wikiHome.emptyBody": "The global wiki appears once the daemon is reachable.",
  "wikiHome.updating": "Updating…",
  "wikiHome.globalBadge": "~ global",
  "wikiHome.fragmentsCapturedOne": "{count} fragment captured",
  "wikiHome.fragmentsCapturedMany": "{count} fragments captured",
  "wikiHome.updatedOn": "updated {date}",
  "wikiHome.notInitialized": "Not initialized — opens empty, first fragment creates it",

  /** ---------- Wiki scope detail（碎片追加 + 蒸馏） ---------- */
  "wikiScope.backTitle": "Back to wiki scopes",
  "wikiScope.heading": "{scope} wiki",
  "wikiScope.workspaceBadge": "workspace",
  "wikiScope.subtitle":
    "Persistent notes for {scope} — fragments collected here feed skill evolution.",
  "wikiScope.refreshTitle": "Refresh wiki",
  "wikiScope.globalScopeLabel": "Global",
  "wikiScope.distillButtonTitle": "Distill this workspace's fragments into the global wiki",
  "wikiScope.distillButton": "Distill to global",
  "wikiScope.addFragment": "Add fragment",
  "wikiScope.distillSectionAria": "Distill to global",
  "wikiScope.distillStarting": "Distilling fragments to the global wiki…",
  "wikiScope.distillStartFailed": "Couldn't start the distillation",
  "wikiScope.distillFailed": "Distillation failed",
  "wikiScope.distillCompleted": "Distillation completed",
  "wikiScope.distillCancelled": "Distillation cancelled",
  "wikiScope.distillRunning": "Distilling to the global wiki…",
  "wikiScope.distillStartingBody":
    "Collecting this workspace's fragments and asking the model for generalizations — this can take up to two minutes.",
  "wikiScope.proposalsReadyOne":
    "{count} proposal ready for review ({pending} pending). Nothing is written to the global wiki until you approve.",
  "wikiScope.proposalsReadyMany":
    "{count} proposals ready for review ({pending} pending). Nothing is written to the global wiki until you approve.",
  "wikiScope.cancelledNoApply": "Cancelled — no proposal was applied.",
  "wikiScope.pollStopped": "Status polling stopped: {error}",
  "wikiScope.viewProposals": "View proposals",
  "wikiScope.hideProposals": "Hide proposals",
  "wikiScope.cancelRun": "Cancel run",
  "wikiScope.loadingProposals": "Loading proposals…",
  "wikiScope.noProposals": "No proposals found for this run.",
  "wikiScope.formAria": "Add a fragment",
  "wikiScope.newFragment": "New fragment",
  "wikiScope.cancelAddTitle": "Cancel",
  "wikiScope.cancelAddAria": "Cancel adding a fragment",
  "wikiScope.fieldTitle": "Title",
  "wikiScope.fieldNote": "Note",
  "wikiScope.titlePlaceholder": "One-line insight, e.g. Pin exit codes",
  "wikiScope.notePlaceholder": "What should the agent remember next time?",
  "wikiScope.addToWiki": "Add to wiki",
  "wikiScope.loadErrorTitle": "Couldn't load the wiki",
  "wikiScope.loadingAria": "Loading wiki",
  "wikiScope.emptyTitle": "No fragments yet",
  "wikiScope.emptyBody":
    "Capture recurring insights here; they become the input for skill evolution.",
  "wikiScope.addFirst": "Add the first fragment",
  "wikiScope.filterPlaceholder": "Filter fragments…",
  "wikiScope.filterAria": "Filter wiki fragments",
  "wikiScope.promotedBadge": "promoted",
  "wikiScope.loadingPattern": "Loading…",
  "wikiScope.noMatch": "No fragments match “{query}”.",
  "wikiScope.toastAdded": "Added “{title}” to the wiki.",
  "wikiScope.toastDeduplicated": "Already captured as “{title}”.",
  /** RunState 徽标（六态穷尽）。 */
  "wikiScope.runStateCollecting": "collecting",
  "wikiScope.runStateKernelRunning": "running model",
  "wikiScope.runStateAwaitingApproval": "awaiting approval",
  "wikiScope.runStateCompleted": "completed",
  "wikiScope.runStateFailed": "failed",
  "wikiScope.runStateCancelled": "cancelled",
  /** DistillFailReason 人读文案（七因穷尽）。 */
  "wikiScope.failNoValidProposals":
    "The model produced no valid proposals, so nothing was generalized.",
  "wikiScope.failCapacity": "The proposal store was at capacity; every proposal was refused.",
  "wikiScope.failIo": "A disk error interrupted the run.",
  "wikiScope.failTimeout": "The model run timed out.",
  "wikiScope.failKernelUnavailable": "The agent kernel is unavailable right now.",
  "wikiScope.failRestarted": "The daemon restarted and the run was cancelled.",
  "wikiScope.failCancelledByShutdown": "The daemon stopped and the run was cancelled.",

  /** ---------- 全局 toast ---------- */
  "toast.dismiss": "Dismiss notification",

  /** ---------- ⌘K 命令面板 ---------- */
  "palette.placeholder": "Search navigation, workspaces and skills…",
  "palette.empty": "No matching destination.",
  "palette.groupNavigate": "Navigate",
  "palette.groupWorkspaces": "Workspaces",
  "palette.groupSkills": "Skills",
  "palette.navWorkspaces": "Workspaces",
  "palette.navCreator": "Creator",
  "palette.navRepository": "Repository",
  "palette.navSearchConfig": "Open search config",
  "palette.typeToSearch": "Type to search skills across workspaces…",
  "palette.searching": "Searching skills…",
  "palette.searchFailed": "Skill search failed — {error}",
  "palette.noMatchingSkill": "No matching skill.",

  /** ---------- Agent 面板容器 ---------- */
  "agentPanel.panelAria": "Agent panel",
  "agentPanel.resizeAria": "Resize agent panel",
  "agentPanel.editingNote": "Editing — resending keeps your full history (append-only)",
  "agentPanel.cancelEdit": "Cancel edit",

  /** ---------- Agent 面板头部 ---------- */
  "agentHeader.agentLabel": "Agent",
  "agentHeader.sessionAria": "Session",
  "agentHeader.newSessionOption": "New session…",
  "agentHeader.noSessions": "No sessions",
  "agentHeader.endedSuffix": "· ended",
  "agentHeader.statusSuffix": "· {status}",
  "agentHeader.newSession": "New session",
  "agentHeader.closePanel": "Close panel",

  /** ---------- ui:// 卡片 ---------- */
  "agentCard.loading": "Loading card…",
  "agentCard.unavailable": "Card unavailable: {title}",

  /** ---------- ask_user_question 决定卡 ---------- */
  "agentApproval.answeredAria": "Answered question",
  "agentApproval.pendingAria": "Pending question",
  "agentApproval.answered": "Answered",
  "agentApproval.yourDecision": "Your decision",
  "agentApproval.customPlaceholder": "Custom answer (optional)",
  "agentApproval.customAria": "Custom answer for {question}",
  "agentApproval.submit": "Submit answer",

  /** ---------- mutation proposal 审批卡 ---------- */
  "agentProposal.groupAria": "Mutation proposal",
  "agentProposal.title": "Proposal — {status}",
  "agentProposal.reject": "Reject",
  "agentProposal.approve": "Approve",
  "agentProposal.toastExecuted": "Proposal executed: {capability}",
  "agentProposal.toastFailed": "Proposal failed: {capability}",
  "agentProposal.toastRejected": "Proposal rejected: {capability}",

  /** ---------- 工具行（分型展开卡） ---------- */
  "agentTool.input": "Input",
  "agentTool.output": "Output",
  "agentTool.running": "running",
  "agentTool.runningEllipsis": "running…",
  "agentTool.errorTag": "error",
  "agentTool.cardTitle": "Card",
  "agentTool.todoSummaryOne": "{total} todo · {done} done",
  "agentTool.todoSummaryMany": "{total} todos · {done} done",

  /** ---------- Todo 折叠卡 ---------- */
  "todoDock.tasks": "Tasks",
  "todoDock.counts": "done {done} · active {active} · pending {pending}",

  /** ---------- 排队队列 dock ---------- */
  "queueDock.dockAria": "Queued messages",
  "queueDock.queued": "Queued",
  "queueDock.attachmentsTitle": "{count} attachment(s)",
  "queueDock.steerChip": "steer",
  "queueDock.steerChipTitle": "Steers the running turn at the next step boundary",
  "queueDock.editAria": "Edit queued message",
  "queueDock.editTitle": "Edit this queued message",
  "queueDock.steerAria": "Steer with this message",
  "queueDock.steerRunningTitle": "Steer the current turn with this message",
  "queueDock.steerLockedTitle": "Steering unlocks while a turn is running",
  "queueDock.removeAria": "Remove queued message",
  "queueDock.removeTitle": "Remove from queue",
  "queueDock.sending": "sending…",
  "queueDock.toastEditFailed": "Queue edit failed: {error}",
  "queueDock.toastRemoveFailed": "Queue remove failed: {error}",
  "queueDock.toastSteerFailed": "Queue steer failed: {error}",

  /** ---------- 上下文用量环 ---------- */
  "contextMeter.aria": "Context usage",
  "contextMeter.dialogAria": "Context usage details",
  "contextMeter.tooltipUsed": "{percent}% of context used · last turn {input} in / {output} out",
  "contextMeter.tooltipIdle": "No turns yet — context usage appears after the first turn",
  "contextMeter.context": "Context",
  "contextMeter.used": "Used",
  "contextMeter.lastTurn": "Last turn",
  "contextMeter.capacity": "Capacity",
  "contextMeter.assumedSuffix": "· assumed 128k",
  "contextMeter.noTurns": "No turns yet.",
  "contextMeter.compactTitle": "Compact the conversation history (kernel /compact)",
  "contextMeter.compactButton": "compact",

  /** ---------- Composer 输入卡 ---------- */
  "composer.messageAria": "Message",
  "composer.attachmentsAria": "Pending attachments",
  "composer.removeAttachment": "Remove attachment",
  "composer.removeFile": "Remove file {name}",
  "composer.imageFallback": "image",
  "composer.placeholderOwner": "Edit your message — sending will resend it as a new message",
  "composer.placeholderReconnecting": "Reconnecting…",
  "composer.placeholderUnavailable": "Agent unavailable",
  "composer.placeholderMode": "Message the {mode} agent…",
  "composer.placeholderDefault": "Message the agent…",
  "composer.modeChipTitleRunning": "Switch after the current turn ends",
  "composer.modeChipTitleSession": "Switch this session's mode",
  "composer.modeChipTitlePending": "Pick the mode for your next session",
  "composer.modeChipAria": "Session mode",
  "composer.modeChipFallback": "Mode",
  "composer.launcherTitle": "Commands and skills",
  "composer.attachImages": "Attach images (paste or pick, ≤4 MiB each)",
  "composer.attachFiles": "Attach files (text inlined, binary as refs, ≤512 KiB each)",
  "composer.modelDanglingTitle":
    "{label} — active model is outside your configured Model Routes (amber). Pick a routed model here or manage routes in Settings → Model",
  "composer.modelRunningTitle": "{label} — switch after the current turn ends",
  "composer.modelTitle":
    "{label} — switch the active model (route configuration lives in Settings → Model)",
  "composer.modelDanglingAria":
    "Switch active model — current model {label} is outside your configured Model Routes",
  "composer.modelAria": "Switch active model",
  "composer.effortTitle": "Reasoning effort: {effort}",
  "composer.danglingLabel": "{label} — outside Routes",
  "composer.openSettings": "Open settings →",
  "composer.busyAttachmentReads": "Attachments are still being read — try again in a moment.",
  "composer.toastModelSwitched": "Active model → {provider} · {model}",
  "composer.toastBusyPref": "Busy-Enter preference → {mode}",
  "composer.stopAria": "Cancel current activity",
  "composer.queueAria": "Queue message after the current turn",
  "composer.steerAria": "Steer the current turn with this message",
  "composer.sendAria": "Send message",
  "composer.stopTitle": "Cancel current activity",
  "composer.queueTitle": "Queue (Enter) · Steer (⌘/Ctrl+Enter)",
  "composer.steerTitle": "Steer (Enter) · Queue (⌘/Ctrl+Enter)",
  "composer.sendTitle": "Send (Enter)",

  /** ---------- `/` 命令与技能菜单 ---------- */
  "slashMenu.groupCommands": "Commands",
  "slashMenu.groupSkills": "Skills",
  "slashMenu.cmdCompact": "Summarize the transcript to reclaim context",
  "slashMenu.cmdQueue": "While busy, Enter queues after the current turn",
  "slashMenu.cmdSteer": "While busy, Enter steers the current turn",
  "slashMenu.menuAria": "Slash commands and skills",
  "slashMenu.sourceFromProvider": "skills from provider: {provider}",
  "slashMenu.sourceNoProvider": "Open a Workspace provider to load skills",
  "slashMenu.empty": "No matching command or skill",

  /** ---------- `$` 技能引用菜单 ---------- */
  /** typeToSearch 两键的 en 值固定现网中文占位（skill-menu.test 锚点；历史遗留，
      后续批统一裁决测试与文案）。 */
  "skillMenu.typeToSearch": "输入关键词检索技能",
  "skillMenu.typeToSearchEmpty": "输入关键词检索技能…",
  "skillMenu.searching": "Searching skills…",
  "skillMenu.notConnected": "Not connected",
  "skillMenu.searchUnavailable": "Search unavailable",
  "skillMenu.noMatchingSkill": "No matching skill",
  "skillMenu.menuAria": "Skills — across workspaces",
  "skillMenu.resultsSummary": "{count} skills · {groups} provider groups",
  "skillMenu.acrossWorkspaces": "Skills across workspaces",

  /** ---------- `@` 文件/会话引用菜单 ---------- */
  "referenceMenu.loadingDir": "Loading directory…",
  "referenceMenu.filesFromHome": "Files from: home",
  "referenceMenu.filesFrom": "Files from: {dir}",
  "referenceMenu.notConnected": "Not connected",
  "referenceMenu.menuAria": "References — files and sessions",
  "referenceMenu.empty": "No matching file or session",
  "referenceMenu.groupSessions": "Sessions",
  "referenceMenu.groupFiles": "Files",

  /** ---------- 拖放覆盖层 ---------- */
  "dropOverlay.aria": "Drop files to attach",
  "dropOverlay.title": "Drop to attach",
  "dropOverlay.body": "Images and files go to this message",

  /** ---------- 折叠行原子 ---------- */
  "disclosureRow.toolError": "Tool error",

  /** ---------- 芯片镜像层 tooltip ---------- */
  "chipPaint.sessionTitle": "session: {label}",
  "chipPaint.skillTitle": "skill: {name}",

  /** ---------- 转录流 ---------- */
  "transcript.emptyPrimary": "Send a message to start a session.",
  "transcript.emptySecondary": "Pick how the agent works with the mode selector below.",
  "transcript.turnDefault": "Turn",
  "transcript.modeAria": "Mode switched from {from} to {to}",
  "transcript.modeTag": "mode",
  "transcript.compactTag": "compact",
  "transcript.agentTag": "agent",
  "transcript.subagentAria": "Subagent spawned: {label} ({mode})",
  "transcript.actionsAria": "Message actions",
  "transcript.copyTitle": "Copy",
  "transcript.copyAria": "Copy message",
  "transcript.editTitle": "Edit & resend — resends as a new message, keeps history",
  "transcript.editAria": "Edit and resend — resends as a new message, keeps history",
  "transcript.resendTitle": "Resend — keeps history",
  "transcript.resendAria": "Resend message — keeps history",
  "transcript.thinking": "Thinking",
  "transcript.working": "Working",
  "transcript.backToBottom": "Back to bottom",
  "transcript.toastCopyFailed": "Copy failed — clipboard unavailable.",
} as const;

export type EnCatalog = typeof en;
export type MessageKey = keyof EnCatalog;
