/**
 * 扩展面板 typed panel registry store（skills-agent-page-zcode-parity task 3.1/3.2）。
 *
 * 用户原始需求 [2026-10-04]（design §3）：「建立可类型化的 panel registry……
 * 建立 `tool result → typed panel request → active tab` 映射；每个请求保留
 * `sessionId`、Workspace target 和源 seq/tool id，验证输出引用后才创建 pane。」
 *
 * ZCode 引用对照（/tmp/ia-redesign/zcode-src/packages/ui/src/，commit 29628c9）：
 *   - registry 状态机与操作：lib/workspaceSidePane.ts（本 store 经
 *     components/agent/extension/panel-tabs.ts 纯模型组合——activate/reorder/
 *     close/others/all/restore/normalize/visible 逐条对照）。
 *   - 最近关闭（bounded 8/newest-first/重开即移除）：hooks/useAppPanels.ts:1341/:1508。
 *   - typed 输出链接宿主接线：app-shell/WorkspaceShellLayout.tsx:1839-1894
 *     （onOpenBrowserUrl/onOpenCodeViewer/onOpenBackgroundBash/onOpenSubagent*
 *     等集中连接——本产品对应 openExtension* API，供容器/TranscriptView 接线）。
 *
 * 差异裁决：
 *   - 旧版固定三 tab 的 manualTab/autoTab「手动优先」语义退役：ZCode 的 open
 *     request 一律激活目标 tab（design §3 决策 3——审批到达沿 = typed request，
 *     激活 approvals tab）；审批角标/到达沿保留（产品自有）。
 *   - 审批轮询投影（skills-agent-page 1.5）原语义保留：4s 轮询、断线代次门、
 *     会话切换重置 pending 基线（新会话存量不算「到达」）。
 *   - owner 为 null（无活动会话）：typed request 一律拒绝（本产品数据面均
 *     session-scoped；ZCode 的 draft-scope tab 无对应数据面）。
 *
 * 正交意图：
 *   [1] registry 状态（tabs/activeTabId/recentClosed/dragging）经纯模型组合。
 *   [2] typed 输出链接（approvals/bash-output/subagents/cards/ui-card/
 *       file-preview）——引用验证失败不建 tab（typed 拒绝）。
 *   [3] 审批 watch（轮询/到达沿/角标）——到达沿驱动 typed request。
 *   [4] owner 生命周期（rebind 归一 + 基线重置）。
 * 妥协声明：无。
 */

import { loadProposals } from "$lib/stores/intelligence.svelte";
import type { UnifiedProposalView } from "$shared/contracts/agent.js";
import {
  activatePanelTab,
  closeAllPanelTabs,
  closeOtherPanelTabs,
  closePanelTab,
  createApprovalsPanelTab,
  createBashOutputPanelTab,
  createCardsPanelTab,
  createFilePreviewPanelTab,
  createSubagentsPanelTab,
  createUiCardPanelTab,
  getVisiblePanelTabs,
  getVisibleRecentClosedPanelTabs,
  isUsableFilePreviewPath,
  isUsableUiCardResourceUri,
  normalizePanelTabsState,
  rememberClosedPanelTabs,
  reorderPanelTab,
  resolveActivePanelTabId,
  restorePanelTab,
  setActivePanelTab,
  type ExtensionPanelTab,
  type RecentClosedPanelTab,
} from "$lib/components/agent/extension/panel-tabs.js";

const POLL_INTERVAL = 4_000;

export const extensionPanel = $state({
  /** 当前 owner 会话（registry 冻结归属；null = 无会话，可见面为空）。 */
  ownerSessionId: null as string | null,
  /** registry 全量 tab（跨会话保留；可见面按 owner 过滤——ZCode workspace 级 registry 同构）。 */
  tabs: [] as ExtensionPanelTab[],
  /** 活动 tab id（"" = 无活动；可见面为空时由视图解析回退）。 */
  activeTabId: "",
  /** 最近关闭（bounded 8，newest-first；owner 过滤后进 overview）。 */
  recentClosed: [] as RecentClosedPanelTab[],
  /** 拖拽中的 tab id（tab 条投影用；null = 未拖拽）。 */
  draggingTabId: null as string | null,
  /** 最新统一审批面投影（null = 未加载；代次门语义见 intelligence store）。 */
  proposals: null as UnifiedProposalView[] | null,
  error: null as string | null,
  /** approvals tab 角标（未读 pending 数；激活 approvals tab 清零）。 */
  approvalsBadge: 0,
  /** 新审批到达沿（消费即清；激活 approvals tab 即消费）。 */
  approvalArrived: false,
});

/** pending 计数基线（上升沿检测）。 */
let pendingBaseline = 0;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let boundSession: string | null = null;

// ---- registry 状态提交（纯模型 → runes 状态） ----

function currentState() {
  return { tabs: extensionPanel.tabs, activeTabId: extensionPanel.activeTabId };
}

function commitState(next: ReturnType<typeof currentState> | null): void {
  if (next === null) {
    extensionPanel.tabs = [];
    extensionPanel.activeTabId = "";
    return;
  }
  extensionPanel.tabs = next.tabs;
  extensionPanel.activeTabId = next.activeTabId;
}

/** 可见 tab（owner 过滤；组件 $derived 消费）。 */
export function visibleExtensionTabs(): ExtensionPanelTab[] {
  return getVisiblePanelTabs(extensionPanel.tabs, extensionPanel.ownerSessionId);
}

/** 可见 active 解析（原 active 不可见 → 最后一个可见；ZCode :427-429 派生回退）。 */
export function visibleActiveExtensionTabId(): string {
  const id = resolveActivePanelTabId(currentState(), extensionPanel.ownerSessionId);
  return id ?? "";
}

/** 可见最近关闭（owner 过滤；overview 消费）。 */
export function visibleRecentClosedExtensionTabs(): RecentClosedPanelTab[] {
  return getVisibleRecentClosedPanelTabs(
    extensionPanel.recentClosed,
    extensionPanel.ownerSessionId,
  );
}

function commitClosed(closedTabs: ExtensionPanelTab[]): void {
  if (closedTabs.length === 0) return;
  extensionPanel.recentClosed = rememberClosedPanelTabs(
    extensionPanel.recentClosed,
    closedTabs,
    Date.now(),
  );
}

// ---- registry 操作（tab 条/overview 直面；ZCode AnimatedSidePanePanel 回调族） ----

/** 激活 tab（未知 id 不改状态；approvals 激活 = 已读：角标/到达沿清零）。 */
export function activateExtensionTab(tabId: string): void {
  const next = setActivePanelTab(currentState(), tabId);
  if (next !== null) commitState(next);
  const active = extensionPanel.tabs.find((tab) => tab.id === extensionPanel.activeTabId);
  if (active?.type === "approvals") {
    extensionPanel.approvalsBadge = 0;
    extensionPanel.approvalArrived = false;
  }
}

/** 关闭单个 tab（关的是 active 时按 ZCode fallback 落邻位）。 */
export function closeExtensionTab(tabId: string): void {
  const before = currentState();
  const closed = before.tabs.find((tab) => tab.id === tabId);
  if (!closed) return;
  commitState(closePanelTab(before, tabId));
  commitClosed([closed]);
}

/** 关闭其它（owner 可见面；其它 owner 的 tab 与最近关闭记忆不动）。 */
export function closeOtherExtensionTabs(tabId: string): void {
  const before = currentState();
  const visible = getVisiblePanelTabs(before.tabs, extensionPanel.ownerSessionId);
  const target = visible.find((tab) => tab.id === tabId);
  if (!target) return;
  const closing = visible.filter((tab) => tab.id !== tabId);
  commitState(closeOtherPanelTabs(before, tabId, extensionPanel.ownerSessionId));
  commitClosed(closing);
}

/** 关闭全部（owner 可见面）。 */
export function closeAllExtensionTabs(): void {
  const before = currentState();
  const closing = getVisiblePanelTabs(before.tabs, extensionPanel.ownerSessionId);
  commitState(closeAllPanelTabs(before, extensionPanel.ownerSessionId));
  commitClosed(closing);
}

/** 拖拽重排（activeId 移到 overId；ZCode onReorderTab）。 */
export function reorderExtensionTab(activeTabId: string, overTabId: string): void {
  commitState(reorderPanelTab(currentState(), activeTabId, overTabId));
}

/** 拖拽态（tab 条 DragOverlay/ghost 投影用）。 */
export function setExtensionDraggingTabId(tabId: string | null): void {
  extensionPanel.draggingTabId = tabId;
}

/** 最近重开（恢复 + 激活 + 移出最近关闭；ZCode handleReopenClosedSidePaneTab）。 */
export function reopenRecentExtensionTab(tabId: string): void {
  const entry = extensionPanel.recentClosed.find((item) => item.tab.id === tabId);
  if (!entry) return;
  commitState(restorePanelTab(currentState(), entry.tab));
  extensionPanel.recentClosed = extensionPanel.recentClosed.filter((item) => item.tab.id !== tabId);
}

// ---- typed 输出链接（tool result → typed panel request → active tab） ----

export interface TypedPanelOpenResult {
  opened: boolean;
  /** 拒绝原因（opened=false 时非空；容器/调用方可静默忽略）。 */
  reason?: "no-active-session" | "invalid-reference";
}

function openSingletonTab(tab: ExtensionPanelTab): TypedPanelOpenResult {
  if (extensionPanel.ownerSessionId === null) {
    return { opened: false, reason: "no-active-session" };
  }
  commitState(activatePanelTab(currentState(), tab));
  return { opened: true };
}

/** 统一审批面 tab（owner 单例；审批到达沿自动触发）。 */
export function openExtensionApprovals(): TypedPanelOpenResult {
  if (extensionPanel.ownerSessionId === null) {
    return { opened: false, reason: "no-active-session" };
  }
  return openSingletonTab(createApprovalsPanelTab(extensionPanel.ownerSessionId));
}

/** shell 输出流 tab（owner 单例；ZCode bash-output 的产品映射——聚合流）。 */
export function openExtensionBashOutput(): TypedPanelOpenResult {
  if (extensionPanel.ownerSessionId === null) {
    return { opened: false, reason: "no-active-session" };
  }
  return openSingletonTab(createBashOutputPanelTab(extensionPanel.ownerSessionId));
}

/** 子代理目录 tab（owner 单例）。 */
export function openExtensionSubagents(): TypedPanelOpenResult {
  if (extensionPanel.ownerSessionId === null) {
    return { opened: false, reason: "no-active-session" };
  }
  return openSingletonTab(createSubagentsPanelTab(extensionPanel.ownerSessionId));
}

/** ui:// 卡目录 tab（owner 单例）。 */
export function openExtensionCards(): TypedPanelOpenResult {
  if (extensionPanel.ownerSessionId === null) {
    return { opened: false, reason: "no-active-session" };
  }
  return openSingletonTab(createCardsPanelTab(extensionPanel.ownerSessionId));
}

/**
 * 单张 ui:// 卡聚焦 tab（身份 = owner + resourceUri，重复点击幂等聚焦）。
 * 引用验证：uri 必须命中 agent.card.get 契约正则——畸形/不支持的结果不建 tab。
 */
export function openExtensionUiCard(request: {
  resourceUri: string;
  title?: string;
}): TypedPanelOpenResult {
  if (extensionPanel.ownerSessionId === null) {
    return { opened: false, reason: "no-active-session" };
  }
  if (!isUsableUiCardResourceUri(request.resourceUri)) {
    return { opened: false, reason: "invalid-reference" };
  }
  return openSingletonTab(
    createUiCardPanelTab({
      ownerSessionId: extensionPanel.ownerSessionId,
      resourceUri: request.resourceUri,
      title: request.title,
    }),
  );
}

/**
 * 单文件/媒体预览 tab（身份 = owner + 绝对路径；ZCode code-viewer 的产品映射）。
 * 引用验证：agent.files.preview 契约要求绝对路径——相对/空路径 typed 拒绝。
 */
export function openExtensionFilePreview(request: { path: string }): TypedPanelOpenResult {
  if (extensionPanel.ownerSessionId === null) {
    return { opened: false, reason: "no-active-session" };
  }
  if (!isUsableFilePreviewPath(request.path)) {
    return { opened: false, reason: "invalid-reference" };
  }
  return openSingletonTab(
    createFilePreviewPanelTab({
      ownerSessionId: extensionPanel.ownerSessionId,
      path: request.path,
    }),
  );
}

// ---- owner 生命周期 + 审批 watch（skills-agent-page 1.5 语义保留） ----

/**
 * 会话上下文切换（SkillsAgentPage 调用）：registry 跨会话保留（可见面按 owner
 * 过滤 + active 归一回退）；审批手动/到达基线重置（新会话 pending 是存量不是
 * 到达），立即拉一轮。
 */
export function rebindExtensionPanel(sessionId: string | null): void {
  if (boundSession === sessionId) return;
  boundSession = sessionId;
  extensionPanel.ownerSessionId = sessionId;
  const normalized = normalizePanelTabsState(currentState(), sessionId);
  extensionPanel.tabs = normalized.tabs;
  extensionPanel.activeTabId = normalized.activeTabId;
  extensionPanel.approvalsBadge = 0;
  extensionPanel.approvalArrived = false;
  pendingBaseline = 0;
  void refreshProposals();
}

async function refreshProposals(): Promise<void> {
  const { proposals, error } = await loadProposals();
  // stale（代次门失效）或断线：保留上一投影，不更新基线。
  if (proposals === null) {
    if (error !== null) extensionPanel.error = error;
    return;
  }
  extensionPanel.proposals = proposals;
  extensionPanel.error = null;
  const pending = proposals.filter((proposal) => proposal.status === "pending").length;
  if (pending > pendingBaseline && pendingBaseline !== 0) {
    // 上升沿：新审批到达 = typed request → 激活 approvals tab + 角标（ZCode
    // open request 语义；旧 manualTab 优先语义见文件头差异裁决）。
    extensionPanel.approvalArrived = true;
    extensionPanel.approvalsBadge = pending;
    void openExtensionApprovals();
  } else if (pending <= pendingBaseline) {
    // 决定/清除：角标只减不清到达沿语义（用户未读时保留角标余量）。
    extensionPanel.approvalsBadge = Math.min(extensionPanel.approvalsBadge, pending);
    extensionPanel.approvalArrived = false;
  }
  pendingBaseline = pending;
}

/** 启动轮询（Agent 页挂载调用；幂等）。 */
export function startExtensionPanelWatch(): void {
  if (pollTimer !== null) return;
  void refreshProposals();
  pollTimer = setInterval(() => void refreshProposals(), POLL_INTERVAL);
}

/** 停止轮询（Agent 页卸载调用）。 */
export function stopExtensionPanelWatch(): void {
  if (pollTimer !== null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}
