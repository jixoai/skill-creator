/**
 * 冻结 fuzzy 规则单元测试（scoring 层；P1-2/P2-3 codex 复核处置）。
 *
 * User input [2026-09-21]：「长 token fuzzy 以 MiniSearch 实测为 canonical
 * （距离 3-6、不按长度差钳 2）；CJK skip 入冻结规则并补正负测试。」
 *
 * Orthogonal intents:
 *   [1] 长词距离边界：maxFuzzyDistance = min(6, round(len×0.2))；变体展开
 *       接受距离 3-6（含 |Δlen|=3 删除形态），拒绝超限距离。
 *   [2] CJK skip：含 Han/Hiragana/Katakana/Hangul 的 token 跳过 fuzzy 展开
 *       （exact/prefix 不受影响）——本层用合成词表直接钉死规则（API 层受
 *       Segmenter 切分约束，CJK token 几乎恒 ≤2 码点、距离上限自然为 0，
 *       无法单独暴露该规则）。
 */
import { describe, expect, it } from "vitest";
import { expandQueryToken, maxFuzzyDistance } from "../src/scoring.js";

const WORD_16 = "abcdefghijklmnop";
const WORD_30 = "abcdefghijklmnopqrstuvwxyzabcd";

describe("frozen fuzzy distance rule (MiniSearch canonical)", () => {
  it("computes maxFuzzyDistance as min(6, round(len × 0.2))", () => {
    expect(maxFuzzyDistance("ab", 0.2)).toBe(0); // round(0.4) = 0：短词无 fuzzy
    expect(maxFuzzyDistance("component", 0.2)).toBe(2); // round(1.8) = 2
    expect(maxFuzzyDistance(WORD_16, 0.2)).toBe(3); // round(3.2) = 3
    expect(maxFuzzyDistance(WORD_30, 0.2)).toBe(6); // round(6.0) = 6 = 上限
    expect(maxFuzzyDistance(`${WORD_30}plusmore`, 0.2)).toBe(6); // 超长钳 6
    expect(maxFuzzyDistance(WORD_16, 0)).toBe(0); // 比例 0 = 关闭
  });

  it("expands long tokens to distance 3 including |Δlen|=3 deletions", () => {
    const derived = expandQueryToken(
      WORD_16,
      ["abcxefghiqklmnwp", "abcefghiklmnp", "abxdeqghwjkzmjok"],
      { prefix: false, maxDistance: maxFuzzyDistance(WORD_16, 0.2) },
    );
    // 距离 3 的两种形态（同长度替换 / 删除 3 字符）进变体集；权重 = 0.45×L/(L+3)，
    // L = 词表词长（MiniSearch 口径：fuzzyWeight × term.length/(term.length+distance)）。
    expect(derived.get("abcxefghiqklmnwp")).toBeCloseTo(0.45 * (16 / 19), 12);
    expect(derived.get("abcefghiklmnp")).toBeCloseTo(0.45 * (13 / 16), 12);
    // 距离 6 > 3 不进变体集。
    expect(derived.has("abxdeqghwjkzmjok")).toBe(false);
  });

  it("expands len-30 tokens up to distance 6 but not 7", () => {
    const derived = expandQueryToken(
      WORD_30,
      ["abcqefghwjklmxopqrztuvwjyzabkd", "abqdefwhijxlmnzpqrjtuvkxyzvbcd"],
      { prefix: false, maxDistance: maxFuzzyDistance(WORD_30, 0.2) },
    );
    expect(derived.has("abcqefghwjklmxopqrztuvwjyzabkd")).toBe(true);
    expect(derived.has("abqdefwhijxlmnzpqrjtuvkxyzvbcd")).toBe(false);
  });
});

describe("frozen CJK fuzzy skip rule", () => {
  it("skips fuzzy expansion for CJK tokens while the latin control expands", () => {
    // 「实事求是」为 Segmenter 词典单 token（4 码点，距离上限 1）；合成 1-编辑
    // 变体「实事求事」若 fuzzy 生效必然命中——CJK 规则要求跳过（变体集只剩 exact 自身）。
    const cjk = expandQueryToken("实事求是", ["实事求事"], {
      prefix: false,
      maxDistance: 1,
    });
    expect([...cjk.entries()]).toEqual([["实事求是", 1]]);

    // Latin 对照（同长度同距离）：正常进变体集。
    const latin = expandQueryToken("abcd", ["abce"], { prefix: false, maxDistance: 1 });
    expect(latin.get("abce")).toBeCloseTo(0.45 * (4 / 5), 12);
  });

  it("skips fuzzy for tokens carrying any Han/Hiragana/Katakana/Hangul script", () => {
    for (const token of ["実事求是", "ひらがな語", "한국어토큰"]) {
      const derived = expandQueryToken(token, [`${token}x`], { prefix: false, maxDistance: 2 });
      expect([...derived.entries()], `token ${token}`).toEqual([[token, 1]]);
    }
  });

  it("keeps exact and prefix expansion for CJK tokens", () => {
    const derived = expandQueryToken("数据", ["数据库"], { prefix: true, maxDistance: 1 });
    // exact（w=1）与 prefix（w=0.375×3/(3+0.3×1)）保留，仅 fuzzy 被跳过。
    expect(derived.get("数据")).toBe(1);
    expect(derived.get("数据库")).toBeCloseTo(0.375 * (3 / (3 + 0.3 * (3 - 2))), 12);
  });
});
