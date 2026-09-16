/**
 * SkillTokenizer 冻结期望表测试。
 *
 * User input [2026-09-17]: "SkillTokenizer MUST 以 docs/search-design.md §6 的冻结期望表
 * 为逐字契约（改动先改表、再改实现、再跑基准）；small-ICU 探针失败时逐字退化 + 滑窗，
 * 不得抛错。"
 *
 * Orthogonal intents:
 *   [1] 冻结期望表 20 条逐字断言（含 JA/KO/全角/URL/scope/camel 条目）。
 *   [2] 探针降级（Intl.Segmenter 缺失或词典退化）→ pure-bigram 行为一致。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSkillTokenizer, TOKENIZER_VERSION } from "../src/daemon/skill-search/tokenizer.js";

/** docs/search-design.md §6 冻结期望表（逐字抄录；改动必须先改表再改实现）。 */
const FROZEN_TABLE: ReadonlyArray<readonly [string, string[]]> = [
  ["react-component-design", ["react", "component", "design", "react-component-design"]],
  ["@jixoai/jixoai-ui", ["jixoai", "jixoai-ui", "jixoai/jixoai-ui", "ui"]],
  ["React组件设计", ["react", "组件", "设计"]],
  ["组件设计", ["组件", "设计"]],
  ["如何创建Svelte组件", ["如何", "创建", "svelte", "组件"]],
  ["玻璃拟态 毛玻璃效果", ["玻璃", "拟态", "毛", "效果"]],
  ["http3 传输层", ["http", "3", "http3", "传输", "层"]],
  ["工作流管理", ["工作", "流", "管理"]],
  [
    "https://github.com/lightonai/bm25x",
    ["lightonai", "bm25x", "lightonai/bm25x", "https", "github", "com", "github-com", "bm", "25"],
  ],
  ["ＲＥＡＣＴ组件（全角）", ["react", "组件", "全角"]],
  ["タスク管理とスプリント", ["タスク", "管理", "と", "スプリント"]],
  ["한국어 검색", ["한국어", "검색"]],
  ["getBoundsWidth", ["get", "bounds", "width", "getboundswidth"]],
  ["ParseHTTPResponse", ["parse", "http", "response", "parsehttpresponse"]],
  ["TypeScript类型检查", ["type", "script", "typescript", "类型", "检查"]],
  ["光刻与渲染管线优化", ["光刻", "刻与", "渲染", "管线", "线优", "优化"]],
  ["SKILL.md 文档", ["skill", "md", "skill-md", "文档"]],
  ["react componet design", ["react", "componet", "design"]],
  ["useSyncExternalStore", ["use", "sync", "external", "store", "usesyncexternalstore"]],
  ["XMLHttpRequest", ["xml", "http", "request", "xmlhttprequest"]],
];

describe("skill search tokenizer (frozen table)", () => {
  const tokenizer = createSkillTokenizer();

  it.each(FROZEN_TABLE)("tokenizes %s", (input, expected) => {
    expect(tokenizer.tokenize(input)).toEqual(expected);
  });

  it("freezes the tokenizer version", () => {
    expect(TOKENIZER_VERSION).toBe("segmenter-bigram-v1");
  });

  it("returns an empty token list for blank and separator-only input", () => {
    expect(tokenizer.tokenize("")).toEqual([]);
    expect(tokenizer.tokenize("  — ·  /  ")).toEqual([]);
  });

  it("keeps hiragana and hangul runs in CJK scope (length filter exempt)", () => {
    // 孤立单字/多字假名与谚文 token 均豁免 Latin 长度过滤。
    expect(tokenizer.tokenize("こんにちは")[0]).toBe("こんにちは");
    expect(tokenizer.tokenize("한국어")[0]).toBe("한국어");
  });
});

describe("skill search tokenizer probe degradation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("degrades to pure-bigram when Intl.Segmenter is missing", () => {
    vi.stubGlobal("Intl", { ...Intl, Segmenter: undefined });
    const tokenizer = createSkillTokenizer();
    // 逐字 [组,件,设,计] → 连续单字段滑窗 bigram；不抛错。
    expect(tokenizer.tokenize("组件设计")).toEqual(["组件", "件设", "设计"]);
    expect(tokenizer.tokenize("工作流管理")).toEqual(["工作", "作流", "流管", "管理"]);
  });

  it("degrades to pure-bigram when the segmenter dictionary is small-ICU", () => {
    // 伪造 Segmenter：把「组件设计」切成单字序列（small-ICU 症状），探针必须判不可用。
    class SingleCharSegmenter {
      segment(text: string): Array<{ segment: string; isWordLike: boolean }> {
        return [...text].map((char) => ({
          segment: char,
          isWordLike: /\p{L}|\p{N}/u.test(char),
        }));
      }
    }
    vi.stubGlobal("Intl", { ...Intl, Segmenter: SingleCharSegmenter });
    const tokenizer = createSkillTokenizer();
    expect(tokenizer.tokenize("组件设计")).toEqual(["组件", "件设", "设计"]);
    // query 与 document 共用同一条管线。
    expect(tokenizer.tokenize("React组件设计")).toEqual(["react", "组件", "件设", "设计"]);
  });
});
