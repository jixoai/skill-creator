/**
 * @jixoai/search API 语义测试（backend-agnostic：sqlite 与 tantivy 同一组用例，
 * tasks 1.8 起 tantivy 为默认后端、sqlite 回落——两后端逐用例复用）。
 *
 * User input [2026-09-21]：「两后端仅召回实现不同，命中与分数逐位一致；
 * 幂等 upsert/分页/稳定排序/stored 回传不打分/remove/信封不匹配自动重建/
 * fuzzy-prefix/中英混合均为包级单测。」（jixoai-search-core 1.10/1.8。）
 *
 * Orthogonal intents:
 *   [1] 契约语义：幂等、分页 total、score desc → id asc、stored 不打分、remove。
 *   [2] 信封重建：tokenizerVersion 篡改后 openIndex 得空索引且成功。
 *   [3] 检索行为：typo（fuzzy）/前缀（prefix）/中文 bigram/camelCase/npm scope。
 *   [4] typed 拒绝面：非法参数与不可用后端的 SearchError 错误码。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openIndex, SearchError, type SearchBackend, type SearchIndex } from "../src/index.js";
import { rmSandboxRetry } from "./helpers/rm-sandbox.js";

const FIELDS = { name: { weight: 10 }, body: { weight: 1 } };

// 长 token fuzzy 冻结期望（P1-2；变体真实码点编辑距离经独立 DP 校准：
// len16 同长度距离 3 / len13 删除距离 3（|Δlen|=3）/ len16 距离 6 > 上限 3；
// len30 距离 6 = 上限 / 距离 7 > 上限。canonical 证据 /tmp/jixoai-fuzzy-canonical.mjs：
// MiniSearch 7.2 长词真实接受距离 3-6 且不按长度差钳 2——D1 冒烟 |m−n|>2 早退
// 是其自身简化）。
const LONG_WORD_16 = "abcdefghijklmnop";
const LONG_WORD_16_DIST_3_SAME_LENGTH = "abcxefghiqklmnwp";
const LONG_WORD_16_DIST_3_DELETION = "abcefghiklmnp";
const LONG_WORD_16_DIST_6 = "abxdeqghwjkzmjok";
const LONG_WORD_30 = "abcdefghijklmnopqrstuvwxyzabcd";
const LONG_WORD_30_DIST_6 = "abcqefghwjklmxopqrztuvwjyzabkd";
const LONG_WORD_30_DIST_7 = "abqdefwhijxlmnzpqrjtuvkxyzvbcd";

let sandbox = "";
let index: SearchIndex | null = null;

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "jixoai-search-test-"));
});

afterEach(async () => {
  await index?.close();
  index = null;
  rmSandboxRetry(sandbox);
});

function indexDirectory(): string {
  return path.join(sandbox, "idx");
}

async function openTestIndex(backend: SearchBackend): Promise<SearchIndex> {
  index = await openIndex({ directory: indexDirectory(), fields: FIELDS, backend });
  return index;
}

for (const backend of ["sqlite", "tantivy"] as const satisfies readonly SearchBackend[]) {
  describe(`search index api semantics (${backend} backend)`, () => {
    it("upserts idempotently: same id overwrites instead of duplicating", async () => {
      const search = await openTestIndex(backend);
      await search.upsert([
        {
          id: "a",
          fields: { name: "alpha beta", body: "greek letters" },
          stored: { kind: "letter" },
        },
      ]);
      await search.upsert([
        {
          id: "a",
          fields: { name: "gamma delta", body: "greek letters" },
          stored: { kind: "letter" },
        },
      ]);
      const stale = await search.search("alpha");
      expect(stale.total).toBe(0);
      const current = await search.search("gamma");
      expect(current.total).toBe(1);
      expect(current.hits[0]?.id).toBe("a");
      expect(current.hits[0]?.stored).toEqual({ kind: "letter" });
    });

    it("paginates with total counted before pagination", async () => {
      const search = await openTestIndex(backend);
      const docs = Array.from({ length: 15 }, (_, i) => ({
        id: `doc-${String(i).padStart(2, "0")}`,
        fields: { name: `shared document ${i}`, body: "shared corpus" },
      }));
      await search.upsert(docs);
      const firstPage = await search.search("shared");
      expect(firstPage.hits).toHaveLength(10);
      expect(firstPage.total).toBe(15);
      const secondPage = await search.search("shared", { limit: 10, offset: 10 });
      expect(secondPage.hits).toHaveLength(5);
      expect(secondPage.total).toBe(15);
      const beyond = await search.search("shared", { offset: 20 });
      expect(beyond.hits).toHaveLength(0);
      expect(beyond.total).toBe(15);
    });

    it("orders by score desc then id asc (frozen tie-break)", async () => {
      const search = await openTestIndex(backend);
      await search.upsert([
        { id: "c", fields: { name: "zebra", body: "shared" } },
        { id: "a", fields: { name: "zebra", body: "shared" } },
        { id: "b", fields: { name: "zebra", body: "shared" } },
        { id: "d", fields: { name: "shared zebra", body: "shared zebra shared" } },
      ]);
      const result = await search.search("zebra");
      expect(result.hits.map((hit) => hit.id)).toEqual(["d", "a", "b", "c"]);
      // 同分三连的 tie 内部严格按 id asc。
      const tied = result.hits.slice(1).map((hit) => hit.score);
      expect(tied[0]).toBe(tied[1]);
      expect(tied[1]).toBe(tied[2]);
    });

    it("returns stored payloads verbatim without affecting scores", async () => {
      const search = await openTestIndex(backend);
      await search.upsert([
        { id: "plain", fields: { name: "quantum tunneling", body: "physics" } },
        {
          id: "annotated",
          fields: { name: "quantum tunneling", body: "physics" },
          stored: { tags: ["physics"], depth: 3, nested: { ok: true } },
        },
      ]);
      const result = await search.search("quantum");
      expect(result.total).toBe(2);
      const plain = result.hits.find((hit) => hit.id === "plain");
      const annotated = result.hits.find((hit) => hit.id === "annotated");
      expect(plain?.score).toBe(annotated?.score);
      expect(plain?.stored).toBeUndefined();
      expect(annotated?.stored).toEqual({ tags: ["physics"], depth: 3, nested: { ok: true } });
    });

    it("removes documents so they no longer hit", async () => {
      const search = await openTestIndex(backend);
      await search.upsert([
        { id: "keep", fields: { name: "kernel scheduler", body: "" } },
        { id: "drop", fields: { name: "kernel panic", body: "" } },
      ]);
      expect((await search.search("kernel")).total).toBe(2);
      await search.remove(["drop"]);
      const remaining = await search.search("kernel");
      expect(remaining.total).toBe(1);
      expect(remaining.hits[0]?.id).toBe("keep");
      // 幂等 remove：不存在 id 不抛错。
      await search.remove(["drop", "never-existed"]);
      expect((await search.search("kernel")).total).toBe(1);
    });

    it("rebuilds an empty index when the envelope no longer matches", async () => {
      const first = await openTestIndex(backend);
      await first.upsert([{ id: "a", fields: { name: "webpack bundler", body: "" } }]);
      expect((await first.search("webpack")).total).toBe(1);
      await first.close();
      index = null;

      // 篡改信封的 tokenizerVersion：指纹不匹配 → openIndex 删除重建空索引（不抛错）。
      const envelopePath = path.join(indexDirectory(), "envelope.json");
      const envelope = JSON.parse(fs.readFileSync(envelopePath, "utf8")) as Record<string, unknown>;
      envelope.tokenizerVersion = "segmenter-bigram-v9";
      fs.writeFileSync(envelopePath, JSON.stringify(envelope), "utf8");

      const second = await openTestIndex(backend);
      index = second;
      const emptied = await second.search("webpack");
      expect(emptied.total).toBe(0);
      expect(emptied.hits).toEqual([]);
      // 重建后的索引功能完整。
      await second.upsert([{ id: "b", fields: { name: "webpack bundler", body: "" } }]);
      expect((await second.search("webpack")).total).toBe(1);
    });

    it("recalls typo queries via fuzzy variants and stems via prefix", async () => {
      const search = await openTestIndex(backend);
      await search.upsert([
        { id: "component", fields: { name: "component library", body: "" } },
        { id: "reactive", fields: { name: "reactive animations", body: "" } },
        { id: "unrelated", fields: { name: "database migrations", body: "" } },
      ]);
      // componet → component（编辑距离 1 ≤ round(0.2×8)=2）。
      const typo = await search.search("componet");
      expect(typo.total).toBe(1);
      expect(typo.hits[0]?.id).toBe("component");
      // react → reactive（prefix 前缀扩展）。
      const prefix = await search.search("react");
      expect(prefix.total).toBe(1);
      expect(prefix.hits[0]?.id).toBe("reactive");
    });

    it("recalls long tokens at frozen fuzzy distances 3-6 (MiniSearch canonical)", async () => {
      const search = await openTestIndex(backend);
      await search.upsert([
        { id: "w16", fields: { name: LONG_WORD_16, body: "" } },
        { id: "w30", fields: { name: LONG_WORD_30, body: "" } },
      ]);
      // len16 上限 = min(6, round(16×0.2)) = 3：距离 3 命中（同长度替换与
      // |Δlen|=3 删除两种形态——后者正是冒烟 |m−n|>2 早退会错误拒绝的形态）。
      expect(
        (await search.search(LONG_WORD_16_DIST_3_SAME_LENGTH)).hits.map((hit) => hit.id),
      ).toEqual(["w16"]);
      expect((await search.search(LONG_WORD_16_DIST_3_DELETION)).hits.map((hit) => hit.id)).toEqual(
        ["w16"],
      );
      // 距离 6 > 3：不命中。
      expect((await search.search(LONG_WORD_16_DIST_6)).total).toBe(0);
      // len30 上限 = min(6, round(30×0.2)) = 6：距离 6 命中、距离 7 不命中。
      expect((await search.search(LONG_WORD_30_DIST_6)).hits.map((hit) => hit.id)).toEqual(["w30"]);
      expect((await search.search(LONG_WORD_30_DIST_7)).total).toBe(0);
    });

    it("retrieves long CJK words exactly without fuzzy drift", async () => {
      const search = await openTestIndex(backend);
      await search.upsert([
        { id: "idiom", fields: { name: "实事求是", body: "" } },
        { id: "other", fields: { name: "软件工程", body: "" } },
      ]);
      // CJK 词精确命中（Segmenter 词典词为单 token）。
      expect((await search.search("实事求是")).hits.map((hit) => hit.id)).toEqual(["idiom"]);
      // CJK 跳过 fuzzy（P2-3 冻结规则）：同字集错排查询（是事/事求/求实 与文档
      // token 实事求是 无 exact/prefix 关系）零召回——若 CJK fuzzy 未跳过，
      // 1-2 码点编辑距离的 bigram 变体将命中。拉丁同距 typo 对照见上一下用例。
      expect((await search.search("是事求实")).total).toBe(0);
    });

    it("retrieves mixed Chinese/English corpora (bigram, camelCase, npm scope)", async () => {
      const search = await openTestIndex(backend);
      await search.upsert([
        { id: "zh", fields: { name: "React组件设计", body: "玻璃拟态 毛玻璃效果" } },
        { id: "scope", fields: { name: "@jixoai/ui-vite-plugin", body: "vite plugin bridge" } },
        { id: "camel", fields: { name: "getBoundsWidth", body: "useSyncExternalStore helper" } },
      ]);
      expect((await search.search("组件")).hits.map((hit) => hit.id)).toEqual(["zh"]);
      expect((await search.search("玻璃")).hits.map((hit) => hit.id)).toEqual(["zh"]);
      expect((await search.search("vite plugin")).hits.map((hit) => hit.id)).toEqual(["scope"]);
      expect((await search.search("getboundswidth")).hits.map((hit) => hit.id)).toEqual(["camel"]);
      expect((await search.search("jixoai")).hits.map((hit) => hit.id)).toEqual(["scope"]);
    });

    it("returns empty results for blank or separator-only queries", async () => {
      const search = await openTestIndex(backend);
      await search.upsert([{ id: "a", fields: { name: "anything", body: "" } }]);
      expect(await search.search("")).toEqual({ hits: [], total: 0 });
      expect(await search.search("  — · / ")).toEqual({ hits: [], total: 0 });
    });

    it("rejects invalid arguments with typed SearchError codes", async () => {
      const search = await openTestIndex(backend);
      await expect(search.upsert([{ id: "", fields: { name: "x" } }])).rejects.toMatchObject({
        code: "SEARCH_INVALID_ARGUMENT",
      });
      await expect(
        search.upsert([{ id: "a", fields: { unknown: "x" } } as never]),
      ).rejects.toMatchObject({ code: "SEARCH_INVALID_ARGUMENT" });
      // 容器收窄（P1-3）：null/非数组的 upsert/remove/search 入参 typed 拒绝，
      // 不得裸 TypeError。
      await expect(search.upsert(null as never)).rejects.toBeInstanceOf(SearchError);
      await expect(search.upsert(undefined as never)).rejects.toMatchObject({
        code: "SEARCH_INVALID_ARGUMENT",
      });
      await expect(search.upsert("not-an-array" as never)).rejects.toMatchObject({
        code: "SEARCH_INVALID_ARGUMENT",
      });
      await expect(search.remove(null as never)).rejects.toBeInstanceOf(SearchError);
      await expect(search.remove(42 as never)).rejects.toMatchObject({
        code: "SEARCH_INVALID_ARGUMENT",
      });
      await expect(search.search(null as never)).rejects.toBeInstanceOf(SearchError);
      await expect(search.search(7 as never)).rejects.toMatchObject({
        code: "SEARCH_INVALID_ARGUMENT",
      });
      // 混合批次：一条合法一条非法 → 整批拒绝、零写入。
      await expect(
        search.upsert([
          { id: "would-exist", fields: { name: "zero write proof" } },
          { id: "", fields: { name: "invalid empty id" } },
        ]),
      ).rejects.toMatchObject({ code: "SEARCH_INVALID_ARGUMENT" });
      expect((await search.search("zero write proof")).total).toBe(0);
      await expect(search.search("x", { limit: 101 })).rejects.toMatchObject({
        code: "SEARCH_INVALID_ARGUMENT",
      });
      await expect(search.search("x", { limit: 0 })).rejects.toMatchObject({
        code: "SEARCH_INVALID_ARGUMENT",
      });
      await expect(search.remove([""])).rejects.toMatchObject({
        code: "SEARCH_INVALID_ARGUMENT",
      });
      await expect(openIndex({ directory: indexDirectory(), fields: {} })).rejects.toMatchObject({
        code: "SEARCH_INVALID_ARGUMENT",
      });
    });

    it("reports SEARCH_IO after close", async () => {
      const search = await openTestIndex(backend);
      await search.close();
      index = null;
      await expect(search.search("x")).rejects.toMatchObject({ code: "SEARCH_IO" });
      await expect(search.close()).resolves.toBeUndefined();
    });

    it("reuses an existing index across openIndex calls when the envelope matches", async () => {
      const first = await openTestIndex(backend);
      await first.upsert([{ id: "persist", fields: { name: "durable index", body: "" } }]);
      await first.close();
      index = null;

      const second = await openTestIndex(backend);
      index = second;
      const result = await second.search("durable");
      expect(result.total).toBe(1);
      expect(result.hits[0]?.id).toBe("persist");
    });
  });
}

describe("SearchError shape", () => {
  it("carries the typed code", () => {
    const error = new SearchError("SEARCH_IO", "boom");
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe("SEARCH_IO");
    expect(error.name).toBe("SearchError");
  });
});
