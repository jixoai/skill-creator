// @vitest-environment jsdom
/**
 * SkillsDashboard 组件级 DOM 断言（skills-dashboard 1.3/1.4/1.6/1.7 + 
 * skills-tabs-redesign 批 1）。
 * 用户原始需求 [2026-10-06]：「顶部 TabsHeader 三一等 Tabs（Skills / Agents /
 * Discover repos），每 Tab 独占整幅画布」；「?tab= 深链（批 1 修订：screen→tab
 * 直切，无别名）」；
 * 「页题行统计小字来自现有 store 真实数据」。
 * 正交意图：
 *   [1] TabsHeader chrome：tablist/tab/tabpanel ARIA + roving tabindex（←→/
 *       Home/End 自动激活）+ ?tab= 深链与 Tab 点击同源写 URL。
 *   [2] Skills panel 数据驱动（行/provider chips 计数；screen 组件内部不动）。
 *   [3] master-detail 身份 = ?provider=&skill= 双参数导航（行点击）。
 *   [4] detail 零写纪律（运行时面）：除 skills.toggle 外零写 RPC、无
 *       creator 或 repository 域调用（与源扫描测试互为表里）。
 *   [5] 筛选 URL 面：duplicates-only / provider chip。
 *   [6] Global 页脚冒烟锚点 en 逐字（/skills across \d+ agent locations/）。
 *   [7] Intelligence 双入口同链（Agents screen 与 detail 面同 href）。
 *   [8] 页题行统计小字：providers 摘要真实计数，缺席不渲染（不造假）。
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
import { dashboardSkillsState, resetDashboardSkills } from "$lib/stores/dashboard-skills.svelte";
import { workspaceState } from "$lib/stores/workspaces.svelte";
import {
  resetSkillDuplicates,
  resetSkillSearch,
  searchState,
  skillDuplicatesState,
} from "$lib/stores/skills.svelte";
import { clearUpdateReport } from "$lib/stores/skills-update.svelte";
import type { Workspace } from "$shared/contracts/workspaces.js";
import DashboardRouterHarness from "./dashboard-router-harness.svelte";

const SK_A = `sk_${"a".repeat(24)}`;
const SK_B = `sk_${"b".repeat(24)}`;
const SK_C = `sk_${"c".repeat(24)}`;

interface RpcLog {
  calls: string[];
  navigate: string[];
}

function makeRpcLog(): RpcLog {
  return { calls: [], navigate: [] };
}

function listWorkspaceOutput(
  rows: Array<{ id: string; providerId: string; name: string }>,
  nextCursor?: string,
): Record<string, unknown> {
  return {
    providers: [
      {
        providerId: "claude-code",
        label: "Claude Code",
        available: true,
        skillCount: rows.filter((r) => r.providerId === "claude-code").length,
      },
      {
        providerId: "zcode",
        label: "ZCode",
        available: true,
        skillCount: rows.filter((r) => r.providerId === "zcode").length,
      },
    ],
    skills: rows.map((row) => ({
      id: row.id,
      providerId: row.providerId,
      name: row.name,
      description: `${row.name} desc`,
      directoryName: row.name,
      disabled: false,
      provider: row.providerId,
      location: { workspaceId: "~", providerId: row.providerId },
      path: `/skills/${row.name}`,
      hasReferences: false,
      hasScripts: false,
    })),
    ...(nextCursor ? { nextCursor } : {}),
    duplicates: { groups: [], groupsTruncated: false },
  };
}

function installRpc(
  log: RpcLog,
  firstPage: Record<string, unknown>,
  secondPage?: Record<string, unknown>,
): void {
  let listWorkspaceCalls = 0;
  rpcClient = {
    skills: {
      listWorkspace: (input: Record<string, unknown>) => {
        log.calls.push(`skills.listWorkspace:${JSON.stringify(input)}`);
        listWorkspaceCalls += 1;
        return Promise.resolve(listWorkspaceCalls === 2 && secondPage ? secondPage : firstPage);
      },
      list: (input: Record<string, unknown>) => {
        log.calls.push(`skills.list:${input.providerId ?? ""}`);
        const rows = (firstPage as { skills: Array<{ id: string; providerId: string }> }).skills;
        return Promise.resolve({ skills: rows.map((row) => ({ ...row })) });
      },
      info: (input: Record<string, unknown>) => {
        log.calls.push(`skills.info:${input.skillId ?? ""}`);
        return Promise.resolve({
          id: input.skillId,
          name: "Skill A",
          description: "Skill A description",
          directoryName: "skill-a",
          disabled: false,
          provider: input.providerId,
          location: { workspaceId: "~", providerId: input.providerId },
          path: "/skills/skill-a",
          hasReferences: false,
          hasScripts: false,
          size: 128,
          content: "---\nname: Skill A\ndescription: Skill A description\n---\n\n# Body\n",
          revision: `sha256:${"0".repeat(64)}`,
        });
      },
      validate: (input: Record<string, unknown>) => {
        log.calls.push(`skills.validate:${input.skillId ?? ""}`);
        return Promise.resolve({ success: true, errors: [], warnings: [] });
      },
      toggle: (input: Record<string, unknown>) => {
        log.calls.push(`skills.toggle:${JSON.stringify(input)}`);
        const skillIds = input.skillIds as string[] | undefined;
        return Promise.resolve({
          results: [{ skillId: skillIds?.[0], name: "Skill A", status: "disabled" }],
        });
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
      update: {
        check: () => {
          log.calls.push("skills.update.check");
          return Promise.resolve({ results: [] });
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
    } as unknown as Workspace,
  ];
}

const mounted: ReturnType<typeof mount>[] = [];

function mountDashboard(search: Record<string, unknown> = {}, wsId = "~"): HTMLElement {
  const target = document.createElement("div");
  document.body.appendChild(target);
  const Harness = DashboardRouterHarness as unknown as Component;
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
  resetDashboardSkills();
  resetSkillSearch();
  resetSkillDuplicates();
  clearUpdateReport();
  workspaceState.workspaces = [];
  dashboardSkillsState.error = null;
  searchState.results = [];
  skillDuplicatesState.groups = [];
  rpcClient = null;
});

describe("SkillsDashboard TabsHeader chrome（批 1）", () => {
  function threeRows(): RpcLog {
    const log = makeRpcLog();
    activeLog = log;
    installRpc(
      log,
      listWorkspaceOutput([
        { id: SK_A, providerId: "claude-code", name: "alpha" },
        { id: SK_B, providerId: "claude-code", name: "beta" },
        { id: SK_C, providerId: "zcode", name: "gamma" },
      ]),
    );
    return log;
  }

  it("renders the tablist with three ARIA tabs wired to their tabpanels", async () => {
    const log = threeRows();
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
    expect(tabs.map((tab) => tab.getAttribute("aria-selected"))).toEqual(["true", "false", "false"]);
    expect(tabs.map((tab) => tab.getAttribute("tabindex"))).toEqual(["0", "-1", "-1"]);
    expect(root.querySelector<HTMLDivElement>("#panel-skills")?.hidden).toBe(false);
    expect(root.querySelector<HTMLDivElement>("#panel-agents")?.hidden).toBe(true);
    expect(root.querySelector<HTMLDivElement>("#panel-repos")?.hidden).toBe(true);
    expect(log.calls.some((call) => call.startsWith("skills.listWorkspace:"))).toBe(true);
  });

  it("keeps ?tab= deep-link semantics (values unchanged, tab state follows)", async () => {
    threeRows();
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
    installRpc(log, listWorkspaceOutput([{ id: SK_A, providerId: "claude-code", name: "alpha" }]));
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
    installRpc(log, listWorkspaceOutput([{ id: SK_A, providerId: "claude-code", name: "alpha" }]));
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
    expect(new URL(log.navigate.at(-1) as string, "https://x.invalid").searchParams.get("tab")).toBe(
      "agents",
    );

    // End：直达 repos。
    tablist?.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    expect(document.activeElement).toBe(tabRepos);
    expect(new URL(log.navigate.at(-1) as string, "https://x.invalid").searchParams.get("tab")).toBe(
      "repos",
    );

    // Home：回 skills（当前激活屏）——不重复导航（同屏激活无 URL 写入），焦点仍随移。
    const navigationsBeforeHome = log.navigate.length;
    tablist?.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    expect(document.activeElement).toBe(tabSkills);
    expect(log.navigate).toHaveLength(navigationsBeforeHome);
  });

  it("shows pagehead stats from the providers summary and hides them without data", async () => {
    threeRows();
    const root = mountDashboard();
    await settle();

    // providers 摘要：claude-code 2 + zcode 1 → 真实计数小字。
    const statsEl = root.querySelector('[data-testid="dashboard-stats"]');
    expect(statsEl).not.toBeNull();
    expect(textOf(statsEl as HTMLElement)).toBe("3 skills · 2 providers");

    // 数据缺席（providers 摘要为空）不渲染数字（不造假）。
    const emptyOutput = listWorkspaceOutput([{ id: SK_A, providerId: "claude-code", name: "alpha" }]);
    (emptyOutput as { providers: unknown[] }).providers = [];
    const emptyLog = makeRpcLog();
    activeLog = emptyLog;
    installRpc(emptyLog, emptyOutput);
    const emptyRoot = mountDashboard();
    await settle();
    expect(emptyRoot.querySelector('[data-testid="dashboard-stats"]')).toBeNull();
  });

  it("keeps all three panels mounted so tab switching is instant (no remount)", async () => {
    threeRows();
    const root = mountDashboard({ tab: "agents" });
    await settle();

    // 三 panel 常驻挂载（hidden 切换）：skills 行数据面不因切 Tab 重挂。
    expect(root.querySelector('[data-screen="skills"]')).not.toBeNull();
    expect(root.querySelector('[data-screen="agents"]')).not.toBeNull();
    expect(root.querySelector('[data-screen="repos"]')).not.toBeNull();
    expect(root.querySelector(`button[data-skill-id="${SK_A}"]`)).not.toBeNull();
  });
});

describe("Skills panel 数据面", () => {
  it("renders RPC-driven rows and provider chip counts inside the skills panel", async () => {
    const log = makeRpcLog();
    activeLog = log;
    installRpc(
      log,
      listWorkspaceOutput([
        { id: SK_A, providerId: "claude-code", name: "alpha" },
        { id: SK_B, providerId: "claude-code", name: "beta" },
        { id: SK_C, providerId: "zcode", name: "gamma" },
      ]),
    );
    const root = mountDashboard();
    await settle();

    expect(log.calls.some((call) => call.startsWith("skills.listWorkspace:"))).toBe(true);

    // 平铺行：跨 provider + provider 归属角标。
    const rowA = root.querySelector<HTMLButtonElement>(`button[data-skill-id="${SK_A}"]`);
    expect(rowA).not.toBeNull();
    expect(textOf(rowA as HTMLElement)).toContain("alpha");
    expect(textOf(rowA as HTMLElement)).toContain("claude-code");

    // provider chips：All（ε 线收敛：不带已载行数——与 header 窗口数字冗余）
    // + Claude Code 2 + ZCode 1（per-provider facet 计数保留）。
    const chips = [...root.querySelectorAll('[aria-label="Filter by provider"] button')];
    expect(chips.map((chip) => textOf(chip as HTMLElement))).toEqual(
      expect.arrayContaining(["All", "Claude Code 2", "ZCode 1"]),
    );
  });

  it("converges the header count on the workspace total (window form only when fewer visible)", async () => {
    // ε 线计数收敛（2026-10-05「少即是多」）：header 主显 providers 摘要聚合的
    // workspace 总量（q/分页无关）；可见行数 < 总量（分页/筛选窗口）才以
    // 「Showing N of M」窗口式表达；相等时总量单显（单复数由 key 承担）。
    const log = makeRpcLog();
    activeLog = log;
    installRpc(
      log,
      listWorkspaceOutput([
        { id: SK_A, providerId: "claude-code", name: "alpha" },
        { id: SK_B, providerId: "claude-code", name: "beta" },
        { id: SK_C, providerId: "zcode", name: "gamma" },
      ]),
    );
    const root = mountDashboard();
    await settle();

    // header 计数 = 标题行 Badge（chips 的计数 span 嵌套在 button 内，不在此选择器）。
    const headerCountOf = (scope: HTMLElement) =>
      textOf(scope.querySelector('[data-screen="skills"] header > div > span') as HTMLElement);
    // providers 摘要 2 + 1 = 3，可见 3：总量单显（复数）。
    expect(headerCountOf(root)).toBe("3 skills");

    // 单技能 workspace：单数 key（"1 skill"，不落 "1 skills" 语法缺陷）。
    const one = makeRpcLog();
    activeLog = one;
    installRpc(one, listWorkspaceOutput([{ id: SK_A, providerId: "claude-code", name: "alpha" }]));
    const rootOne = mountDashboard();
    await settle();
    expect(headerCountOf(rootOne)).toBe("1 skill");

    // 分页窗口：providers 总量（2+3=5）> 已载 1 行 → 窗口式表达。
    const windowed = listWorkspaceOutput(
      [{ id: SK_A, providerId: "claude-code", name: "alpha" }],
      "cur-1",
    );
    const windowProviders = windowed.providers as Array<{ skillCount: number }>;
    windowProviders[0]!.skillCount = 2;
    windowProviders[1]!.skillCount = 3;
    const paged = makeRpcLog();
    activeLog = paged;
    installRpc(paged, windowed);
    const rootPaged = mountDashboard();
    await settle();
    expect(headerCountOf(rootPaged)).toBe("Showing 1 of 5 skills");
  });

  it("navigates master-detail identity ?provider=&skill= on row click (dual params)", async () => {
    const log = makeRpcLog();
    activeLog = log;
    installRpc(
      log,
      listWorkspaceOutput([
        { id: SK_A, providerId: "claude-code", name: "alpha" },
        { id: SK_C, providerId: "zcode", name: "gamma" },
      ]),
    );
    const root = mountDashboard();
    await settle();

    click(root.querySelector<HTMLButtonElement>(`button[data-skill-id="${SK_C}"]`));
    expect(log.navigate).toHaveLength(1);
    const url = new URL(log.navigate[0] as string, "https://skill-creator.invalid");
    expect(url.pathname).toBe("/w/~/skills");
    expect(url.searchParams.get("provider")).toBe("zcode");
    expect(url.searchParams.get("skill")).toBe(SK_C);
    expect(url.searchParams.get("view")).toBe("detail");
  });

  it("renders detail from ?provider+skill with zero write RPCs until toggle", async () => {
    const log = makeRpcLog();
    activeLog = log;
    installRpc(log, listWorkspaceOutput([{ id: SK_A, providerId: "claude-code", name: "alpha" }]));
    const root = mountDashboard({ provider: "claude-code", skill: SK_A, view: "detail" });
    await settle(60);

    // detail 数据面：skills.info（+ detail 面挂载触发的 skills.list）。
    expect(log.calls.some((call) => call.startsWith("skills.info:"))).toBe(true);
    // 零写纪律（运行时）：无 creator.*、无 repository 写面（repos screen 的
    // sources.list 只读拉取允许）、无 skills.toggle。
    const forbidden = log.calls.filter(
      (call) =>
        call.startsWith("creator.") ||
        /^repository\.(scan|preview|install)/.test(call) ||
        call.startsWith("repository.sources.add") ||
        call.startsWith("repository.sources.remove") ||
        call.startsWith("skills.toggle"),
    );
    expect(forbidden).toEqual([]);
    // detail 只读渲染：frontmatter + 正文。
    expect(textOf(root)).toContain("Skill A");

    // Toggle = skills 域唯一写 RPC（design §2 归属清单）。
    const toggle = buttons(root).find((b) => textOf(b) === "Disable");
    expect(toggle).toBeDefined();
    click(toggle);
    await settle();
    expect(log.calls.some((call) => call.startsWith("skills.toggle:"))).toBe(true);
    // Validate 只读面。
    const validate = buttons(root).find((b) => textOf(b) === "Validate");
    click(validate);
    await settle();
    expect(log.calls.some((call) => call.startsWith("skills.validate:"))).toBe(true);
    // 仍然零 creator / repository 写面。
    expect(
      log.calls.filter(
        (call) => call.startsWith("creator.") || /^repository\.(scan|preview|install)/.test(call),
      ),
    ).toEqual([]);
  });

  it("drives duplicates-only and provider chip filters through URL search", async () => {
    const log = makeRpcLog();
    activeLog = log;
    installRpc(
      log,
      listWorkspaceOutput([
        { id: SK_A, providerId: "claude-code", name: "alpha" },
        { id: SK_C, providerId: "zcode", name: "gamma" },
      ]),
    );
    const root = mountDashboard();
    await settle();

    // FD-01 降级后的过滤下拉交互：header「Filter options」按钮 → menuitemcheckbox
    // 「Same content only」→ URL ?duplicates=1（REPLACE 导航也经 adapter 记录）。
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

    // chip 联动测试保留（provider 筛选不受 duplicates 降级影响）。
    const root2 = mountDashboard({ skill: SK_A, provider: "claude-code" });
    await settle();
    const chip = [
      ...root2.querySelectorAll<HTMLButtonElement>('[aria-label="Filter by provider"] button'),
    ].find((b) => textOf(b).startsWith("ZCode"));
    click(chip as HTMLButtonElement);
    const url = new URL(log.navigate.at(-1) as string, "https://skill-creator.invalid");
    expect(url.searchParams.get("provider")).toBe("zcode");
    // chip 切换清掉跨 provider 的旧详情身份。
    expect(url.searchParams.get("skill")).toBeNull();
  });

  it("clears detail identity (?view/skill) when an Agents card is clicked from detail state", async () => {
    const log = makeRpcLog();
    activeLog = log;
    installRpc(log, listWorkspaceOutput([{ id: SK_A, providerId: "claude-code", name: "alpha" }]));
    // detail 态（?provider&skill&view=detail）下点 Agents 卡片（走查 14-fix）：
    // 切 provider 过滤 = 回主屏列表态——不得残留无身份 ?view=detail。
    const root = mountDashboard({ provider: "claude-code", skill: SK_A, view: "detail" });
    await settle();

    const card = [
      ...root.querySelectorAll<HTMLButtonElement>('[data-screen="agents"] button[aria-pressed]'),
    ].find((button) => textOf(button).includes("ZCode"));
    expect(card).toBeDefined();
    click(card);
    expect(log.navigate).toHaveLength(1);
    const url = new URL(log.navigate[0] as string, "https://skill-creator.invalid");
    expect(url.pathname).toBe("/w/~/skills");
    expect(url.searchParams.get("provider")).toBe("zcode");
    expect(url.searchParams.get("skill")).toBeNull();
    expect(url.searchParams.get("view")).toBeNull();
  });

  it("appends the next cursor page via load-more", async () => {
    const log = makeRpcLog();
    activeLog = log;
    installRpc(
      log,
      listWorkspaceOutput([{ id: SK_A, providerId: "claude-code", name: "alpha" }], "cur-1"),
      listWorkspaceOutput([{ id: SK_B, providerId: "claude-code", name: "beta" }]),
    );
    const root = mountDashboard();
    await settle();

    expect(root.querySelector('[data-testid="load-more"]')).not.toBeNull();
    click(root.querySelector<HTMLButtonElement>('[data-testid="load-more"]'));
    await settle();

    const cursorCall = log.calls.find((call) => call.includes('"cursor":"cur-1"'));
    expect(cursorCall).toBeDefined();
    expect(root.querySelector(`button[data-skill-id="${SK_B}"]`)).not.toBeNull();
  });

  // ---- loadMore 抖动修复（workspace-page-polish θ4）----
  // Owner 观察：加载更多时列表抖动、滚动归零（怀疑清空重加）。store 层已是
  // 增量追加（[...rows, ...incoming] + 同键去重）——根因在渲染层，两处：
  // (a) 虚拟化启用判定 `visibleRows.length > 200` 在 200→201 追加瞬间切换渲染
  //     模式，整列 DOM 换成 spacer + 窗口（可视行被销毁 = 抖动 + 滚动跳变）；
  // (b) 行自然高 59-75px 不等而常量 57（spacer 位移错位）。修复 = 启用判定
  //     锚定 rows（>= 阈值 == 首页 limit，满页首页初始提交即启用，追加永不
  //     跨档）+ 行高统一 75px。以下两测试用元素引用相等钉死增量语义。

  it("reuses preceding row nodes on load-more append (element identity, no rebuild)", async () => {
    const log = makeRpcLog();
    activeLog = log;
    installRpc(
      log,
      listWorkspaceOutput(
        [
          { id: SK_A, providerId: "claude-code", name: "alpha" },
          { id: SK_B, providerId: "claude-code", name: "beta" },
          { id: SK_C, providerId: "zcode", name: "gamma" },
        ],
        "cur-1",
      ),
      listWorkspaceOutput([{ id: `sk_${"d".repeat(24)}`, providerId: "zcode", name: "delta" }]),
    );
    const root = mountDashboard();
    await settle();

    const listEl = root.querySelector<HTMLElement>('[data-testid="skills-list"]');
    expect(listEl).not.toBeNull();
    const before = [...root.querySelectorAll<HTMLButtonElement>("button[data-skill-id]")];
    expect(before).toHaveLength(3);

    click(root.querySelector<HTMLButtonElement>('[data-testid="load-more"]'));
    await settle();

    // 滚动容器不被替换（容器换节点 = 滚动归零的经典来源）。
    expect(root.querySelector('[data-testid="skills-list"]')).toBe(listEl);
    // 前序行节点原引用仍在 DOM（keyed each 增量 appendChild，非清空重建）。
    const after = [...root.querySelectorAll<HTMLButtonElement>("button[data-skill-id]")];
    for (const node of before) {
      expect(node.isConnected).toBe(true);
      expect(after).toContain(node);
    }
    // 追加行按「provider 分组 + name localeCompare」既有行序插入（delta 排在
    // gamma 前）——keyed each 单节点插入，既有行文档序与节点引用均不动。
    expect(after.map((node) => node.getAttribute("data-skill-id"))).toEqual([
      SK_A,
      SK_B,
      `sk_${"d".repeat(24)}`,
      SK_C,
    ]);
  });

  it("engages windowing at the full first page so append never crosses the threshold", async () => {
    const page1Rows = Array.from({ length: 200 }, (_, i) => ({
      id: `sk_${String(i).padStart(24, "0")}`,
      providerId: "claude-code",
      name: `skill-${i}`,
    }));
    const page2Rows = Array.from({ length: 50 }, (_, i) => ({
      id: `sk_${String(200 + i).padStart(24, "0")}`,
      providerId: "claude-code",
      name: `skill-${200 + i}`,
    }));
    const log = makeRpcLog();
    activeLog = log;
    installRpc(log, listWorkspaceOutput(page1Rows, "cur-1"), listWorkspaceOutput(page2Rows));
    const root = mountDashboard();
    await settle(60);

    // 满页首页（存在 nextCursor ⇒ 200 行）初始提交即窗口化——追加前已定型，
    // 不存在 200→201 的模式切换点。
    const firstWindow = [...root.querySelectorAll<HTMLButtonElement>("button[data-skill-id]")];
    expect(firstWindow.length).toBeGreaterThan(0);
    expect(firstWindow.length).toBeLessThan(200);

    click(root.querySelector<HTMLButtonElement>('[data-testid="load-more"]'));
    await settle(60);

    // 追加后窗口起点不动（scrollTop 未变）：首窗行节点原引用全部幸存（无重建）。
    const afterAppend = [...root.querySelectorAll<HTMLButtonElement>("button[data-skill-id]")];
    for (const node of firstWindow) {
      expect(node.isConnected).toBe(true);
      expect(afterAppend).toContain(node);
    }
    // 滚到列表底部（jsdom scrollTop 赋值 + scroll 事件驱动窗口滑动）：追加的
    // 尾行进入窗口（续页可达，非只渲染首页窗口）。
    const listEl = root.querySelector<HTMLElement>('[data-testid="skills-list"]');
    expect(listEl).not.toBeNull();
    // 滚到列表底部（250 行 × 75px；jsdom scrollTop 赋值 + scroll 事件驱动窗口
    // 滑动）：追加的尾行进入窗口（续页可达，非只渲染首页窗口）。
    listEl!.scrollTop = 250 * 75;
    listEl!.dispatchEvent(new Event("scroll"));
    await settle();
    expect(
      root.querySelector(`button[data-skill-id="sk_${String(249).padStart(24, "0")}"]`),
    ).not.toBeNull();
  });

  it("keeps the web-mode smoke anchor verbatim in the Global footer", async () => {
    const log = makeRpcLog();
    activeLog = log;
    installRpc(log, listWorkspaceOutput([{ id: SK_A, providerId: "claude-code", name: "alpha" }]));
    const root = mountDashboard();
    await settle();

    const srOnly = root.querySelector("footer .sr-only");
    expect(srOnly).not.toBeNull();
    expect((srOnly as HTMLElement).textContent ?? "").toMatch(
      /^\d+ skills across \d+ agent locations\.$/,
    );
  });

  it("links both intelligence entries to the identical route (dual-entry same link)", async () => {
    const log = makeRpcLog();
    activeLog = log;
    installRpc(log, listWorkspaceOutput([{ id: SK_A, providerId: "claude-code", name: "alpha" }]));
    const root = mountDashboard();
    await settle();

    // 入口一：Agents screen 的 per-provider「Analysis & proposals」（FD-09 改名）。
    const analysisBtn = buttons(root).find((b) => textOf(b).includes("Analysis"));
    expect(analysisBtn).toBeDefined();
    click(analysisBtn);
    const agentsHref = log.navigate.at(-1);
    expect(agentsHref).toBe("/w/~/skills/insights/claude-code");

    // 入口二：skill 详情面的 Insights 按钮（同 route；I4 起 detail 入口携带
    // ?skill= 上下文预过滤——同路由不同 search 是设计行为，断言 pathname 一致）。
    const root2 = mountDashboard({ provider: "claude-code", skill: SK_A });
    await settle(60);
    const insights = buttons(root2).find((b) =>
      (b.getAttribute("aria-label") ?? "").startsWith("Insights"),
    );
    expect(insights).toBeDefined();
    click(insights);
    const detailNavigate = log.navigate.at(-1) as string;
    expect(new URL(detailNavigate, "https://x.invalid").pathname).toBe(
      new URL(agentsHref as string, "https://x.invalid").pathname,
    );
    expect(detailNavigate).toContain("skill=");
  });

  it("virtualizes long lists (>200 rows render a window, not all rows)", async () => {
    const log = makeRpcLog();
    activeLog = log;
    const many = Array.from({ length: 250 }, (_, i) => ({
      id: `sk_${String(i).padStart(24, "0")}`,
      providerId: "claude-code",
      name: `skill-${i}`,
    }));
    installRpc(log, listWorkspaceOutput(many));
    const root = mountDashboard();
    await settle(60);

    const rendered = root.querySelectorAll("button[data-skill-id^='sk_']").length;
    expect(rendered).toBeGreaterThan(0);
    expect(rendered).toBeLessThan(250);
  });
});

describe("窄屏栈切换 DOM 契约（修复批 2：450px 盲区）", () => {
  // jsdom 无布局/容器查询——钉死机制契约：窄屏 display:none 的生效路径 =
  // pane 上的隐藏类 + .skills-master-detail 自身的 inline-size 容器。
  // （类落在 wrapper 上时，无名 @container 上溯 .dashboard-shell 解析条件，
  // 整个 master-detail——行、空态、详情——被藏掉 = 走查 450px 空白盲区。）
  it("list mode hides the detail pane only — rows and the empty state stay reachable", async () => {
    const log = makeRpcLog();
    activeLog = log;
    installRpc(log, listWorkspaceOutput([{ id: SK_A, providerId: "claude-code", name: "alpha" }]));
    const root = mountDashboard();
    await settle();

    const wrapper = root.querySelector<HTMLElement>(".skills-master-detail");
    const listPane = root.querySelector<HTMLElement>(".skills-list-pane");
    const detailPane = root.querySelector<HTMLElement>(".skills-detail-pane");
    expect(wrapper).not.toBeNull();
    expect(listPane).not.toBeNull();
    expect(detailPane).not.toBeNull();
    expect(wrapper?.classList.contains("list-hidden")).toBe(false);
    expect(wrapper?.classList.contains("detail-hidden")).toBe(false);
    expect(listPane?.classList.contains("list-hidden")).toBe(false);
    expect(detailPane?.classList.contains("detail-hidden")).toBe(true);
  });

  it("detail mode with a valid identity flips list-hidden onto the list pane", async () => {
    const log = makeRpcLog();
    activeLog = log;
    installRpc(log, listWorkspaceOutput([{ id: SK_A, providerId: "claude-code", name: "alpha" }]));
    const root = mountDashboard({ provider: "claude-code", skill: SK_A, view: "detail" });
    await settle(60);

    expect(
      root.querySelector<HTMLElement>(".skills-list-pane")?.classList.contains("list-hidden"),
    ).toBe(true);
    expect(
      root.querySelector<HTMLElement>(".skills-detail-pane")?.classList.contains("detail-hidden"),
    ).toBe(false);
  });

  it("stale ?view=detail without identity falls back to the list pane (never both hidden)", async () => {
    const log = makeRpcLog();
    activeLog = log;
    installRpc(log, listWorkspaceOutput([{ id: SK_A, providerId: "claude-code", name: "alpha" }]));
    const root = mountDashboard({ view: "detail" });
    await settle();

    // 无身份残留 view=detail：落回列表态——窄屏两 pane 全隐 = 空白盲区。
    expect(
      root.querySelector<HTMLElement>(".skills-list-pane")?.classList.contains("list-hidden"),
    ).toBe(false);
    expect(
      root.querySelector<HTMLElement>(".skills-detail-pane")?.classList.contains("detail-hidden"),
    ).toBe(true);
  });
});

describe("skill-detail 头部栈式布局契约（修复批 2 P1-1：文本柱塌缩）", () => {
  it("stacks the full-width title block above an independent actions row", async () => {
    const log = makeRpcLog();
    activeLog = log;
    installRpc(log, listWorkspaceOutput([{ id: SK_A, providerId: "claude-code", name: "alpha" }]));
    // Imported workspace：editable=true——Edit in Creator 按钮在场（最长动作项，
    // 同级行布局下正是它把 flex-1 文本柱挤成 60-90px 细柱的元凶）。
    const root = mountDashboard(
      { provider: "claude-code", skill: SK_A, view: "detail" },
      `ws_${"b".repeat(24)}`,
    );
    await settle(60);

    const heading = root.querySelector<HTMLHeadingElement>(".skills-detail-pane header h2");
    expect(heading?.textContent).toBe("Skill A");
    // 全名截断兜底：title 属性携带完整名称。
    expect(heading?.getAttribute("title")).toBe("Skill A");
    // 标题块（h2 的父容器）内没有任何动作按钮——文本块不再与按钮同行争宽。
    const titleBlock = heading?.parentElement ?? null;
    expect(titleBlock?.querySelector("button")).toBeNull();
    // 动作行 = 标题行的下一兄弟节点（独立行，含全部管理动作）。
    const actionsRow = titleBlock?.parentElement?.nextElementSibling ?? null;
    const actionTexts = [...(actionsRow?.querySelectorAll("button") ?? [])].map((button) =>
      textOf(button as HTMLElement),
    );
    expect(actionTexts).toEqual(expect.arrayContaining(["Edit in Creator", "Validate", "Disable"]));
  });
});
