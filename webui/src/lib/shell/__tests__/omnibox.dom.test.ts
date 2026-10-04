// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SkillSearchResult } from "$shared/contracts/search.js";
import type { Workspace } from "$shared/contracts/workspaces.js";

const harness = vi.hoisted(() => {
  const navigate = vi.fn();
  const navigateHistory = vi.fn();
  const search = vi.fn<
    (input: { query: string; limit: number }) => Promise<{ results: SkillSearchResult[] }>
  >(async () => ({ results: [] }));
  const rpc = { skills: { search, searchConfig: { open: vi.fn() } } };
  return {
    page: { url: { pathname: "/w/~/skills", search: "", searchParams: new URLSearchParams() } },
    tabSession: {
      navigation: {
        activeId: "~",
        stacks: { "~": { entries: ["/w/~/skills"], cursor: 0 } },
      },
    },
    navigate,
    navigateHistory,
    search,
    rpc,
    workspaceState: { workspaces: [] as Workspace[] },
    appearance: { theme: "system", setTheme: vi.fn() },
  };
});

vi.mock("$app/state", () => ({ page: harness.page }));
vi.mock("../route-hygiene.js", () => ({
  canonicalizeShellLocation: (pathname: string, search: string) => `${pathname}${search}`,
  resolveShellRoute: (pathname: string) =>
    pathname === "/missing"
      ? null
      : {
          app: { pageKind: pathname === "/agent" ? "agent" : "workspace" },
          result: { kind: "matched" },
        },
}));
vi.mock("../tab-session.js", () => ({
  tabIdForPath: (pathname: string) =>
    pathname.startsWith("/w/") ? decodeURIComponent(pathname.split("/")[2] ?? "") : null,
}));
vi.mock("../tab-session.svelte.js", () => ({
  tabSession: harness.tabSession,
  navigateTab: harness.navigate,
  navigateTabHistory: harness.navigateHistory,
}));
vi.mock("../appearance.svelte.js", () => ({
  appearanceTheme: () => harness.appearance.theme,
  setAppearanceTheme: harness.appearance.setTheme,
}));
vi.mock("$lib/stores/connection.svelte", () => ({
  getConnectionGeneration: () => 1,
  getRpc: () => harness.rpc,
}));
vi.mock("$lib/stores/skills.svelte", () => ({ openSkillSearchConfig: vi.fn() }));
vi.mock("$lib/stores/workspaces.svelte", () => ({ workspaceState: harness.workspaceState }));
// shell 批（webui-i18n-bilingual task 4.1）：Omnibox 文案已 t() 化——mock 换成
// 真 en 词典直通（en = 事实源，测试锚点走英文原文；runAction 的 agentPage.*
// 查询标签同样由词典供值）。
vi.mock("$lib/i18n", async () => {
  const { en } = await import("$lib/i18n/catalogs/en.js");
  return { t: (key: string) => en[key as keyof typeof en] ?? key };
});

import Omnibox from "../Omnibox.svelte";
import { flushSync, mount, unmount } from "../../__tests__/svelte-client";
import { tick } from "svelte";
import {
  ImportedWorkspaceIdSchema,
  ProviderIdSchema,
  WorkspaceIdSchema,
} from "$shared/contracts/workspaces.js";
import { SkillIdSchema } from "$shared/contracts/skills.js";

let mounted: ReturnType<typeof mount> | null = null;

function mountOmnibox(): void {
  mounted = mount(Omnibox, { target: document.body });
  flushSync();
}

function editButton(): HTMLButtonElement {
  const button = document.querySelector<HTMLButtonElement>('[aria-label="Edit address"]');
  if (!button) throw new Error("omnibox edit button missing");
  return button;
}

function inputElement(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>(
    '[aria-label="Address and command input"]',
  );
  if (!input) throw new Error("omnibox input missing");
  return input;
}

function typeInto(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function makeSearchResult(): SkillSearchResult {
  return {
    id: SkillIdSchema.parse(`sk_${"a".repeat(24)}`),
    name: "shell-tooling",
    description: "Shell test skill",
    canonicalPath: "/skills/shell-tooling/SKILL.md",
    installations: [
      {
        path: "/workspace/.agents/skills/shell-tooling",
        workspaceId: WorkspaceIdSchema.parse(`ws_${"b".repeat(24)}`),
        providerId: ProviderIdSchema.parse("claude"),
      },
    ],
    contentHash: "c".repeat(64),
    disabled: false,
    conflict: false,
    score: 1,
    duplicates: [],
  };
}

beforeEach(() => {
  document.body.innerHTML = "";
  harness.navigate.mockClear();
  harness.navigateHistory.mockClear();
  harness.search.mockReset().mockResolvedValue({ results: [] });
  harness.workspaceState.workspaces = [];
  harness.page.url.pathname = "/w/~/skills";
  harness.page.url.search = "";
  harness.tabSession.navigation.activeId = "~";
  harness.tabSession.navigation.stacks = { "~": { entries: ["/w/~/skills"], cursor: 0 } };
  vi.useFakeTimers();
});

afterEach(() => {
  if (mounted) unmount(mounted);
  mounted = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Omnibox interactions", () => {
  it("opens with the active route, accepts pasted scheme paths, and exits on Escape", async () => {
    mountOmnibox();
    editButton().click();
    await tick();
    expect(inputElement().value).toBe("/w/~/skills");

    typeInto(inputElement(), "skill-creator://w/~/wiki");
    await tick();
    const wiki = [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(
      (option) => option.textContent?.includes("/w/~/wiki"),
    );
    expect(wiki).toBeDefined();
    wiki?.click();
    await tick();
    expect(harness.navigate).toHaveBeenCalledWith("/w/~/wiki");

    editButton().click();
    await tick();
    inputElement().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await tick();
    expect(document.querySelector('[aria-label="Address and command input"]')).toBeNull();
  });

  it("resolves ws-scoped commands against the active tab workspace", async () => {
    // workspace-page-polish V2：`>` 命令的目的地跟随激活 tab（旧实现硬编码 /w/~/，
    // 从 Alpha tab 执行「Creator」会跳去 Global 的 creator）。
    const alphaId = `ws_${"b".repeat(24)}`;
    harness.tabSession.navigation.activeId = alphaId;
    mountOmnibox();
    editButton().click();
    await tick();
    typeInto(inputElement(), "> creator");
    await tick();
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(1);
    inputElement().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await tick();
    expect(harness.navigate).toHaveBeenCalledWith(`/w/${alphaId}/creator`);
    expect(document.querySelector('[aria-label="Address and command input"]')).toBeNull();
  });

  it("no longer registers the retired Repository command", async () => {
    mountOmnibox();
    editButton().click();
    await tick();
    typeInto(inputElement(), "> repo");
    await tick();
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(0);
  });

  it("retains invalid local paths for correction", async () => {
    mountOmnibox();
    editButton().click();
    await tick();
    typeInto(inputElement(), "/missing");
    await tick();
    inputElement().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await tick();
    expect(inputElement().value).toBe("/missing");
    expect(document.querySelector(".omnibox-invalid")).not.toBeNull();
  });

  it("routes Agent Page actions to the page-owned terminal and panel toggles", () => {
    harness.page.url.pathname = "/agent";
    document.body.insertAdjacentHTML(
      "afterbegin",
      '<section data-agent-page="true"><div><button aria-label="Show tree"></button><button aria-label="New session"></button><button aria-label="Toggle terminal"></button><button aria-label="Toggle extension panel"></button></div></section>',
    );
    const toggleTerminal = document.querySelector<HTMLButtonElement>(
      '[aria-label="Toggle terminal"]',
    );
    const togglePanel = document.querySelector<HTMLButtonElement>(
      '[aria-label="Toggle extension panel"]',
    );
    if (!toggleTerminal || !togglePanel) throw new Error("Agent Page action targets missing");
    const terminalClick = vi.spyOn(toggleTerminal, "click");
    const panelClick = vi.spyOn(togglePanel, "click");
    mountOmnibox();

    document.querySelector<HTMLButtonElement>('[aria-label="Terminal"]')?.click();
    document.querySelector<HTMLButtonElement>('[aria-label="Extension panel"]')?.click();

    expect(terminalClick).toHaveBeenCalledOnce();
    expect(panelClick).toHaveBeenCalledOnce();
  });

  it("uses skills.search with an eight-result cap and carries provider plus skill", async () => {
    harness.search.mockResolvedValue({ results: [makeSearchResult()] });
    harness.workspaceState.workspaces = [
      {
        id: ImportedWorkspaceIdSchema.parse(`ws_${"b".repeat(24)}`),
        kind: "directory",
        label: "Test workspace",
        path: "/workspace",
        active: false,
        available: true,
        skillCount: 1,
        providers: [
          {
            id: ProviderIdSchema.parse("claude"),
            label: "Claude",
            path: "/workspace/.agents",
            available: true,
            writable: true,
            skillCount: 1,
          },
        ],
      },
    ];
    mountOmnibox();
    editButton().click();
    await tick();
    typeInto(inputElement(), "shell-tooling");
    await tick();
    await vi.advanceTimersByTimeAsync(150);
    await tick();

    expect(harness.search).toHaveBeenCalledWith({ query: "shell-tooling", limit: 8 });
    const skillOption = [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(
      (option) => option.textContent?.includes("shell-tooling"),
    );
    expect(skillOption).toBeDefined();
    skillOption?.click();
    await tick();
    expect(harness.navigate).toHaveBeenCalledWith(
      `/w/ws_${"b".repeat(24)}/skills?provider=claude&skill=sk_${"a".repeat(24)}`,
    );
  });

  it("derives history button disabled states from the active tab stack", () => {
    mountOmnibox();
    expect(
      document.querySelector<HTMLButtonElement>('[aria-label="Back in this tab"]')?.disabled,
    ).toBe(true);
    expect(
      document.querySelector<HTMLButtonElement>('[aria-label="Forward in this tab"]')?.disabled,
    ).toBe(true);
    harness.tabSession.navigation.stacks = {
      "~": { entries: ["/w/~/skills", "/w/~/wiki", "/w/~/creator"], cursor: 1 },
    };
    unmount(mounted!);
    mountOmnibox();
    expect(
      document.querySelector<HTMLButtonElement>('[aria-label="Back in this tab"]')?.disabled,
    ).toBe(false);
    expect(
      document.querySelector<HTMLButtonElement>('[aria-label="Forward in this tab"]')?.disabled,
    ).toBe(false);
  });

  it("forwards Cmd/Ctrl+Shift+P to the existing command palette shortcut", () => {
    mountOmnibox();
    const forwarded = vi.fn<(event: KeyboardEvent) => void>();
    const onKeydown = (event: KeyboardEvent): void => {
      if (event.key === "k" && (event.metaKey || event.ctrlKey)) forwarded(event);
    };
    globalThis.addEventListener("keydown", onKeydown);
    try {
      const shortcut = new KeyboardEvent("keydown", {
        key: "P",
        code: "KeyP",
        metaKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      });
      globalThis.dispatchEvent(shortcut);

      expect(shortcut.defaultPrevented).toBe(true);
      expect(forwarded).toHaveBeenCalledOnce();
      expect(forwarded.mock.calls[0]?.[0]).toMatchObject({ key: "k", metaKey: true });
    } finally {
      globalThis.removeEventListener("keydown", onKeydown);
    }
  });

  it("brands the editing focus state instead of the forms-plugin default blue (P2-3)", async () => {
    mountOmnibox();
    editButton().click();
    await tick();
    // 机制：@tailwindcss/forms 的 base 只枚举 :not([type]) 与特定 type——typeless
    // input 的 :focus 会拿到插件注入的 blue-600 环/边框（走查实测 RGB(37,99,235)）。
    // 显式 type="text" 脱离插件面；焦点态由 wrapper 的品牌 token 承载。
    expect(inputElement().getAttribute("type")).toBe("text");
    const field = inputElement().closest("div");
    expect(field?.className).toContain("focus-within:border-primary/50");
    expect(field?.className).toContain("focus-within:ring-primary/40");
  });
});
