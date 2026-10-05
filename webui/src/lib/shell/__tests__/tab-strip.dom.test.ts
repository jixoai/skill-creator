// @vitest-environment jsdom
/**
 * TabStrip workspace tab subtitle DOM 测试（η 线 task 3）。
 * 用户原始需求 [2026-10-05]：「新 tab 的 subtitle 显示真实 path」——每个
 * workspace tab 增设次行 = workspaceState.workspaces 的 path 字段；Global
 * tab 语义自足不加次行；workspace 尚未落载的异步窗口期次行留空占位。
 * 正交意图：
 *   [1] imported tab 渲染 data-tab-path 次行（text + title = 真实 path）。
 *   [2] Global tab 无次行；未知 workspace tab 次行占位但不显示 path。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Workspace } from "$shared/contracts/workspaces.js";

const harness = vi.hoisted(() => {
  const activate = vi.fn();
  const closeTab = vi.fn();
  const removeTab = vi.fn();
  return {
    tabSession: {
      navigation: {
        activeId: "~",
        order: [] as string[],
      },
    },
    // 稳定 holder：mock 捕获对象引用，测试只改属性、不换对象（换对象会断开
    // mock 闭包引用——首轮失败实证）。
    workspaceState: { workspaces: [] as Workspace[] },
    activate,
    closeTab,
    removeTab,
  };
});

vi.mock("$lib/stores/workspaces.svelte", () => ({
  workspaceState: harness.workspaceState,
  workspaceEntryPath: (workspace: { id: string }) => `/w/${workspace.id}/skills`,
  removeWorkspace: vi.fn(),
}));
vi.mock("$lib/stores/import-workspace.svelte", () => ({
  requestImportWorkspace: vi.fn(),
}));
vi.mock("$lib/toast.svelte", () => ({ showToast: vi.fn() }));
// ConfirmDialog → bits-ui .svelte 转换在根 vp 跑器外不可达——复用既有 stub。
vi.mock("$lib/components/confirm-dialog.svelte", async () => {
  const { default: stub } = await import("$lib/__tests__/stubs/confirm-dialog-stub.svelte");
  return { default: stub };
});
vi.mock("../tab-session.svelte.js", () => ({
  tabSession: harness.tabSession,
  activateTabAndNavigate: harness.activate,
  closeImportedTab: harness.closeTab,
  removeWorkspaceTab: harness.removeTab,
}));
vi.mock("$lib/i18n", async () => {
  const { en } = await import("$lib/i18n/catalogs/en.js");
  return { t: (key: string) => en[key as keyof typeof en] ?? key };
});

import TabStrip from "../TabStrip.svelte";
import { flushSync, mount, unmount } from "../../__tests__/svelte-client";
import { ImportedWorkspaceIdSchema, ProviderIdSchema } from "$shared/contracts/workspaces.js";

const alphaId = ImportedWorkspaceIdSchema.parse(`ws_${"b".repeat(24)}`);
const alphaPath = "/repos/alpha-skills";

function makeWorkspace(id: string, path: string): Workspace {
  return {
    id: ImportedWorkspaceIdSchema.parse(id),
    kind: "directory",
    label: "Alpha",
    path,
    active: false,
    available: true,
    skillCount: 1,
    providers: [
      {
        id: ProviderIdSchema.parse("claude"),
        label: "Claude",
        path: `${path}/.agents`,
        available: true,
        writable: true,
        skillCount: 1,
      },
    ],
  };
}

let mounted: ReturnType<typeof mount> | null = null;

function mountStrip(): void {
  mounted = mount(TabStrip, { target: document.body });
  flushSync();
}

function importedTabButton(workspaceId: string): HTMLButtonElement {
  // APG tabs 接线后（2026-10-05）：激活钮 = role=tab（wrapper 留 data-tab-id
  // 作稳定钩子——role=group 已随语义清理退役）。
  const tab = [...document.querySelectorAll('[role="tab"]')].find(
    (node) => node.id === `shell-tab-${workspaceId}` || node.textContent?.includes(workspaceId),
  );
  if (!(tab instanceof HTMLButtonElement))
    throw new Error(`imported tab for ${workspaceId} missing`);
  return tab;
}

beforeEach(() => {
  document.body.innerHTML = "";
  harness.activate.mockClear();
  harness.closeTab.mockClear();
  harness.removeTab.mockClear();
  harness.workspaceState.workspaces = [];
  harness.tabSession.navigation.activeId = "~";
  harness.tabSession.navigation.order = ["~"];
});

afterEach(() => {
  if (mounted) unmount(mounted);
  mounted = null;
});

describe("TabStrip workspace tab subtitle", () => {
  it("renders the workspace's real path as a second line with the full path as title", () => {
    harness.workspaceState.workspaces = [makeWorkspace(alphaId, alphaPath)];
    harness.tabSession.navigation.order = ["~", alphaId];
    mountStrip();

    const subtitle = document.querySelector<HTMLElement>(`[data-tab-path="${alphaPath}"]`);
    expect(subtitle).not.toBeNull();
    expect(subtitle?.textContent).toBe(alphaPath);
    expect(subtitle?.getAttribute("title")).toBe(alphaPath);
  });

  it("keeps the Global tab single-line (no path subtitle)", () => {
    harness.workspaceState.workspaces = [makeWorkspace(alphaId, alphaPath)];
    harness.tabSession.navigation.order = ["~", alphaId];
    mountStrip();

    const globalTab = document.querySelector<HTMLElement>('[aria-label="Global workspace tab"]');
    expect(globalTab).not.toBeNull();
    expect(globalTab?.querySelector("[data-tab-path]")).toBeNull();
    expect(document.querySelectorAll("[data-tab-path]")).toHaveLength(1);
  });

  it("reserves an empty subtitle line while the workspace record is still loading", () => {
    const pendingId = ImportedWorkspaceIdSchema.parse(`ws_${"c".repeat(24)}`);
    harness.workspaceState.workspaces = [makeWorkspace(alphaId, alphaPath)];
    harness.tabSession.navigation.order = ["~", alphaId, pendingId];
    mountStrip();

    // 已知 workspace：path 次行；未知 workspace：次行保留（无 data-tab-path）。
    expect(document.querySelector(`[data-tab-path="${alphaPath}"]`)).not.toBeNull();
    const pendingButton = importedTabButton(pendingId);
    expect(pendingButton.querySelector("[data-tab-path]")).toBeNull();
    const lines = pendingButton.querySelectorAll("span");
    expect(lines).toHaveLength(2);
    expect(lines[1]?.textContent).toBe("");
  });
});
