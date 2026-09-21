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
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openIndex, type SearchIndex } from "../src/index.js";
import { BENCHMARK_LABELED_QUERIES } from "./fixtures/benchmark.js";
import { BENCHMARK_FIELDS, buildBenchmarkDocuments } from "./fixtures/benchmark-docs.js";

/** 冻结浮点容差（理想逐位一致；两后端词表装载序在 astral 码点排序上理论可差 1ulp）。 */
const SCORE_TOLERANCE = 1e-9;

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
