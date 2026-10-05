// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushSync, mount, unmount } from "svelte";

const mocks = vi.hoisted(() => ({
  agentPanel: { open: false },
  agentSession: { sessionId: null as string | null, status: "idle" },
  agentSessionsList: {
    loaded: true,
    loading: false,
    sessions: [] as Array<Record<string, unknown>>,
    error: null as string | null,
  },
  workspaceState: {
    workspaces: [] as Array<{ id: string; kind: "directory"; path: string }>,
  },
  openExtensionFilePreview: vi.fn(() => ({ opened: true })),
  openExtensionBashOutput: vi.fn(() => ({ opened: true })),
  // 空态 rail 派生源（Owner 裁决 4b）：默认非空（保住既有几何断言）；rail 测试
  // 逐例改写返回值（mock 翻转不驱动 $derived，测试以重挂载换态）。
  visibleExtensionTabs: vi.fn(() => [{ id: "probe-tab" }]),
  agentPageActiveSession: vi.fn(() => null),
  beginNewAgentSession: vi.fn(),
  loadAgentSessions: vi.fn(),
  registerAgentSurface: vi.fn(() => vi.fn()),
  selectAgentSession: vi.fn(),
  setAgentPageSessionId: vi.fn(),
  connectionState: { status: "connected" },
}));

vi.mock("$lib/stores/agent.svelte", () => mocks);
vi.mock("$lib/stores/connection.svelte", () => ({ connectionState: mocks.connectionState }));
vi.mock("$lib/stores/workspaces.svelte", () => ({ workspaceState: mocks.workspaceState }));
vi.mock("$lib/shell", () => ({ useSearch: () => () => ({}) }));
vi.mock("$lib/i18n", () => ({ t: (key: string) => key }));
vi.mock("$lib/apps/agent/extension-panel.svelte.js", () => ({
  rebindExtensionPanel: vi.fn(),
  openExtensionFilePreview: mocks.openExtensionFilePreview,
  openExtensionBashOutput: mocks.openExtensionBashOutput,
  visibleExtensionTabs: mocks.visibleExtensionTabs,
}));
vi.mock("$lib/apps/agent/SessionTree.svelte", async () => ({
  default: (await import("$lib/shell/__tests__/stub-leaf.svelte")).default,
}));
vi.mock("$lib/apps/agent/ExtensionPanel.svelte", async () => ({
  default: (await import("./ExtensionPanelProbe.svelte")).default,
}));
vi.mock("$lib/components/agent/SessionFace.svelte", async () => ({
  default: (await import("./SessionFaceProbe.svelte")).default,
}));
vi.mock("$lib/components/agent/terminal/TerminalDock.svelte", async () => ({
  default: (await import("./TerminalDockProbe.svelte")).default,
}));

import SkillsAgentPage from "../SkillsAgentPage.svelte";
import { readDevicePrefs } from "$lib/shell/device-prefs.js";

let host: HTMLElement;
let mounted: ReturnType<typeof mount> | null = null;
let originalClientWidth: PropertyDescriptor | undefined;
let originalClientHeight: PropertyDescriptor | undefined;
let originalPointerCapture: PropertyDescriptor | undefined;
let originalPlatform: PropertyDescriptor | undefined;
let mediaMatches = false;

class FixedResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element): void {
    this.callback([{ target } as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
  disconnect(): void {}
  unobserve(): void {}
}

function mountPage(): void {
  host = document.body.appendChild(document.createElement("div"));
  mounted = mount(SkillsAgentPage, { target: host });
  flushSync();
}

function click(button: Element | null): void {
  expect(button).toBeTruthy();
  button!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  flushSync();
}

function pointer(type: string, clientX: number, target: EventTarget): void {
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0, clientX }));
  flushSync();
}

beforeEach(() => {
  localStorage.clear();
  mocks.agentSession.sessionId = null;
  mocks.agentPanel.open = false;
  mocks.agentSessionsList.loaded = true;
  mocks.agentSessionsList.loading = false;
  mocks.agentSessionsList.sessions = [];
  mocks.agentSessionsList.error = null;
  mocks.workspaceState.workspaces = [];
  mocks.openExtensionFilePreview.mockClear();
  mocks.openExtensionBashOutput.mockClear();
  mocks.visibleExtensionTabs.mockClear();
  mocks.visibleExtensionTabs.mockReturnValue([{ id: "probe-tab" }]);
  mocks.beginNewAgentSession.mockReset();
  mocks.loadAgentSessions.mockReset();
  mocks.registerAgentSurface.mockClear();
  mocks.selectAgentSession.mockReset();
  mocks.setAgentPageSessionId.mockReset();
  vi.stubGlobal("ResizeObserver", FixedResizeObserver);
  mediaMatches = false;
  vi.stubGlobal("matchMedia", () => ({
    get matches() {
      return mediaMatches;
    },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  originalPlatform = Object.getOwnPropertyDescriptor(navigator, "platform");
  Object.defineProperty(navigator, "platform", { configurable: true, value: "MacIntel" });
  originalClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
  originalClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
  originalPointerCapture = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "setPointerCapture",
  );
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get: () => 1200,
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => 800,
  });
  Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
    configurable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  if (mounted) unmount(mounted);
  mounted = null;
  host?.remove();
  vi.unstubAllGlobals();
  if (originalPlatform) Object.defineProperty(navigator, "platform", originalPlatform);
  else Reflect.deleteProperty(navigator, "platform");
  for (const [name, descriptor] of [
    ["clientWidth", originalClientWidth],
    ["clientHeight", originalClientHeight],
    ["setPointerCapture", originalPointerCapture],
  ] as const) {
    if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor);
    else Reflect.deleteProperty(HTMLElement.prototype, name);
  }
});

describe("SkillsAgentPage shell geometry", () => {
  it("collapses to the icon rail and restores the persisted tree width after pointer resize", () => {
    mountPage();
    const tree = host.querySelector<HTMLElement>("[data-tree-region]");
    expect(tree?.style.width).toBe("264px");

    const resizer = host.querySelector<HTMLElement>("[data-agent-tree-resizer]");
    expect(resizer).toBeTruthy();
    pointer("pointerdown", 264, resizer!);
    pointer("pointermove", 364, window);
    pointer("pointerup", 364, window);
    flushSync();
    expect(tree?.style.width).toBe("364px");
    expect(readDevicePrefs().agentTreeWidth).toBe(364);

    click(host.querySelector('button[aria-label="agentPage.hideTree"]'));
    expect(tree?.style.width).toBe("36px");
    expect(readDevicePrefs().agentTreeCollapsed).toBe(true);
    click(host.querySelector('button[aria-label="agentPage.showTree"]'));
    expect(tree?.style.width).toBe("364px");

    unmount(mounted!);
    mounted = null;
    host.remove();
    mountPage();
    expect(host.querySelector<HTMLElement>("[data-tree-region]")?.style.width).toBe("364px");
  });

  it("resizes the navigation separator with Arrow, Home, and End and persists each size", () => {
    mountPage();
    const separator = host.querySelector<HTMLElement>("[data-agent-tree-resizer]");
    expect(separator?.getAttribute("role")).toBe("separator");
    expect(separator?.getAttribute("aria-valuenow")).toBe("264");

    for (const [key, width] of [
      ["ArrowRight", "280"],
      ["Home", "264"],
      ["End", "600"],
    ] as const) {
      const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      separator!.dispatchEvent(event);
      flushSync();
      expect(event.defaultPrevented).toBe(true);
      expect(separator?.getAttribute("aria-valuenow")).toBe(width);
      expect(readDevicePrefs().agentTreeWidth).toBe(Number(width));
    }
  });

  it("resizes the right pane proportionally and persists the ratio", () => {
    mountPage();
    const panel = host.querySelector<HTMLElement>("[data-right-panel-region]");
    expect(panel?.style.getPropertyValue("--agent-right-width")).toBe("421px");
    const resizer = host.querySelector<HTMLElement>("[data-agent-right-resizer]");
    expect(resizer).toBeTruthy();
    pointer("pointerdown", 1000, resizer!);
    pointer("pointermove", 900, window);
    pointer("pointerup", 900, window);
    const prefs = readDevicePrefs();
    expect(prefs.agentRightPanelExpandedRatio).toBeGreaterThan(0.45);
    expect(prefs.agentRightPanelExpandedRatio).toBeLessThanOrEqual(0.65);
    expect(panel?.style.getPropertyValue("--agent-right-width")).toBe("521px");

    click(host.querySelector('button[aria-label="agentPage.toggleRightPanel"]'));
    expect(host.querySelector("[data-right-panel-region]")).toBeNull();
    click(host.querySelector('button[aria-label="agentPage.toggleRightPanel"]'));
    expect(
      host
        .querySelector<HTMLElement>("[data-right-panel-region]")
        ?.style.getPropertyValue("--agent-right-width"),
    ).toBe("521px");

    unmount(mounted!);
    mounted = null;
    host.remove();
    mountPage();
    expect(
      host
        .querySelector<HTMLElement>("[data-right-panel-region]")
        ?.style.getPropertyValue("--agent-right-width"),
    ).toBe("521px");
  });

  it("persists the right-pane ratio beyond the legacy pixel-width bounds", () => {
    mountPage();
    let resizer = host.querySelector<HTMLElement>("[data-agent-right-resizer]");
    let panel = host.querySelector<HTMLElement>("[data-right-panel-region]");
    expect(resizer).toBeTruthy();
    expect(panel).toBeTruthy();

    pointer("pointerdown", 1000, resizer!);
    pointer("pointermove", 700, window);
    pointer("pointerup", 700, window);
    expect(panel?.style.getPropertyValue("--agent-right-width")).toBe("608px");
    expect(readDevicePrefs().agentRightPanelExpandedRatio).toBe(0.65);

    unmount(mounted!);
    mounted = null;
    host.remove();
    mountPage();
    resizer = host.querySelector<HTMLElement>("[data-agent-right-resizer]");
    panel = host.querySelector<HTMLElement>("[data-right-panel-region]");
    expect(panel?.style.getPropertyValue("--agent-right-width")).toBe("608px");

    pointer("pointerdown", 1000, resizer!);
    pointer("pointermove", 1370, window);
    pointer("pointerup", 1370, window);
    expect(panel?.style.getPropertyValue("--agent-right-width")).toBe("240px");
    expect(readDevicePrefs().agentRightPanelExpandedRatio).toBeCloseTo(240 / 936);

    unmount(mounted!);
    mounted = null;
    host.remove();
    mountPage();
    expect(
      host
        .querySelector<HTMLElement>("[data-right-panel-region]")
        ?.style.getPropertyValue("--agent-right-width"),
    ).toBe("240px");
  });

  it("opens the narrow-screen tree drawer as a grid overlay stacked over the chat", () => {
    mediaMatches = true;
    mountPage();
    expect(host.querySelector<HTMLElement>("[data-tree-region]")?.style.width).toBe("36px");
    expect(host.querySelector("[data-agent-tree-resizer]")).toBeNull();
    expect(host.querySelector("[data-right-panel-region]")).toBeNull();
    click(host.querySelector('button[aria-label="agentPage.showTree"]'));
    // 2026-10-05 grid 同格层叠：抽屉态树与 Chat 同格（col 2/row 1）的 static grid
    // item（z-20 静态即生效），弃 absolute；基础类不再恒挂 relative。
    const drawerTree = host.querySelector<HTMLElement>("[data-tree-region]");
    expect(drawerTree?.className).toContain("col-start-2 row-start-1");
    expect(drawerTree?.className).toContain("justify-self-start");
    expect(drawerTree?.className).toContain("z-20");
    expect(drawerTree?.className).not.toContain("absolute");
    expect(drawerTree?.className).not.toContain("relative");
    expect(drawerTree?.className).toContain("bg-background");
    // scrim：同格 z-10（chat(auto) < scrim(10) < tree(20)），无 inline left 偏移。
    const scrim = host.querySelector<HTMLButtonElement>(
      'button[aria-label="agentPage.closeTreeDrawer"]',
    );
    expect(scrim?.className).toContain("col-start-2 row-start-1");
    expect(scrim?.className).toContain("z-10");
    expect(scrim?.className).not.toContain("absolute");
    expect(scrim?.style.left).toBe("");
    click(scrim!);
    expect(host.querySelector<HTMLElement>("[data-tree-region]")?.style.width).toBe("36px");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("agentPage.showTree");

    click(host.querySelector('button[aria-label="agentPage.toggleRightPanel"]'));
    // 2026-10-05 grid 化：窄屏面板与 Chat 同格堆叠（col 2/row 1），不再 absolute。
    expect(host.querySelector<HTMLElement>("[data-right-panel-region]")?.className).toContain(
      "col-start-2 row-start-1",
    );
    click(
      host.querySelector('[data-right-panel-region] button[aria-label="probe-close-extension"]'),
    );
    expect(host.querySelector("[data-right-panel-region]")).toBeNull();
    expect(document.activeElement?.getAttribute("aria-label")).toBe("agentPage.showTree");

    click(host.querySelector('button[aria-label="agentPage.toggleTerminal"]'));
    expect(host.querySelector("[data-terminal-region]")).toBeTruthy();
    expect(host.querySelector("[data-right-panel-region]")).toBeNull();
    click(host.querySelector('button[aria-label="probe-close-terminal"]'));
    expect(host.querySelector("[data-terminal-region]")).toBeTruthy();
    expect(document.activeElement?.getAttribute("aria-label")).toBe("agentPage.showTree");
  });

  it("routes ZCode global shell shortcuts without consuming editor key events", () => {
    mountPage();
    const toggleTerminal = new KeyboardEvent("keydown", {
      key: "j",
      code: "KeyJ",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(toggleTerminal);
    flushSync();
    expect(readDevicePrefs().agentTerminalOpen).toBe(true);
    expect(host.querySelector("[data-terminal-region]")).toBeTruthy();
    expect(host.querySelector("[data-right-panel-region]")).toBeTruthy();
    expect(toggleTerminal.defaultPrevented).toBe(true);

    const terminalInput = document.createElement("textarea");
    host.querySelector("[data-terminal-region]")?.append(terminalInput);
    terminalInput.focus();
    const closeTerminal = new KeyboardEvent("keydown", {
      key: "j",
      code: "KeyJ",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    terminalInput.dispatchEvent(closeTerminal);
    flushSync();
    expect(readDevicePrefs().agentTerminalOpen).toBe(false);
    expect(closeTerminal.defaultPrevented).toBe(true);

    const search = document.createElement("input");
    host.append(search);
    search.focus();
    const editorShortcut = new KeyboardEvent("keydown", {
      key: "b",
      code: "KeyB",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    search.dispatchEvent(editorShortcut);
    expect(readDevicePrefs().agentTreeCollapsed).toBe(false);
    expect(editorShortcut.defaultPrevented).toBe(false);
  });

  it("binds the terminal to the selected Workspace and hides it without unmounting", () => {
    const workspaceId = "ws_0123456789abcdef01234567";
    mocks.agentSession.sessionId = "session-a";
    mocks.agentSessionsList.sessions = [
      {
        sessionId: "session-a",
        title: "Session A",
        status: "idle",
        cwd: "/work/repo/subdir",
        createdAt: "2026-10-04T00:00:00.000Z",
        mode: "free",
        target: { workspaceId, providerId: "skills" },
        seedSkill: null,
      },
    ];
    mocks.workspaceState.workspaces = [{ id: workspaceId, kind: "directory", path: "/work/repo" }];
    mountPage();

    click(host.querySelector('button[aria-label="agentPage.toggleTerminal"]'));
    const region = host.querySelector<HTMLElement>("[data-terminal-region]");
    const dock = host.querySelector<HTMLElement>("[data-terminal-dock-probe]");
    expect(dock?.dataset.workspaceKey).toBe(workspaceId);
    expect(dock?.dataset.workspaceCwd).toBe("/work/repo/subdir");

    click(host.querySelector('button[aria-label="probe-close-terminal"]'));
    expect(region?.className).toContain("hidden");
    expect(host.querySelector("[data-terminal-dock-probe]")).toBe(dock);

    click(host.querySelector('button[aria-label="agentPage.toggleTerminal"]'));
    expect(host.querySelector("[data-terminal-dock-probe]")).toBe(dock);
  });

  it("wires ExtensionPanel close back to the right-pane toggle", () => {
    mountPage();
    expect(host.querySelector("[data-extension-panel-probe]")).toBeTruthy();
    click(host.querySelector('button[aria-label="probe-close-extension"]'));
    expect(host.querySelector("[data-right-panel-region]")).toBeNull();
  });

  it("resizes the right pane by 16px through its persisted ratio and keeps the Chat minimum", () => {
    mountPage();
    const separator = host.querySelector<HTMLElement>("[data-agent-right-resizer]");
    expect(separator?.getAttribute("role")).toBe("separator");
    expect(separator?.getAttribute("aria-valuenow")).toBe("421");

    const grow = new KeyboardEvent("keydown", {
      key: "ArrowLeft",
      bubbles: true,
      cancelable: true,
    });
    separator!.dispatchEvent(grow);
    flushSync();
    expect(grow.defaultPrevented).toBe(true);
    expect(separator?.getAttribute("aria-valuenow")).toBe("437");
    expect(readDevicePrefs().agentRightPanelExpandedRatio).toBeCloseTo(437 / 936);

    const maximum = new KeyboardEvent("keydown", { key: "End", bubbles: true, cancelable: true });
    separator!.dispatchEvent(maximum);
    flushSync();
    expect(separator?.getAttribute("aria-valuenow")).toBe("608");
    expect(1200 - 264 - 608).toBeGreaterThanOrEqual(320);
  });

  it("routes file and bash tool actions through typed panel opens and reveals the pane", () => {
    mountPage();
    click(host.querySelectorAll('button[aria-label="agentPage.toggleRightPanel"]')[0] ?? null);
    expect(host.querySelector("[data-right-panel-region]")).toBeNull();

    click(host.querySelector('button[aria-label="probe-open-file-preview"]'));
    expect(mocks.openExtensionFilePreview).toHaveBeenCalledWith({ path: "/tmp/tool-output.md" });
    expect(host.querySelector("[data-right-panel-region]")).toBeTruthy();

    click(host.querySelector('button[aria-label="probe-close-extension"]'));
    click(host.querySelector('button[aria-label="probe-open-bash-output"]'));
    expect(mocks.openExtensionBashOutput).toHaveBeenCalledOnce();
    expect(host.querySelector("[data-right-panel-region]")).toBeTruthy();
  });

  it("collapses the empty right pane to the 48px icon rail and restores the ratio width with a tab", () => {
    // 空态（无活动 tab）：侧栏收敛为 rail——宽度 48px、无拖宽分隔条；DevicePrefs
    // 不新增字段（比例记忆原样保留）。mock 翻转不驱动 $derived，换态经重挂载。
    mocks.visibleExtensionTabs.mockReturnValue([]);
    mountPage();
    let panel = host.querySelector<HTMLElement>("[data-right-panel-region]");
    expect(panel?.style.getPropertyValue("--agent-right-width")).toBe("48px");
    expect(panel?.dataset.rightPanelRail).toBe("true");
    expect(host.querySelector("[data-agent-right-resizer]")).toBeNull();
    expect(readDevicePrefs().agentRightPanelOpen).toBe(true);

    // 有 tab：回全宽比例形态 + 分隔条回归（比例记忆未受 rail 旁路影响）。
    unmount(mounted!);
    mounted = null;
    host.remove();
    mocks.visibleExtensionTabs.mockReturnValue([{ id: "probe-tab" }]);
    mountPage();
    panel = host.querySelector<HTMLElement>("[data-right-panel-region]");
    expect(panel?.style.getPropertyValue("--agent-right-width")).toBe("421px");
    expect(panel?.dataset.rightPanelRail).toBeUndefined();
    expect(host.querySelector("[data-agent-right-resizer]")).toBeTruthy();
  });

  it("keeps the narrow-screen drawer out of rail mode regardless of tab presence", () => {
    mediaMatches = true;
    mocks.visibleExtensionTabs.mockReturnValue([]);
    mountPage();
    click(host.querySelector('button[aria-label="agentPage.toggleRightPanel"]'));
    const panel = host.querySelector<HTMLElement>("[data-right-panel-region]");
    // 窄屏面板经 grid 同格堆叠为覆盖层（w-full，后声明者在上），不参与 rail 收敛；
    // 空态由面板内的 launcher 卡承载。
    expect(panel?.dataset.rightPanelRail).toBeUndefined();
    expect(panel?.className).toContain("col-start-2 row-start-1");
    expect(panel?.className).not.toContain("absolute");
    expect(host.querySelector("[data-extension-panel-probe]")).toBeTruthy();
  });
});
