// @vitest-environment jsdom
/**
 * WorkspaceManager 页面级 DOM 断言（workspace-page-polish θ1+2）。
 * 用户原始需求 [2026-10-05]（Owner 裁决）：「IMPORTED 的技术语义正确，但
 * 『IMPORTED』是实现细节泄漏进用户面——删除操作收口到标准管理页；概念呈现退化。」
 * 正交意图：
 *   [1] 注册目录索引：label + 真实路径 + provider/技能计数；Global（~）不入列。
 *   [2] Remove 收口：危险操作确认闸（stub 化 ConfirmDialog）+ workspace.remove
 *       RPC + 成功后 toast；确认前零 remove RPC。
 *   [3] Open 语义：goById("workspaces.provider") → /w/<wsId>/skills（tabs 打开
 *       该 ws 的 dashboard）；Import 入口 = 全局 import-workspace-dialog 打开态。
 *   [4] 空态：无注册工作区时引导导入（IMPORTED 词汇不再出现）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, unmount, type Component } from "svelte";

let rpcClient: Record<string, unknown> | null = null;
let connectionStatus = "connected";

vi.mock("$lib/stores/connection.svelte", () => ({
  connectionState: {
    get status() {
      return connectionStatus;
    },
    error: null,
  },
  connect: vi.fn(),
  disconnect: vi.fn(),
  getConnectionGeneration: () => 0,
  getRpc: () => rpcClient,
  requireRpc: () => {
    if (!rpcClient) throw new Error("The Skill Creator daemon is not connected.");
    return rpcClient;
  },
}));

vi.mock("$app/navigation", () => ({ goto: vi.fn() }));

// ConfirmDialog → 同 props 契约 stub（bits-ui 外置化；确认流按钮可断言）。
vi.mock("$lib/components/confirm-dialog.svelte", async () => {
  const { default: stub } = await import("$lib/__tests__/stubs/confirm-dialog-stub.svelte");
  return { default: stub };
});
vi.mock("$lib/components/ui/button", async () => {
  const { default: stub } = await import("$lib/__tests__/stubs/ui-button-stub.svelte");
  return { Button: stub };
});

// goById 构 href 需要 routeRegistry：真实 workspaces manifest。
import "../../workspaces/manifest.js";
import { setNavControllerAdapter } from "$lib/shell/navigate.js";
import { workspaceState } from "$lib/stores/workspaces.svelte";
import { importWorkspaceUi } from "$lib/stores/import-workspace.svelte";
import { toasts } from "$lib/toast.svelte";
import type { Workspace } from "$shared/contracts/workspaces.js";
import WorkspaceManager from "../WorkspaceManager.svelte";

const WS_ALPHA = `ws_${"a".repeat(23)}1`;
const WS_BETA = `ws_${"b".repeat(23)}2`;

function directoryWorkspace(
  id: string,
  label: string,
  path: string,
  skillCount: number,
  available = true,
): Workspace {
  return {
    id,
    kind: "directory",
    label,
    path,
    active: false,
    available,
    skillCount,
    providers: [
      {
        id: "claude-code",
        label: "Claude Code",
        path: `${path}/.claude/skills`,
        available,
        writable: true,
        skillCount,
      },
    ],
  } as unknown as Workspace;
}

const globalWorkspace: Workspace = {
  id: "~",
  kind: "global",
  label: "Global",
  path: null,
  active: true,
  available: true,
  skillCount: 7,
  providers: [],
} as unknown as Workspace;

const mounted: ReturnType<typeof mount>[] = [];
const navigated: string[] = [];

function mountManager(): HTMLElement {
  const target = document.createElement("div");
  document.body.appendChild(target);
  mounted.push(mount(WorkspaceManager as unknown as Component, { target }));
  return target;
}

async function settle(ms = 30): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function click(button: HTMLElement | null | undefined): void {
  if (!button) throw new Error("button not found");
  button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}

function textOf(root: HTMLElement): string {
  return (root.textContent ?? "").replace(/\s+/g, " ").trim();
}

const rpcCalls: string[] = [];

function installRpc(workspaces: Workspace[]): void {
  rpcClient = {
    workspace: {
      list: () => {
        rpcCalls.push("workspace.list");
        return Promise.resolve({ workspaces });
      },
      remove: (input: { id: string }) => {
        rpcCalls.push(`workspace.remove:${input.id}`);
        return Promise.resolve({ activeId: "~" });
      },
    },
  };
}

beforeEach(() => {
  connectionStatus = "connected";
  document.body.innerHTML = "";
  rpcCalls.length = 0;
  navigated.length = 0;
  toasts.length = 0;
  importWorkspaceUi.open = false;
  workspaceState.workspaces = [];
  setNavControllerAdapter({
    navigate: (path: string) => navigated.push(path),
  });
});

afterEach(async () => {
  while (mounted.length > 0) {
    const instance = mounted.pop();
    if (instance) await unmount(instance);
  }
  workspaceState.workspaces = [];
  rpcClient = null;
  setNavControllerAdapter({ navigate: () => {} });
});

describe("WorkspaceManager（/workspace 标准管理页）", () => {
  it("lists registered workspaces with paths and counts; Global (~) never appears", async () => {
    installRpc([
      globalWorkspace,
      directoryWorkspace(WS_ALPHA, "Alpha", "/Users/dev/alpha", 12),
      directoryWorkspace(WS_BETA, "Beta", "/Users/dev/beta", 3, false),
    ]);
    const root = mountManager();
    await settle();

    const rows = [...root.querySelectorAll("tbody tr")];
    expect(rows).toHaveLength(2);
    // 真实路径呈现（等宽列）+ 计数；Global 固定 tab 不入索引。
    expect(textOf(rows[0] as HTMLElement)).toContain("/Users/dev/alpha");
    expect(textOf(rows[0] as HTMLElement)).toContain("12");
    // 不可用目录：Missing 标记在场（注册仍在，删除可达——AGENTS §7.2）。
    expect(textOf(rows[1] as HTMLElement)).toContain("Missing");
    // IMPORTED 词汇从用户面退役（分区标题、行文案均不再出现）。
    expect(textOf(root)).not.toMatch(/imported/i);
  });

  it("opens the workspace dashboard via the canonical route on Open", async () => {
    installRpc([globalWorkspace, directoryWorkspace(WS_ALPHA, "Alpha", "/Users/dev/alpha", 12)]);
    const root = mountManager();
    await settle();

    click(
      [...root.querySelectorAll<HTMLButtonElement>("tbody button")].find(
        (b) => textOf(b) === "Open",
      ),
    );
    expect(navigated).toEqual([`/w/${WS_ALPHA}/skills`]);
  });

  it("gates Remove behind the confirm dialog, then removes and toasts", async () => {
    installRpc([globalWorkspace, directoryWorkspace(WS_ALPHA, "Alpha", "/Users/dev/alpha", 12)]);
    const root = mountManager();
    await settle();

    const remove = [...root.querySelectorAll<HTMLButtonElement>("tbody button")].find((b) =>
      (b.getAttribute("aria-label") ?? "").startsWith("Remove"),
    );
    expect(remove).toBeDefined();
    click(remove);
    await settle();

    // 确认闸在场（危险操作描述携带 label）；确认前零 remove RPC。
    const dialog = root.querySelector('[data-stub="confirm-dialog"]');
    expect(dialog).not.toBeNull();
    expect(textOf(dialog as HTMLElement)).toContain("Alpha");
    expect(rpcCalls.some((call) => call.startsWith("workspace.remove:"))).toBe(false);

    click(root.querySelector<HTMLButtonElement>('[data-stub="confirm-accept"]'));
    await settle(60);

    expect(rpcCalls).toContain(`workspace.remove:${WS_ALPHA}`);
    expect(toasts.length).toBe(1);
    expect(toasts[0]?.message).toContain("Alpha");
  });

  it("surfaces the global import dialog from the header and the empty state", async () => {
    installRpc([globalWorkspace]);
    const root = mountManager();
    await settle();

    // 空态：无注册工作区 → 引导导入。
    expect(textOf(root)).toContain("No workspaces yet");
    const emptyImport = [...root.querySelectorAll<HTMLButtonElement>("button")].find(
      (b) => textOf(b) === "Import workspace",
    );
    expect(emptyImport).toBeDefined();
    click(emptyImport);
    expect(importWorkspaceUi.open).toBe(true);

    // header Import 入口同一打开态（幂等）。
    importWorkspaceUi.open = false;
    const headerImport = [...root.querySelectorAll<HTMLButtonElement>("header button")].find((b) =>
      textOf(b).includes("Import"),
    );
    click(headerImport);
    expect(importWorkspaceUi.open).toBe(true);
  });
});
