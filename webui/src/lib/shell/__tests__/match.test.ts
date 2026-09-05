/**
 * 用户原始需求 [2026-07-27]：「ChromeTabs 和路由做深度的绑定」。
 * 正交意图：[1] 验证 matchRouteTree 树匹配 + zod parse。
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { matchRouteTree } from "../match.js";
import type { ErasedRouteContract } from "../contract.js";

function makeRoute(overrides: Partial<ErasedRouteContract> = {}): ErasedRouteContract {
  return {
    id: "test",
    pattern: "",
    component: () => Promise.resolve({ default: {} as never }),
    ...overrides,
  };
}

describe("matchRouteTree", () => {
  it("matches index route (empty relative path)", () => {
    const root = makeRoute({ id: "home", pattern: "" });
    const result = matchRouteTree(root, "/workspaces", "", "/workspaces");
    expect(result.kind).toBe("matched");
    if (result.kind === "matched") {
      expect(result.chain).toHaveLength(1);
      expect(result.chain[0].route.id).toBe("home");
    }
  });

  it("matches route with params", () => {
    const root = makeRoute({
      id: "provider",
      pattern: ":wsId/:providerId",
      params: z.object({ wsId: z.string(), providerId: z.string() }),
    });
    const result = matchRouteTree(root, "/workspaces/ws_abc/claude-code", "", "/workspaces");
    expect(result.kind).toBe("matched");
    if (result.kind === "matched") {
      const node = result.chain[0];
      expect(node.rawParams).toEqual({ wsId: "ws_abc", providerId: "claude-code" });
    }
  });

  it("returns no-match when path has extra segments and no children", () => {
    const root = makeRoute({ id: "home", pattern: "" });
    const result = matchRouteTree(root, "/workspaces/extra/segments", "", "/workspaces");
    expect(result.kind).toBe("no-match");
  });

  it("matches nested children", () => {
    const child = makeRoute({ id: "detail", pattern: "detail/:skillId" });
    const root = makeRoute({ id: "provider", pattern: ":wsId/:providerId", children: [child] });
    const result = matchRouteTree(
      root,
      "/workspaces/ws_abc/claude-code/detail/sk_xyz",
      "",
      "/workspaces",
    );
    expect(result.kind).toBe("matched");
    if (result.kind === "matched") {
      expect(result.chain).toHaveLength(2);
      expect(result.chain[1].route.id).toBe("detail");
    }
  });

  it("returns parse-error when params fail zod validation", () => {
    const root = makeRoute({
      id: "provider",
      pattern: ":wsId",
      params: z.object({ wsId: z.string().regex(/^ws_\d+$/) }),
    });
    const result = matchRouteTree(root, "/workspaces/invalid", "", "/workspaces");
    expect(result.kind).toBe("parse-error");
    if (result.kind === "parse-error") {
      expect(result.reason).toBe("params");
    }
  });

  it("parses search params via leaf search schema", () => {
    const root = makeRoute({
      id: "provider",
      pattern: "",
      search: z.object({ q: z.string().optional(), view: z.enum(["list", "detail"]).optional() }),
    });
    const result = matchRouteTree(root, "/workspaces", "?q=test&view=detail", "/workspaces");
    expect(result.kind).toBe("matched");
  });

  it("returns parse-error when search fails zod validation", () => {
    const root = makeRoute({
      id: "provider",
      pattern: "",
      search: z.object({ view: z.enum(["list", "detail"]) }),
    });
    const result = matchRouteTree(root, "/workspaces", "?view=invalid", "/workspaces");
    expect(result.kind).toBe("parse-error");
    if (result.kind === "parse-error") {
      expect(result.reason).toBe("search");
    }
  });
});
