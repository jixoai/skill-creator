import { z } from "zod";

export const TAB_SESSION_STORAGE_KEY = "skill-creator.tabs.v1";
const DEFAULT_WORKSPACE_ROUTE = (workspaceId: string) =>
  `/w/${encodeURIComponent(workspaceId)}/skills`;

export interface TabRouteStack {
  readonly entries: readonly string[];
  readonly cursor: number;
}

export interface PersistedTabSession {
  readonly version: 1;
  readonly order: readonly string[];
  readonly stacks: Readonly<Record<string, TabRouteStack>>;
}

export interface TabNavigationState {
  readonly order: readonly string[];
  readonly stacks: Readonly<Record<string, TabRouteStack>>;
  readonly activeId: string;
}

export interface ReplaceNavigationOptions {
  readonly replace: true;
  readonly reset: false;
}

export interface TabSessionStorage {
  setItem(key: string, value: string): void;
}

const routeStackSchema = z
  .object({
    entries: z.array(z.string().min(1)).min(1),
    cursor: z.number().int().nonnegative(),
  })
  .superRefine((value, ctx) => {
    if (value.cursor >= value.entries.length) {
      ctx.addIssue({ code: "custom", message: "cursor must point to an entry" });
    }
  });

const persistedTabSessionSchema = z.object({
  version: z.literal(1),
  order: z.array(z.string()),
  stacks: z.record(z.string(), routeStackSchema),
});

export function createTabNavigationState(): TabNavigationState {
  return {
    order: ["~"],
    stacks: {
      "~": { entries: [DEFAULT_WORKSPACE_ROUTE("~")], cursor: 0 },
      agent: { entries: ["/agent"], cursor: 0 },
    },
    activeId: "~",
  };
}

export function restoreTabNavigationState(
  stored: unknown,
  availableWorkspaceIds: readonly string[],
): TabNavigationState {
  const fallback = createTabNavigationState();
  const parsed = persistedTabSessionSchema.safeParse(stored);
  if (!parsed.success) return fallback;

  const available = new Set(["~", ...availableWorkspaceIds]);
  const order = [
    "~",
    ...new Set(parsed.data.order.filter((id) => id !== "~" && available.has(id))),
  ];
  const stacks: Record<string, TabRouteStack> = {
    ...fallback.stacks,
    "~": validStackFor(parsed.data.stacks["~"], "~") ?? fallback.stacks["~"]!,
  };

  for (const id of order.slice(1)) {
    const stack = validStackFor(parsed.data.stacks[id], id);
    stacks[id] = stack ?? { entries: [DEFAULT_WORKSPACE_ROUTE(id)], cursor: 0 };
  }
  return { order, stacks, activeId: "~" };
}

export function persistableTabSession(state: TabNavigationState): PersistedTabSession {
  const order = state.order.includes("~") ? state.order : ["~", ...state.order];
  const stacks: Record<string, TabRouteStack> = {};
  for (const id of order) {
    const stack = state.stacks[id];
    if (stack) stacks[id] = { entries: [...stack.entries], cursor: stack.cursor };
  }
  return { version: 1, order: [...order], stacks };
}

export function persistTabSession(storage: TabSessionStorage, state: TabNavigationState): boolean {
  try {
    storage.setItem(TAB_SESSION_STORAGE_KEY, JSON.stringify(persistableTabSession(state)));
    return true;
  } catch {
    return false;
  }
}

export function navigateWithReplaceState(
  path: string,
  navigate: (path: string, options: ReplaceNavigationOptions) => void,
): void {
  navigate(path, { replace: true, reset: false });
}

export function addWorkspaceTab(
  state: TabNavigationState,
  workspaceId: string,
): TabNavigationState {
  const order = state.order.includes(workspaceId) ? state.order : [...state.order, workspaceId];
  const stacks = state.stacks[workspaceId]
    ? state.stacks
    : {
        ...state.stacks,
        [workspaceId]: { entries: [DEFAULT_WORKSPACE_ROUTE(workspaceId)], cursor: 0 },
      };
  return { ...state, order, stacks };
}

export function addWorkspaceTabsAndActivateLast(
  state: TabNavigationState,
  workspaceIds: readonly string[],
): TabNavigationState {
  const ids = [...new Set(workspaceIds)];
  let next = state;
  for (const workspaceId of ids) next = addWorkspaceTab(next, workspaceId);
  const lastId = ids.at(-1);
  return lastId === undefined ? next : activateTab(next, lastId);
}

export function activateTab(state: TabNavigationState, tabId: string): TabNavigationState {
  const withWorkspace = isWorkspaceTab(tabId) ? addWorkspaceTab(state, tabId) : state;
  const stacks = withWorkspace.stacks[tabId]
    ? withWorkspace.stacks
    : { ...withWorkspace.stacks, [tabId]: { entries: [tabDefaultRoute(tabId)], cursor: 0 } };
  return { ...withWorkspace, stacks, activeId: tabId };
}

export function activateTabAtRoute(
  state: TabNavigationState,
  tabId: string,
  path: string,
): TabNavigationState {
  return replaceTabRoute(activateTab(state, tabId), tabId, path);
}

export function pushTabRoute(
  state: TabNavigationState,
  tabId: string,
  path: string,
): TabNavigationState {
  const firstWorkspaceNavigation = isWorkspaceTab(tabId) && !state.order.includes(tabId);
  const active = activateTab(state, tabId);
  const stack = active.stacks[tabId]!;
  if (firstWorkspaceNavigation) {
    return {
      ...active,
      stacks: { ...active.stacks, [tabId]: { entries: [path], cursor: 0 } },
    };
  }
  if (stack.entries[stack.cursor] === path) return active;
  const entries = [...stack.entries.slice(0, stack.cursor + 1), path];
  return {
    ...active,
    stacks: { ...active.stacks, [tabId]: { entries, cursor: entries.length - 1 } },
  };
}

export function replaceTabRoute(
  state: TabNavigationState,
  tabId: string,
  path: string,
): TabNavigationState {
  const active = activateTab(state, tabId);
  const stack = active.stacks[tabId]!;
  const entries = [...stack.entries];
  entries[stack.cursor] = path;
  return { ...active, stacks: { ...active.stacks, [tabId]: { entries, cursor: stack.cursor } } };
}

export function moveTabCursor(state: TabNavigationState, direction: -1 | 1): TabNavigationState {
  const stack = state.stacks[state.activeId];
  if (!stack) return state;
  const cursor = stack.cursor + direction;
  if (cursor < 0 || cursor >= stack.entries.length) return state;
  return {
    ...state,
    stacks: { ...state.stacks, [state.activeId]: { ...stack, cursor } },
  };
}

export function closeWorkspaceTab(
  state: TabNavigationState,
  workspaceId: string,
): TabNavigationState {
  if (workspaceId === "~" || !state.order.includes(workspaceId)) return state;
  const index = state.order.indexOf(workspaceId);
  const order = state.order.filter((id) => id !== workspaceId);
  const stacks = { ...state.stacks };
  delete stacks[workspaceId];
  const activeId =
    state.activeId === workspaceId ? (order[Math.max(0, index - 1)] ?? "~") : state.activeId;
  return { ...state, order, stacks, activeId };
}

export function reconcileWorkspaceTabs(
  state: TabNavigationState,
  availableWorkspaceIds: readonly string[],
): TabNavigationState {
  const available = new Set(["~", ...availableWorkspaceIds]);
  let next = state;
  for (const workspaceId of state.order.slice(1)) {
    if (!available.has(workspaceId)) next = closeWorkspaceTab(next, workspaceId);
  }
  return next;
}

export function currentTabRoute(state: TabNavigationState, tabId = state.activeId): string {
  const stack = state.stacks[tabId];
  return stack?.entries[stack.cursor] ?? tabDefaultRoute(tabId);
}

export function tabIdForPath(pathname: string): string | null {
  if (pathname === "/agent" || pathname.startsWith("/agent/")) return "agent";
  if (pathname === "/settings" || pathname.startsWith("/settings/")) return "settings";
  // 工作区管理页（workspace-page-polish）：全局作用域页面，归属 Global tab 的
  // 路由栈（不入独立 tab kind——tab strip 语义不扩面）。
  if (pathname === "/workspace") return "~";
  const match = /^\/w\/([^/]+)\//.exec(pathname);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]!);
  } catch {
    return match[1]!;
  }
}

export function routeForTabId(tabId: string): string {
  return tabDefaultRoute(tabId);
}

export function splitLocation(path: string): { pathname: string; search: string } {
  const queryAt = path.indexOf("?");
  return queryAt < 0
    ? { pathname: path || "/", search: "" }
    : { pathname: path.slice(0, queryAt) || "/", search: path.slice(queryAt) };
}

function validStackFor(
  stack: TabRouteStack | undefined,
  workspaceId: string,
): TabRouteStack | null {
  if (!stack) return null;
  for (const entry of stack.entries) {
    const { pathname } = splitLocation(entry);
    if (tabIdForPath(pathname) !== workspaceId) return null;
  }
  return { entries: [...stack.entries], cursor: stack.cursor };
}

function isWorkspaceTab(tabId: string): boolean {
  return tabId === "~" || tabId.startsWith("ws_");
}

function tabDefaultRoute(tabId: string): string {
  if (tabId === "agent") return "/agent";
  if (tabId === "settings") return "/settings";
  return DEFAULT_WORKSPACE_ROUTE(tabId);
}
