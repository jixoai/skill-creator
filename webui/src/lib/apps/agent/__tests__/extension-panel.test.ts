/**
 * 扩展面板 panelTabs 切换语义单测（skills-agent-page 1.5）。
 *
 * 用户原始需求 [2026-10-03]（design §5）：「panelTabs 按会话上下文自动切换
 * （新审批到达 → 审批 tab 角标）；用户手动切换优先（会话内记忆）」。
 *
 * 正交意图：
 *   [1] 到达检测：pending 上升沿 → autoTab=approvals + 角标；存量不算到达
 *       （会话 rebind 重置基线）。
 *   [2] 手动优先：manualTab 存在时自动切换不覆盖；切到 approvals 清角标。
 *   [3] 轮询面：start/stop 有界（interval 清理）；stale 投影（代次门失效）
 *       不更新状态。
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
  extensionPanel,
  rebindExtensionPanel,
  setExtensionTabManual,
  startExtensionPanelWatch,
  stopExtensionPanelWatch,
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

beforeEach(() => {
  vi.useFakeTimers();
  intelligence.next = null;
  intelligence.stale = false;
  stopExtensionPanelWatch();
  rebindExtensionPanel("session-a");
});

afterEach(() => {
  stopExtensionPanelWatch();
  vi.useRealTimers();
});

describe("approval arrival detection", () => {
  it("auto-switches to approvals with a badge when a new pending proposal arrives", async () => {
    // 首轮刷新（start 的立即拉取）建立存量基线。
    intelligence.next = { proposals: [proposal("mcp:1", "pending")], error: null };
    startExtensionPanelWatch();
    await vi.advanceTimersByTimeAsync(0);
    expect(extensionPanel.activeTab).toBe("terminal-narrative");

    intelligence.next = {
      proposals: [proposal("mcp:1", "pending"), proposal("mcp:2", "pending")],
      error: null,
    };
    await vi.advanceTimersByTimeAsync(4_000);
    expect(extensionPanel.approvalArrived).toBe(true);
    expect(extensionPanel.activeTab).toBe("approvals");
    expect(extensionPanel.approvalsBadge).toBe(2);
  });

  it("manual choice wins over auto-switch within the same session", async () => {
    intelligence.next = { proposals: [proposal("mcp:1", "pending")], error: null };
    startExtensionPanelWatch();
    await vi.advanceTimersByTimeAsync(0);

    setExtensionTabManual("cards");
    intelligence.next = {
      proposals: [proposal("mcp:1", "pending"), proposal("mcp:2", "pending")],
      error: null,
    };
    await vi.advanceTimersByTimeAsync(4_000);
    // 到达沿仍记录（角标），但手动 tab 不被覆盖。
    expect(extensionPanel.activeTab).toBe("cards");
    expect(extensionPanel.approvalsBadge).toBe(2);

    // 手动切到 approvals = 已读：角标清零。
    setExtensionTabManual("approvals");
    expect(extensionPanel.approvalsBadge).toBe(0);
    expect(extensionPanel.approvalArrived).toBe(false);
  });

  it("rebinding to a new session resets manual memory and treats pending as baseline", async () => {
    intelligence.next = { proposals: [proposal("mcp:1", "pending")], error: null };
    startExtensionPanelWatch();
    await vi.advanceTimersByTimeAsync(0);
    setExtensionTabManual("cards");

    intelligence.next = null;
    rebindExtensionPanel("session-b");
    expect(extensionPanel.manualTab).toBeNull();
    expect(extensionPanel.activeTab).toBe("terminal-narrative");
    expect(extensionPanel.approvalsBadge).toBe(0);

    // 新会话的同一批 pending 是存量：不触发自动切换。
    intelligence.next = { proposals: [proposal("mcp:1", "pending")], error: null };
    await vi.advanceTimersByTimeAsync(8_000);
    expect(extensionPanel.activeTab).toBe("terminal-narrative");
    expect(extensionPanel.approvalArrived).toBe(false);
  });

  it("keeps the previous projection when the request goes stale (generation gate)", async () => {
    intelligence.next = { proposals: [proposal("mcp:1", "pending")], error: null };
    startExtensionPanelWatch();
    await vi.advanceTimersByTimeAsync(0);
    const seen = extensionPanel.proposals;

    intelligence.stale = true;
    intelligence.next = {
      proposals: [proposal("mcp:1", "executed")],
      error: null,
    };
    await vi.advanceTimersByTimeAsync(4_000);
    expect(extensionPanel.proposals).toBe(seen);
  });

  it("stopExtensionPanelWatch clears the interval (no further polls)", async () => {
    intelligence.next = { proposals: [proposal("mcp:1", "pending")], error: null };
    startExtensionPanelWatch();
    await vi.advanceTimersByTimeAsync(0);
    expect(extensionPanel.proposals).not.toBeNull();

    stopExtensionPanelWatch();
    intelligence.next = {
      proposals: [proposal("mcp:9", "executed")],
      error: null,
    };
    await vi.advanceTimersByTimeAsync(60_000);
    // 停止后不再轮询：投影停留在停止前的一轮。
    expect(extensionPanel.proposals?.[0]?.id).toBe("mcp:1");
    expect(extensionPanel.proposals?.some((item) => item.id === "mcp:9")).toBe(false);
  });
});
