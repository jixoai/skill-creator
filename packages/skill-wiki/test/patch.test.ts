/**
 * 用户原始需求 [2026-09-21]：「将它移植进来，用 skill-wiki 这个包来承载」。
 * 正交意图：[1] 钉死 patch 引擎的原子性与锚定语义（论文 Wiki Maintainer 原语）。
 */
import { describe, expect, it } from "vitest";
import { applyEdits, validateEdits, type WikiEdit } from "../src/index.js";
import { SkillWikiError } from "../src/index.js";

describe("validateEdits", () => {
  it("accepts a batch whose anchors all hit", () => {
    const edits: WikiEdit[] = [
      { op: "replace", target: "old", content: "new" },
      { op: "insert_after", target: "keep", content: " added" },
    ];
    expect(() => validateEdits("keep old text", edits)).not.toThrow();
  });

  it("rejects a missing anchor with WIKI_PATCH_FAILED", () => {
    try {
      validateEdits("abc", [{ op: "replace", target: "zzz", content: "x" }]);
      expect.unreachable("must throw");
    } catch (error) {
      expect(error).toBeInstanceOf(SkillWikiError);
      expect((error as SkillWikiError).code).toBe("WIKI_PATCH_FAILED");
    }
  });

  it("rejects an empty target", () => {
    expect(() => validateEdits("abc", [{ op: "insert_after", target: "", content: "x" }])).toThrow(
      SkillWikiError,
    );
  });
});

describe("applyEdits", () => {
  it("applies append at the end", () => {
    expect(applyEdits("a", [{ op: "append", content: "b" }])).toBe("ab");
  });

  it("replaces only the first occurrence", () => {
    expect(applyEdits("x x x", [{ op: "replace", target: "x", content: "y" }])).toBe("y x x");
  });

  it("inserts content immediately after the anchor", () => {
    expect(
      applyEdits("head anchor tail", [{ op: "insert_after", target: "anchor", content: "!" }]),
    ).toBe("head anchor! tail");
  });

  it("applies a batch sequentially", () => {
    const result = applyEdits("one two three", [
      { op: "replace", target: "two", content: "TWO" },
      { op: "insert_after", target: "TWO", content: "!" },
      { op: "append", content: " end" },
    ]);
    expect(result).toBe("one TWO! three end");
  });

  it("is atomic: a later bad anchor aborts the whole batch without partial edits", () => {
    const content = "one two three";
    try {
      applyEdits(content, [
        { op: "replace", target: "one", content: "ONE" },
        { op: "replace", target: "missing", content: "X" },
      ]);
      expect.unreachable("must throw");
    } catch (error) {
      expect(error).toBeInstanceOf(SkillWikiError);
    }
    // 纯函数语义：失败即抛错，调用方持有的原文不受影响。
    expect(content).toBe("one two three");
  });
});
