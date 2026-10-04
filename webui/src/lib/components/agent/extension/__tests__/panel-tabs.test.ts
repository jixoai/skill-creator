/**
 * panel registry 纯模型单测（skills-agent-page-zcode-parity 3.1/3.2）。
 *
 * 用户原始需求 [2026-10-04]（design §3）：「typed single-host/multi-tab panel
 * registry supporting add, activate, reorder, close-current/others/all, overview
 * search, and reopen-recent；malformed/unsupported results do not create tabs」。
 *
 * 正交意图：
 *   [1] 生命周期：activate 幂等（结构化 id）、reorder splice、close fallback、
 *       closeOthers/closeAll 的 owner 可见面语义。
 *   [2] 搜索打分：ZCode sidePaneTabSearch.ts 逐位对照（120/90/70/40/20/1 档、
 *       多词 AND、稳定名次）。
 *   [3] 最近关闭：bounded 8、newest-first、重开恢复；typed 引用验证（绝对路径/
 *       ui:// 契约正则）与标题投影。
 */
import { describe, expect, it } from "vitest";
import {
  activatePanelTab,
  buildPanelTabSearchFields,
  closeAllPanelTabs,
  closeOtherPanelTabs,
  closePanelTab,
  createApprovalsPanelTab,
  createBashOutputPanelTab,
  createCardsPanelTab,
  createFilePreviewPanelTab,
  createSubagentsPanelTab,
  createUiCardPanelTab,
  filterAndRankPanelTabSearchItems,
  formatPanelTabRelativeTime,
  getPanelTabSearchHint,
  getPanelTabTitle,
  getPanelTabTypeLabel,
  getVisiblePanelTabs,
  getVisibleRecentClosedPanelTabs,
  isUsableFilePreviewPath,
  isUsableUiCardResourceUri,
  normalizePanelTabSearchQuery,
  normalizePanelTabsState,
  rememberClosedPanelTabs,
  reorderPanelTab,
  RECENT_CLOSED_PANEL_TAB_LIMIT,
  resolveActivePanelTabId,
  restorePanelTab,
  setActivePanelTab,
  type ExtensionPanelTab,
  type ExtensionPanelTabsState,
} from "../panel-tabs.js";

const OWNER = "session-a";
const OTHER = "session-b";

function bashTab(owner = OWNER): ExtensionPanelTab {
  return createBashOutputPanelTab(owner, 1_000);
}
function approvalsTab(owner = OWNER): ExtensionPanelTab {
  return createApprovalsPanelTab(owner, 2_000);
}
function subagentsTab(owner = OWNER): ExtensionPanelTab {
  return createSubagentsPanelTab(owner, 3_000);
}
function cardsTab(owner = OWNER): ExtensionPanelTab {
  return createCardsPanelTab(owner, 4_000);
}
function uiCardTab(owner = OWNER): ExtensionPanelTab {
  return createUiCardPanelTab({
    ownerSessionId: owner,
    resourceUri: "ui://card/skill/abc123",
    title: "Skill report",
    openedAt: 5_000,
  });
}
function fileTab(path = "/tmp/report.md", owner = OWNER): ExtensionPanelTab {
  return createFilePreviewPanelTab({ ownerSessionId: owner, path, openedAt: 6_000 });
}

function stateOf(...tabs: ExtensionPanelTab[]): ExtensionPanelTabsState {
  return { tabs, activeTabId: tabs[tabs.length - 1]?.id ?? "" };
}

describe("structured identity (idempotent open)", () => {
  it("gives the same id for the same owner + resource", () => {
    expect(uiCardTab().id).toBe(uiCardTab().id);
    expect(fileTab().id).toBe(fileTab().id);
    expect(fileTab().id).not.toBe(fileTab("/tmp/other.md").id);
    expect(uiCardTab().id).not.toBe(uiCardTab(OTHER).id);
  });

  it("encodes unsafe path characters into the tab id", () => {
    const tab = fileTab("/tmp/a b:c/d.md");
    expect(tab.id).not.toMatch(/\s/);
  });

  it("activate replaces an existing tab in place and activates it", () => {
    const first = bashTab();
    const second = bashTab();
    const state = activatePanelTab(activatePanelTab(stateOf(first), approvalsTab()), second);
    expect(state.tabs.map((tab) => tab.type)).toEqual(["bash-output", "approvals"]);
    expect(state.tabs[0]).toBe(second);
    expect(state.activeTabId).toBe(second.id);
  });

  it("activate appends unknown tabs and activates them", () => {
    const state = activatePanelTab(stateOf(bashTab()), approvalsTab());
    expect(state.tabs).toHaveLength(2);
    expect(state.activeTabId).toBe(state.tabs[1]?.id);
  });

  it("activate bootstraps from a null registry", () => {
    const state = activatePanelTab(null, bashTab());
    expect(state.tabs).toHaveLength(1);
    expect(state.activeTabId).toBe(state.tabs[0]?.id);
  });
});

describe("reorder (drag)", () => {
  it("moves the dragged tab onto the target position", () => {
    const a = bashTab();
    const b = approvalsTab();
    const c = subagentsTab();
    // ZCode 语义：先移除 dragged，再按目标原 index 插入 → a 落到 c 的原位之后。
    const state = reorderPanelTab(stateOf(a, b, c), a.id, c.id);
    expect(state?.tabs.map((tab) => tab.id)).toEqual([b.id, c.id, a.id]);
  });

  it("moves a trailing tab forward", () => {
    const a = bashTab();
    const b = approvalsTab();
    const c = subagentsTab();
    const state = reorderPanelTab(stateOf(a, b, c), c.id, a.id);
    expect(state?.tabs.map((tab) => tab.id)).toEqual([c.id, a.id, b.id]);
  });

  it("is a no-op for same or unknown ids", () => {
    const state = stateOf(bashTab(), approvalsTab());
    expect(reorderPanelTab(state, state.tabs[0]!.id, state.tabs[0]!.id)).toBe(state);
    expect(reorderPanelTab(state, "missing", state.tabs[1]!.id)).toBe(state);
  });
});

describe("close semantics", () => {
  it("falls back to the neighbouring tab when closing the active tab", () => {
    const a = bashTab();
    const b = approvalsTab();
    const c = subagentsTab();
    const closedMiddle = closePanelTab(stateOf(a, b, c), b.id);
    expect(closedMiddle?.activeTabId).toBe(c.id);
    const closedLast = closePanelTab(stateOf(a, b, c), c.id);
    expect(closedLast?.activeTabId).toBe(b.id);
  });

  it("keeps the current active when closing an inactive tab", () => {
    const a = bashTab();
    const b = approvalsTab();
    const state = closePanelTab({ tabs: [a, b], activeTabId: b.id }, a.id);
    expect(state?.tabs.map((tab) => tab.id)).toEqual([b.id]);
    expect(state?.activeTabId).toBe(b.id);
  });

  it("empties the registry when the last tab closes", () => {
    const a = bashTab();
    expect(closePanelTab(stateOf(a), a.id)).toBeNull();
  });

  it("closing an unknown id is a no-op", () => {
    const state = stateOf(bashTab());
    expect(closePanelTab(state, "missing")).toBe(state);
  });

  it("closeOthers keeps the target, activates it, and preserves other-owner tabs", () => {
    const a = bashTab();
    const b = approvalsTab();
    const foreign = bashTab(OTHER);
    const state = { tabs: [a, b, foreign], activeTabId: a.id };
    const next = closeOtherPanelTabs(state, b.id, OWNER);
    expect(next?.tabs.map((tab) => tab.id)).toEqual([b.id, foreign.id]);
    expect(next?.activeTabId).toBe(b.id);
  });

  it("closeOthers with an invisible target is a no-op", () => {
    const a = bashTab();
    const foreign = bashTab(OTHER);
    const state = { tabs: [a, foreign], activeTabId: a.id };
    expect(closeOtherPanelTabs(state, foreign.id, OWNER)).toBe(state);
  });

  it("closeAll removes only owner-visible tabs and resets active", () => {
    const a = bashTab();
    const b = approvalsTab();
    const foreign = bashTab(OTHER);
    const next = closeAllPanelTabs({ tabs: [a, b, foreign], activeTabId: b.id }, OWNER);
    expect(next?.tabs.map((tab) => tab.id)).toEqual([foreign.id]);
    expect(next?.activeTabId).toBe("");
    expect(closeAllPanelTabs(stateOf(a), OWNER)).toBeNull();
  });
});

describe("owner visibility and active resolution", () => {
  it("filters tabs by owner and rejects a null owner", () => {
    const a = bashTab();
    const foreign = bashTab(OTHER);
    expect(getVisiblePanelTabs([a, foreign], OWNER).map((tab) => tab.id)).toEqual([a.id]);
    expect(getVisiblePanelTabs([a], null)).toEqual([]);
  });

  it("resolves preferred > current-if-visible > last visible > null", () => {
    const a = bashTab();
    const b = approvalsTab();
    const foreign = bashTab(OTHER);
    const state = { tabs: [a, b, foreign], activeTabId: a.id };
    expect(resolveActivePanelTabId(state, OWNER, b.id)).toBe(b.id);
    expect(resolveActivePanelTabId(state, OWNER)).toBe(a.id);
    expect(resolveActivePanelTabId({ tabs: [a, b], activeTabId: foreign.id }, OWNER)).toBe(b.id);
    expect(resolveActivePanelTabId(state, OTHER)).toBe(foreign.id);
    expect(resolveActivePanelTabId({ tabs: [a], activeTabId: a.id }, OTHER)).toBeNull();
  });

  it("setActive only applies known ids", () => {
    const state = stateOf(bashTab(), approvalsTab());
    const next = setActivePanelTab(state, state.tabs[0]!.id);
    expect(next?.activeTabId).toBe(state.tabs[0]!.id);
    expect(setActivePanelTab(state, "missing")).toBe(state);
  });

  it("normalize drops unknown types and falls active back to the last visible tab", () => {
    const a = bashTab();
    const unknown = { id: "browser:x", type: "browser" } as unknown as ExtensionPanelTab;
    const foreign = bashTab(OTHER);
    const normalized = normalizePanelTabsState(
      { tabs: [a, unknown, foreign], activeTabId: foreign.id },
      OWNER,
    );
    expect(normalized.tabs.map((tab) => tab.id)).toEqual([a.id, foreign.id]);
    expect(normalized.activeTabId).toBe(a.id);
  });

  it("normalize returns the same reference for an already-consistent state", () => {
    const state = stateOf(bashTab(), approvalsTab());
    expect(normalizePanelTabsState(state, OWNER)).toBe(state);
  });
});

describe("recent closed memory", () => {
  it("prepends closed tabs newest-first, dedupes by id, and caps at 8", () => {
    const tabs = Array.from({ length: 10 }, (_, index) =>
      createUiCardPanelTab({
        ownerSessionId: OWNER,
        resourceUri: `ui://card/skill/card-${index}`,
        openedAt: 1_000 + index,
      }),
    );
    let recent = rememberClosedPanelTabs([], tabs.slice(0, 2), 10_000);
    recent = rememberClosedPanelTabs(recent, [tabs[0]!], 11_000);
    expect(recent.map((item) => item.tab.id)).toEqual([tabs[0]!.id, tabs[1]!.id]);
    expect(recent[0]?.closedAt).toBe(11_000);
    // 批量关闭按输入序前插（ZCode remember 语义），旧条目被 8 条上限挤出。
    recent = rememberClosedPanelTabs(recent, tabs.slice(2), 12_000);
    expect(recent).toHaveLength(RECENT_CLOSED_PANEL_TAB_LIMIT);
    expect(recent.map((item) => item.tab.id)).toEqual(tabs.slice(2, 10).map((tab) => tab.id));
    expect(recent.some((item) => item.tab.id === tabs[0]!.id)).toBe(false);
    expect(recent.some((item) => item.tab.id === tabs[1]!.id)).toBe(false);
  });

  it("restore re-activates the tab and keeps its original openedAt", () => {
    const tab = uiCardTab();
    const state = restorePanelTab(stateOf(bashTab()), tab);
    expect(state.tabs).toHaveLength(2);
    expect(state.activeTabId).toBe(tab.id);
    expect(state.tabs[1]?.openedAt).toBe(5_000);
  });

  it("recent closed list is owner-filtered", () => {
    const mine = bashTab();
    const foreign = bashTab(OTHER);
    const recent = rememberClosedPanelTabs([], [mine, foreign], 10_000);
    expect(getVisibleRecentClosedPanelTabs(recent, OWNER).map((item) => item.tab.id)).toEqual([
      mine.id,
    ]);
    expect(getVisibleRecentClosedPanelTabs(recent, null)).toEqual([]);
  });
});

describe("overview search scoring (ZCode sidePaneTabSearch parity)", () => {
  it("empty query returns items in stable order", () => {
    const rows = [
      { name: "a", searchFields: buildPanelTabSearchFields("Alpha", "", "Cards") },
      { name: "b", searchFields: buildPanelTabSearchFields("Beta", "", "Cards") },
    ];
    expect(filterAndRankPanelTabSearchItems(rows, normalizePanelTabSearchQuery(""))).toEqual(rows);
  });

  it("requires every query part to match somewhere (AND)", () => {
    const rows = [
      { name: "a", searchFields: buildPanelTabSearchFields("Shell output", "", "Shell output") },
      { name: "b", searchFields: buildPanelTabSearchFields("Approvals", "", "Approvals") },
    ];
    const hits = filterAndRankPanelTabSearchItems(
      rows,
      normalizePanelTabSearchQuery("shell output"),
    );
    expect(hits.map((row) => row.name)).toEqual(["a"]);
  });

  it("ranks title prefix > word prefix > substring > hint > type label", () => {
    const rows = [
      { name: "substring", searchFields: buildPanelTabSearchFields("xreport", "", "") },
      {
        name: "hint",
        searchFields: buildPanelTabSearchFields("notes", "/tmp/report.md", "File preview"),
      },
      { name: "type", searchFields: buildPanelTabSearchFields("other", "", "report type") },
      { name: "prefix", searchFields: buildPanelTabSearchFields("report a", "", "") },
      { name: "word", searchFields: buildPanelTabSearchFields("final report v2", "", "") },
    ];
    const hits = filterAndRankPanelTabSearchItems(rows, normalizePanelTabSearchQuery("report"));
    expect(hits.map((row) => row.name)).toEqual(["prefix", "word", "substring", "hint", "type"]);
  });

  it("word prefix splits on separators like the ZCode tokenizer", () => {
    const fields = buildPanelTabSearchFields("my-file_v2.txt", "", "");
    expect(fields.title.split(/[\s/_.:-]+/).some((word) => word.startsWith("file"))).toBe(true);
  });

  it("is case-insensitive and trims", () => {
    expect(normalizePanelTabSearchQuery("  Shell  OUTPUT ")).toEqual(["shell", "output"]);
  });
});

describe("typed reference validation and titles", () => {
  it("accepts only absolute paths for file preview", () => {
    expect(isUsableFilePreviewPath("/tmp/a.md")).toBe(true);
    expect(isUsableFilePreviewPath("tmp/a.md")).toBe(false);
    expect(isUsableFilePreviewPath("")).toBe(false);
  });

  it("accepts only contract-shaped ui:// card uris", () => {
    expect(isUsableUiCardResourceUri("ui://card/skill/abc123")).toBe(true);
    expect(isUsableUiCardResourceUri("ui://card/Skill/abc123")).toBe(false);
    expect(isUsableUiCardResourceUri("ui://card/skill/ABC!")).toBe(false);
    expect(isUsableUiCardResourceUri("https://example.com")).toBe(false);
    expect(isUsableUiCardResourceUri("")).toBe(false);
  });

  it("projects titles, type labels, and search hints", () => {
    expect(getPanelTabTitle(fileTab("/tmp/quarterly report.md"))).toBe("quarterly report.md");
    expect(getPanelTabTitle(uiCardTab())).toBe("Skill report");
    expect(
      getPanelTabTitle(
        createUiCardPanelTab({ ownerSessionId: OWNER, resourceUri: "ui://card/skill/abc123" }),
      ),
    ).toBe("ui://card/skill/abc123");
    expect(getPanelTabTypeLabel(fileTab())).toBe("File preview");
    expect(getPanelTabSearchHint(fileTab())).toBe("/tmp/report.md");
    expect(getPanelTabSearchHint(uiCardTab())).toBe("ui://card/skill/abc123");
    expect(getPanelTabSearchHint(bashTab())).toBe("");
  });

  it("formats relative time in the ZCode cadence", () => {
    const now = 100 * 60_000;
    expect(formatPanelTabRelativeTime(now - 30_000, now)).toBe("Just now");
    expect(formatPanelTabRelativeTime(now - 5 * 60_000, now)).toBe("5m ago");
    expect(formatPanelTabRelativeTime(now - 3 * 3_600_000, now)).toBe("3h ago");
    expect(formatPanelTabRelativeTime(now - 2 * 86_400_000, now)).toBe("2d ago");
  });
});
