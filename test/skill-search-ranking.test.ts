/**
 * 冻结 ranking 管线测试（BM25 top40 → rerank → content-dup 折叠 → tie-break）。
 *
 * User input [2026-09-17]: "name 命中压制 body 命中；typo 经 fuzzy 召回；同 contentHash
 * 组内 final 最高者为主，其余进 duplicates；tie-break final desc → name asc →
 * canonicalPath asc 稳定。"
 *
 * Orthogonal intents:
 *   [1] 端到端次序性质（经生产引擎配置：name > description > body、typo 召回）。
 *   [2] 纯 rankResults 单元性质（折叠选主、同分 tie-break、不依赖输入次序）。
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  RANKING_VERSION,
  rankResults,
  type RankingCandidate,
} from "../src/daemon/skill-search/ranking.js";
import { createSkillTokenizer } from "../src/daemon/skill-search/tokenizer.js";
import {
  buildIndexWithDocuments,
  createSkillSearchDocument,
  skillSearchDocumentId,
} from "./helpers/skill-search-documents.js";

const tokenizer = createSkillTokenizer();
const tokenize = (text: string): string[] => tokenizer.tokenize(text);

function candidate(
  overrides: Partial<RankingCandidate> &
    Pick<RankingCandidate, "name" | "canonicalPath" | "contentHash">,
): RankingCandidate {
  return {
    id: skillSearchDocumentId(overrides.canonicalPath),
    bm25: 10,
    description: "",
    keywords: [],
    installations: [],
    disabled: false,
    conflict: false,
    ...overrides,
  };
}

describe("frozen ranking end-to-end ordering (production engine config)", () => {
  it("ranks a name hit above a description hit above a body-only hit", () => {
    const index = buildIndexWithDocuments([
      createSkillSearchDocument({
        name: "reactive-forms",
        description: "unrelated description about cooking recipes",
        body: "nothing relevant here at all",
        contentHash: createHash("sha256").update("name-doc").digest("hex"),
      }),
      createSkillSearchDocument({
        name: "unrelated-name",
        description: "Guide to reactive forms architecture and validation flows",
        body: "not about forms",
        contentHash: createHash("sha256").update("desc-doc").digest("hex"),
      }),
      createSkillSearchDocument({
        name: "totally-other",
        description: "something else entirely",
        body: "Deep dive into reactive forms internals and edge cases of reactive forms.",
        contentHash: createHash("sha256").update("body-doc").digest("hex"),
      }),
    ]);
    const results = rankResults(index.search("reactive forms"), "reactive forms", 10, tokenize);
    expect(results.map((result) => result.name)).toEqual([
      "reactive-forms",
      "unrelated-name",
      "totally-other",
    ]);
  });

  it("recalls a 1-edit typo target through the fuzzy path", () => {
    const index = buildIndexWithDocuments([
      createSkillSearchDocument({
        name: "svelte-component-dev",
        description: "Svelte component development",
        contentHash: createHash("sha256").update("svelte-doc").digest("hex"),
      }),
      createSkillSearchDocument({
        name: "react-component-dev",
        description: "React component development",
        contentHash: createHash("sha256").update("react-doc").digest("hex"),
      }),
    ]);
    const results = rankResults(
      index.search("sveltte component"),
      "sveltte component",
      5,
      tokenize,
    );
    expect(results.map((result) => result.name)).toContain("svelte-component-dev");
  });
});

describe("frozen rankResults unit properties", () => {
  it("folds same-contentHash groups keeping the highest-final member as primary", () => {
    const primary = candidate({
      name: "agents-sdk",
      canonicalPath: "/repo/a/agents-sdk",
      contentHash: "a".repeat(64),
      bm25: 20,
    });
    const duplicate = candidate({
      name: "agents-sdk",
      canonicalPath: "/repo/b/agents-sdk",
      contentHash: "a".repeat(64),
      bm25: 12,
    });
    const other = candidate({
      name: "wrangler",
      canonicalPath: "/repo/a/wrangler",
      contentHash: "b".repeat(64),
      bm25: 15,
    });
    const results = rankResults([duplicate, primary, other], "agents", 10, tokenize);
    expect(results).toHaveLength(2);
    expect(results[0]?.name).toBe("agents-sdk");
    expect(results[0]?.canonicalPath).toBe("/repo/a/agents-sdk");
    expect(results[0]?.duplicates).toEqual([
      { id: duplicate.id, canonicalPath: "/repo/b/agents-sdk" },
    ]);
    // 组内成员均参与 top40 竞争（低分成员折叠而非淘汰）。
    expect(results[1]?.name).toBe("wrangler");
  });

  it("breaks same-final ties by name asc then canonicalPath asc", () => {
    const a = candidate({
      name: "alpha",
      canonicalPath: "/z/alpha",
      contentHash: "c".repeat(64),
      bm25: 10,
    });
    const b = candidate({
      name: "beta",
      canonicalPath: "/a/beta",
      contentHash: "d".repeat(64),
      bm25: 10,
    });
    // 同 bm25、同 rerank（无信号）→ final 相等 → name asc 优先。
    const results = rankResults([b, a], "query", 10, tokenize);
    expect(results.map((result) => result.name)).toEqual(["alpha", "beta"]);
  });

  it("picks the primary of a same-hash same-final group by canonicalPath asc", () => {
    const first = candidate({
      name: "same-name",
      canonicalPath: "/b/same-name",
      contentHash: "e".repeat(64),
      bm25: 10,
    });
    const second = candidate({
      name: "same-name",
      canonicalPath: "/a/same-name",
      contentHash: "e".repeat(64),
      bm25: 10,
    });
    const results = rankResults([first, second], "same", 10, tokenize);
    expect(results).toHaveLength(1);
    expect(results[0]?.canonicalPath).toBe("/a/same-name");
    expect(results[0]?.duplicates).toEqual([{ id: first.id, canonicalPath: "/b/same-name" }]);
  });

  it("applies frozen rerank signals case-insensitively with the query trimmed", () => {
    const exact = candidate({
      name: "TDD",
      canonicalPath: "/p/tdd",
      contentHash: createHash("sha256").update("1").digest("hex"),
      bm25: 1,
    });
    const keyword = candidate({
      name: "testing-guide",
      canonicalPath: "/p/testing",
      contentHash: createHash("sha256").update("2").digest("hex"),
      keywords: ["TDD"],
      bm25: 1,
    });
    // exactName 0.9 + queryInName 0.4 > keywordExact 0.3（同 bm25 下 final 定序）。
    const results = rankResults([keyword, exact], "  tdd  ", 10, tokenize);
    expect(results[0]?.name).toBe("TDD");
  });

  it("caps the rerank contribution and freezes the ranking version", () => {
    expect(RANKING_VERSION).toBe("rerank-2026-09-17-v1");
    const boosted = candidate({
      name: "alpha",
      canonicalPath: "/p/alpha",
      contentHash: "f".repeat(64),
      keywords: ["alpha"],
      description: "alpha alpha alpha",
      bm25: 30,
    });
    const results = rankResults([boosted], "alpha", 10, tokenize);
    // rerank = min(1, .9+.5+.4+.3+.2) = 1.0（上限生效）；
    // final = quantize(0.7×(30/38) + 0.3×1.0)（12 位有效数字稳定量化）。
    expect(results[0]?.score).toBe(Number((0.7 * (30 / 38) + 0.3).toPrecision(12)));
  });

  it("limits results to the requested limit", () => {
    const many = Array.from({ length: 8 }, (_, index) =>
      candidate({
        name: `skill-${index}`,
        canonicalPath: `/p/skill-${index}`,
        contentHash: createHash("sha256").update(String(index)).digest("hex"),
        bm25: 10 - index,
      }),
    );
    expect(rankResults(many, "skill", 3, tokenize)).toHaveLength(3);
    expect(rankResults(many, "skill", 50, tokenize)).toHaveLength(8);
  });

  it("keeps deterministic output regardless of candidate input order", () => {
    const base = [
      candidate({
        name: "gamma",
        canonicalPath: "/p/gamma",
        contentHash: "1".repeat(64),
        bm25: 12,
      }),
      candidate({
        name: "delta",
        canonicalPath: "/p/delta",
        contentHash: "2".repeat(64),
        bm25: 12,
      }),
      candidate({ name: "beta", canonicalPath: "/p/beta", contentHash: "3".repeat(64), bm25: 15 }),
    ];
    const forward = rankResults(base, "query", 10, tokenize);
    const backward = rankResults([...base].reverse(), "query", 10, tokenize);
    expect(forward).toEqual(backward);
  });
});
