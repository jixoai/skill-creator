/**
 * dashboard store 单测（skills-dashboard 1.1/1.3 GUI 面）。
 * 用户原始需求 [2026-10-02]：「直接展示所有的 skill——listWorkspace 有界聚合 +
 * nextCursor load-more」。
 * 正交意图：
 *   [1] 载入纪律：latest-request-wins + request key（wsId+q）双闸；错误置 error
 *       保留上次成功页。
 *   [2] 续页：cursor 透传 + (providerId,id) 键去重防御 + nextCursor 推进。
 *   [3] 纯投影：provider chips 计数 / duplicates-only 过滤 / 重复计数 /
 *       truncated 标志 / 虚拟化窗口数学。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

let connectionGeneration = 0;
let rpcClient: Record<string, unknown> | null = null;

vi.mock("../../stores/connection.svelte", () => ({
  connectionState: { status: "idle", error: null },
  connect: vi.fn(),
  disconnect: vi.fn(),
  getConnectionGeneration: () => connectionGeneration,
  getRpc: () => rpcClient,
  requireRpc: () => {
    if (!rpcClient) throw new Error("The Skill Creator daemon is not connected.");
    return rpcClient;
  },
}));

import {
  computeDashboardWindow,
  DASHBOARD_FALLBACK_VIEWPORT_ROWS,
  DASHBOARD_ROW_HEIGHT,
  DASHBOARD_VIRTUALIZE_THRESHOLD,
  dashboardDuplicateCounts,
  dashboardDuplicatesTruncated,
  dashboardProviderCounts,
  dashboardRequestKey,
  dashboardSkillsState,
  filterDashboardRows,
  loadDashboardSkills,
  loadMoreDashboardSkills,
  resetDashboardSkills,
} from "../dashboard-skills.svelte";
import type { SkillsListWorkspaceOutput } from "$shared/rpc-contract.js";
import type { SkillListWorkspaceDuplicates } from "$shared/contracts/search.js";
import type { ProviderId, WorkspaceId } from "$shared/contracts/workspaces.js";
import type { SkillId } from "$shared/contracts/skills.js";

const WS = ("ws_" + "a".repeat(23)) as WorkspaceId;
const WS2 = ("ws_" + "b".repeat(23)) as WorkspaceId;

/** 平铺行 = SkillMetadata + providerId 归属（字段全集满足契约类型）。 */
function row(providerId: string, n: number): SkillsListWorkspaceOutput["skills"][number] {
  return {
    id: `sk_${String(n).padStart(24, "0")}` as SkillId,
    providerId: providerId as ProviderId,
    name: `skill-${n}`,
    description: "",
    directoryName: `skill-${n}`,
    disabled: false,
    provider: providerId,
    location: "user",
    path: `/skills/skill-${n}`,
    hasReferences: false,
    hasScripts: false,
    hasAssets: false,
    pluginInfo: null,
  };
}

function page(rows: Array<ReturnType<typeof row>>, nextCursor?: string): SkillsListWorkspaceOutput {
  return {
    providers: [
      {
        providerId: "claude-code" as ProviderId,
        label: "Claude Code",
        available: true,
        skillCount: rows.length,
      },
    ],
    skills: rows,
    ...(nextCursor ? { nextCursor } : {}),
    duplicates: { groups: [], groupsTruncated: false },
  };
}

function listWorkspaceMock(): {
  calls: Array<Record<string, unknown>>;
  resolve: (out: SkillsListWorkspaceOutput) => void;
} {
  const calls: Array<Record<string, unknown>> = [];
  // FIFO 队列：并发在途请求（stale + fresh）各自可被独立 resolve。
  const queue: Array<(out: SkillsListWorkspaceOutput) => void> = [];
  rpcClient = {
    skills: {
      listWorkspace: (input: Record<string, unknown>) => {
        calls.push(input);
        return new Promise<SkillsListWorkspaceOutput>((resolve) => {
          queue.push(resolve);
        });
      },
    },
  };
  return {
    calls,
    resolve: (out) => {
      const fn = queue.shift();
      fn?.(out);
    },
  };
}

beforeEach(() => {
  connectionGeneration = 0;
  rpcClient = null;
  resetDashboardSkills();
});

describe("loadDashboardSkills（latest-request-wins + request key 双闸）", () => {
  it("commits providers/rows/nextCursor and passes wsId+q to the RPC", async () => {
    const mock = listWorkspaceMock();
    const loading = loadDashboardSkills(WS, "vue");
    await Promise.resolve();
    expect(mock.calls[0]).toEqual({ wsId: WS, q: "vue", limit: 200 });
    mock.resolve(page([row("claude-code", 1)], "cursor-1"));
    await loading;
    expect(dashboardSkillsState.rows).toHaveLength(1);
    expect(dashboardSkillsState.nextCursor).toBe("cursor-1");
    expect(dashboardSkillsState.loading).toBe(false);
  });

  it("omits q entirely when empty (server contract: q optional)", async () => {
    const mock = listWorkspaceMock();
    const loading = loadDashboardSkills(WS);
    await Promise.resolve();
    expect(mock.calls[0]).toEqual({ wsId: WS, limit: 200 });
    mock.resolve(page([]));
    await loading;
  });

  it("drops a superseded first-page commit (newer request owns state)", async () => {
    const mock = listWorkspaceMock();
    const stale = loadDashboardSkills(WS, "old");
    await Promise.resolve();
    const fresh = loadDashboardSkills(WS, "new");
    await Promise.resolve();
    mock.resolve(page([row("claude-code", 1)])); // 旧请求的响应
    await stale;
    expect(dashboardSkillsState.rows).toHaveLength(0);
    mock.resolve(page([row("claude-code", 2), row("claude-code", 3)]));
    await fresh;
    expect(dashboardSkillsState.rows).toHaveLength(2);
    expect(dashboardSkillsState.q).toBe("new");
  });

  it("records typed failures as error and keeps previous rows", async () => {
    const mock = listWorkspaceMock();
    const first = loadDashboardSkills(WS);
    await Promise.resolve();
    mock.resolve(page([row("claude-code", 1)]));
    await first;
    // 下一轮直接失败（typed failure 投影为 error；已载行保留）。
    (
      rpcClient as { skills: { listWorkspace: (input: unknown) => Promise<never> } }
    ).skills.listWorkspace = vi.fn(async () => {
      throw new Error("boom");
    });
    await loadDashboardSkills(WS, "q2");
    expect(dashboardSkillsState.error).toBe("boom");
    expect(dashboardSkillsState.rows).toHaveLength(1);
  });
});

describe("loadMoreDashboardSkills（cursor 续页）", () => {
  it("appends the next page, advances nextCursor, and passes the cursor", async () => {
    const mock = listWorkspaceMock();
    const first = loadDashboardSkills(WS);
    await Promise.resolve();
    mock.resolve(page([row("claude-code", 1), row("claude-code", 2)], "cur"));
    await first;

    const more = loadMoreDashboardSkills();
    await Promise.resolve();
    expect(mock.calls[1]).toMatchObject({ wsId: WS, limit: 200, cursor: "cur" });
    mock.resolve(page([row("claude-code", 3)]));
    await more;
    expect(dashboardSkillsState.rows.map((r) => r.name)).toEqual(["skill-1", "skill-2", "skill-3"]);
    expect(dashboardSkillsState.nextCursor).toBeNull();
  });

  it("no-ops without a cursor and dedups same-key rows defensively", async () => {
    await loadMoreDashboardSkills(); // 无游标：静默跳过
    const mock = listWorkspaceMock();
    const first = loadDashboardSkills(WS);
    await Promise.resolve();
    mock.resolve(page([row("claude-code", 1)], "cur"));
    await first;
    const more = loadMoreDashboardSkills();
    await Promise.resolve();
    mock.resolve(page([row("claude-code", 1), row("claude-code", 2)])); // 重复行防御
    await more;
    expect(dashboardSkillsState.rows).toHaveLength(2);
  });
});

describe("纯投影", () => {
  it("dashboardRequestKey fingerprints wsId+q", () => {
    expect(dashboardRequestKey(WS, "a")).not.toBe(dashboardRequestKey(WS2, "a"));
    expect(dashboardRequestKey(WS, "a")).not.toBe(dashboardRequestKey(WS, "b"));
  });

  it("provider counts derive from rows with defensive missing-provider rows", () => {
    const providers = [
      {
        providerId: "claude-code" as ProviderId,
        label: "Claude",
        available: true,
        skillCount: 2,
        error: undefined,
      },
      {
        providerId: "zcode" as ProviderId,
        label: "ZCode",
        available: true,
        skillCount: 0,
        error: { code: "scan-failed" as const, message: "x" },
      },
    ];
    const rows = [row("claude-code", 1), row("claude-code", 2), row("ghost", 3)];
    const chips = dashboardProviderCounts(providers, rows);
    expect(chips.find((c) => c.providerId === "claude-code")?.count).toBe(2);
    expect(chips.find((c) => c.providerId === "zcode")?.error).toBe(true);
    expect(chips.find((c) => c.providerId === "ghost")?.label).toBe("ghost");
  });

  it("provider chips 零计数倒置（2.2 处置批 P2-2）：非零前置、零计数殿后（组内相对序保持）", () => {
    const providers = [
      { providerId: "empty-a" as ProviderId, label: "Empty A", available: true, skillCount: 0 },
      { providerId: "full-a" as ProviderId, label: "Full A", available: true, skillCount: 1 },
      { providerId: "empty-b" as ProviderId, label: "Empty B", available: true, skillCount: 0 },
      { providerId: "full-b" as ProviderId, label: "Full B", available: true, skillCount: 2 },
    ];
    const rows = [row("full-a", 1), row("full-b", 2), row("full-b", 3)];
    const chips = dashboardProviderCounts(providers, rows);
    expect(chips.map((c) => c.providerId)).toEqual(["full-a", "full-b", "empty-a", "empty-b"]);
  });

  it("duplicate counts map member ids to group size minus one", () => {
    const duplicates = {
      groups: [
        {
          contentHash: "a".repeat(64),
          membersTruncated: false,
          members: [
            {
              id: row("p", 1).id,
              name: "a",
              canonicalPath: "/a",
              disabled: false,
              conflict: false,
              invalidFrontmatter: false,
              installations: { items: [], truncated: false },
            },
            {
              id: row("p", 2).id,
              name: "b",
              canonicalPath: "/b",
              disabled: false,
              conflict: false,
              invalidFrontmatter: false,
              installations: { items: [], truncated: false },
            },
          ],
        },
      ],
      groupsTruncated: false,
    };
    const counts = dashboardDuplicateCounts(duplicates as SkillListWorkspaceDuplicates);
    expect(counts.get(row("p", 1).id)).toBe(1);
    expect(counts.size).toBe(2);
    expect(dashboardDuplicateCounts(null).size).toBe(0);
  });

  it("filterDashboardRows applies provider chip and duplicates-only filters", () => {
    const rows = [row("claude-code", 1), row("zcode", 2), row("zcode", 3)];
    const dupIds = new Map<SkillId, number>([[row("zcode", 2).id, 1]]);
    expect(filterDashboardRows(rows, {}, dupIds)).toHaveLength(3);
    expect(
      filterDashboardRows(rows, { providerId: "zcode" as ProviderId }, dupIds).map((r) => r.name),
    ).toEqual(["skill-2", "skill-3"]);
    expect(filterDashboardRows(rows, { duplicatesOnly: true }, dupIds).map((r) => r.name)).toEqual([
      "skill-2",
    ]);
  });

  it("filterDashboardRows 行序可预测（2.2 处置批 P2-7）：provider 首现分组 + name localeCompare 二级键", () => {
    // 乱序输入：同名行跨 provider、组内乱序、数字名走 numeric 序。
    const rows = [
      row("zcode", 10), // name skill-10
      row("claude-code", 2),
      row("zcode", 2),
      row("claude-code", 1),
      row("zcode", 1),
    ];
    const ordered = filterDashboardRows(rows, {}).map((r) => `${r.providerId}/${r.name}`);
    // 分组按首现行序（zcode 先出现）；组内 numeric localeCompare：1 < 2 < 10。
    expect(ordered).toEqual([
      "zcode/skill-1",
      "zcode/skill-2",
      "zcode/skill-10",
      "claude-code/skill-1",
      "claude-code/skill-2",
    ]);
  });

  it("truncated flags surface at group or member level", () => {
    expect(dashboardDuplicatesTruncated({ groups: [], groupsTruncated: true })).toBe(true);
    expect(
      dashboardDuplicatesTruncated({
        groups: [
          {
            contentHash: "a".repeat(64),
            members: [],
            membersTruncated: true,
          } as SkillListWorkspaceDuplicates["groups"][number],
        ],
        groupsTruncated: false,
      }),
    ).toBe(true);
    expect(dashboardDuplicatesTruncated({ groups: [], groupsTruncated: false })).toBe(false);
    expect(dashboardDuplicatesTruncated(null)).toBe(false);
  });
});

describe("computeDashboardWindow（虚拟化窗口数学）", () => {
  it("clamps to [0, count) and windows around scrollTop", () => {
    const win = computeDashboardWindow(1000, DASHBOARD_ROW_HEIGHT * 10, DASHBOARD_ROW_HEIGHT * 20);
    // start = scrollTop行(10) - overscan(6)；end = start + ceil(viewport/rowH) + 2×overscan。
    expect(win.start).toBe(4);
    expect(win.end).toBe(4 + 20 + 12);
    expect(win.end).toBeLessThanOrEqual(1000);
  });

  it("falls back to a fixed page when viewport is unmeasurable (jsdom clientHeight=0)", () => {
    const win = computeDashboardWindow(1000, 0, 0);
    expect(win.start).toBe(0);
    expect(win.end).toBe(DASHBOARD_FALLBACK_VIEWPORT_ROWS);
    const tail = computeDashboardWindow(10, DASHBOARD_ROW_HEIGHT * 100, 0);
    expect(tail.end).toBe(10); // count clamp
  });

  it("returns an empty window for empty rows", () => {
    expect(computeDashboardWindow(0, 0, 100)).toEqual({ start: 0, end: 0 });
  });

  it("virtualization threshold matches the design (>200 rows)", () => {
    expect(DASHBOARD_VIRTUALIZE_THRESHOLD).toBe(200);
    expect(DASHBOARD_ROW_HEIGHT).toBeGreaterThan(0);
  });
});
