/**
 * wiki store 单测（skill-wiki-incubation 切片② WebUI，2026-09-21；
 * wiki-directory-standard task 3.5：scope 索引面扩展，2026-09-22）。
 * 用户原始需求 [2026-09-21]：「P1 本质上是在收集一些碎片的认知……是 skill-wiki
 * 输入的一部分」。
 * 正交意图：
 *   [1] latest-request-wins + connection owner generation 的提交纪律（列表面）。
 *   [2] 追加闭环：成功就地插入、幂等去重不重复插、stale 成功/rejection 投影 null。
 *   [3] 空 scope 列表 + 未连接 typed error + RPC 失败置 error 保留已提交数据。
 *   [4] scope 索引面（loadWikiScopes）同代次纪律的独立请求门（三态可区分）。
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

import {
  appendWikiFragment,
  loadWiki,
  loadWikiScopes,
  readWikiPattern,
  resetWiki,
  resetWikiScopes,
  wikiScopesState,
  wikiState,
} from "../wiki.svelte";
import type { PatternListItem } from "skill-wiki/schema";
import type { WikiScope } from "$shared/contracts/wiki.js";
import { WorkspaceIdSchema } from "$shared/contracts/workspaces.js";

function makeItem(name: string, title = name): PatternListItem {
  return {
    name,
    title,
    origin: "~",
    promotedFrom: null,
    updated: "2026-09-21T00:00:00.000Z",
    contentHash: name.padEnd(64, "0").slice(0, 64),
  };
}

function mockWiki() {
  const list = vi.fn();
  const append = vi.fn();
  const read = vi.fn();
  const scopes = vi.fn();
  rpcClient = { wiki: { list, append, read, scopes } };
  return { list, append, read, scopes };
}

beforeEach(() => {
  connectionGeneration = 0;
  rpcClient = null;
  resetWiki();
  resetWikiScopes();
});

describe("loadWiki", () => {
  it("commits an empty pattern list and clears loading", async () => {
    const { list } = mockWiki();
    list.mockResolvedValue({ patterns: [] });

    await expect(loadWiki("~")).resolves.toBe("loaded");

    expect(list).toHaveBeenCalledWith({ scope: "~" });
    expect(wikiState.scope).toBe("~");
    expect(wikiState.patterns).toEqual([]);
    expect(wikiState.loading).toBe(false);
    expect(wikiState.error).toBeNull();
  });

  it("drops a superseded response after a newer load for another scope", async () => {
    const { list } = mockWiki();
    let resolveFirst: (value: { patterns: PatternListItem[] }) => void = () => {};
    const first = new Promise<{ patterns: PatternListItem[] }>((resolve) => {
      resolveFirst = resolve;
    });
    list.mockImplementationOnce(() => first).mockResolvedValueOnce({ patterns: [] });

    const slow = void loadWiki("~");
    await loadWiki(WorkspaceIdSchema.parse("ws_" + "3".repeat(24)));
    resolveFirst({ patterns: [makeItem("stale")] });
    await slow;

    expect(wikiState.patterns).toEqual([]);
    expect(wikiState.scope).toBe("ws_" + "3".repeat(24));
  });

  it("drops responses whose connection owner generation went stale (reconnect)", async () => {
    const { list } = mockWiki();
    let resolveList: (value: { patterns: PatternListItem[] }) => void = () => {};
    list.mockReturnValue(
      new Promise((resolve) => {
        resolveList = resolve;
      }),
    );

    const pending = loadWiki("~");
    connectionGeneration += 1;
    resolveList({ patterns: [makeItem("stale")] });
    await expect(pending).resolves.toBe("superseded");

    expect(wikiState.patterns).toEqual([]);
    expect(wikiState.loading).toBe(false);
  });

  it("records the error and keeps previously committed patterns when the RPC fails", async () => {
    const { list } = mockWiki();
    wikiState.patterns = [makeItem("committed")];

    list.mockRejectedValue(new Error("wiki io failed"));
    await expect(loadWiki("~")).resolves.toBe("failed");

    expect(wikiState.error).toBe("wiki io failed");
    expect(wikiState.patterns).toEqual([makeItem("committed")]);
  });

  it("fails with a diagnosable error when the daemon is not connected", async () => {
    await expect(loadWiki("~")).resolves.toBe("failed");
    expect(wikiState.error).toBe("The Skill Creator daemon is not connected.");
    expect(wikiState.loading).toBe(false);
  });
});

describe("appendWikiFragment", () => {
  it("appends, returns the result, and inserts the item into the current scope in place", async () => {
    const { append } = mockWiki();
    const item = makeItem("pin-exit-codes", "Pin exit codes");
    append.mockResolvedValue({ item, deduplicated: false });

    const result = await appendWikiFragment("~", { title: "Pin exit codes", body: "b" });

    expect(append).toHaveBeenCalledWith({ scope: "~", title: "Pin exit codes", body: "b" });
    expect(result).toEqual({ item, deduplicated: false });
    expect(wikiState.patterns).toEqual([item]);
  });

  it("does not insert a duplicate item when the daemon deduplicated the body", async () => {
    const { append } = mockWiki();
    const existing = makeItem("pin-exit-codes", "Pin exit codes");
    wikiState.patterns = [existing];
    append.mockResolvedValue({ item: existing, deduplicated: true });

    const result = await appendWikiFragment("~", { title: "Other title", body: "same body" });

    expect(result?.deduplicated).toBe(true);
    expect(wikiState.patterns).toEqual([existing]);
  });

  it("keeps the appended row when a stale in-flight list resolves after it (codex P1)", async () => {
    const { list, append } = mockWiki();
    let resolveList: (value: { patterns: PatternListItem[] }) => void = () => {};
    list.mockReturnValue(
      new Promise((resolve) => {
        resolveList = resolve;
      }),
    );
    append.mockResolvedValue({ item: makeItem("late-append"), deduplicated: false });

    // 首次列表加载在途（loading=true）时提交追加——旧行为会跳过插入并被旧快照覆盖。
    const pending = loadWiki("~");
    const result = await appendWikiFragment("~", { title: "Late", body: "b" });
    expect(result?.item.name).toBe("late-append");
    expect(wikiState.patterns.map((p) => p.name)).toEqual(["late-append"]);
    expect(wikiState.loading).toBe(false);

    // 旧列表快照（早于追加）返回：不得覆盖就地插入的行。
    resolveList({ patterns: [] });
    await expect(pending).resolves.toBe("superseded");
    expect(wikiState.patterns.map((p) => p.name)).toEqual(["late-append"]);
    expect(wikiState.loading).toBe(false);
  });

  it("ends loading even when a cross-scope append invalidates the in-flight list (codex r3 P1)", async () => {
    const wsScope = WorkspaceIdSchema.parse("ws_" + "5".repeat(24));
    const { list, append } = mockWiki();
    const resolvers: Array<(value: { patterns: PatternListItem[] }) => void> = [];
    list.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        }),
    );
    append.mockResolvedValue({ item: makeItem("cross-scope-append"), deduplicated: false });

    // 序列：list A(~) 在途 → 切 scope 发 list B(ws) 在途 → 旧 scope 的 append(~)
    // 成功——作废 A、B 两条在途 list，且 append scope ≠ 当前视图 scope。
    const listA = loadWiki("~");
    const listB = loadWiki(wsScope);
    expect(wikiState.scope).toBe(wsScope);
    expect(wikiState.loading).toBe(true);

    const result = await appendWikiFragment("~", { title: "Cross", body: "b" });
    expect(result?.item.name).toBe("cross-scope-append");
    // 跨 scope append 不插入当前视图，但 loading 必须有终态（不得永久悬挂）。
    expect(wikiState.loading).toBe(false);
    expect(wikiState.patterns.map((p) => p.name)).toEqual([]);

    // 两条被作废的 list 返回：都不提交 patterns，也不回挂 loading。
    resolvers.forEach((resolve) => resolve({ patterns: [makeItem("stale")] }));
    await expect(listA).resolves.toBe("superseded");
    await expect(listB).resolves.toBe("superseded");
    expect(wikiState.loading).toBe(false);
    expect(wikiState.patterns.map((p) => p.name)).toEqual([]);
  });

  it("projects a stale success as null without committing (reconnect mid-flight)", async () => {
    const { append } = mockWiki();
    let resolveAppend: (value: { item: PatternListItem; deduplicated: boolean }) => void = () => {};
    append.mockReturnValue(
      new Promise((resolve) => {
        resolveAppend = resolve;
      }),
    );

    const pending = appendWikiFragment("~", { title: "t", body: "b" });
    connectionGeneration += 1;
    resolveAppend({ item: makeItem("late"), deduplicated: false });
    await expect(pending).resolves.toBeNull();
    expect(wikiState.patterns).toEqual([]);
  });

  it("re-throws a current failure so the caller can surface it", async () => {
    const { append } = mockWiki();
    append.mockRejectedValue(new Error("INVALID_OPERATION"));
    await expect(appendWikiFragment("~", { title: " ", body: "b" })).rejects.toThrow(
      "INVALID_OPERATION",
    );
  });
});

describe("readWikiPattern", () => {
  it("forwards a single read to the RPC client", async () => {
    const { read } = mockWiki();
    const full = {
      name: "pin-exit-codes",
      title: "Pin exit codes",
      origin: "~",
      promotedFrom: null,
      updated: "2026-09-21T00:00:00.000Z",
      contentHash: "c".repeat(64),
      body: "Branch on exit codes.",
    };
    read.mockResolvedValue(full);

    await expect(readWikiPattern("~", "pin-exit-codes")).resolves.toEqual(full);
    expect(read).toHaveBeenCalledWith({ scope: "~", name: "pin-exit-codes" });
  });
});

function makeScope(id: "~" | string, label: string, patternCount: number, exists: boolean) {
  return { id: id === "~" ? "~" : WorkspaceIdSchema.parse(id), label, patternCount, exists };
}

describe("loadWikiScopes", () => {
  it("commits the scope index and clears loading (loaded)", async () => {
    const { scopes } = mockWiki();
    const index: WikiScope[] = [
      makeScope("~", "Global", 2, true),
      makeScope("ws_" + "7".repeat(24), "registered", 0, false),
    ];
    scopes.mockResolvedValue({ scopes: index });

    await expect(loadWikiScopes()).resolves.toBe("loaded");

    expect(scopes).toHaveBeenCalledWith({});
    expect(wikiScopesState.scopes).toEqual(index);
    expect(wikiScopesState.loading).toBe(false);
    expect(wikiScopesState.error).toBeNull();
  });

  it("drops a superseded response after a newer load (superseded)", async () => {
    const { scopes } = mockWiki();
    let resolveFirst: (value: { scopes: WikiScope[] }) => void = () => {};
    const first = new Promise<{ scopes: WikiScope[] }>((resolve) => {
      resolveFirst = resolve;
    });
    scopes
      .mockImplementationOnce(() => first)
      .mockResolvedValueOnce({
        scopes: [makeScope("~", "Global", 0, false)],
      });

    const slow = void loadWikiScopes();
    await loadWikiScopes();
    resolveFirst({ scopes: [makeScope("~", "Stale", 9, true)] });
    await slow;

    expect(wikiScopesState.scopes.map((scope) => scope.label)).toEqual(["Global"]);
  });

  it("drops responses whose connection owner generation went stale (reconnect)", async () => {
    const { scopes } = mockWiki();
    let resolveScopes: (value: { scopes: WikiScope[] }) => void = () => {};
    scopes.mockReturnValue(
      new Promise((resolve) => {
        resolveScopes = resolve;
      }),
    );

    const pending = loadWikiScopes();
    connectionGeneration += 1;
    resolveScopes({ scopes: [makeScope("~", "Stale", 9, true)] });
    await expect(pending).resolves.toBe("superseded");

    expect(wikiScopesState.scopes).toEqual([]);
    expect(wikiScopesState.loading).toBe(false);
  });

  it("records the error and keeps previously committed scopes when the RPC fails (failed)", async () => {
    const { scopes } = mockWiki();
    wikiScopesState.scopes = [makeScope("~", "Global", 1, true)];

    scopes.mockRejectedValue(new Error("scopes io failed"));
    await expect(loadWikiScopes()).resolves.toBe("failed");

    expect(wikiScopesState.error).toBe("scopes io failed");
    expect(wikiScopesState.scopes).toEqual([makeScope("~", "Global", 1, true)]);
    expect(wikiScopesState.loading).toBe(false);
  });

  it("fails with a diagnosable error when the daemon is not connected", async () => {
    await expect(loadWikiScopes()).resolves.toBe("failed");
    expect(wikiScopesState.error).toBe("The Skill Creator daemon is not connected.");
    expect(wikiScopesState.loading).toBe(false);
  });
});
