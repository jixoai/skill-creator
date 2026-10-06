// @vitest-environment jsdom
/**
 * SkillsDashboard 冷直载深链 DOM 测试（走查 15-fix 诊断 repro）。
 * 用户原始需求 [2026-10-03]（ego-browser 走查 23 项之 15）：
 * 「带 ?provider&skill&view=detail 的 URL 直接打开（冷载）100% 白屏；
 * 同 URL 应用内导航正常。疑似 hydration/首帧竞态（leaf 懒加载 vs search
 * 解析时序）。」
 * 正交意图：
 *   [1] 全真链路冷载 repro：kit-fake page（冷深链 URL）→ 真实 PageOutlet →
 *       真实 AppShell（leaf 懒加载 + router 上下文 + search 解析）→ 真实
 *       workspaces manifest → 真实 SkillsDashboard（master-detail detail 态）。
 *   [2] +layout boot 链路复刻（initializeTabSession matched → 零重定向）。
 *   [3] 批 1（skills-tabs-redesign）：?tab= 冷载深链 = Tab 直接选中
 *       （tablist ARIA + panel hidden 同源）。
 * 仿真边界：与 skills-dashboard.dom.test.ts 同一 mock 集（connection/rpc/ui
 * 原语/dialog/banner/agent store），$app/navigation 换 kit-fake goto（tab-session
 * 需要可完成的真实导航语义）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("$app/state", async () => {
  const kit = await import("$lib/shell/__tests__/kit-fake.svelte.js");
  return { page: kit.mockPage };
});
vi.mock("$app/navigation", async () => {
  const kit = await import("$lib/shell/__tests__/kit-fake.svelte.js");
  return {
    goto: (path: string, options?: { replace?: boolean }) => kit.mockGoto(path, options),
    beforeNavigate: (callback: Parameters<typeof kit.mockBeforeNavigate>[0]) =>
      kit.mockBeforeNavigate(callback),
  };
});

vi.mock("$lib/stores/agent.svelte", () => ({
  startAgentAction: vi.fn(),
}));

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

// 真实 manifest 注册（appRegistry/routeRegistry：PageOutlet→AppShell→matchTree）。
import "$lib/apps/workspaces/manifest.js";
import { flushSync, mount, unmount } from "$lib/__tests__/svelte-client";
import type { Component } from "svelte";
import PageOutlet from "$lib/shell/PageOutlet.svelte";
import { resetKitFake } from "$lib/shell/__tests__/kit-fake.svelte.js";
import {
  consumeExpectedNavigation,
  initializeTabSession,
  navigateTab,
} from "$lib/shell/tab-session.svelte.js";
import { beforeNavigate } from "$app/navigation";
import { workspaceState } from "$lib/stores/workspaces.svelte";
import { resetDashboardSkills } from "$lib/stores/dashboard-skills.svelte";
import { resetSkillDuplicates, resetSkillSearch } from "$lib/stores/skills.svelte";
import { clearUpdateReport } from "$lib/stores/skills-update.svelte";
import type { Workspace } from "$shared/contracts/workspaces.js";

// +layout beforeNavigate 守卫（同序复刻）。
beforeNavigate((navigation) => {
  if (!navigation.to || navigation.willUnload) return;
  const path = `${navigation.to.url.pathname}${navigation.to.url.search}`;
  if (consumeExpectedNavigation(path)) return;
  navigation.cancel();
  navigateTab(path, "PUSH");
});

const SK_A = `sk_${"a".repeat(24)}`;

let mounted: ReturnType<typeof mount> | null = null;

// 首载 = 冷载语义（叶子懒加载真实发生）；dashboard 大图在 vitest 下首载
// transform 需要秒级，settle 必须覆盖（fileParallelism false，不阻塞其他文件）。
async function settle(ms = 4000): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
  flushSync();
}

beforeEach(() => {
  document.body.innerHTML = "";
  connectionStatus = "connected";
  workspaceState.workspaces = [
    {
      id: "~",
      label: "Global",
      kind: "global",
      active: true,
      available: true,
      skillCount: 1,
      path: null,
      providers: [
        {
          id: "claude-code",
          label: "Claude Code",
          path: "/~/.claude/skills",
          available: true,
          writable: false,
          skillCount: 1,
        },
      ],
    } as unknown as Workspace,
  ];
  rpcClient = {
    skills: {
      listWorkspace: () =>
        Promise.resolve({
          providers: [
            { providerId: "claude-code", label: "Claude Code", available: true, skillCount: 1 },
          ],
          skills: [
            {
              id: SK_A,
              providerId: "claude-code",
              name: "alpha",
              description: "alpha desc",
              directoryName: "alpha",
              disabled: false,
              provider: "claude-code",
              location: { workspaceId: "~", providerId: "claude-code" },
              path: "/skills/alpha",
              hasReferences: false,
              hasScripts: false,
            },
          ],
          duplicates: { groups: [], groupsTruncated: false },
        }),
      info: () =>
        Promise.resolve({
          id: SK_A,
          name: "alpha",
          description: "alpha desc",
          directoryName: "alpha",
          disabled: false,
          provider: "claude-code",
          location: { workspaceId: "~", providerId: "claude-code" },
          path: "/skills/alpha",
          hasReferences: false,
          hasScripts: false,
          size: 128,
          content: "---\nname: alpha\ndescription: alpha desc\n---\n\n# Body\n",
          revision: `sha256:${"0".repeat(64)}`,
        }),
      validate: () => Promise.resolve({ success: true, errors: [], warnings: [] }),
      search: () => Promise.resolve({ results: [] }),
      duplicates: () => Promise.resolve({ groups: [] }),
      list: () => Promise.resolve({ skills: [] }),
      searchConfig: { open: () => Promise.resolve({ opened: true }) },
      update: { check: () => Promise.resolve({ results: [] }) },
    },
    repository: {
      sources: { list: () => Promise.resolve({ builtIn: [], user: [] }) },
    },
    selfSkill: { state: () => Promise.resolve({ state: "ok" }) },
    workspace: { list: () => Promise.resolve({ workspaces: [] }) },
  };
});

afterEach(async () => {
  if (mounted) await unmount(mounted);
  mounted = null;
  resetDashboardSkills();
  resetSkillSearch();
  resetSkillDuplicates();
  clearUpdateReport();
  workspaceState.workspaces = [];
  rpcClient = null;
});

describe("SkillsDashboard 冷直载深链（走查 15-fix 回归钉）", () => {
  it("cold-loads the detail deep link through the real PageOutlet→AppShell→dashboard chain", async () => {
    const search = `?provider=claude-code&skill=${SK_A}&view=detail`;
    resetKitFake(`/w/~/skills${search}`);
    const target = document.createElement("div");
    document.body.appendChild(target);
    mounted = mount(PageOutlet as unknown as Component, { target });
    flushSync();

    // +layout boot 链路：matched URL → 零重定向。
    const redirect = initializeTabSession([], "/w/~/skills", search);
    expect(redirect).toBeNull();
    await settle();

    // 断言：主屏 + detail 面渲染（非白屏、非 page-outlet-empty、非 app-shell-empty）。
    expect(document.querySelector(".page-outlet-empty")).toBeNull();
    expect(document.querySelector(".app-shell-empty")).toBeNull();
    expect(document.querySelector('[data-screen="skills"]')).not.toBeNull();
    expect(document.body.textContent ?? "").toContain("alpha");
  });

  it("cold-loads the ?tab= deep link straight into the selected tab (batch 1)", async () => {
    resetKitFake("/w/~/skills?tab=agents");
    const target = document.createElement("div");
    document.body.appendChild(target);
    mounted = mount(PageOutlet as unknown as Component, { target });
    flushSync();

    const redirect = initializeTabSession([], "/w/~/skills", "?tab=agents");
    expect(redirect).toBeNull();
    await settle();

    // 冷载深链 = Tab 直接选中 agents（tablist ARIA + panel hidden 同源）。
    const agentsTab = document.querySelector<HTMLButtonElement>("#tab-agents");
    expect(agentsTab?.getAttribute("aria-selected")).toBe("true");
    expect(agentsTab?.getAttribute("tabindex")).toBe("0");
    expect(document.querySelector<HTMLDivElement>("#panel-agents")?.hidden).toBe(false);
    expect(document.querySelector<HTMLDivElement>("#panel-skills")?.hidden).toBe(true);
    expect(document.querySelector('[data-screen="agents"]')).not.toBeNull();
  });
});
