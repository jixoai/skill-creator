/**
 * @jixoai/search sqlite 后端资格测试（对拍基准，冻结地板与主仓一致）。
 *
 * User input [2026-09-21]：「从主仓基准提取合成语料与 45 条标注 query 作包级对拍
 * fixture；R@5 ≥ 0.95、typo 类 R@5 = 1.00、MRR ≥ 0.95——这是 sqlite 后端的资格
 * 测试，tantivy 后端接入后同一 fixture 复用。」（jixoai-search-core 1.10。）
 *
 * Orthogonal intents:
 *   [1] 资格地板：主仓 benchmark 语料（119 manifest + 11 合成）经包 API 检索，
 *       指标不低于 docs/search-design.md §4 现行基准。
 *   [2] 文档构造复刻：materializeCorpus + parser 抽取（fence 状态机/heading/截断）
 *       与 /tmp/tantivy-smoke/benchmark-run.mjs 逐字符同源。
 *
 * 与主仓基准的口径差异（有意声明）：包 API 不做 contentHash 折叠与 rerank（属消费方
 * ranking v2 职责）；评测在测试侧按 name 折叠（content 重复 ⟹ name 相同，为产品
 * contentHash 折叠的上界近似），排序即冻结 score desc → id asc。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openIndex, type SearchDocument, type SearchIndex } from "../src/index.js";
import {
  BENCHMARK_CORPUS,
  BENCHMARK_LABELED_QUERIES,
  BENCHMARK_SYNTHETIC_SKILLS,
} from "./fixtures/benchmark.js";

/** 字段权重复刻主仓 FIELD_BOOST（src/daemon/skill-search/index.ts）。 */
const FIELDS = {
  name: { weight: 10 },
  description: { weight: 6 },
  keywords: { weight: 5 },
  triggers: { weight: 5 },
  headings: { weight: 3 },
  body: { weight: 1 },
} as const;

// ---------- parser 复刻（src/daemon/skill-search/parser.ts；与冒烟脚本同源） ----------
const HEADINGS_LIMIT = 30;
const BODY_LIMIT = 12000;
const FENCE_MARKER_RE = /^[ \t]*(?:```|~~~)/;
const HEADING_RE = /^#{1,4}[ \t]+(.+)$/gm;

function extractContent(rawText: string): { headings: string; body: string } {
  const marker = rawText.startsWith("---\n") ? rawText.indexOf("\n---\n") : -1;
  const content = marker >= 0 ? rawText.slice(marker + 5) : rawText;
  const headingLines: string[] = [];
  const bodyLines: string[] = [];
  let inFence = false;
  for (const line of content.split("\n")) {
    if (FENCE_MARKER_RE.test(line)) {
      inFence = !inFence;
      continue;
    }
    bodyLines.push(line);
    if (!inFence) headingLines.push(line);
  }
  const headings: string[] = [];
  for (const match of headingLines.join("\n").matchAll(HEADING_RE)) {
    headings.push(match[1]?.trim() ?? "");
    if (headings.length >= HEADINGS_LIMIT) break;
  }
  return { headings: headings.join("\n"), body: bodyLines.join("\n").slice(0, BODY_LIMIT) };
}

// ---------- materializeCorpus 复刻（内存版，不落盘 SKILL.md） ----------
function buildBenchmarkDocuments(): SearchDocument[] {
  const docs: SearchDocument[] = [];
  for (const entry of BENCHMARK_CORPUS) {
    const frontmatter: string[] = [];
    if (entry.name) frontmatter.push(`name: ${JSON.stringify(entry.name)}`);
    if (entry.description) frontmatter.push(`description: ${JSON.stringify(entry.description)}`);
    const text =
      frontmatter.length > 0
        ? `---\n${frontmatter.join("\n")}\n---\n${entry.bodyHead}`
        : entry.bodyHead;
    const parsed = extractContent(text);
    const valid = Boolean(entry.name) && Boolean(entry.description);
    docs.push({
      id: `doc-${String(docs.length).padStart(3, "0")}`,
      fields: {
        name: valid ? entry.name : entry.directoryName,
        description: valid ? entry.description : "",
        keywords: "",
        triggers: "",
        headings: parsed.headings,
        body: parsed.body,
      },
      stored: { name: valid ? entry.name : entry.directoryName },
    });
  }
  for (const skill of BENCHMARK_SYNTHETIC_SKILLS) {
    const frontmatter = [
      `name: ${JSON.stringify(skill.name)}`,
      `description: ${JSON.stringify(skill.description)}`,
      `keywords:\n${skill.keywords.map((k) => `  - ${JSON.stringify(k)}`).join("\n")}`,
    ];
    if (skill.triggers.length > 0) {
      frontmatter.push(
        `triggers:\n${skill.triggers.map((t) => `  - ${JSON.stringify(t)}`).join("\n")}`,
      );
    }
    const headingsBlock = skill.headings.map((h) => `## ${h}`).join("\n");
    const text = `---\n${frontmatter.join("\n")}\n---\n${headingsBlock}\n${skill.body}\n`;
    const parsed = extractContent(text);
    docs.push({
      id: `doc-${String(docs.length).padStart(3, "0")}`,
      fields: {
        name: skill.name,
        description: skill.description,
        keywords: skill.keywords.join(" "),
        triggers: skill.triggers.join(" "),
        headings: parsed.headings,
        body: parsed.body,
      },
      stored: { name: skill.name },
    });
  }
  return docs;
}

// ---------- 指标计算（主仓 test/skill-search-benchmark.test.ts evaluate 复刻 + name 折叠） ----------
interface Metrics {
  r5: number;
  r10: number;
  mrr: number;
  typoR5: number;
}

function evaluate(run: (query: string) => Array<{ name: string }>): Metrics {
  let r5 = 0;
  let r10 = 0;
  let reciprocalRank = 0;
  let typoR5 = 0;
  let typoCount = 0;
  for (const { q, expect, category } of BENCHMARK_LABELED_QUERIES) {
    // name 折叠：同名（= 产品侧 contentHash 折叠的上界近似）只占首个位次。
    const seenNames = new Set<string>();
    const folded = run(q).filter((result) => {
      if (seenNames.has(result.name)) return false;
      seenNames.add(result.name);
      return true;
    });
    const expected = new Set(expect);
    const hitNamesAt = (count: number) =>
      new Set(
        folded
          .slice(0, count)
          .filter((result) => expected.has(result.name))
          .map((r) => r.name),
      );
    const allHitNames = new Set(
      folded.filter((result) => expected.has(result.name)).map((r) => r.name),
    );
    r5 += hitNamesAt(5).size / expect.length;
    r10 += allHitNames.size / expect.length;
    const firstIndex = folded.findIndex((result) => expected.has(result.name));
    reciprocalRank += firstIndex >= 0 ? 1 / (firstIndex + 1) : 0;
    if (category === "typo") {
      typoR5 += hitNamesAt(5).size / expect.length;
      typoCount += 1;
    }
  }
  const total = BENCHMARK_LABELED_QUERIES.length;
  return {
    r5: r5 / total,
    r10: r10 / total,
    mrr: reciprocalRank / total,
    typoR5: typoR5 / typoCount,
  };
}

let sandbox = "";
let index: SearchIndex | null = null;

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "jixoai-search-benchmark-"));
});

afterEach(async () => {
  await index?.close();
  index = null;
  fs.rmSync(sandbox, { recursive: true, force: true });
});

describe("search backend qualification (sqlite, frozen benchmark corpus)", () => {
  it("meets the frozen floors on the main-repo benchmark corpus", async () => {
    expect(BENCHMARK_CORPUS.length).toBe(119);
    expect(BENCHMARK_SYNTHETIC_SKILLS).toHaveLength(11);
    expect(BENCHMARK_LABELED_QUERIES).toHaveLength(45);

    index = await openIndex({ directory: path.join(sandbox, "idx"), fields: FIELDS });
    await index.upsert(buildBenchmarkDocuments());

    const nameById = new Map<string, string>();
    for (const doc of buildBenchmarkDocuments()) {
      const name = doc.stored?.["name"];
      if (typeof name === "string") nameById.set(doc.id, name);
    }
    const results = new Map<string, Array<{ name: string }>>();
    for (const { q } of BENCHMARK_LABELED_QUERIES) {
      const raw = await index.search(q, { limit: 100 });
      results.set(
        q,
        raw.hits.flatMap((hit) => {
          const name = nameById.get(hit.id);
          return name === undefined ? [] : [{ name }];
        }),
      );
    }
    const metrics = evaluate((query) => results.get(query) ?? []);

    // 地板与主仓基准一致（docs/search-design.md §4：终版 R@5 0.993 / MRR 0.985 的安全余量）。
    expect(metrics.r5).toBeGreaterThanOrEqual(0.95);
    expect(metrics.r10).toBeGreaterThanOrEqual(0.95);
    expect(metrics.mrr).toBeGreaterThanOrEqual(0.95);
    expect(metrics.typoR5).toBe(1);
    console.info(
      `[jixoai-search-qualification] docs=${BENCHMARK_CORPUS.length + BENCHMARK_SYNTHETIC_SKILLS.length} ` +
        `queries=${BENCHMARK_LABELED_QUERIES.length} backend=sqlite ` +
        `R@5=${metrics.r5.toFixed(3)} R@10=${metrics.r10.toFixed(3)} ` +
        `MRR=${metrics.mrr.toFixed(3)} typoR@5=${metrics.typoR5.toFixed(2)}`,
    );
  });

  it("replays byte-identical ranking across a reopen (envelope reuse)", async () => {
    const documents = buildBenchmarkDocuments();
    const directory = path.join(sandbox, "idx");
    index = await openIndex({ directory, fields: FIELDS });
    await index.upsert(documents);
    const firstRun: string[] = [];
    for (const { q } of BENCHMARK_LABELED_QUERIES) {
      firstRun.push(JSON.stringify(await index.search(q, { limit: 10 })));
    }
    await index.close();
    index = null;

    const second = await openIndex({ directory, fields: FIELDS });
    index = second;
    for (const [i, { q }] of BENCHMARK_LABELED_QUERIES.entries()) {
      expect(JSON.stringify(await second.search(q, { limit: 10 }))).toBe(firstRun[i]);
    }
  });
});
