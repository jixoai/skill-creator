// @vitest-environment jsdom
/**
 * agents-screen 组件级 DOM 断言（skills-tabs-redesign 批 4，design Δ5 路径 1）。
 * 用户原始需求 [2026-10-06]：「诊断行紧凑化（只用现有投影字段）+ 搜索过滤 +
 * 可写|只读分组头 + 计数」；「provider 行点击（跳 Skills Tab 带 provider 筛选）
 * 与行尾动作是两个独立可聚焦操作」。
 * 正交意图：
 *   [1] 分组渲染：可写|只读两组 + 组计数（field-driven；现行 daemon 投影里
 *       writable 是 workspace 级——同一 workspace 混组由 fixture 人工构造以
 *       钉分组契约，空组不渲染头）。
 *   [2] 组内序：在盘前置、label/id 码点序（确定性扫描序）；不可用行无可写性
 *       徽标（P2-9）+「Not found on disk」。
 *   [3] 搜索窗口：label/path 子串过滤（大小写不敏感）+ showingOf 窗口计数 +
 *       空态（query 回显 + 清除恢复 + 焦点归还输入框）。
 *   [4] 双操作分离：行主体（provider 筛选 toggle，?tab 卸载/skill·view 清空）
 *       与行尾 Insights（insights 路由）互不嵌套、各自可聚焦、DOM 序稳定。
 *   [5] 规模假设：30+ provider 全量渲染（不虚拟化），每行恰两个 tab stop。
 *   [6] i18n 域键 en/zh 渲染（含 ICU 复数）。
 * 妥协声明：jsdom 无布局——sticky 分组头/44px 触达/图标态收敛/假数据禁令由
 * agents-screen-css.test.ts（node env）钉源级契约，真实布局归走查门。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, unmount, type Component } from "svelte";

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
  getRpc: () => null,
  requireRpc: () => {
    throw new Error("The Skill Creator daemon is not connected.");
  },
}));

vi.mock("$app/navigation", () => ({ goto: vi.fn() }));

vi.mock("$lib/stores/agent.svelte", () => ({
  startAgentAction: vi.fn(),
}));

vi.mock("$lib/components/ui/badge", async () => {
  const { default: stub } = await import("$lib/__tests__/stubs/ui-badge-stub.svelte");
  return { Badge: stub };
});

import "../../workspaces/manifest.js";
import "../../creator/manifest.js";
import { setNavControllerAdapter } from "$lib/shell/navigate.js";
import { workspaceState } from "$lib/stores/workspaces.svelte";
import { __resetLocaleForTests, setLocale, t } from "$lib/i18n";
import type { Workspace } from "$shared/contracts/workspaces.js";
import AgentsHarness from "./agents-router-harness.svelte";

const WS_ID = `ws_${"a".repeat(24)}`;

function provider(
  id: string,
  label: string,
  options: {
    path?: string;
    available?: boolean;
    writable?: boolean;
    skillCount?: number;
  } = {},
): Record<string, unknown> {
  return {
    id,
    label,
    path: options.path ?? `/home/agent/${id}/skills`,
    available: options.available ?? true,
    writable: options.writable ?? false,
    skillCount: options.skillCount ?? 0,
  };
}

function seedWorkspaces(workspaces: unknown[]): void {
  workspaceState.workspaces = workspaces as unknown as typeof workspaceState.workspaces;
}

/** Imported ws：3 可写（含 1 根缺失沉底）+ 1 人工只读条目（钉混组契约）。 */
function seedImportedWorkspace(): void {
  seedWorkspaces([
    {
      id: WS_ID,
      label: "Demo Workspace",
      kind: "directory",
      active: true,
      available: true,
      skillCount: 7,
      path: "/tmp/ws-demo",
      providers: [
        provider("aaa-labs", "AAA Labs", { writable: true, skillCount: 4 }),
        provider("mid-agent", "Mid Agent", {
          writable: true,
          skillCount: 3,
          path: "/tmp/ws-demo/.agents/mid/skills",
        }),
        provider("old-archive", "Old Archive", { writable: false, skillCount: 0 }),
        provider("zzz-agent", "ZZZ Agent", { writable: true, available: false }),
      ],
    },
  ]);
}

function seedGlobalWorkspace(count: number): void {
  seedWorkspaces([
    {
      id: "~",
      label: "Global",
      kind: "global",
      active: true,
      available: true,
      skillCount: count,
      path: null,
      providers: Array.from({ length: count }, (_, index) =>
        provider(
          `prov-${String(index).padStart(2, "0")}`,
          `Provider ${String(index).padStart(2, "0")}`,
          { skillCount: index },
        ),
      ),
    },
  ]);
}

const mounted: ReturnType<typeof mount>[] = [];

function mountAgents(search: Record<string, unknown> = {}, wsId = WS_ID): HTMLElement {
  const target = document.createElement("div");
  document.body.appendChild(target);
  const Harness = AgentsHarness as unknown as Component;
  mounted.push(mount(Harness, { target, props: { wsId, search } }));
  return target;
}

function settle(ms = 20): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function textOf(root: HTMLElement | null): string {
  return (root?.textContent ?? "").replace(/\s+/g, " ").trim();
}

function rows(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('[data-testid="agents-row"]')];
}

function click(element: HTMLElement | null | undefined): void {
  if (!element) throw new Error("element not found");
  element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}

function typeQuery(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

let navigateLog: string[] = [];

beforeEach(() => {
  connectionStatus = "connected";
  document.body.innerHTML = "";
  navigateLog = [];
  setNavControllerAdapter({
    navigate: (path: string) => {
      navigateLog.push(path);
    },
  });
});

afterEach(async () => {
  while (mounted.length > 0) {
    const instance = mounted.pop();
    if (instance) await unmount(instance);
  }
  __resetLocaleForTests();
  workspaceState.workspaces = [];
  setNavControllerAdapter({
    navigate: () => {
      /* 测试间空适配器 */
    },
  });
});

describe("Agents 分组渲染（Δ5 路径 1）", () => {
  it("renders writable | read-only groups with per-group counts; empty group renders no head", async () => {
    seedImportedWorkspace();
    const root = mountAgents();
    await settle();

    const writableSection = root.querySelector('[data-testid="agents-group-writable"]');
    const readonlySection = root.querySelector('[data-testid="agents-group-readonly"]');
    expect(textOf(writableSection?.querySelector(".agents-group-head") ?? null)).toBe(
      "Writable 3",
    );
    expect(textOf(readonlySection?.querySelector(".agents-group-head") ?? null)).toBe(
      "Read-only 1",
    );
    expect(
      [...(writableSection?.querySelectorAll('[data-testid="agents-row"]') ?? [])].map((row) =>
        row.getAttribute("data-provider-id"),
      ),
    ).toEqual(["aaa-labs", "mid-agent", "zzz-agent"]);
    expect(
      [...(readonlySection?.querySelectorAll('[data-testid="agents-row"]') ?? [])].map((row) =>
        row.getAttribute("data-provider-id"),
      ),
    ).toEqual(["old-archive"]);

    // Global ws（现行投影全员只读）：只渲染只读组头，可写组不渲染（空组不造假）。
    seedGlobalWorkspace(2);
    const globalRoot = mountAgents({}, "~");
    await settle();
    expect(globalRoot.querySelector('[data-testid="agents-group-writable"]')).toBeNull();
    expect(
      textOf(
        globalRoot.querySelector('[data-testid="agents-group-readonly"] .agents-group-head') ??
          null,
      ),
    ).toBe("Read-only 2");
  });

  it("sorts on-disk providers before missing ones within a group (deterministic scan order)", async () => {
    seedImportedWorkspace();
    const root = mountAgents();
    await settle();

    const writableIds = rows(root)
      .filter((row) => row.closest('[data-testid="agents-group-writable"]'))
      .map((row) => row.getAttribute("data-provider-id"));
    expect(writableIds).toEqual(["aaa-labs", "mid-agent", "zzz-agent"]);
  });

  it("keeps the P2-9 badge gate: missing-root rows carry no writability badge", async () => {
    seedImportedWorkspace();
    const root = mountAgents();
    await settle();

    const missingRow = root.querySelector('[data-provider-id="zzz-agent"]');
    expect(missingRow).not.toBeNull();
    expect(textOf(missingRow as HTMLElement)).toContain("Not found on disk");
    expect(textOf(missingRow as HTMLElement)).not.toContain("writable");

    const diskRow = root.querySelector('[data-provider-id="mid-agent"]');
    expect(textOf(diskRow as HTMLElement)).toContain("writable");
  });

  it("renders initials identifier, mono path, and real skill count per row", async () => {
    seedImportedWorkspace();
    const root = mountAgents();
    await settle();

    const row = root.querySelector('[data-provider-id="aaa-labs"]');
    expect(textOf(row as HTMLElement)).toContain("AAA Labs");
    expect(textOf(row as HTMLElement)).toContain("4");
    const avatar = row?.querySelector(".agents-avatar");
    expect(avatar?.textContent).toBe("AL");
    // 零计数行仍渲染真实 0（诊断事实，不隐藏不造假）。
    const zeroRow = root.querySelector('[data-provider-id="old-archive"]');
    expect(textOf(zeroRow as HTMLElement)).toContain("0");
  });
});

describe("Agents 搜索窗口", () => {
  it("filters by label/path substring case-insensitively and updates the window count", async () => {
    seedImportedWorkspace();
    const root = mountAgents();
    await settle();

    const input = root.querySelector<HTMLInputElement>('[data-testid="agents-search"]');
    expect(input).not.toBeNull();
    typeQuery(input!, "MID");
    await settle();

    // label 子串命中 mid-agent（其余 3 行滤除）。
    expect(rows(root).map((row) => row.getAttribute("data-provider-id"))).toEqual(["mid-agent"]);
    expect(textOf(root.querySelector('[data-testid="agents-showing"]') as HTMLElement)).toBe(
      "Showing 1 of 4 providers",
    );
    // 命中行属可写组：只渲染可写组头。
    expect(root.querySelector('[data-testid="agents-group-writable"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="agents-group-readonly"]')).toBeNull();

    // path 子串命中（reset 后搜 .agents/mid）。
    typeQuery(input!, ".agents/mid");
    await settle();
    expect(rows(root).map((row) => row.getAttribute("data-provider-id"))).toEqual(["mid-agent"]);
  });

  it("shows an explicit empty state and restores rows on clear (focus returns to input)", async () => {
    seedImportedWorkspace();
    const root = mountAgents();
    await settle();

    const input = root.querySelector<HTMLInputElement>('[data-testid="agents-search"]')!;
    typeQuery(input, "no-such-provider");
    await settle();

    const empty = root.querySelector('[data-testid="agents-search-empty"]');
    expect(empty).not.toBeNull();
    expect(textOf(empty as HTMLElement)).toContain("no-such-provider");
    expect(rows(root)).toHaveLength(0);

    click(root.querySelector<HTMLElement>('[data-testid="agents-search-empty"] button'));
    await settle();

    expect(rows(root)).toHaveLength(4);
    expect(root.querySelector<HTMLInputElement>('[data-testid="agents-search"]')?.value).toBe("");
    expect(document.activeElement).toBe(
      root.querySelector<HTMLInputElement>('[data-testid="agents-search"]'),
    );
  });
});

describe("Agents 双操作分离（行主体 vs 行尾 Insights）", () => {
  it("row main navigates to the skills tab with provider filter (tab/skill/view dropped)", async () => {
    seedImportedWorkspace();
    const root = mountAgents({ tab: "agents", skill: "sk_x", view: "detail" });
    await settle();

    const row = root.querySelector('[data-provider-id="aaa-labs"]');
    const main = row?.querySelector<HTMLButtonElement>(".agents-row-main");
    click(main);
    expect(navigateLog).toHaveLength(1);
    const url = new URL(navigateLog[0]!, "https://skill-creator.invalid");
    expect(url.pathname).toBe(`/w/${WS_ID}/skills`);
    expect(url.searchParams.get("provider")).toBe("aaa-labs");
    expect(url.searchParams.has("tab")).toBe(false);
    expect(url.searchParams.has("skill")).toBe(false);
    expect(url.searchParams.has("view")).toBe(false);
  });

  it("row main toggles the filter off when the provider is already active", async () => {
    seedImportedWorkspace();
    const root = mountAgents({ provider: "aaa-labs" });
    await settle();

    const row = root.querySelector('[data-provider-id="aaa-labs"]');
    const main = row?.querySelector<HTMLButtonElement>(".agents-row-main");
    expect(main?.getAttribute("aria-pressed")).toBe("true");
    click(main);
    const url = new URL(navigateLog[0]!, "https://skill-creator.invalid");
    expect(url.searchParams.has("provider")).toBe(false);
  });

  it("row tail navigates to the insights route as a separate focusable action", async () => {
    seedImportedWorkspace();
    const root = mountAgents();
    await settle();

    const row = root.querySelector('[data-provider-id="aaa-labs"]');
    const main = row?.querySelector<HTMLButtonElement>(".agents-row-main");
    const action = row?.querySelector<HTMLButtonElement>('[data-testid="agents-row-action"]');
    expect(main).not.toBeNull();
    expect(action).not.toBeNull();
    // 互不嵌套 + DOM 序稳定（main → action = 逐行 Tab 遍历序）。
    expect(main!.contains(action!)).toBe(false);
    expect(action!.contains(main!)).toBe(false);
    expect(main!.compareDocumentPosition(action!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    click(action);
    expect(navigateLog).toHaveLength(1);
    expect(navigateLog[0]).toBe(`/w/${WS_ID}/skills/insights/aaa-labs`);
  });
});

describe("Agents 规模假设（30+ 不虚拟化）", () => {
  it("renders every provider row for 32 providers with exactly two tab stops per row", async () => {
    seedGlobalWorkspace(32);
    const root = mountAgents({}, "~");
    await settle();

    const rendered = rows(root);
    expect(rendered).toHaveLength(32);
    // 每行恰两个按钮（行主体 + 行尾），无第三聚焦产物。
    for (const row of rendered) {
      expect(row.querySelectorAll("button")).toHaveLength(2);
    }
    // 全屏交互面 = 行×2 + 搜索框（未搜索态无清除钮）。
    expect(root.querySelectorAll("button, input")).toHaveLength(32 * 2 + 1);
    // 零计数行保留真实计数（首行 skillCount=0）。
    expect(textOf(rendered[0]!)).toContain("Provider 00");
  });
});

describe("Agents i18n 域键（skills-agents）", () => {
  it("renders en/zh pairs including ICU plural for the row count label", () => {
    expect(t("agentsScreen.searchPlaceholder")).toBe("Filter providers by name or path");
    expect(t("agentsScreen.showingOf", { visible: 1, total: 2 })).toBe("Showing 1 of 2 providers");
    expect(t("agentsScreen.skillsCountAria", { count: 1 })).toBe("1 skill");
    expect(t("agentsScreen.skillsCountAria", { count: 3 })).toBe("3 skills");

    setLocale("zh");
    expect(t("agentsScreen.searchPlaceholder")).toBe("按名称或路径筛选 provider");
    expect(t("agentsScreen.showingOf", { visible: 1, total: 2 })).toBe(
      "显示 1 / 共 2 个 provider",
    );
    expect(t("agentsScreen.skillsCountAria", { count: 3 })).toBe("3 个技能");
  });
});
