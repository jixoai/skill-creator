/**
 * 用户原始需求 [2026-10-03]（Owner 裁决）：「WebUI 做中英双语（i18n）」。
 * 正交意图：
 *   [1] 中文词典：Record<MessageKey, string>——en 缺一即编译失败（齐全性门禁）。
 */

import type { EnCatalog } from "./en.js";

/**
 * 术语对照仓库 i18n.zh.md Canonical Glossary：Workspace=工作区、Provider=Provider、
 * Skill=技能、Fragment=碎片、Distill=蒸馏、Proposal=提案、Turn=轮次、
 * Session=会话、Context=上下文；路由/一级导航名（Workspaces/Creator/Repository/Wiki）
 * 与命令 token（/compact、/queue、/steer、$、@）保留英文。
 */
export const zh: Record<keyof EnCatalog, string> = {
  /** ---------- 通用 ---------- */
  "common.retry": "重试",
  "common.cancel": "取消",
  "common.dismiss": "关闭",

  /** ---------- Wiki 首页（scope 索引） ---------- */
  "wikiHome.title": "Wiki",
  "wikiHome.subtitle": "按 wiki 归集的碎片认知——全局笔记与工作区本地知识。",
  "wikiHome.refreshTitle": "刷新 wiki 作用域",
  "wikiHome.loadErrorTitle": "无法加载 wiki 作用域",
  "wikiHome.loadingAria": "正在加载 wiki 作用域",
  "wikiHome.emptyTitle": "还没有 wiki 作用域",
  "wikiHome.emptyBody": "daemon 可达后全局 wiki 会自动出现。",
  "wikiHome.updating": "更新中…",
  "wikiHome.globalBadge": "~ 全局",
  "wikiHome.fragmentsCapturedOne": "已收录 {count} 条碎片",
  "wikiHome.fragmentsCapturedMany": "已收录 {count} 条碎片",
  "wikiHome.updatedOn": "更新于 {date}",
  "wikiHome.notInitialized": "未初始化——首次打开为空，第一条碎片会创建它",

  /** ---------- Wiki scope detail（碎片追加 + 蒸馏） ---------- */
  "wikiScope.backTitle": "返回 wiki 作用域列表",
  "wikiScope.heading": "{scope} wiki",
  "wikiScope.workspaceBadge": "工作区",
  "wikiScope.subtitle": "{scope} 的持久笔记——在这里收集的碎片会驱动技能演进。",
  "wikiScope.refreshTitle": "刷新 wiki",
  "wikiScope.globalScopeLabel": "全局",
  "wikiScope.distillButtonTitle": "把这个工作区的碎片蒸馏进全局 wiki",
  "wikiScope.distillButton": "蒸馏到全局",
  "wikiScope.addFragment": "添加碎片",
  "wikiScope.distillSectionAria": "蒸馏到全局",
  "wikiScope.distillStarting": "正在把碎片蒸馏到全局 wiki…",
  "wikiScope.distillStartFailed": "无法启动蒸馏",
  "wikiScope.distillFailed": "蒸馏失败",
  "wikiScope.distillCompleted": "蒸馏完成",
  "wikiScope.distillCancelled": "蒸馏已取消",
  "wikiScope.distillRunning": "正在蒸馏到全局 wiki…",
  "wikiScope.distillStartingBody":
    "正在收集该工作区的碎片并请模型给出泛化建议——最多可能需要两分钟。",
  "wikiScope.proposalsReadyOne":
    "{count} 份提案待审（{pending} 份待处理）。你批准之前不会写入全局 wiki。",
  "wikiScope.proposalsReadyMany":
    "{count} 份提案待审（{pending} 份待处理）。你批准之前不会写入全局 wiki。",
  "wikiScope.cancelledNoApply": "已取消——没有应用任何提案。",
  "wikiScope.pollStopped": "状态轮询已停止：{error}",
  "wikiScope.viewProposals": "查看提案",
  "wikiScope.hideProposals": "收起提案",
  "wikiScope.cancelRun": "取消运行",
  "wikiScope.loadingProposals": "正在加载提案…",
  "wikiScope.noProposals": "本轮运行没有找到提案。",
  "wikiScope.formAria": "添加碎片",
  "wikiScope.newFragment": "新碎片",
  "wikiScope.cancelAddTitle": "取消",
  "wikiScope.cancelAddAria": "取消添加碎片",
  "wikiScope.fieldTitle": "标题",
  "wikiScope.fieldNote": "笔记",
  "wikiScope.titlePlaceholder": "一句话洞察，例如：固化退出码分支",
  "wikiScope.notePlaceholder": "下次希望 agent 记住什么？",
  "wikiScope.addToWiki": "加入 wiki",
  "wikiScope.loadErrorTitle": "无法加载 wiki",
  "wikiScope.loadingAria": "正在加载 wiki",
  "wikiScope.emptyTitle": "还没有碎片",
  "wikiScope.emptyBody": "在这里沉淀反复出现的洞察；它们是技能演进的输入。",
  "wikiScope.addFirst": "添加第一条碎片",
  "wikiScope.filterPlaceholder": "过滤碎片…",
  "wikiScope.filterAria": "过滤 wiki 碎片",
  "wikiScope.promotedBadge": "已泛化",
  "wikiScope.loadingPattern": "加载中…",
  "wikiScope.noMatch": "没有匹配「{query}」的碎片。",
  "wikiScope.toastAdded": "已把「{title}」加入 wiki。",
  "wikiScope.toastDeduplicated": "已收录过：「{title}」。",
  "wikiScope.runStateCollecting": "收集中",
  "wikiScope.runStateKernelRunning": "模型运行中",
  "wikiScope.runStateAwaitingApproval": "等待批准",
  "wikiScope.runStateCompleted": "已完成",
  "wikiScope.runStateFailed": "已失败",
  "wikiScope.runStateCancelled": "已取消",
  "wikiScope.failNoValidProposals": "模型没有产出有效提案，没有内容被泛化。",
  "wikiScope.failCapacity": "提案存储已满；所有提案都被拒绝。",
  "wikiScope.failIo": "磁盘错误中断了本次运行。",
  "wikiScope.failTimeout": "模型运行超时。",
  "wikiScope.failKernelUnavailable": "agent 内核当前不可用。",
  "wikiScope.failRestarted": "daemon 重启，运行被取消。",
  "wikiScope.failCancelledByShutdown": "daemon 停止，运行被取消。",

  /** ---------- 全局 toast ---------- */
  "toast.dismiss": "关闭通知",

  /** ---------- ⌘K 命令面板 ---------- */
  "palette.placeholder": "搜索导航、工作区与技能…",
  "palette.empty": "没有匹配的目的地。",
  "palette.groupNavigate": "导航",
  "palette.groupWorkspaces": "工作区",
  "palette.groupSkills": "技能",
  "palette.navWorkspaces": "Workspaces",
  "palette.navCreator": "Creator",
  "palette.navRepository": "Repository",
  "palette.navSearchConfig": "打开搜索配置",
  "palette.typeToSearch": "输入以跨工作区搜索技能…",
  "palette.searching": "正在搜索技能…",
  "palette.searchFailed": "技能搜索失败——{error}",
  "palette.noMatchingSkill": "没有匹配的技能。",

  /** ---------- Agent 面板容器 ---------- */
  "agentPanel.panelAria": "Agent 面板",
  "agentPanel.resizeAria": "调整 Agent 面板宽度",
  "agentPanel.editingNote": "编辑中——重发会保留完整历史（只增不改）",
  "agentPanel.cancelEdit": "取消编辑",

  /** ---------- Agent 面板头部 ---------- */
  "agentHeader.agentLabel": "Agent",
  "agentHeader.sessionAria": "会话",
  "agentHeader.newSessionOption": "新建会话…",
  "agentHeader.noSessions": "暂无会话",
  "agentHeader.endedSuffix": "· 已结束",
  "agentHeader.statusSuffix": "· {status}",
  "agentHeader.newSession": "新建会话",
  "agentHeader.closePanel": "关闭面板",

  /** ---------- ui:// 卡片 ---------- */
  "agentCard.loading": "卡片加载中…",
  "agentCard.unavailable": "卡片不可用：{title}",

  /** ---------- ask_user_question 决定卡 ---------- */
  "agentApproval.answeredAria": "已回答的问题",
  "agentApproval.pendingAria": "待回答的问题",
  "agentApproval.answered": "已回答",
  "agentApproval.yourDecision": "需要你的决定",
  "agentApproval.customPlaceholder": "自定义回答（可选）",
  "agentApproval.customAria": "{question} 的自定义回答",
  "agentApproval.submit": "提交回答",

  /** ---------- mutation proposal 审批卡 ---------- */
  "agentProposal.groupAria": "变更提案",
  "agentProposal.title": "提案——{status}",
  "agentProposal.reject": "拒绝",
  "agentProposal.approve": "批准",
  "agentProposal.toastExecuted": "提案已执行：{capability}",
  "agentProposal.toastFailed": "提案执行失败：{capability}",
  "agentProposal.toastRejected": "提案已拒绝：{capability}",

  /** ---------- 工具行（分型展开卡） ---------- */
  "agentTool.input": "输入",
  "agentTool.output": "输出",
  "agentTool.running": "运行中",
  "agentTool.runningEllipsis": "运行中…",
  "agentTool.errorTag": "错误",
  "agentTool.cardTitle": "卡片",
  "agentTool.todoSummaryOne": "{total} 项待办 · 已完成 {done}",
  "agentTool.todoSummaryMany": "{total} 项待办 · 已完成 {done}",
  /** ---------- Todo 折叠卡 ---------- */
  "todoDock.tasks": "任务",
  "todoDock.counts": "完成 {done} · 进行 {active} · 待办 {pending}",

  /** ---------- 排队队列 dock ---------- */
  "queueDock.dockAria": "排队中的消息",
  "queueDock.queued": "队列",
  "queueDock.attachmentsTitle": "{count} 个附件",
  "queueDock.steerChip": "插话",
  "queueDock.steerChipTitle": "在下一个步骤边界引导当前轮次",
  "queueDock.editAria": "编辑排队消息",
  "queueDock.editTitle": "编辑这条排队消息",
  "queueDock.steerAria": "用这条消息插话",
  "queueDock.steerRunningTitle": "用这条消息引导当前轮次",
  "queueDock.steerLockedTitle": "轮次运行中才能插话",
  "queueDock.removeAria": "移除排队消息",
  "queueDock.removeTitle": "从队列移除",
  "queueDock.sending": "发送中…",
  "queueDock.toastEditFailed": "队列编辑失败：{error}",
  "queueDock.toastRemoveFailed": "队列移除失败：{error}",
  "queueDock.toastSteerFailed": "队列插话失败：{error}",

  /** ---------- 上下文用量环 ---------- */
  "contextMeter.aria": "上下文用量",
  "contextMeter.dialogAria": "上下文用量详情",
  "contextMeter.tooltipUsed": "已用 {percent}% 上下文 · 上一轮 ↑{input} / ↓{output}",
  "contextMeter.tooltipIdle": "还没有轮次——首轮结束后才会显示上下文用量",
  "contextMeter.context": "上下文",
  "contextMeter.used": "已用",
  "contextMeter.lastTurn": "上一轮",
  "contextMeter.capacity": "容量",
  "contextMeter.assumedSuffix": "· 按 128k 估算",
  "contextMeter.noTurns": "还没有轮次。",
  "contextMeter.compactTitle": "压缩对话历史（内核 /compact）",
  "contextMeter.compactButton": "压缩",

  /** ---------- Composer 输入卡 ---------- */
  "composer.messageAria": "消息",
  "composer.attachmentsAria": "待发附件",
  "composer.removeAttachment": "移除附件",
  "composer.removeFile": "移除文件 {name}",
  "composer.imageFallback": "图片",
  "composer.placeholderOwner": "编辑消息——发送后会作为新消息重发",
  "composer.placeholderReconnecting": "正在重连…",
  "composer.placeholderUnavailable": "Agent 不可用",
  "composer.placeholderMode": "给 {mode} 模式 agent 发消息…",
  "composer.placeholderDefault": "给 agent 发消息…",
  "composer.modeChipTitleRunning": "当前轮次结束后可切换",
  "composer.modeChipTitleSession": "切换本会话的模式",
  "composer.modeChipTitlePending": "为下一个会话选择模式",
  "composer.modeChipAria": "会话模式",
  "composer.modeChipFallback": "模式",
  "composer.launcherTitle": "命令与技能",
  "composer.attachImages": "附加图片（粘贴或选择，每张 ≤4 MiB）",
  "composer.attachFiles": "附加文件（文本内联、二进制以引用注入，每个 ≤512 KiB）",
  "composer.modelDanglingTitle":
    "{label}——当前活动模型不在已配置的 Model Routes 内（黄色）。请在此选择已路由模型，或到 Settings → Model 管理路由",
  "composer.modelRunningTitle": "{label}——当前轮次结束后可切换",
  "composer.modelTitle": "{label}——切换活动模型（路由配置在 Settings → Model）",
  "composer.modelDanglingAria": "切换活动模型——当前模型 {label} 不在已配置的 Model Routes 内",
  "composer.modelAria": "切换活动模型",
  "composer.effortTitle": "推理强度：{effort}",
  "composer.danglingLabel": "{label}——不在 Routes 内",
  "composer.openSettings": "打开设置 →",
  "composer.busyAttachmentReads": "附件仍在读取中——稍等片刻再试。",
  "composer.toastModelSwitched": "活动模型 → {provider} · {model}",
  "composer.toastBusyPref": "忙碌 Enter 偏好 → {mode}",
  "composer.stopAria": "取消当前活动",
  "composer.queueAria": "排队到当前轮次之后",
  "composer.steerAria": "用这条消息引导当前轮次",
  "composer.sendAria": "发送消息",
  "composer.stopTitle": "取消当前活动",
  "composer.queueTitle": "排队（Enter）· 插话（⌘/Ctrl+Enter）",
  "composer.steerTitle": "插话（Enter）· 排队（⌘/Ctrl+Enter）",
  "composer.sendTitle": "发送（Enter）",

  /** ---------- `/` 命令与技能菜单 ---------- */
  "slashMenu.groupCommands": "命令",
  "slashMenu.groupSkills": "技能",
  "slashMenu.cmdCompact": "总结转录内容以回收上下文",
  "slashMenu.cmdQueue": "忙碌时，Enter 排队到当前轮次之后",
  "slashMenu.cmdSteer": "忙碌时，Enter 插话引导当前轮次",
  "slashMenu.menuAria": "斜杠命令与技能",
  "slashMenu.sourceFromProvider": "技能来源 provider：{provider}",
  "slashMenu.sourceNoProvider": "打开工作区 Provider 以加载技能",
  "slashMenu.empty": "没有匹配的命令或技能",

  /** ---------- `$` 技能引用菜单 ---------- */
  "skillMenu.typeToSearch": "输入关键词检索技能",
  "skillMenu.typeToSearchEmpty": "输入关键词检索技能…",
  "skillMenu.searching": "正在搜索技能…",
  "skillMenu.notConnected": "未连接",
  "skillMenu.searchUnavailable": "搜索不可用",
  "skillMenu.noMatchingSkill": "没有匹配的技能",
  "skillMenu.menuAria": "技能——跨工作区",
  "skillMenu.resultsSummary": "{count} 个技能 · {groups} 个 provider 分组",
  "skillMenu.acrossWorkspaces": "跨工作区技能",

  /** ---------- `@` 文件/会话引用菜单 ---------- */
  "referenceMenu.loadingDir": "正在加载目录…",
  "referenceMenu.filesFromHome": "文件来自：主目录",
  "referenceMenu.filesFrom": "文件来自：{dir}",
  "referenceMenu.notConnected": "未连接",
  "referenceMenu.menuAria": "引用——文件与会话",
  "referenceMenu.empty": "没有匹配的文件或会话",
  "referenceMenu.groupSessions": "会话",
  "referenceMenu.groupFiles": "文件",

  /** ---------- 拖放覆盖层 ---------- */
  "dropOverlay.aria": "拖放文件以附加",
  "dropOverlay.title": "拖放以附加",
  "dropOverlay.body": "图片与文件会附加到这条消息",

  /** ---------- 折叠行原子 ---------- */
  "disclosureRow.toolError": "工具错误",

  /** ---------- 芯片镜像层 tooltip ---------- */
  "chipPaint.sessionTitle": "会话：{label}",
  "chipPaint.skillTitle": "技能：{name}",

  /** ---------- 转录流 ---------- */
  "transcript.emptyPrimary": "发送一条消息即可开始会话。",
  "transcript.emptySecondary": "用下方的模式选择器决定 agent 的工作方式。",
  "transcript.turnDefault": "轮次",
  "transcript.modeAria": "模式从 {from} 切换为 {to}",
  "transcript.modeTag": "模式",
  "transcript.compactTag": "压缩",
  "transcript.agentTag": "agent",
  "transcript.subagentAria": "子代理已启动：{label}（{mode}）",
  "transcript.actionsAria": "消息操作",
  "transcript.copyTitle": "复制",
  "transcript.copyAria": "复制消息",
  "transcript.editTitle": "编辑并重发——作为新消息重发，保留历史",
  "transcript.editAria": "编辑并重发——作为新消息重发，保留历史",
  "transcript.resendTitle": "重发——保留历史",
  "transcript.resendAria": "重发消息——保留历史",
  "transcript.thinking": "思考中",
  "transcript.working": "进行中",
  "transcript.backToBottom": "回到底部",
  "transcript.toastCopyFailed": "复制失败——剪贴板不可用。",
};
