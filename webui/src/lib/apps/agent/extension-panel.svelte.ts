/**
 * 扩展面板审批 watch（skills-agent-page 1.5）。
 *
 * 用户原始需求 [2026-10-03]（design §5）：「panelTabs 按会话上下文自动切换
 * （新审批到达 → 审批 tab 角标）；用户手动切换优先（会话内记忆）」——审批
 * 数据源 = agent.proposals.* 统一审批面（intelligence store 的 loadProposals，
 * latest-request-wins 代次门在彼处）。
 *
 * 正交意图：
 *   [1] 轮询投影：Agent 页在场时 4s 间隔拉统一审批面（轻 RPC；断线由
 *       loadProposals 的代次门自然失效）。
 *   [2] 到达检测：pending 数量上升沿 = 新审批到达（autoTab 信号 + 角标计数）；
 *       会话切换重置基线（新会话的 pending 不算「到达」，只算存量）。
 *   [3] 手动切换优先（会话内记忆）：manualTab 由用户点击写入，会话切换时清除。
 * 妥协声明：无（审批决定动作复用 AgentProposalCard 的直连 RPC 面）。
 */

import { loadProposals } from "$lib/stores/intelligence.svelte";
import type { UnifiedProposalView } from "$shared/contracts/agent.js";

const POLL_INTERVAL = 4_000;

export type ExtensionPanelTab = "terminal-narrative" | "approvals" | "cards";

export const extensionPanel = $state({
  /** 当前激活 tab（manualTab 存在时跟随手动；否则跟随 autoTab）。 */
  activeTab: "terminal-narrative" as ExtensionPanelTab,
  /** 用户手动选择（会话内记忆；null = 尚未手动切换，允许自动切换）。 */
  manualTab: null as ExtensionPanelTab | null,
  /** 自动切换目标（新审批到达 → approvals）。 */
  autoTab: "terminal-narrative" as ExtensionPanelTab,
  /** 审批 tab 的角标（未读 pending 数；切到该 tab 清零）。 */
  approvalsBadge: 0,
  /** 最新统一审批面投影（null = 未加载）。 */
  proposals: null as UnifiedProposalView[] | null,
  error: null as string | null,
  /** 新审批到达沿（消费即清；autoTab 已置 approvals，badge 供角标）。 */
  approvalArrived: false,
});

/** pending 计数基线（上升沿检测）。 */
let pendingBaseline = 0;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let boundSession: string | null = null;

/** 手动切换 tab（优先记忆；会话切换时清除）。 */
export function setExtensionTabManual(tab: ExtensionPanelTab): void {
  extensionPanel.manualTab = tab;
  extensionPanel.activeTab = tab;
  if (tab === "approvals") {
    extensionPanel.approvalsBadge = 0;
    extensionPanel.approvalArrived = false;
  }
}

/**
 * 会话上下文切换（SkillsAgentPage 调用）：重置手动记忆与到达基线（新会话的
 * pending 是存量不是到达），立即拉一轮。
 */
export function rebindExtensionPanel(sessionId: string | null): void {
  if (boundSession === sessionId) return;
  boundSession = sessionId;
  extensionPanel.manualTab = null;
  extensionPanel.autoTab = "terminal-narrative";
  extensionPanel.activeTab = "terminal-narrative";
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
    // 上升沿：新审批到达——自动切 tab（手动记忆优先不被覆盖）+ 角标。
    extensionPanel.approvalArrived = true;
    extensionPanel.approvalsBadge = pending;
    extensionPanel.autoTab = "approvals";
    if (extensionPanel.manualTab === null) extensionPanel.activeTab = "approvals";
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
