/**
 * 扩展面板 registry store 单测（skills-agent-page-zcode-parity 3.1/3.2）。
 *
 * 用户原始需求 [2026-10-04]（design §3）：「Agent event 通过带源 session/target 的
 * typed request 激活或新建 tab……验证输出引用后才创建 pane」+ skills-agent-page 1.5
 * 保留面（审批轮询/到达沿/基线重置）。
 *
 * 正交意图：
 *   [1] typed 输出链接：owner 冻结、幂等开档、畸形引用不建 tab、无会话拒绝。
 *   [2] registry 生命周期经 store 面：close → 最近关闭记忆 → reopen 恢复；
 *       closeOthers/closeAll；owner 切换可见面过滤（registry 保留）。
 *   [3] 审批 watch：到达沿 → typed request 激活 approvals tab + 角标；激活即已读；
 *       新会话存量不触发；stale 投影保留；stop 有界。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const intelligence = vi.hoisted(() => ({
  next: null as
    | { proposals: import("$shared/contracts/agent.js").UnifiedProposalView[]; error: null }
    | { proposals: null; error: string }
    | null,
  stale: false,
}));

vi.mock("../../../stores/intelligence.svelte", () => ({
  loadProposals: async () => {
    const payload = intelligence.next;
    if (payload === null) return { proposals: null, error: null as string | null };
    if (intelligence.stale) return { proposals: null, error: null as string | null };
    return payload;
  },
}));

import type { UnifiedProposalView } from "$shared/contracts/agent.js";
import {
  activateExtensionTab,
  closeAllExtensionTabs,
  closeExtensionTab,
  closeOtherExtensionTabs,
  extensionPanel,
  openExtensionApprovals,
  openExtensionBashOutput,
  openExtensionCards,
  openExtensionFilePreview,
  openExtensionSubagents,
  openExtensionUiCard,
  rebindExtensionPanel,
  reopenRecentExtensionTab,
  reorderExtensionTab,
  startExtensionPanelWatch,
  stopExtensionPanelWatch,
  visibleActiveExtensionTabId,
  visibleExtensionTabs,
  visibleRecentClosedExtensionTabs,
} from "../extension-panel.svelte";

function proposal(id: string, status: UnifiedProposalView["status"]): UnifiedProposalView {
  return {
    id,
    source: "mcp",
    capability: "wiki.append",
    payload: {},
    origin: "agent-tool",
    kind: "wiki-append",
    target: null,
    observedRevision: null,
    before: null,
    after: null,
    finding: null,
    validation: null,
    status,
    createdAt: "2026-10-03T00:00:00.000Z",
  };
}

/** 重置模块级 registry 到干净 owner（rebind 对同 id 幂等——先解绑再绑定）。 */
function resetStore(): void {
  stopExtensionPanelWatch();
  extensionPanel.tabs = [];
  extensionPanel.activeTabId = "";
  extensionPanel.recentClosed = [];
  extensionPanel.draggingTabId = null;
  extensionPanel.proposals = null;
  extensionPanel.error = null;
  intelligence.next = null;
  intelligence.stale = false;
  rebindExtensionPanel(null);
  rebindExtensionPanel("session-a");
}

beforeEach(() => {
  vi.useFakeTimers();
  resetStore();
});

afterEach(() => {
  stopExtensionPanelWatch();
  vi.useRealTimers();
});

describe("typed output links (tool result → typed panel request → active tab)", () => {
  it("opens singleton tabs idempotently and activates them", () => {
    const first = openExtensionBashOutput();
    const second = openExtensionBashOutput();
    expect(first.opened).toBe(true);
    expect(second.opened).toBe(true);
    expect(visibleExtensionTabs()).toHaveLength(1);
    expect(visibleActiveExtensionTabId()).toBe(visibleExtensionTabs()[0]?.id);

    openExtensionSubagents();
    openExtensionCards();
    expect(visibleExtensionTabs().map((tab) => tab.type)).toEqual([
      "bash-output",
      "subagents",
      "cards",
    ]);
  });

  it("opens ui-card tabs per resource uri and rejects malformed uris", () => {
    expect(
      openExtensionUiCard({ resourceUri: "ui://card/skill/abc123", title: "Report" }).opened,
    ).toBe(true);
    expect(openExtensionUiCard({ resourceUri: "ui://card/skill/abc123" }).opened).toBe(true);
    expect(openExtensionUiCard({ resourceUri: "ui://card/skill/def456" }).opened).toBe(true);
    // 畸形/不支持引用不建 tab。
    expect(openExtensionUiCard({ resourceUri: "https://example.com" })).toEqual({
      opened: false,
      reason: "invalid-reference",
    });
    expect(visibleExtensionTabs()).toHaveLength(2);
  });

  it("opens file previews for absolute paths only", () => {
    expect(openExtensionFilePreview({ path: "/tmp/report.md" }).opened).toBe(true);
    expect(openExtensionFilePreview({ path: "report.md" })).toEqual({
      opened: false,
      reason: "invalid-reference",
    });
    expect(openExtensionFilePreview({ path: "" }).opened).toBe(false);
    expect(visibleExtensionTabs()).toHaveLength(1);
  });

  it("rejects every typed request without an active session", () => {
    rebindExtensionPanel(null);
    expect(openExtensionApprovals()).toEqual({ opened: false, reason: "no-active-session" });
    expect(openExtensionBashOutput().opened).toBe(false);
    expect(openExtensionFilePreview({ path: "/tmp/a.md" }).opened).toBe(false);
    expect(openExtensionUiCard({ resourceUri: "ui://card/skill/abc123" }).opened).toBe(false);
    expect(extensionPanel.tabs).toHaveLength(0);
  });
});

describe("registry lifecycle through the store", () => {
  it("close remembers tabs and reopen restores + activates + drains the recent list", () => {
    openExtensionBashOutput();
    openExtensionSubagents();
    const closedId = visibleExtensionTabs()[0]!.id;

    closeExtensionTab(closedId);
    expect(visibleExtensionTabs().map((tab) => tab.type)).toEqual(["subagents"]);
    expect(visibleRecentClosedExtensionTabs().map((item) => item.tab.id)).toEqual([closedId]);

    reopenRecentExtensionTab(closedId);
    expect(visibleExtensionTabs().map((tab) => tab.type)).toEqual(["subagents", "bash-output"]);
    expect(visibleActiveExtensionTabId()).toBe(closedId);
    expect(visibleRecentClosedExtensionTabs()).toHaveLength(0);
  });

  it("closeOthers keeps the target and remembers the closed siblings", () => {
    openExtensionBashOutput();
    openExtensionSubagents();
    openExtensionCards();
    const target = visibleExtensionTabs()[1]!.id;

    closeOtherExtensionTabs(target);
    expect(visibleExtensionTabs().map((tab) => tab.id)).toEqual([target]);
    expect(visibleActiveExtensionTabId()).toBe(target);
    expect(visibleRecentClosedExtensionTabs()).toHaveLength(2);
  });

  it("closeAll empties the visible face while remembering everything", () => {
    openExtensionBashOutput();
    openExtensionCards();
    closeAllExtensionTabs();
    expect(visibleExtensionTabs()).toHaveLength(0);
    expect(extensionPanel.tabs).toHaveLength(0);
    expect(visibleRecentClosedExtensionTabs()).toHaveLength(2);
  });

  it("reorder moves tabs through the store", () => {
    openExtensionBashOutput();
    openExtensionSubagents();
    openExtensionCards();
    const [first, , last] = visibleExtensionTabs();
    reorderExtensionTab(last!.id, first!.id);
    expect(visibleExtensionTabs().map((tab) => tab.type)).toEqual([
      "cards",
      "bash-output",
      "subagents",
    ]);
  });

  it("keeps the registry across owner switches and restores visibility on switch-back", () => {
    openExtensionBashOutput();
    rebindExtensionPanel("session-b");
    expect(visibleExtensionTabs()).toHaveLength(0);
    expect(extensionPanel.tabs).toHaveLength(1); // registry 保留（ZCode workspace 级 registry）
    expect(visibleRecentClosedExtensionTabs()).toHaveLength(0);

    rebindExtensionPanel("session-a");
    expect(visibleExtensionTabs().map((tab) => tab.type)).toEqual(["bash-output"]);
    // 不可见 owner 的 active 回退到最后一个可见 tab。
    expect(visibleActiveExtensionTabId()).toBe(visibleExtensionTabs()[0]?.id);
  });
});

describe("approval watch (arrival edge drives the typed request)", () => {
  it("auto-opens and activates the approvals tab with a badge on arrival", async () => {
    intelligence.next = { proposals: [proposal("mcp:1", "pending")], error: null };
    startExtensionPanelWatch();
    await vi.advanceTimersByTimeAsync(0);
    openExtensionBashOutput();
    expect(visibleExtensionTabs().map((tab) => tab.type)).toEqual(["bash-output"]);

    intelligence.next = {
      proposals: [proposal("mcp:1", "pending"), proposal("mcp:2", "pending")],
      error: null,
    };
    await vi.advanceTimersByTimeAsync(4_000);
    expect(extensionPanel.approvalArrived).toBe(true);
    expect(extensionPanel.approvalsBadge).toBe(2);
    expect(visibleExtensionTabs().map((tab) => tab.type)).toEqual(["bash-output", "approvals"]);
    expect(visibleActiveExtensionTabId()).toBe(
      visibleExtensionTabs().find((tab) => tab.type === "approvals")?.id,
    );
  });

  it("activating the approvals tab consumes the badge (read)", async () => {
    intelligence.next = { proposals: [proposal("mcp:1", "pending")], error: null };
    startExtensionPanelWatch();
    await vi.advanceTimersByTimeAsync(0);
    openExtensionBashOutput();

    intelligence.next = {
      proposals: [proposal("mcp:1", "pending"), proposal("mcp:2", "pending")],
      error: null,
    };
    await vi.advanceTimersByTimeAsync(4_000);
    expect(extensionPanel.approvalsBadge).toBe(2);

    activateExtensionTab(visibleExtensionTabs().find((tab) => tab.type === "approvals")!.id);
    expect(extensionPanel.approvalsBadge).toBe(0);
    expect(extensionPanel.approvalArrived).toBe(false);
  });

  it("rebinding to a new session treats pending as baseline (no arrival edge)", async () => {
    intelligence.next = { proposals: [proposal("mcp:1", "pending")], error: null };
    startExtensionPanelWatch();
    await vi.advanceTimersByTimeAsync(0);
    openExtensionBashOutput();

    rebindExtensionPanel("session-b");
    intelligence.next = { proposals: [proposal("mcp:9", "pending")], error: null };
    await vi.advanceTimersByTimeAsync(8_000);
    expect(extensionPanel.approvalArrived).toBe(false);
    expect(extensionPanel.approvalsBadge).toBe(0);
    expect(visibleExtensionTabs()).toHaveLength(0); // 新 owner 无 approvals tab
  });

  it("keeps the previous projection when the request goes stale (generation gate)", async () => {
    intelligence.next = { proposals: [proposal("mcp:1", "pending")], error: null };
    startExtensionPanelWatch();
    await vi.advanceTimersByTimeAsync(0);
    const seen = extensionPanel.proposals;

    intelligence.stale = true;
    intelligence.next = { proposals: [proposal("mcp:1", "executed")], error: null };
    await vi.advanceTimersByTimeAsync(4_000);
    expect(extensionPanel.proposals).toBe(seen);
  });

  it("stopExtensionPanelWatch clears the interval (no further polls)", async () => {
    intelligence.next = { proposals: [proposal("mcp:1", "pending")], error: null };
    startExtensionPanelWatch();
    await vi.advanceTimersByTimeAsync(0);
    expect(extensionPanel.proposals).not.toBeNull();

    stopExtensionPanelWatch();
    intelligence.next = { proposals: [proposal("mcp:9", "executed")], error: null };
    await vi.advanceTimersByTimeAsync(60_000);
    expect(extensionPanel.proposals?.[0]?.id).toBe("mcp:1");
    expect(extensionPanel.proposals?.some((item) => item.id === "mcp:9")).toBe(false);
  });
});
