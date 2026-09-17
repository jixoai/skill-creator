/**
 * skills store 检索面单测（skill-search-gui C1）。
 * 用户原始需求 [2026-09-17]：「任何需要搜索 skills 的地方都吃到 BM25 + 中文分词
 * + typo 容忍」。
 * 正交意图：
 *   [1] 空/全空白 query 不发 RPC 且清空结果态（输入 schema min-1 是 RPC 合同）。
 *   [2] latest-request-wins + connection owner generation 的提交纪律。
 *   [3] 错误置 error 态并保留已提交结果（降级策略交调用方）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

let connectionGeneration = 0;
let rpcClient: Record<string, unknown> | null = null;

vi.mock("../connection.svelte", () => ({
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

import { resetSkillSearch, searchSkills, searchState } from "../skills.svelte";
import type { SkillSearchResult } from "$shared/contracts/search.js";
import { SkillIdSchema } from "$shared/contracts/skills.js";
import { ProviderIdSchema, WorkspaceIdSchema } from "$shared/contracts/workspaces.js";

function makeResult(rawId: string, name: string): SkillSearchResult {
  return {
    id: SkillIdSchema.parse(rawId),
    name,
    description: `${name} description`,
    canonicalPath: `/canonical/${name}`,
    installations: [
      {
        path: `/root/${name}`,
        workspaceId: WorkspaceIdSchema.parse("~"),
        providerId: ProviderIdSchema.parse("claude"),
      },
    ],
    contentHash: "a".repeat(64),
    disabled: false,
    conflict: false,
    score: 1,
    duplicates: [],
  };
}

function mockSearch() {
  const search = vi.fn();
  rpcClient = { skills: { search } };
  return search;
}

beforeEach(() => {
  connectionGeneration = 0;
  rpcClient = null;
  resetSkillSearch();
});

describe("searchSkills (skill-search-gui C1)", () => {
  it("does not issue an RPC for empty or whitespace-only queries and clears state", async () => {
    const search = mockSearch();
    searchState.results = [makeResult("sk_" + "a".repeat(24), "stale")];
    searchState.query = "stale";

    await searchSkills("");
    await searchSkills("   ");

    expect(search).not.toHaveBeenCalled();
    expect(searchState.query).toBe("");
    expect(searchState.results).toEqual([]);
    expect(searchState.searching).toBe(false);
    expect(searchState.error).toBeNull();
  });

  it("commits results for the latest query and clears the loading flag", async () => {
    const search = mockSearch();
    const result = makeResult("sk_" + "b".repeat(24), "code-review");
    search.mockResolvedValue({ results: [result] });

    await searchSkills("  组件设计  ");

    expect(search).toHaveBeenCalledWith({ query: "组件设计", limit: 20 });
    expect(searchState.query).toBe("组件设计");
    expect(searchState.results).toEqual([result]);
    expect(searchState.searching).toBe(false);
    expect(searchState.error).toBeNull();
  });

  it("drops responses whose connection owner generation went stale (reconnect)", async () => {
    const search = mockSearch();
    let resolveSearch: (value: { results: SkillSearchResult[] }) => void = () => {};
    search.mockReturnValue(
      new Promise((resolve) => {
        resolveSearch = resolve;
      }),
    );

    const pending = searchSkills("reconnect");
    expect(searchState.searching).toBe(true);
    // 在途时连接被替换（owner generation++）——旧响应不得提交。
    connectionGeneration += 1;
    resolveSearch({ results: [makeResult("sk_" + "c".repeat(24), "stale-skill")] });
    await pending;

    expect(searchState.results).toEqual([]);
    expect(searchState.searching).toBe(false);
    expect(searchState.query).toBe("reconnect");
  });

  it("keeps previously committed results and records the error when the RPC fails", async () => {
    const search = mockSearch();
    const committed = makeResult("sk_" + "d".repeat(24), "committed");
    searchState.results = [committed];

    search.mockRejectedValue(new Error("daemon exploded"));
    await searchSkills("next query");

    expect(searchState.error).toBe("daemon exploded");
    // 错误保留旧结果：调用方决定降级展示。
    expect(searchState.results).toEqual([committed]);
    expect(searchState.searching).toBe(false);
  });

  it("throws a diagnosable error state when the daemon is not connected", async () => {
    await searchSkills("anything");
    expect(searchState.error).toBe("The Skill Creator daemon is not connected.");
    expect(searchState.searching).toBe(false);
  });
});
