import { describe, expect, it } from "vitest";
import {
  TAB_SESSION_STORAGE_KEY,
  activateTab,
  activateTabAtRoute,
  addWorkspaceTab,
  addWorkspaceTabsAndActivateLast,
  closeWorkspaceTab,
  createTabNavigationState,
  currentTabRoute,
  moveTabCursor,
  navigateWithReplaceState,
  persistTabSession,
  persistableTabSession,
  pushTabRoute,
  reconcileWorkspaceTabs,
  replaceTabRoute,
  restoreTabNavigationState,
} from "../tab-session.js";

describe("tab route stacks", () => {
  it("pushes routes, truncates forward history, and moves the cursor", () => {
    let state = createTabNavigationState();
    state = pushTabRoute(state, "~", "/w/~/creator");
    state = pushTabRoute(state, "~", "/w/~/wiki");
    expect(currentTabRoute(moveTabCursor(state, -1))).toBe("/w/~/creator");

    state = moveTabCursor(state, -1);
    state = pushTabRoute(state, "~", "/w/~/evaluating");
    expect(state.stacks["~"]).toEqual({
      entries: ["/w/~/skills", "/w/~/creator", "/w/~/evaluating"],
      cursor: 2,
    });
    expect(moveTabCursor(state, 1)).toBe(state);
  });

  it("keeps concurrent tab histories isolated and switching tabs does not move cursors", () => {
    let state = createTabNavigationState();
    state = addWorkspaceTab(state, "ws_a");
    state = addWorkspaceTab(state, "ws_b");
    state = pushTabRoute(state, "~", "/w/~/wiki");
    state = pushTabRoute(state, "ws_a", "/w/ws_a/creator");
    state = pushTabRoute(state, "ws_b", "/w/ws_b/evaluating");

    state = activateTab(state, "ws_a");
    state = moveTabCursor(state, -1);
    expect(currentTabRoute(state, "ws_a")).toBe("/w/ws_a/skills");
    expect(currentTabRoute(state, "ws_b")).toBe("/w/ws_b/evaluating");

    state = activateTab(state, "ws_b");
    state = moveTabCursor(state, -1);
    expect(currentTabRoute(state, "ws_b")).toBe("/w/ws_b/skills");
    expect(currentTabRoute(state, "~")).toBe("/w/~/wiki");
  });

  it("replaces the current route without adding an entry", () => {
    let state = createTabNavigationState();
    state = pushTabRoute(state, "~", "/w/~/skills?q=before");
    state = replaceTabRoute(state, "~", "/w/~/skills?q=after");
    expect(state.stacks["~"]).toEqual({
      entries: ["/w/~/skills", "/w/~/skills?q=after"],
      cursor: 1,
    });
  });

  it("does not duplicate the active entry when navigation targets the same URL", () => {
    const state = createTabNavigationState();
    expect(pushTabRoute(state, "~", "/w/~/skills")).toEqual(state);
  });

  it("uses the first requested workspace route as its initial history entry", () => {
    const state = pushTabRoute(
      createTabNavigationState(),
      "ws_new",
      "/w/ws_new/creator/edit/provider/skill",
    );

    expect(state.order).toEqual(["~", "ws_new"]);
    expect(state.stacks.ws_new).toEqual({
      entries: ["/w/ws_new/creator/edit/provider/skill"],
      cursor: 0,
    });
    expect(state.activeId).toBe("ws_new");
  });

  it("adds multiple imported tabs and activates the last without changing their defaults", () => {
    const state = addWorkspaceTabsAndActivateLast(createTabNavigationState(), [
      "ws_first",
      "ws_second",
      "ws_first",
    ]);

    expect(state.order).toEqual(["~", "ws_first", "ws_second"]);
    expect(state.activeId).toBe("ws_second");
    expect(currentTabRoute(state, "ws_first")).toBe("/w/ws_first/skills");
    expect(currentTabRoute(state, "ws_second")).toBe("/w/ws_second/skills");
  });

  it("activates direct workspace and Settings routes without persisting Settings", () => {
    let state = createTabNavigationState();
    state = pushTabRoute(state, "~", "/w/~/wiki");
    state = activateTabAtRoute(state, "ws_deep", "/w/ws_deep/creator/edit/provider/skill");
    expect(state.activeId).toBe("ws_deep");
    expect(currentTabRoute(state)).toBe("/w/ws_deep/creator/edit/provider/skill");
    expect(currentTabRoute(state, "~")).toBe("/w/~/wiki");

    state = activateTabAtRoute(state, "settings", "/settings/model");
    expect(state.activeId).toBe("settings");
    expect(currentTabRoute(state)).toBe("/settings/model");
    expect(persistableTabSession(state).order).toEqual(["~", "ws_deep"]);
  });

  it("closes an imported tab without removing its workspace from the available set", () => {
    let state = createTabNavigationState();
    state = addWorkspaceTab(state, "ws_a");
    state = addWorkspaceTab(state, "ws_b");
    state = activateTab(state, "ws_a");
    state = closeWorkspaceTab(state, "ws_a");
    expect(state.order).toEqual(["~", "ws_b"]);
    expect(state.activeId).toBe("~");

    const reopened = restoreTabNavigationState(persistableTabSession(state), ["ws_a", "ws_b"]);
    expect(reopened.order).toEqual(["~", "ws_b"]);
  });

  it("drops persisted tabs for workspaces removed from the registry", () => {
    let state = createTabNavigationState();
    state = addWorkspaceTab(state, "ws_a");
    state = addWorkspaceTab(state, "ws_b");
    state = activateTab(state, "ws_b");
    const reconciled = reconcileWorkspaceTabs(state, ["ws_a"]);
    expect(reconciled.order).toEqual(["~", "ws_a"]);
    expect(reconciled.activeId).toBe("ws_a");
    expect(reconciled.stacks.ws_b).toBeUndefined();
  });
});

describe("tab session persistence", () => {
  it("round-trips each open workspace stack and cursor", () => {
    let state = createTabNavigationState();
    state = addWorkspaceTab(state, "ws_a");
    state = pushTabRoute(state, "~", "/w/~/creator");
    state = pushTabRoute(state, "ws_a", "/w/ws_a/wiki");
    state = activateTab(state, "~");
    state = moveTabCursor(state, -1);

    const restored = restoreTabNavigationState(persistableTabSession(state), ["ws_a"]);
    expect(restored.order).toEqual(["~", "ws_a"]);
    expect(currentTabRoute(restored, "~")).toBe("/w/~/skills");
    expect(currentTabRoute(restored, "ws_a")).toBe("/w/ws_a/wiki");
    expect(restored.stacks["~"]?.cursor).toBe(0);
    expect(restored.stacks.ws_a?.cursor).toBe(1);
  });

  it("drops stale workspaces and malformed or newer versions", () => {
    const value = {
      version: 1,
      order: ["~", "ws_missing", "ws_available"],
      stacks: {
        "~": { entries: ["/w/~/skills"], cursor: 0 },
        ws_missing: { entries: ["/w/ws_missing/wiki"], cursor: 0 },
        ws_available: { entries: ["/w/ws_available/creator"], cursor: 0 },
      },
    };
    const restored = restoreTabNavigationState(value, ["ws_available"]);
    expect(restored.order).toEqual(["~", "ws_available"]);
    expect(restoreTabNavigationState({ ...value, version: 2 }, ["ws_available"]).order).toEqual([
      "~",
    ]);
    const invalid = restoreTabNavigationState(
      { ...value, stacks: { "~": { entries: [], cursor: 4 } } },
      [],
    );
    expect(invalid.order).toEqual(["~"]);
    expect(invalid.stacks.agent?.entries).toEqual(["/agent"]);
  });

  it("falls back to memory mode when storage throws a quota error", () => {
    const state = createTabNavigationState();
    const storage = {
      setItem: () => {
        throw new DOMException("quota exceeded", "QuotaExceededError");
      },
    };
    expect(persistTabSession(storage, state)).toBe(false);
  });

  it("keeps browser history depth constant by using replaceState for every route", () => {
    const entries = ["/initial"];
    const optionsSeen: unknown[] = [];
    const apply = (path: string, options: { replace: true; reset: false }) => {
      optionsSeen.push(options);
      entries[0] = path;
    };

    for (const path of ["/w/~/skills", "/w/~/creator", "/agent", "/w/ws_a/wiki"]) {
      navigateWithReplaceState(path, apply);
    }
    expect(entries).toEqual(["/w/ws_a/wiki"]);
    expect(optionsSeen).toHaveLength(4);
    expect(optionsSeen.every((options) => (options as { replace?: boolean }).replace)).toBe(true);
    expect(TAB_SESSION_STORAGE_KEY).toBe("skill-creator.tabs.v1");
  });
});
