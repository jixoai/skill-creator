// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushSync, mount, unmount } from "svelte";

const mocks = vi.hoisted(() => ({
  agentSession: { sessionId: "session-a" as string | null },
  agentSessionsList: {
    loaded: true,
    loading: false,
    sessions: [] as Array<Record<string, unknown>>,
    error: null as string | null,
  },
  beginNewAgentSession: vi.fn(),
  loadAgentSessions: vi.fn(),
  selectAgentSession: vi.fn(),
  connectionState: { status: "connected" as string },
  workspaceState: { workspaces: [] as Array<Record<string, unknown>> },
}));

vi.mock("$lib/stores/agent.svelte", () => mocks);
vi.mock("$lib/stores/connection.svelte", () => ({ connectionState: mocks.connectionState }));
vi.mock("$lib/stores/workspaces.svelte", () => ({ workspaceState: mocks.workspaceState }));
vi.mock("$lib/i18n", () => ({
  t: (key: string, values?: Record<string, string>) =>
    Object.entries(values ?? {}).reduce(
      (label, [name, value]) => label.replace(`{${name}}`, value),
      key,
    ),
}));

import SessionTree from "../SessionTree.svelte";

const importedId = "ws_0123456789abcdef01234567";

function dateAtLocalDayOffset(offset: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return date.toISOString();
}

function makeSession(
  overrides: Partial<Record<string, unknown>> & { sessionId: string; title: string },
): Record<string, unknown> {
  return {
    status: "idle",
    cwd: "/repo/alpha",
    createdAt: "2026-10-04T08:00:00.000Z",
    mode: "free",
    seedSkill: null,
    target: { workspaceId: importedId },
    ...overrides,
  };
}

let host: HTMLElement;
let mounted: ReturnType<typeof mount> | null = null;

function mountTree(): void {
  host = document.body.appendChild(document.createElement("div"));
  mounted = mount(SessionTree, { target: host });
  flushSync();
}

function buttonByName(name: string): HTMLButtonElement {
  const button = [...host.querySelectorAll("button")].find(
    (item) => item.getAttribute("aria-label") === name || item.textContent?.trim() === name,
  );
  expect(button, `button ${name} should exist`).toBeTruthy();
  return button!;
}

function click(element: Element | null): void {
  if (element === null) throw new Error("Expected an interactive element");
  element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  flushSync();
}

beforeEach(() => {
  mocks.agentSession.sessionId = "session-a";
  mocks.agentSessionsList.loaded = true;
  mocks.agentSessionsList.loading = false;
  mocks.agentSessionsList.error = null;
  mocks.agentSessionsList.sessions = [
    makeSession({
      sessionId: "session-a",
      title: "Alpha task",
      createdAt: dateAtLocalDayOffset(0),
    }),
    makeSession({
      sessionId: "session-b",
      title: "Beta work",
      createdAt: dateAtLocalDayOffset(-1),
    }),
  ];
  mocks.workspaceState.workspaces = [
    {
      id: importedId,
      kind: "directory",
      label: "Project Alpha",
      path: "/repo/alpha",
    },
  ];
  mocks.beginNewAgentSession.mockReset();
  mocks.loadAgentSessions.mockReset();
  mocks.selectAgentSession.mockReset();
});

afterEach(() => {
  if (mounted) unmount(mounted);
  mounted = null;
  host?.remove();
});

describe("SessionTree interaction parity", () => {
  it("switches between Workspace and created-time Timeline organizations", () => {
    mountTree();
    expect(host.querySelectorAll('[data-agent-session-row="true"]')).toHaveLength(2);
    click(buttonByName("agentTree.organizationTimeline"));
    expect(buttonByName("agentTree.organizationTimeline").getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(host.textContent).toContain("agentTree.timelineToday");
    expect(host.textContent).toContain("agentTree.timelineYesterday");
    click(buttonByName("agentTree.organizationWorkspace"));
    expect(host.textContent).toContain("Project Alpha");
  });

  it("filters session metadata and exposes its action control on hover/focus", () => {
    mountTree();
    const search = host.querySelector<HTMLInputElement>('input[type="search"]');
    expect(search).toBeTruthy();
    search!.value = "Project Alpha";
    search!.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();
    expect(host.querySelectorAll('[data-agent-session-row="true"]')).toHaveLength(2);
    search!.value = "Beta work";
    search!.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();
    expect(host.querySelectorAll('[data-agent-session-row="true"]')).toHaveLength(1);
    expect(host.textContent).toContain("Beta work");

    const action = host.querySelector<HTMLButtonElement>("[data-agent-session-menu-button]");
    expect(action).toBeTruthy();
    expect(action?.className).toContain("group-hover/row:opacity-100");
    expect(action?.className).toContain("group-focus-within/row:opacity-100");
    expect(action?.className).toContain("[@media(hover:none)]:opacity-100");
  });

  it("opens a context menu from right-click and supports menu keyboard navigation", () => {
    mountTree();
    const row = host.querySelector<HTMLButtonElement>(
      '[data-agent-session-row][data-session-id="session-a"]',
    );
    expect(row).toBeTruthy();
    const contextMenu = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    row!.dispatchEvent(contextMenu);
    flushSync();
    expect(contextMenu.defaultPrevented).toBe(true);
    expect(host.querySelector('[role="menu"]')).toBeTruthy();
    const items = [...host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
    expect(items).toHaveLength(3);
    expect(document.activeElement).toBe(items[0]);
    expect(host.textContent).not.toMatch(/pin|archive/i);

    items[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    flushSync();
    expect(document.activeElement).toBe(items[1]);
    items[1]!.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    flushSync();
    expect(document.activeElement).toBe(items[2]);
    items[2]!.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    flushSync();
    expect(document.activeElement).toBe(items[0]);
    items[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    flushSync();
    expect(document.activeElement).toBe(items[1]);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    flushSync();
    expect(host.querySelector('[role="menu"]')).toBeNull();
    const action = host.querySelector<HTMLButtonElement>('[data-agent-session-menu-button="true"]');
    expect(document.activeElement).toBe(action);
    click(action);
    expect(host.querySelector('[role="menu"]')).toBeTruthy();
    document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    flushSync();
    expect(host.querySelector('[role="menu"]')).toBeNull();
  });

  it("runs the supported same-Workspace action from the context menu", () => {
    mountTree();
    const row = host.querySelector<HTMLButtonElement>(
      '[data-agent-session-row][data-session-id="session-a"]',
    );
    row!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    flushSync();
    click(buttonByName("agentTree.newSessionInSameWorkspace"));
    expect(mocks.beginNewAgentSession).toHaveBeenCalledWith({
      target: { workspaceId: importedId },
      cwd: "/repo/alpha",
    });
  });

  it("omits the same-Workspace action when a session has no target", () => {
    mocks.agentSessionsList.sessions = [
      makeSession({ sessionId: "legacy-session", title: "Legacy", target: undefined }),
    ];
    mountTree();
    const row = host.querySelector<HTMLButtonElement>(
      '[data-agent-session-row][data-session-id="legacy-session"]',
    );
    row!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    flushSync();
    expect(host.textContent).not.toContain("agentTree.newSessionInSameWorkspace");
    expect(host.querySelectorAll('[role="menuitem"]')).toHaveLength(2);
  });

  it("moves focus with arrow keys and collapses Workspace groups", () => {
    mountTree();
    const first = host.querySelector<HTMLButtonElement>(
      '[data-agent-session-row][data-session-id="session-a"]',
    );
    const second = host.querySelector<HTMLButtonElement>(
      '[data-agent-session-row][data-session-id="session-b"]',
    );
    first!.focus();
    first!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    flushSync();
    expect(document.activeElement).toBe(second);
    second!.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    flushSync();
    expect(document.activeElement).toBe(first);
    first!.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    flushSync();
    expect(document.activeElement).toBe(second);
    second!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "F10", shiftKey: true, bubbles: true }),
    );
    flushSync();
    expect(host.querySelector('[role="menu"]')).toBeTruthy();
    expect(document.activeElement).toBe(host.querySelector('[role="menuitem"]'));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    flushSync();
    expect(document.activeElement).toBe(second);

    const collapse = buttonByName("agentTree.collapseGroup");
    click(collapse);
    expect(collapse.getAttribute("aria-expanded")).toBe("false");
    expect(host.querySelectorAll('[data-agent-session-row="true"]')).toHaveLength(0);
  });

  it("shows loading, empty, and filtered-empty states", () => {
    mocks.agentSessionsList.loaded = false;
    mocks.agentSessionsList.loading = true;
    mocks.agentSessionsList.sessions = [];
    mountTree();
    expect(host.querySelector('[role="status"]')?.textContent).toContain("agentTree.loading");

    unmount(mounted!);
    mounted = null;
    host.remove();
    mocks.agentSessionsList.loaded = true;
    mocks.agentSessionsList.loading = false;
    mountTree();
    expect(host.textContent).toContain("agentTree.empty");

    const search = host.querySelector<HTMLInputElement>('input[type="search"]')!;
    search.value = "missing";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();
    expect(host.textContent).toContain("agentTree.noSearchResults");
  });
});
