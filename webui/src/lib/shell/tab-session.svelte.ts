import { goto } from "$app/navigation";
import { workspaceState } from "$lib/stores/workspaces.svelte";
import {
  activateTab,
  activateTabAtRoute,
  addWorkspaceTabsAndActivateLast,
  closeWorkspaceTab,
  createTabNavigationState,
  currentTabRoute,
  moveTabCursor,
  navigateWithReplaceState,
  persistTabSession,
  pushTabRoute,
  reconcileWorkspaceTabs,
  replaceTabRoute,
  restoreTabNavigationState,
  splitLocation,
  tabIdForPath,
  type TabNavigationState,
  TAB_SESSION_STORAGE_KEY,
} from "./tab-session.js";
import {
  canonicalizeShellLocation,
  sanitizeShellLocation,
  SHELL_HOME_PATH,
} from "./route-hygiene.js";

export const tabSession = $state({
  navigation: createTabNavigationState(),
  persistence: "local" as "local" | "memory",
  initialized: false,
});

let knownWorkspaceIds = new Set<string>(["~"]);
let expectedNavigations = new Set<string>();

export function setAvailableWorkspaceIds(workspaceIds: readonly string[]): void {
  knownWorkspaceIds = new Set(["~", ...workspaceIds]);
}

export function reconcileAvailableWorkspaceTabs(workspaceIds: readonly string[]): void {
  setAvailableWorkspaceIds(workspaceIds);
  const current = tabSession.navigation;
  const next = reconcileWorkspaceTabs(current, workspaceIds);
  if (next === current) return;
  tabSession.navigation = next;
  persistNavigation(next);
  if (next.activeId !== current.activeId) commitBrowserNavigation(currentTabRoute(next));
}

export function initializeTabSession(
  availableWorkspaceIds: readonly string[],
  pathname: string,
  search: string,
): string | null {
  if (tabSession.initialized) return null;
  setAvailableWorkspaceIds(availableWorkspaceIds);

  let stored: unknown = null;
  try {
    const serialized = localStorage.getItem(TAB_SESSION_STORAGE_KEY);
    if (serialized !== null) stored = JSON.parse(serialized) as unknown;
  } catch {
    tabSession.persistence = "memory";
  }

  let navigation = restoreTabNavigationState(stored, availableWorkspaceIds);
  const canonical = canonicalizeShellLocation(pathname, search);
  const { pathname: canonicalPath, search: canonicalSearch } = splitLocation(canonical);
  const decision = sanitizeShellLocation(canonicalPath, canonicalSearch);
  const currentPath = decision.kind === "redirect" ? decision.path : canonical;
  const current = splitLocation(currentPath);
  const tabId = tabIdForPath(current.pathname);

  if (tabId === "settings") {
    navigation = activateTabAtRoute(navigation, "settings", currentPath);
    tabSession.navigation = navigation;
    tabSession.initialized = true;
    persistNavigation(navigation);
    return decision.kind === "redirect" || currentPath !== canonical ? currentPath : null;
  }

  if (tabId === "agent") {
    navigation = activateTabAtRoute(navigation, "agent", currentPath);
  } else if (tabId !== null && knownWorkspaceIds.has(tabId)) {
    navigation = activateTabAtRoute(navigation, tabId, currentPath);
  } else {
    navigation = activateTab(navigation, "~");
  }

  tabSession.navigation = navigation;
  tabSession.initialized = true;
  persistNavigation(navigation);
  const missingWorkspace = tabId?.startsWith("ws_") && !knownWorkspaceIds.has(tabId);
  if (missingWorkspace) return currentTabRoute(navigation, "~");
  return decision.kind === "redirect" || currentPath !== canonical ? currentPath : null;
}

export function openImportedWorkspaceTabs(workspaceIds: readonly string[]): void {
  refreshKnownWorkspaceIds();
  const availableIds = workspaceIds.filter((workspaceId) => knownWorkspaceIds.has(workspaceId));
  if (availableIds.length === 0) return;
  const navigation = addWorkspaceTabsAndActivateLast(tabSession.navigation, availableIds);
  const activeId = navigation.activeId;
  tabSession.navigation = navigation;
  persistNavigation(navigation);
  commitBrowserNavigation(currentTabRoute(navigation, activeId));
}

export function navigateTab(path: string, action: "PUSH" | "REPLACE" = "PUSH"): void {
  refreshKnownWorkspaceIds();
  const canonical = canonicalizeShellLocation(...splitPathAndSearch(path));
  const location = splitLocation(canonical);
  const decision = sanitizeShellLocation(location.pathname, location.search);
  const target = decision.kind === "redirect" ? decision.path : canonical;
  const targetLocation = splitLocation(target);
  const tabId = tabIdForPath(targetLocation.pathname);

  if (tabId === null || (tabId.startsWith("ws_") && !knownWorkspaceIds.has(tabId))) {
    const fallback = SHELL_HOME_PATH;
    updateNavigation("~", fallback, action);
    commitBrowserNavigation(fallback);
    return;
  }

  updateNavigation(tabId, target, action);
  commitBrowserNavigation(target);
}

export function activateTabAndNavigate(tabId: string, initialPath?: string): void {
  refreshKnownWorkspaceIds();
  if (tabId.startsWith("ws_") && !knownWorkspaceIds.has(tabId)) return;
  const wasOpen = tabSession.navigation.order.includes(tabId) || tabId === "~";
  const next = activateTab(tabSession.navigation, tabId);
  const path =
    !wasOpen && initialPath
      ? canonicalizeShellLocation(...splitPathAndSearch(initialPath))
      : currentTabRoute(next, tabId);
  const finalState = !wasOpen && initialPath ? activateTabAtRoute(next, tabId, path) : next;
  tabSession.navigation = finalState;
  persistNavigation(finalState);
  commitBrowserNavigation(path);
}

export function closeImportedTab(workspaceId: string): void {
  const oldActiveId = tabSession.navigation.activeId;
  const next = closeWorkspaceTab(tabSession.navigation, workspaceId);
  tabSession.navigation = next;
  persistNavigation(next);
  if (next.activeId !== oldActiveId) {
    commitBrowserNavigation(currentTabRoute(next));
  }
}

export function removeWorkspaceTab(workspaceId: string): void {
  closeImportedTab(workspaceId);
}

export function navigateTabHistory(direction: -1 | 1): void {
  const current = tabSession.navigation;
  const next = moveTabCursor(current, direction);
  if (next === current) return;
  tabSession.navigation = next;
  persistNavigation(next);
  commitBrowserNavigation(currentTabRoute(next));
}

export function canNavigateTabHistory(direction: -1 | 1): boolean {
  const stack = tabSession.navigation.stacks[tabSession.navigation.activeId];
  if (!stack) return false;
  return direction < 0 ? stack.cursor > 0 : stack.cursor < stack.entries.length - 1;
}

export function consumeExpectedNavigation(path: string): boolean {
  if (!expectedNavigations.has(path)) return false;
  expectedNavigations.delete(path);
  return true;
}

export function syncExternalLocation(path: string): void {
  refreshKnownWorkspaceIds();
  const canonical = canonicalizeShellLocation(...splitPathAndSearch(path));
  const location = splitLocation(canonical);
  const decision = sanitizeShellLocation(location.pathname, location.search);
  const target = decision.kind === "redirect" ? decision.path : canonical;
  const tabId = tabIdForPath(splitLocation(target).pathname);
  if (tabId === null || (tabId.startsWith("ws_") && !knownWorkspaceIds.has(tabId))) {
    navigateTab(SHELL_HOME_PATH, "REPLACE");
    return;
  }
  updateNavigation(tabId, target, "REPLACE");
  if (target !== path) commitBrowserNavigation(target);
}

function updateNavigation(tabId: string, path: string, action: "PUSH" | "REPLACE"): void {
  const current: TabNavigationState = tabSession.navigation;
  const next =
    action === "PUSH" ? pushTabRoute(current, tabId, path) : replaceTabRoute(current, tabId, path);
  tabSession.navigation = next;
  persistNavigation(next);
}

function persistNavigation(navigation: TabNavigationState): void {
  if (tabSession.persistence === "memory") return;
  if (!persistTabSession(localStorage, navigation)) tabSession.persistence = "memory";
}

function commitBrowserNavigation(path: string): void {
  expectedNavigations.add(path);
  globalThis.setTimeout(() => expectedNavigations.delete(path), 1500);
  navigateWithReplaceState(path, (destination, options) => void goto(destination, options));
}

function splitPathAndSearch(path: string): [string, string] {
  const location = splitLocation(path);
  return [location.pathname, location.search];
}

function refreshKnownWorkspaceIds(): void {
  knownWorkspaceIds = new Set([
    "~",
    ...workspaceState.workspaces
      .filter((workspace) => workspace.kind === "directory")
      .map((workspace) => workspace.id),
  ]);
}
