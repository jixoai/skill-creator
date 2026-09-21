/**
 * 资格测试语料构造（benchmark.test.ts 与 backends-parity.test.ts 共享）。
 *
 * User input [2026-09-21]：「从主仓基准提取合成语料与 45 条标注 query 作包级对拍
 * fixture；R@5 ≥ 0.95、typo 类 R@5 = 1.00、MRR ≥ 0.95——sqlite / tantivy 同一
 * fixture 复用。」（jixoai-search-core 1.10/1.8。）
 *
 * Orthogonal intents:
 *   [1] 字段权重复刻主仓 FIELD_BOOST（src/daemon/skill-search/index.ts）。
 *   [2] 文档构造复刻：materializeCorpus + parser 抽取（fence 状态机/heading/截断）
 *       与 /tmp/tantivy-smoke/benchmark-run.mjs 逐字符同源。
 */
import type { SearchDocument } from "../../src/index.js";
import { BENCHMARK_CORPUS, BENCHMARK_SYNTHETIC_SKILLS } from "./benchmark.js";

/** 字段权重复刻主仓 FIELD_BOOST（src/daemon/skill-search/index.ts）。 */
export const BENCHMARK_FIELDS = {
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
export function buildBenchmarkDocuments(): SearchDocument[] {
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
