// @vitest-environment jsdom
/**
 * SkillsDashboard 组件级 DOM 断言（skills-dashboard 1.3/1.4/1.6/1.7 +
 * skills-tabs-redesign 批 1/批 2）。
 * 用户原始需求 [2026-10-06]：「顶部 TabsHeader 三一等 Tabs……每 Tab 独占整幅
 * 画布」；「Skills 默认不得出现重复 skill-name」（Δ1：唯一 name 行 + ×N 副本
 * 徽标 + 两量纲计数）；「行点击进 SkillDetail 独立路由，?from= 携带列表态」；
 * 「master-detail 耦合面板退役（detail 归独立路由页）」。
 * 正交意图：
 *   [1] TabsHeader chrome：tablist/tab/tabpanel ARIA + roving tabindex（←→/
 *       Home/End 自动激活）+ ?tab= 深链与 Tab 点击同源写 URL。
 *   [2] Skills panel 数据面（listCanonical 分组行/provider chips 代表口径计数/
 *       两量纲 header/×N 徽标/全组不可用置灰）。
 *   [3] detail 导航：行点击 → workspaces.skillDetail（representative 三元组进
 *       路径）+ ?from= 快照（真实 codec 编码）。
 *   [4] 筛选 URL 面：duplicates-only（组内同内容 ≥2 副本）/ provider chip。
 *   [5] Global 页脚冒烟锚点 en 逐字（/skills across \d+ agent locations/）。
 *   [6] Agents screen Intelligence 入口同链（detail 页入口归其页级测试）。
 *   [7] 页题行统计小字：providers 摘要真实计数，缺席不渲染（不造假）。
 * 妥协声明：jsdom 无布局——单行不换行/画布独占由 skills-dashboard-css.test
 * 钉 CSS 契约，真实布局归走查门。
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

vi.mock("$lib/stores/agent.svelte", () => ({
  startAgentAction: vi.fn(),
}));

// ui 原语 → 最小 stub（真组件经 bits-ui，node_modules 内 .svelte 被 vitest 外置化）。
vi.mock("$lib/components/ui/button", async () => {
  const { default: stub } = await import("$lib/__tests__/stubs/ui-button-stub.svelte");
  return { Button: stub };
});
vi.mock("$lib/components/ui/badge", async () => {
  const { default: stub } = await import("$lib/__tests__/stubs/ui-badge-stub.svelte");
  return { Badge: stub };
});
vi.mock("$lib/components/confirm-dialog.svelte", async () => {
  const { default: stub } = await import("$lib/__tests__/stubs/confirm-dialog-stub.svelte");
  return { default: stub };
});
vi.mock("$lib/components/self-skill-conflict-banner.svelte", async () => {
  const { default: stub } = await import("$lib/__tests__/stubs/self-skill-banner-stub.svelte");
  return { default: stub };
});

// manifest 注册（goById 构 href 需要 routeRegistry：workspaces + creator）。
import "../../workspaces/manifest.js";
import "../../creator/manifest.js";
import { setNavControllerAdapter } from "$lib/shell/navigate.js";
import {
  dashboardCanonicalState,
  resetDashboardCanonical,
} from "$lib/stores/dashboard-canonical.svelte";
import { workspaceState } from "$lib/stores/workspaces.svelte";
import { resetSkillSearch, searchState } from "$lib/stores/skills.svelte";
import type { SkillsCanonicalGroup, SkillsListCanonicalOutput } from "$shared/rpc-contract.js";
import { ProviderIdSchema, type ProviderId } from "$shared/contracts/workspaces.js";
import { SkillIdSchema, type SkillId } from "$shared/contracts/skills.js";
import RouterHarness from "./dashboard-router-harness.svelte";

const CLAUDE = ProviderIdSchema.parse("claude-code");
const ZCODE = ProviderIdSchema.parse("zcode");
const SK_A = SkillIdSchema.parse(`sk_${"a".repeat(24)}`);
const SK_B = SkillIdSchema.parse(`sk_${"b".repeat(24)}`);
const SK_C = SkillIdSchema.parse(`sk_${"c".repeat(24)}`);
const SK_A2 = SkillIdSchema.parse(`sk_${"d".repeat(24)}`);

interface RpcLog {
  calls: string[];
  navigate: string[];
}

function makeRpcLog(): RpcLog {
  return { calls: [], navigate: [] };
}

interface CopyFixture {
  id: SkillId;
  providerId: ProviderId;
  disabled?: boolean;
  conflict?: boolean;
  unavailable?: boolean;
  contentHash?: string;
  description?: string;
}

/** 组 fixture：representative 由 Δ1 冻结序在测试内现算（enabled 优先）。 */
function groupFixture(name: string, copies: CopyFixture[]): SkillsCanonicalGroup {
  const projected = copies.map((copy) => ({
    id: copy.id,
    skillId: copy.id,
    workspaceId: "~" as const,
    providerId: copy.providerId,
    name,
    description: copy.description ?? `${name} desc`,
    directoryName: name,
    disabled: copy.disabled ?? false,
    provider: copy.providerId,
    location: "user" as const,
    path: `/skills/${copy.providerId}/${name}`,
    hasReferences: false,
    hasScripts: false,
    hasAssets: false,
    pluginInfo: null,
    installedVia: "unknown" as const,
    updatable: false,
    unavailable: copy.unavailable ?? false,
    conflict: copy.conflict ?? false,
    ...(copy.contentHash ? { contentHash: copy.contentHash } : {}),
  }));
  const available = projected.filter((copy) => !copy.unavailable);
  const pool = available.length > 0 ? available : projected;
  const representative = [...pool].sort((left, right) => {
    if (left.disabled !== right.disabled) return left.disabled ? 1 : -1;
    return left.providerId < right.providerId ? -1 : 1;
  })[0]!;
  return {
    name,
    description: representative.description,
    representative,
    copies: projected,
    groupMeta: { copyCount: projected.length, allUnavailable: available.length === 0 },
  };
}

function canonicalOutput(
  groups: SkillsCanonicalGroup[],
  options: { nextCursor?: string; groupCount?: number; copyCount?: number } = {},
): SkillsListCanonicalOutput {
  const providers = ["claude-code", "zcode"].map((providerId) => ({
    providerId: providerId as ProviderId,
    label: providerId === "claude-code" ? "Claude Code" : "ZCode",
    available: true,
    skillCount: groups.filter((group) =>
      group.copies.some((copy) => copy.providerId === providerId),
    ).length,
  }));
  return {
    providers,
    groups,
    groupCount: options.groupCount ?? groups.length,
    copyCount:
      options.copyCount ?? groups.reduce((total, group) => total + group.groupMeta.copyCount, 0),
    ...(options.nextCursor ? { nextCursor: options.nextCursor } : {}),
  };
}

function installRpc(
  log: RpcLog,
  firstPage: SkillsListCanonicalOutput,
  secondPage?: SkillsListCanonicalOutput,
): void {
  let listCanonicalCalls = 0;
  rpcClient = {
    skills: {
      listCanonical: (input: Record<string, unknown>) => {
        log.calls.push(`skills.listCanonical:${JSON.stringify(input)}`);
        listCanonicalCalls += 1;
        return Promise.resolve(listCanonicalCalls > 1 && secondPage ? secondPage : firstPage);
      },
      list: (input: Record<string, unknown>) => {
        log.calls.push(`skills.list:${input.providerId ?? ""}`);
        return Promise.resolve({ skills: [] });
      },
      search: (input: Record<string, unknown>) => {
        log.calls.push(`skills.search:${input.query ?? ""}`);
        return Promise.resolve({ results: [] });
      },
      duplicates: () => {
        log.calls.push("skills.duplicates");
        return Promise.resolve({ groups: [] });
      },
      searchConfig: {
        open: () => {
          log.calls.push("skills.searchConfig.open");
          return Promise.resolve({ opened: true });
        },
      },
    },
    repository: {
      sources: {
        list: () => {
          log.calls.push("repository.sources.list");
          return Promise.resolve({ builtIn: [], user: [] });
        },
      },
    },
    selfSkill: {
      state: () => {
        log.calls.push("selfSkill.state");
        return Promise.resolve({ state: "ok" });
      },
    },
    workspace: {
      list: () => {
        log.calls.push("workspace.list");
        return Promise.resolve({ workspaces: [] });
      },
    },
  };
}

function seedGlobalWorkspace(): void {
  workspaceState.workspaces = [
    {
      id: "~",
      label: "Global",
      kind: "global",
      active: true,
      available: true,
      skillCount: 3,
      path: null,
      providers: [
        {
          id: "claude-code",
          label: "Claude Code",
          path: "/~/.claude/skills",
          available: true,
          writable: false,
          skillCount: 2,
        },
        {
          id: "zcode",
          label: "ZCode",
          path: "/~/.zcode/skills",
          available: true,
          writable: false,
          skillCount: 1,
        },
      ],
    },
  ] as unknown as typeof workspaceState.workspaces;
}

const mounted: ReturnType<typeof mount>[] = [];

function mountDashboard(search: Record<string, unknown> = {}, wsId = "~"): HTMLElement {
  const target = document.createElement("div");
  document.body.appendChild(target);
  const Harness = RouterHarness as unknown as Component;
  mounted.push(mount(Harness, { target, props: { wsId, search } }));
  return target;
}

function settle(ms = 30): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buttons(root: HTMLElement): HTMLButtonElement[] {
  return [...root.querySelectorAll("button")];
}

function click(button: HTMLElement | null | undefined): void {
  if (!button) throw new Error("button not found");
  button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}

function textOf(root: HTMLElement): string {
  return (root.textContent ?? "").replace(/\s+/g, " ").trim();
}

beforeEach(() => {
  connectionStatus = "connected";
  document.body.innerHTML = "";
  seedGlobalWorkspace();
  setNavControllerAdapter({
    navigate: (path: string) => {
      activeLog?.navigate.push(path);
    },
  });
});

let activeLog: RpcLog | null = null;

afterEach(async () => {
  while (mounted.length > 0) {
    const instance = mounted.pop();
    if (instance) await unmount(instance);
  }
  activeLog = null;
  setNavControllerAdapter({
    navigate: () => {
      /* 测试间空适配器 */
    },
  });
  resetDashboardCanonical();
  resetSkillSearch();
  workspaceState.workspaces = [];
  dashboardCanonicalState.error = null;
  searchState.results = [];
  rpcClient = null;
});

function threeGroupLog(): RpcLog {
  const log = makeRpcLog();
  activeLog = log;
  installRpc(
    log,
    canonicalOutput([
      groupFixture("alpha", [{ id: SK_A, providerId: CLAUDE }]),
      groupFixture("beta", [
        { id: SK_B, providerId: CLAUDE },
        { id: SK_A2, providerId: ZCODE },
      ]),
      groupFixture("gamma", [{ id: SK_C, providerId: ZCODE }]),
    ]),
  );
  return log;
}

describe("SkillsDashboard TabsHeader chrome（批 1）", () => {
  it("renders the tablist with three ARIA tabs wired to their tabpanels", async () => {
    const log = threeGroupLog();
    const root = mountDashboard();
    await settle();

    const tablist = root.querySelector('[role="tablist"]');
    expect(tablist).not.toBeNull();
    const tabs = [...root.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    expect(tabs.map((tab) => tab.id)).toEqual(["tab-skills", "tab-agents", "tab-repos"]);
    expect(tabs.map((tab) => textOf(tab as HTMLElement))).toEqual([
      "Skills",
      "Agents",
      "Discover repos",
    ]);
    // tab ↔ tabpanel 双向 ARIA 关联。
    for (const tab of tabs) {
      const panel = root.querySelector(`#${tab.getAttribute("aria-controls")}`);
      expect(panel?.getAttribute("role")).toBe("tabpanel");
      expect(panel?.getAttribute("aria-labelledby")).toBe(tab.id);
    }
    // 缺省屏 = skills：仅它 selected + 可 Tab 聚焦（roving），其余面板退场。
    expect(tabs.map((tab) => tab.getAttribute("aria-selected"))).toEqual([
      "true",
      "false",
      "false",
    ]);
    expect(tabs.map((tab) => tab.getAttribute("tabindex"))).toEqual(["0", "-1", "-1"]);
    expect(root.querySelector<HTMLDivElement>("#panel-skills")?.hidden).toBe(false);
    expect(root.querySelector<HTMLDivElement>("#panel-agents")?.hidden).toBe(true);
    expect(root.querySelector<HTMLDivElement>("#panel-repos")?.hidden).toBe(true);
    expect(log.calls.some((call) => call.startsWith("skills.listCanonical:"))).toBe(true);
  });

  it("keeps ?tab= deep-link semantics (values unchanged, tab state follows)", async () => {
    threeGroupLog();
    const root = mountDashboard({ tab: "agents" });
    await settle();

    const agentsTab = root.querySelector<HTMLButtonElement>("#tab-agents");
    expect(agentsTab?.getAttribute("aria-selected")).toBe("true");
    expect(agentsTab?.getAttribute("tabindex")).toBe("0");
    expect(root.querySelector<HTMLDivElement>("#panel-agents")?.hidden).toBe(false);
    expect(root.querySelector<HTMLDivElement>("#panel-skills")?.hidden).toBe(true);
  });

  it("writes the tab param on tab click; skills drops the param (default)", async () => {
    const log = makeRpcLog();
    activeLog = log;
    installRpc(log, canonicalOutput([groupFixture("alpha", [{ id: SK_A, providerId: CLAUDE }])]));
    const root = mountDashboard({ tab: "repos" });
    await settle();

    click(root.querySelector<HTMLButtonElement>("#tab-skills"));
    expect(log.navigate).toHaveLength(1);
    const url = new URL(log.navigate[0] as string, "https://skill-creator.invalid");
    expect(url.pathname).toBe("/w/~/skills");
    expect(url.searchParams.has("tab")).toBe(false);

    const root2 = mountDashboard();
    await settle();
    click(root2.querySelector<HTMLButtonElement>("#tab-repos"));
    const reposUrl = new URL(log.navigate.at(-1) as string, "https://skill-creator.invalid");
    expect(reposUrl.searchParams.get("tab")).toBe("repos");
  });

  it("roves focus and activates with ArrowRight/End/Home (tabindex follows selection)", async () => {
    const log = makeRpcLog();
    activeLog = log;
    installRpc(log, canonicalOutput([groupFixture("alpha", [{ id: SK_A, providerId: CLAUDE }])]));
    const root = mountDashboard();
    await settle();

    const tablist = root.querySelector<HTMLDivElement>('[role="tablist"]');
    const tabSkills = root.querySelector<HTMLButtonElement>("#tab-skills");
    const tabAgents = root.querySelector<HTMLButtonElement>("#tab-agents");
    const tabRepos = root.querySelector<HTMLButtonElement>("#tab-repos");
    tabSkills?.focus();
    expect(document.activeElement).toBe(tabSkills);

    // →：自动激活 agents + 焦点随移。
    tablist?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(document.activeElement).toBe(tabAgents);
    expect(
      new URL(log.navigate.at(-1) as string, "https://x.invalid").searchParams.get("tab"),
    ).toBe("agents");

    // End：直达 repos。
    tablist?.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    expect(document.activeElement).toBe(tabRepos);
    expect(
      new URL(log.navigate.at(-1) as string, "https://x.invalid").searchParams.get("tab"),
    ).toBe("repos");

    // Home：回 skills（当前激活屏）——不重复导航（同屏激活无 URL 写入），焦点仍随移。
    const navigationsBeforeHome = log.navigate.length;
    tablist?.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    expect(document.activeElement).toBe(tabSkills);
    expect(log.navigate).toHaveLength(navigationsBeforeHome);
  });

  it("renders no pagehead layer above the tabs (2026-10-09 Owner ruling)", async () => {
    // 「Global Workspace N skills · N providers」独立层去除：workspace 身份在
    // 侧栏，计数由各屏自身 header 承载——dashboard 首元素必须是 tablist。
    threeGroupLog();
    const root = mountDashboard();
    await settle();
    expect(root.querySelector('[data-testid="dashboard-stats"]')).toBeNull();
    expect(root.querySelector(".dashboard-pagehead")).toBeNull();
    const shell = root.querySelector(".dashboard-shell");
    expect(shell?.firstElementChild?.classList.contains("dashboard-tabs")).toBe(true);
  });

  it("keeps all three panels mounted so tab switching is instant (no remount)", async () => {
    threeGroupLog();
    const root = mountDashboard({ tab: "agents" });
    await settle();

    // 三 panel 常驻挂载（hidden 切换）：skills 行数据面不因切 Tab 重挂。
    expect(root.querySelector('[data-screen="skills"]')).not.toBeNull();
    expect(root.querySelector('[data-screen="agents"]')).not.toBeNull();
    expect(root.querySelector('[data-screen="repos"]')).not.toBeNull();
    expect(root.querySelector(`button[data-skill-id="${SK_A}"]`)).not.toBeNull();
  });
});

describe("Skills panel 数据面（Δ1 唯一 name 行）", () => {
  it("renders one row per canonical group with representative provider badge and chips", async () => {
    const log = makeRpcLog();
    activeLog = log;
    installRpc(
      log,
      canonicalOutput([
        groupFixture("alpha", [{ id: SK_A, providerId: CLAUDE }]),
        groupFixture("beta", [
          { id: SK_B, providerId: CLAUDE },
          { id: SK_A2, providerId: ZCODE },
        ]),
        groupFixture("gamma", [{ id: SK_C, providerId: ZCODE }]),
      ]),
    );
    const root = mountDashboard();
    await settle();

    expect(log.calls.some((call) => call.startsWith("skills.listCanonical:"))).toBe(true);

    // 唯一 name 行：3 组（beta 两副本只渲染一行），行身份 = 组代表 skill id。
    const rows = [...root.querySelectorAll<HTMLButtonElement>("button[data-group-name]")];
    expect(rows.map((row) => row.getAttribute("data-group-name"))).toEqual([
      "alpha",
      "beta",
      "gamma",
    ]);
    const rowBeta = root.querySelector<HTMLButtonElement>(`button[data-skill-id="${SK_B}"]`);
    expect(rowBeta).not.toBeNull();
    expect(textOf(rowBeta as HTMLElement)).toContain("beta");
    // 组代表 provider 角标（beta 代表 = claude-code，enabled 优先平局按 providerId）。
    expect(textOf(rowBeta as HTMLElement)).toContain("claude-code");

    // provider chips：代表口径 facet（alpha+beta 代表 claude-code=2、gamma zcode=1）。
    const chips = [...root.querySelectorAll('[aria-label="Filter by provider"] button')];
    expect(chips.map((chip) => textOf(chip as HTMLElement))).toEqual(
      expect.arrayContaining(["All", "Claude Code 2", "ZCode 1"]),
    );
  });

  it("shows the ×N copies badge and the two-dimension header count", async () => {
    const log = makeRpcLog();
    activeLog = log;
    installRpc(
      log,
      canonicalOutput([
        groupFixture("alpha", [{ id: SK_A, providerId: CLAUDE }]),
        groupFixture("beta", [
          { id: SK_B, providerId: CLAUDE },
          { id: SK_A2, providerId: ZCODE },
          {
            id: SkillIdSchema.parse(`sk_${"e".repeat(24)}`),
            providerId: ZCODE,
            contentHash: `${"f".repeat(64)}`,
          },
        ]),
      ]),
    );
    const root = mountDashboard();
    await settle();

    // ×N 副本徽标：beta 3 副本显 ×3；alpha 单副本无徽标。
    const badges = [...root.querySelectorAll<HTMLElement>('[data-testid="copies-badge"]')];
    expect(badges).toHaveLength(1);
    expect(textOf(badges[0] as HTMLElement)).toContain("×3");
    expect(badges[0]?.getAttribute("aria-label")?.replace(/\s+/g, " ").startsWith("3 copies")).toBe(
      true,
    );
    const rowAlpha = root.querySelector<HTMLButtonElement>(`button[data-skill-id="${SK_A}"]`);
    expect(rowAlpha?.querySelector('[data-testid="copies-badge"]')).toBeNull();

    // 两量纲 header：2 技能组 · 4 安装副本（禁止单数字推导）。
    const headerCount = textOf(
      root.querySelector('[data-screen="skills"] header > div > span') as HTMLElement,
    );
    expect(headerCount).toBe("2 skill groups · 4 installations");
  });

  it("keeps an all-unavailable group visible and greyed (never hidden)", async () => {
    const log = makeRpcLog();
    activeLog = log;
    installRpc(
      log,
      canonicalOutput([
        groupFixture("ghost", [
          { id: SK_A, providerId: CLAUDE, unavailable: true },
          { id: SK_B, providerId: ZCODE, unavailable: true },
        ]),
      ]),
    );
    const root = mountDashboard();
    await settle();

    const row = root.querySelector<HTMLButtonElement>(`button[data-skill-id="${SK_A}"]`);
    expect(row).not.toBeNull();
    expect(row?.getAttribute("aria-disabled")).toBe("true");
    expect(row?.className).toContain("opacity-50");
    expect(textOf(root)).toContain("All copies unavailable");
  });

  it("navigates to the skillDetail route with ?from= snapshot on row click", async () => {
    const log = makeRpcLog();
    activeLog = log;
    installRpc(
      log,
      canonicalOutput([
        groupFixture("alpha", [{ id: SK_A, providerId: CLAUDE }]),
        groupFixture("gamma", [{ id: SK_C, providerId: ZCODE }]),
      ]),
    );
    const root = mountDashboard({ q: "alpha" });
    await settle();

    click(root.querySelector<HTMLButtonElement>(`button[data-skill-id="${SK_C}"]`));
    expect(log.navigate).toHaveLength(1);
    const url = new URL(log.navigate[0] as string, "https://skill-creator.invalid");
    // representative 三元组进路径（detail 永远绑定具体 provider copy）。
    expect(url.pathname).toBe(`/w/~/skills/zcode/${SK_C}`);
    // ?from= 携带列表态（q 是白名单键之一；无 provider 筛选时 p 键省略）。
    const from = url.searchParams.get("from");
    expect(from).not.toBeNull();
    const fromParams = new URLSearchParams(from!);
    expect(fromParams.get("q")).toBe("alpha");
    expect(fromParams.get("sel")).toBe(SK_C);
    expect(fromParams.has("p")).toBe(false);
  });

  it("restores provider chip activation and converges rows; from= carries the filter (p)", async () => {
    const log = makeRpcLog();
    activeLog = log;
    installRpc(
      log,
      canonicalOutput([
        groupFixture("alpha", [{ id: SK_A, providerId: CLAUDE }]),
        groupFixture("beta", [
          { id: SK_B, providerId: CLAUDE },
          { id: SK_A2, providerId: ZCODE },
        ]),
        groupFixture("gamma", [{ id: SK_C, providerId: ZCODE }]),
      ]),
    );

    // 行集收敛：provider 深链/回程 URL（search.provider）下仅组代表命中该
    // provider 的组可见（fuse2 returnProvider 语义的列表面）。
    const filtered = mountDashboard({ provider: "zcode" });
    await settle();
    const zcodeChip = [
      ...filtered.querySelectorAll<HTMLButtonElement>('[aria-label="Filter by provider"] button'),
    ].find((chip) => textOf(chip).startsWith("ZCode"));
    expect(zcodeChip).toBeDefined();
    expect(zcodeChip?.getAttribute("aria-pressed")).toBe("true");
    const allChip = [
      ...filtered.querySelectorAll<HTMLButtonElement>('[aria-label="Filter by provider"] button'),
    ].find((chip) => textOf(chip) === "All");
    expect(allChip?.getAttribute("aria-pressed")).toBe("false");
    expect(
      [...filtered.querySelectorAll("button[data-group-name]")].map((row) =>
        row.getAttribute("data-group-name"),
      ),
    ).toEqual(["gamma"]);

    // 带筛选进 detail：from= 的 p 键携带 provider（显式返回时还原同一 chip 激活态）。
    click(filtered.querySelector<HTMLButtonElement>(`button[data-skill-id="${SK_C}"]`));
    expect(log.navigate).toHaveLength(1);
    const url = new URL(log.navigate[0] as string, "https://skill-creator.invalid");
    const fromParams = new URLSearchParams(url.searchParams.get("from")!);
    expect(fromParams.get("p")).toBe("zcode");
  });

  it("drives duplicates-only and provider chip filters through URL search", async () => {
    const log = makeRpcLog();
    activeLog = log;
    installRpc(
      log,
      canonicalOutput([
        groupFixture("alpha", [{ id: SK_A, providerId: CLAUDE }]),
        groupFixture("beta", [
          { id: SK_B, providerId: CLAUDE, contentHash: `${"1".repeat(64)}` },
          { id: SK_A2, providerId: ZCODE, contentHash: `${"1".repeat(64)}` },
        ]),
        groupFixture("gamma", [{ id: SK_C, providerId: ZCODE }]),
      ]),
    );
    const root = mountDashboard();
    await settle();

    // FD-01 降级后的过滤下拉交互：header「Filter options」→「Same content only」
    // → URL ?duplicates=1；同内容 ≥2 副本的组保留（alpha 无重复内容被滤掉）。
    const filterButton = buttons(root).find((b) =>
      (b.getAttribute("aria-label") ?? "").includes("Filter options"),
    );
    expect(filterButton).toBeDefined();
    click(filterButton);
    await settle();
    const duplicatesToggle = [
      ...root.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]'),
    ].find((item) => textOf(item).toLowerCase().includes("same content"));
    expect(duplicatesToggle).toBeDefined();
    click(duplicatesToggle as HTMLElement);
    await settle();
    expect(log.navigate.at(-1)).toContain("duplicates=1");

    const root2 = mountDashboard({ duplicates: "1" });
    await settle();
    const visibleNames = [...root2.querySelectorAll("button[data-group-name]")].map((row) =>
      row.getAttribute("data-group-name"),
    );
    expect(visibleNames).toEqual(["beta"]);

    // provider chip 联动（代表口径）。
    const root3 = mountDashboard();
    await settle();
    const chip = [
      ...root3.querySelectorAll<HTMLButtonElement>('[aria-label="Filter by provider"] button'),
    ].find((b) => textOf(b).startsWith("ZCode"));
    click(chip as HTMLButtonElement);
    const url = new URL(log.navigate.at(-1) as string, "https://skill-creator.invalid");
    expect(url.searchParams.get("provider")).toBe("zcode");
  });

  it("appends the next cursor page via load-more (group rows, no rebuild)", async () => {
    const log = makeRpcLog();
    activeLog = log;
    installRpc(
      log,
      canonicalOutput([groupFixture("alpha", [{ id: SK_A, providerId: CLAUDE }])], {
        nextCursor: "cur-1",
      }),
      canonicalOutput([groupFixture("delta", [{ id: SK_C, providerId: ZCODE }])]),
    );
    const root = mountDashboard();
    await settle();

    expect(root.querySelector('[data-testid="load-more"]')).not.toBeNull();
    const before = [...root.querySelectorAll<HTMLButtonElement>("button[data-group-name]")];
    click(root.querySelector<HTMLButtonElement>('[data-testid="load-more"]'));
    await settle();

    const cursorCall = log.calls.find((entry) => entry.includes('"cursor":"cur-1"'));
    expect(cursorCall).toBeDefined();
    // keyed-by-name 增量 append：前序行节点原引用幸存。
    const after = [...root.querySelectorAll<HTMLButtonElement>("button[data-group-name]")];
    expect(after.map((node) => node.getAttribute("data-group-name"))).toEqual(["alpha", "delta"]);
    expect(after).toContain(before[0] as HTMLButtonElement);
  });

  it("keeps the web-mode smoke anchor verbatim in the Global footer", async () => {
    const log = makeRpcLog();
    activeLog = log;
    installRpc(log, canonicalOutput([groupFixture("alpha", [{ id: SK_A, providerId: CLAUDE }])]));
    const root = mountDashboard();
    await settle();

    const srOnly = root.querySelector("footer .sr-only");
    expect(srOnly).not.toBeNull();
    expect((srOnly as HTMLElement).textContent ?? "").toMatch(
      /^\d+ skills across \d+ agent locations\.$/,
    );
  });

  it("links the Agents-screen intelligence entry to the insights route", async () => {
    const log = makeRpcLog();
    activeLog = log;
    installRpc(log, canonicalOutput([groupFixture("alpha", [{ id: SK_A, providerId: CLAUDE }])]));
    const root = mountDashboard();
    await settle();

    const analysisBtn = buttons(root).find((b) => textOf(b).includes("Analysis"));
    expect(analysisBtn).toBeDefined();
    click(analysisBtn);
    // detail 面板的 Insights 入口随 master-detail 退役迁独立路由页（页级测试钉）。
    expect(log.navigate.at(-1)).toBe("/w/~/skills/insights/claude-code");
  });

  it("virtualizes long group lists (>200 rows render a window, not all rows)", async () => {
    const log = makeRpcLog();
    activeLog = log;
    const many = Array.from({ length: 250 }, (_, i) =>
      groupFixture(`skill-${String(i).padStart(3, "0")}`, [
        {
          id: SkillIdSchema.parse(`sk_${String(i).padStart(24, "0")}`),
          providerId: ProviderIdSchema.parse("claude-code"),
        },
      ]),
    );
    installRpc(log, canonicalOutput(many));
    const root = mountDashboard();
    await settle(60);

    const rendered = root.querySelectorAll("button[data-group-name]").length;
    expect(rendered).toBeGreaterThan(0);
    expect(rendered).toBeLessThan(250);
  });
});
