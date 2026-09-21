/**
 * tantivy ↔ sqlite 两后端逐位对拍（jixoai-search-core tasks 1.8 绿门）。
 *
 * User input [2026-09-21]：「tantivy 召回 + JS 打分……与 sqlite 后端同一路径
 * scoreCorpus 计分排序分页——两后端命中与分数逐位一致（浮点容差 1e-9）。」
 *
 * Orthogonal intents:
 *   [1] 基准语料对拍：同一 130 文档语料同一 45 query，两后端的 id 序列严格一致、
 *       score 差 ≤ 1e-9、total 相等（打分在共享层，召回面逐 token 同构）。
 *   [2] backend 切换 = 信封不匹配 = 自动重建：同目录 sqlite→tantivy 与
 *       tantivy→sqlite 双向打开均得空索引且不抛错（backend 名进信封）。
 *   [3] 独立召回 oracle（P2-1，codex 复核处置）：第三个轻量 brute-force 实现
 *       （遍历语料 unique term，按 exact ∪ prefix ∪ fuzzy 规则独立算候选集），
 *       分别断言两后端各自的召回候选集 == oracle 集合——对拍一致只能证明共同
 *       进入评分层的结果一致，不能排除两后端共享变体错误或共同漏召回。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openIndex, type SearchDocument, type SearchIndex } from "../src/index.js";
import { createSkillTokenizer } from "../src/tokenizer.js";
import { BENCHMARK_LABELED_QUERIES } from "./fixtures/benchmark.js";
import { BENCHMARK_FIELDS, buildBenchmarkDocuments } from "./fixtures/benchmark-docs.js";

/** 冻结浮点容差（理想逐位一致；两后端词表装载序在 astral 码点排序上理论可差 1ulp）。 */
const SCORE_TOLERANCE = 1e-9;

// ---------- 独立 brute-force 召回 oracle（P2-1；规则复述自冻结口径，不复用
// src/scoring.ts 的展开实现——正交性是本测试的存在理由） ----------
const oracleTokenizer = createSkillTokenizer();
/** 与 openIndex 默认一致的冻结参数（本文件不显式传 fuzzy/prefix）。 */
const ORACLE_FUZZY_RATIO = 0.2;
const ORACLE_FUZZY_CAP = 6;
const ORACLE_PREFIX = true;
const ORACLE_CJK_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/** 独立码点 Levenshtein（朴素 DP，无早退无钳位）。 */
function oracleLevenshtein(a: string, b: string): number {
  const left = [...a];
  const right = [...b];
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= right.length; j += 1) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[right.length];
}

/** 语料物化：doc → field → token 集 + 全语料 unique term 集。 */
function materializeCorpus(
  documents: SearchDocument[],
  fieldNames: string[],
): {
  docTerms: Map<string, Set<string>[]>;
  vocabulary: Set<string>;
} {
  const docTerms = new Map<string, Set<string>[]>();
  const vocabulary = new Set<string>();
  for (const doc of documents) {
    const perField = fieldNames.map((field) => {
      const terms = new Set(oracleTokenizer.tokenize(doc.fields[field] ?? ""));
      for (const term of terms) vocabulary.add(term);
      return terms;
    });
    docTerms.set(doc.id, perField);
  }
  return { docTerms, vocabulary };
}

/**
 * 独立候选集计算：query token 在 unique 词表上的 exact ∪ prefix ∪ fuzzy
 * 成员判定（fuzzy 距离 = min(6, round(len×0.2))，CJK token 跳过），再投影到
 * 含命中 term 的 doc。权重全为正的字段集（BENCHMARK_FIELDS）下字段维度
 * 不影响成员语义。
 */
function oracleRecall(
  corpus: ReturnType<typeof materializeCorpus>,
  fieldNames: string[],
  weights: Record<string, number>,
  query: string,
): Set<string> {
  const derivedPerToken = oracleTokenizer.tokenize(query).map((token) => {
    const maxDistance = Math.min(
      ORACLE_FUZZY_CAP,
      Math.round([...token].length * ORACLE_FUZZY_RATIO),
    );
    const derived = new Set<string>([token]);
    for (const term of corpus.vocabulary) {
      if (term === token) continue;
      if (ORACLE_PREFIX && term.startsWith(token)) {
        derived.add(term);
        continue;
      }
      if (maxDistance >= 1 && !ORACLE_CJK_RE.test(token)) {
        if (oracleLevenshtein(token, term) <= maxDistance) derived.add(term);
      }
    }
    return derived;
  });
  const hits = new Set<string>();
  if (derivedPerToken.length === 0) return hits;
  for (const [docId, perField] of corpus.docTerms) {
    const matched = perField.some(
      (terms, fieldIndex) =>
        (weights[fieldNames[fieldIndex] ?? ""] ?? 0) > 0 &&
        derivedPerToken.some((derived) => [...terms].some((term) => derived.has(term))),
    );
    if (matched) hits.add(docId);
  }
  return hits;
}

/** 后端实际候选集：分页取全（total = 分页前命中数，hits = score>0 的 doc）。 */
async function recallViaSearch(index: SearchIndex, query: string): Promise<Set<string>> {
  const ids = new Set<string>();
  let offset = 0;
  for (;;) {
    const page = await index.search(query, { limit: 100, offset });
    if (page.hits.length === 0) return ids;
    for (const hit of page.hits) ids.add(hit.id);
    offset += page.hits.length;
    if (offset >= page.total) return ids;
  }
}

let sandbox = "";
const openIndexes: SearchIndex[] = [];

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "jixoai-search-parity-"));
});

afterEach(async () => {
  for (const index of openIndexes.splice(0)) {
    await index.close();
  }
  fs.rmSync(sandbox, { recursive: true, force: true });
});

describe("tantivy vs sqlite backend parity (frozen benchmark corpus)", () => {
  it("matches hits (id order + scores + total) across all 45 labeled queries", async () => {
    const documents = buildBenchmarkDocuments();
    const sqlite = await openIndex({
      directory: path.join(sandbox, "idx-sqlite"),
      fields: BENCHMARK_FIELDS,
      backend: "sqlite",
    });
    const tantivy = await openIndex({
      directory: path.join(sandbox, "idx-tantivy"),
      fields: BENCHMARK_FIELDS,
      backend: "tantivy",
    });
    openIndexes.push(sqlite, tantivy);
    await sqlite.upsert(documents);
    await tantivy.upsert(documents);

    let maxScoreDelta = 0;
    let comparedHits = 0;
    for (const { q } of BENCHMARK_LABELED_QUERIES) {
      const left = await sqlite.search(q, { limit: 100 });
      const right = await tantivy.search(q, { limit: 100 });
      expect(
        right.total,
        `total mismatch for query "${q}" (sqlite=${left.total}, tantivy=${right.total})`,
      ).toBe(left.total);
      expect(
        right.hits.map((hit) => hit.id),
        `hit id order mismatch for query "${q}"`,
      ).toEqual(left.hits.map((hit) => hit.id));
      for (const [i, expected] of left.hits.entries()) {
        const actual = right.hits[i];
        expect(actual?.stored).toEqual(expected.stored);
        const delta = Math.abs((actual?.score ?? 0) - expected.score);
        maxScoreDelta = Math.max(maxScoreDelta, delta);
        comparedHits += 1;
      }
    }
    expect(maxScoreDelta).toBeLessThanOrEqual(SCORE_TOLERANCE);
    expect(comparedHits).toBeGreaterThan(0);
    console.info(
      `[jixoai-search-parity] queries=${BENCHMARK_LABELED_QUERIES.length} hits=${comparedHits} ` +
        `maxScoreDelta=${maxScoreDelta.toExponential(2)} (tolerance ${SCORE_TOLERANCE.toExponential(0)})`,
    );
  });

  it("matches an independent brute-force recall oracle per backend (candidate sets)", async () => {
    const documents = buildBenchmarkDocuments();
    const fieldNames = Object.keys(BENCHMARK_FIELDS);
    const weights: Record<string, number> = {};
    for (const [field, spec] of Object.entries(BENCHMARK_FIELDS)) weights[field] = spec.weight;
    const corpus = materializeCorpus(documents, fieldNames);

    for (const backend of ["sqlite", "tantivy"] as const) {
      const index = await openIndex({
        directory: path.join(sandbox, `oracle-${backend}`),
        fields: BENCHMARK_FIELDS,
        backend,
      });
      openIndexes.push(index);
      await index.upsert(documents);

      let oracleEmpty = 0;
      for (const { q } of BENCHMARK_LABELED_QUERIES) {
        const expected = oracleRecall(corpus, fieldNames, weights, q);
        const actual = await recallViaSearch(index, q);
        if (expected.size === 0) oracleEmpty += 1;
        const missing = [...expected].filter((id) => !actual.has(id));
        const extra = [...actual].filter((id) => !expected.has(id));
        expect(
          missing.length === 0 && extra.length === 0,
          `oracle mismatch (${backend}) for query "${q}": ` +
            `missing=[${missing.slice(0, 5).join(",")}] extra=[${extra.slice(0, 5).join(",")}]`,
        ).toBe(true);
      }
      // 语料对拍同款健全性：oracle 集非平凡（既有命中也有未命中，不是恒全/恒空）。
      expect(oracleEmpty).toBeLessThan(BENCHMARK_LABELED_QUERIES.length);
      console.info(
        `[jixoai-search-oracle] backend=${backend} queries=${BENCHMARK_LABELED_QUERIES.length} ` +
          `emptyOracle=${oracleEmpty} docs=${documents.length}`,
      );
    }
  });

  it("rebuilds an empty index when the backend switches in either direction", async () => {
    const directory = path.join(sandbox, "idx");
    const fields = { name: { weight: 10 }, body: { weight: 1 } };

    // sqlite → tantivy：backend 名进信封，切换即不匹配 → 删除重建空索引（不抛错）。
    const sqlite = await openIndex({ directory, fields, backend: "sqlite" });
    await sqlite.upsert([{ id: "a", fields: { name: "webpack bundler", body: "" } }]);
    expect((await sqlite.search("webpack")).total).toBe(1);
    await sqlite.close();

    const tantivy = await openIndex({ directory, fields, backend: "tantivy" });
    openIndexes.push(tantivy);
    const emptied = await tantivy.search("webpack");
    expect(emptied.total).toBe(0);
    expect(emptied.hits).toEqual([]);
    // 重建后的 tantivy 索引功能完整。
    await tantivy.upsert([{ id: "b", fields: { name: "webpack bundler", body: "" } }]);
    expect((await tantivy.search("webpack")).total).toBe(1);
    await tantivy.close();
    openIndexes.splice(openIndexes.indexOf(tantivy), 1);

    // tantivy → sqlite：对称方向同样重建。
    const backToSqlite = await openIndex({ directory, fields, backend: "sqlite" });
    openIndexes.push(backToSqlite);
    expect((await backToSqlite.search("webpack")).total).toBe(0);
  });
});
