// @vitest-environment jsdom
/**
 * SkillMenu 组件测试（skill-search-gui C4：`$` 菜单切 BM25 RPC 数据源）。
 *
 * 用户原始需求 [2026-09-16]：「Chat 输入框要支持 `$` 引用 skill，基于 Workspace
 * 分组 + 模糊搜索」；修订 [2026-09-17]：去全量拉取——非空 needle 经 debounce
 * 走 `skills.search`，行从 installations 派生，空 needle 占位。
 *
 * 正交意图：
 *   [1] 懒加载门：空 needle 只显示占位、不发 RPC；非空 needle 去抖后发检索。
 *   [2] 行派生：result × installations（组头 label 反查；多安装多行）。
 *   [3] 选中路由：`$name` token + skill 三元组引用（从 installation 派生）。
 *   [4] 断线：getRpc() null → sourceLabel failure 提示（优雅失败先例）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let rpcClient: Record<string, unknown> | null = null;

vi.mock("../stores/connection.svelte", () => ({
  getRpc: () => rpcClient,
  requireRpc: () => {
    if (!rpcClient) throw new Error("The Skill Creator daemon is not connected.");
    return rpcClient;
  },
  getConnectionGeneration: () => 0,
  connectionState: { status: "connected", error: null },
}));

const workspacesProjection = vi.hoisted(() => ({
  workspaceState: {
    workspaces: [
      {
        id: "~",
        label: "Global",
        providers: [{ id: "claude", label: "Claude Code" }],
      },
      {
        id: "ws_" + "1".repeat(24),
        label: "Lab",
        providers: [{ id: "codex", label: "Codex" }],
      },
    ],
    activeId: "~",
    loading: false,
    error: null,
  },
}));

vi.mock("../stores/workspaces.svelte", () => ({
  workspaceState: workspacesProjection.workspaceState,
  loadWorkspaces: vi.fn(),
}));

import SkillMenu from "$lib/components/agent/SkillMenu.svelte";
import { flushSync, mount, unmount } from "./svelte-client";
import { resetSkillSearch, searchState } from "$lib/stores/skills.svelte";
import type { SkillSearchResult } from "$shared/contracts/search.js";
import { SkillIdSchema } from "$shared/contracts/skills.js";
import { ProviderIdSchema, WorkspaceIdSchema } from "$shared/contracts/workspaces.js";

const SKILL_ID = SkillIdSchema.parse("sk_" + "a".repeat(24));

/** 双安装结果：Global/claude 与 Lab/codex 各一个入口。 */
function dualInstallationResult(): SkillSearchResult {
  return {
    id: SKILL_ID,
    name: "code-review",
    description: "Review code changes",
    canonicalPath: "/canonical/code-review",
    installations: [
      {
        path: "/global/skills/code-review",
        workspaceId: WorkspaceIdSchema.parse("~"),
        providerId: ProviderIdSchema.parse("claude"),
      },
      {
        path: "/lab/skills/code-review",
        workspaceId: WorkspaceIdSchema.parse("ws_" + "1".repeat(24)),
        providerId: ProviderIdSchema.parse("codex"),
      },
    ],
    contentHash: "b".repeat(64),
    disabled: false,
    conflict: false,
    score: 1,
    duplicates: [],
  };
}

function mountMenu(text: string) {
  const onPick = vi.fn();
  const target = document.createElement("div");
  document.body.appendChild(target);
  const instance = mount(SkillMenu, {
    target,
    props: { text, caretOnFirstLine: true, onPick },
  });
  flushSync();
  return {
    onPick,
    menu: () => document.querySelector<HTMLElement>('[data-slot="skill-menu"]'),
    rows: () => [
      ...document.querySelectorAll<HTMLButtonElement>('[data-slot="skill-menu"] li button'),
    ],
    groups: () => [...document.querySelectorAll<HTMLElement>("[data-menu-group]")],
    source: () => document.querySelector<HTMLElement>('[data-menu-source="true"]'),
    cleanup: () => {
      unmount(instance);
      target.remove();
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = "";
  rpcClient = null;
  resetSkillSearch();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("SkillMenu (skill-search-gui C4)", () => {
  it("stays hidden for drafts without the $ trigger", () => {
    const ctx = mountMenu("plain text");
    expect(ctx.menu()).toBeNull();
    ctx.cleanup();
  });

  it("shows the keyword placeholder for an empty needle and never fetches", async () => {
    const search = vi.fn();
    rpcClient = { skills: { search } };
    const ctx = mountMenu("$");
    expect(ctx.menu()?.textContent).toContain("输入关键词检索技能");
    await vi.advanceTimersByTimeAsync(400);
    expect(search).not.toHaveBeenCalled();
    ctx.cleanup();
  });

  it("debounces the BM25 search, then renders installation rows with scope groups", async () => {
    const search = vi.fn().mockResolvedValue({ results: [dualInstallationResult()] });
    rpcClient = { skills: { search } };
    const ctx = mountMenu("$code");

    // 异步空窗：去抖窗口内菜单保持「检索中」占位（不隐藏、不发请求、不闪无匹配）。
    expect(ctx.menu()?.textContent).toContain("Searching skills…");
    await vi.advanceTimersByTimeAsync(149);
    expect(search).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(search).toHaveBeenCalledWith({ query: "code", limit: 20 });
    flushSync();

    const labels = ctx.rows().map((row) => row.textContent ?? "");
    expect(labels.filter((label) => label.includes("$code-review"))).toHaveLength(2);
    const groupLabels = ctx.groups().map((group) => group.dataset.menuGroup);
    expect(groupLabels).toContain("Global / Claude Code");
    expect(groupLabels).toContain("Lab / Codex");
    ctx.cleanup();
  });

  it("picks the skill triple derived from each installation row", async () => {
    rpcClient = {
      skills: { search: vi.fn().mockResolvedValue({ results: [dualInstallationResult()] }) },
    };
    const ctx = mountMenu("$review");
    await vi.advanceTimersByTimeAsync(200);
    flushSync();

    // 同一技能多安装 = 多行（installations 声明序：Global/claude 在前，Lab/codex 在后）。
    const rows = ctx.rows().filter((row) => (row.textContent ?? "").includes("$code-review"));
    expect(rows).toHaveLength(2);
    rows[0]?.click();
    rows[1]?.click();

    const skillId = SKILL_ID;
    expect(ctx.onPick).toHaveBeenNthCalledWith(1, {
      token: "$code-review",
      reference: {
        kind: "skill",
        token: "$code-review",
        target: skillId,
        label: "code-review",
        skill: { workspaceId: "~", providerId: "claude", skillId },
      },
    });
    expect(ctx.onPick).toHaveBeenNthCalledWith(2, {
      token: "$code-review",
      reference: {
        kind: "skill",
        token: "$code-review",
        target: skillId,
        label: "code-review",
        skill: {
          workspaceId: "ws_" + "1".repeat(24),
          providerId: "codex",
          skillId,
        },
      },
    });
    ctx.cleanup();
  });

  it("reports the disconnection through the source label without throwing", async () => {
    rpcClient = null;
    const ctx = mountMenu("$offline");
    await vi.advanceTimersByTimeAsync(200);
    expect(ctx.source()?.textContent).toContain("Not connected");
    expect(ctx.menu()).not.toBeNull();
    ctx.cleanup();
  });

  it("invalidates in-flight search state when the menu goes away", async () => {
    // 复审边界修复：fetchSession 只挡未发包的去抖，挡不住已发出的 RPC——
    // 卸载/离开 `$` 态必须经 resetSkillSearch 作废在途请求并回收共享 searchState。
    rpcClient = {
      skills: { search: vi.fn().mockResolvedValue({ results: [dualInstallationResult()] }) },
    };
    const ctx = mountMenu("$stale");
    await vi.advanceTimersByTimeAsync(200);
    flushSync();
    expect(searchState.query).toBe("stale");
    expect(searchState.results).toHaveLength(1);
    ctx.cleanup();
    flushSync();
    expect(searchState.query).toBe("");
    expect(searchState.results).toHaveLength(0);
    expect(searchState.searching).toBe(false);
  });
});
