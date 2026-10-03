// @vitest-environment jsdom
/**
 * SkillsDashboard 组件级 DOM 断言（skills-dashboard 1.3/1.4/1.6/1.7）。
 * 用户原始需求 [2026-10-02]：「Skills 主屏 = 跨 provider 平铺 + master-detail；
 * Agents/Repos 并列 mobileScreen；WorkspacesHome 退役（冒烟锚点随迁 Global 页脚）。」
 * 正交意图：
 *   [1] 三屏网格渲染 + listWorkspace 数据驱动（行/provider chips 计数）。
 *   [2] master-detail 身份 = ?provider=&skill= 双参数导航（行点击）。
 *   [3] detail 零写纪律（运行时面）：除 skills.toggle 外零写 RPC、无
 *       creator 或 repository 域调用（与源扫描测试互为表里）。
 *   [4] 筛选 URL 面：duplicates-only / provider chip。
 *   [5] Global 页脚冒烟锚点 en 逐字（/skills across \d+ agent locations/）。
 *   [6] Intelligence 双入口同链（Agents screen 与 detail 面同 href）。
 * 妥协声明：jsdom 无布局——网格列数/容器查询回落由 skills-dashboard-css.test
 * 钉契约，真实布局归 1.10 ego-browser 走查门。
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

describe("SkillsDashboard 三屏网格", () => {
  it("renders all three mobileScreens with RPC-driven rows and provider chip counts", async () => {
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

    expect(root.querySelector('[data-screen="skills"]')).not.toBeNull();
    expect(root.querySelector('[data-screen="agents"]')).not.toBeNull();
    expect(root.querySelector('[data-screen="repos"]')).not.toBeNull();
    expect(log.calls.some((call) => call.startsWith("skills.listWorkspace:"))).toBe(true);

    // 平铺行：跨 provider + provider 归属角标。
    const rowA = root.querySelector<HTMLButtonElement>(`button[data-skill-id="${SK_A}"]`);
    expect(rowA).not.toBeNull();
    expect(textOf(rowA as HTMLElement)).toContain("alpha");
    expect(textOf(rowA as HTMLElement)).toContain("claude-code");

    // provider chips：All 3 + Claude Code 2 + ZCode 1。
    const chips = [...root.querySelectorAll('[aria-label="Filter by provider"] button')];
    expect(chips.map((chip) => textOf(chip as HTMLElement))).toEqual(
      expect.arrayContaining(["All 3", "Claude Code 2", "ZCode 1"]),
    );
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

    const dupToggle = buttons(root).find((b) => textOf(b) === "Duplicates");
    click(dupToggle);
    expect(log.navigate.at(-1)).toContain("duplicates=1");

    // chip 联动：以已带 duplicates=1 的 search 快照挂载（真实路由下 search 经
    // 导航回放；本 harness 是静态快照），点击 chip 后保留既有筛选并清详情身份。
    const root2 = mountDashboard({ duplicates: "1", skill: SK_A, provider: "claude-code" });
    await settle();
    const chip = [
      ...root2.querySelectorAll<HTMLButtonElement>('[aria-label="Filter by provider"] button'),
    ].find((b) => textOf(b).startsWith("ZCode"));
    click(chip as HTMLButtonElement);
    const url = new URL(log.navigate.at(-1) as string, "https://skill-creator.invalid");
    expect(url.searchParams.get("provider")).toBe("zcode");
    expect(url.searchParams.get("duplicates")).toBe("1");
    // chip 切换清掉跨 provider 的旧详情身份。
    expect(url.searchParams.get("skill")).toBeNull();
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

    // 入口一：Agents screen 的 per-provider View findings。
    const findings = buttons(root).find((b) => textOf(b).includes("View findings"));
    expect(findings).toBeDefined();
    click(findings);
    const agentsHref = log.navigate.at(-1);
    expect(agentsHref).toBe("/w/~/skills/intelligence/claude-code");

    // 入口二：skill 详情面的 Insights 按钮（同 provider 同链）。
    const root2 = mountDashboard({ provider: "claude-code", skill: SK_A });
    await settle(60);
    const insights = buttons(root2).find((b) =>
      (b.getAttribute("aria-label") ?? "").startsWith("Insights"),
    );
    expect(insights).toBeDefined();
    click(insights);
    expect(log.navigate.at(-1)).toBe(agentsHref);
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
