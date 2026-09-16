// @vitest-environment jsdom
/**
 * `$` 技能菜单模糊匹配器测试（skill-refs C1）。
 *
 * 用户原始需求 [2026-09-16]：「要支持模糊的搜索能力」——子序列命中/淘汰、
 * 连续与词首加权方向性、description 加成、稳定排序。
 */
import { describe, expect, it } from "vitest";
import { fuzzyMatch, fuzzySort } from "$lib/components/agent/composer-fuzzy";

describe("fuzzyMatch", () => {
  it("matches subsequences case-insensitively across word separators", () => {
    expect(fuzzyMatch("cg", "config-getter")).not.toBeNull();
    expect(fuzzyMatch("CR", "code-review")).not.toBeNull();
    expect(fuzzyMatch("crv", "code-review")).not.toBeNull();
  });

  it("rejects non-subsequences", () => {
    expect(fuzzyMatch("gc", "code-review")).toBeNull();
    expect(fuzzyMatch("zzz", "code-review")).toBeNull();
  });

  it("empty query matches everything with score 0", () => {
    expect(fuzzyMatch("", "anything")).toEqual({ score: 0 });
    expect(fuzzyMatch("  ", "anything")).toEqual({ score: 0 });
  });

  it("scores contiguous runs higher than scattered hits", () => {
    const contiguous = fuzzyMatch("code", "code-review");
    const scattered = fuzzyMatch("cdrw", "code-review");
    expect(contiguous).not.toBeNull();
    expect(scattered).not.toBeNull();
    expect(contiguous!.score).toBeGreaterThan(scattered!.score);
  });

  it("adds a low-weight bonus for description substring hits without rescuing misses", () => {
    const withDescription = fuzzyMatch("cr", "code-review", "create a cr report");
    const without = fuzzyMatch("cr", "code-review", "");
    expect(withDescription).not.toBeNull();
    expect(without).not.toBeNull();
    expect(withDescription!.score).toBeGreaterThan(without!.score);
    // name 未命中时 description 命中也不救（name 主匹配淘汰优先）。
    expect(fuzzyMatch("zzz", "cr", "zzz in description")).toBeNull();
  });
});

describe("fuzzySort", () => {
  it("sorts by score descending and keeps input order for ties", () => {
    expect(fuzzySort(["a", "b", "c"], () => 1)).toEqual(["a", "b", "c"]);
    expect(fuzzySort(["low", "high"], (item) => (item === "high" ? 5 : 1))).toEqual([
      "high",
      "low",
    ]);
  });
});
