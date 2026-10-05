/**
 * 用户原始需求 [2026-07-27]：「ChromeTabs 和路由做深度的绑定」。
 * 正交意图：[1] 验证 path-pattern 编译/拼接/渲染。
 */
import { describe, expect, it } from "vitest";
import {
  compilePattern,
  joinPattern,
  matchPathPattern,
  stringifyPattern,
} from "../path-pattern.js";

describe("compilePattern", () => {
  it("compiles index route (empty pattern)", () => {
    const compiled = compilePattern("");
    expect(compiled.paramNames).toEqual([]);
    expect(compiled.regex.test("")).toBe(true);
    expect(compiled.regex.test("/")).toBe(true);
  });

  it("compiles static pattern", () => {
    const compiled = compilePattern("workspaces");
    expect(compiled.paramNames).toEqual([]);
    expect(compiled.regex.test("workspaces")).toBe(true);
    expect(compiled.regex.test("workspaces/")).toBe(true);
    expect(compiled.regex.test("creator")).toBe(false);
  });

  it("compiles pattern with named params", () => {
    const compiled = compilePattern("repo/:owner/:repo");
    expect(compiled.paramNames).toEqual(["owner", "repo"]);
    expect(compiled.regex.test("repo/a/b")).toBe(true);
    expect(compiled.regex.test("repo/a/b/")).toBe(true);
    expect(compiled.regex.test("repo/a")).toBe(false);
  });

  it("escapes static regular expression characters", () => {
    const compiled = compilePattern(".well-known/:name");
    expect(compiled.regex.test(".well-known/skills")).toBe(true);
    expect(compiled.regex.test("xwell-known/skills")).toBe(false);
  });
});

describe("joinPattern", () => {
  it("joins parent and child", () => {
    expect(joinPattern("/workspaces", "ws_abc/claude-code")).toBe("/workspaces/ws_abc/claude-code");
  });

  it("handles empty child", () => {
    expect(joinPattern("/workspaces", "")).toBe("/workspaces");
  });

  it("trims trailing slash from parent", () => {
    expect(joinPattern("/workspaces/", "detail")).toBe("/workspaces/detail");
  });
});

describe("stringifyPattern", () => {
  it("renders params into pattern", () => {
    expect(stringifyPattern("repo/:owner/:repo", { owner: "a", repo: "b" })).toBe("repo/a/b");
  });

  it("encodes param values", () => {
    expect(stringifyPattern("search/:query", { query: "hello world" })).toBe(
      "search/hello%20world",
    );
  });

  it("leaves missing params as :name (DEV warning)", () => {
    expect(stringifyPattern("repo/:owner/:repo", { owner: "a" })).toBe("repo/a/:repo");
  });
});

describe("matchPathPattern", () => {
  it("matches full dynamic segments and decodes URL values", () => {
    expect(matchPathPattern("/w/:wsId/skills", "/w/%7E/skills")).toEqual({
      params: { wsId: "~" },
      remainder: [],
    });
  });

  it("can leave a route suffix while rejecting partial segment matches", () => {
    expect(matchPathPattern("/w/:wsId/skills", "/w/ws_abc/skills/insights/provider", true)).toEqual(
      {
        params: { wsId: "ws_abc" },
        remainder: ["insights", "provider"],
      },
    );
    expect(matchPathPattern("/w/:wsId/skills", "/w/ws_abc/skills-extra", true)).toBeNull();
    expect(matchPathPattern("/w/:wsId/skills", "/w/ws_abc/skills/extra")).toBeNull();
  });
});
