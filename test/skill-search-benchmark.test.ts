/**
 * 搜索质量回归基准（冻结 ranking 全链路）。
 *
 * User input [2026-09-17]: "回归基准固化：合成语料 + 45 条标注 query + 指标断言
 * （R@5 ≥ 0.95 地板、typo 类 R@5 = 1.00、MRR ≥ 0.95）；结果按 contentHash 折叠后计分；
 * 次序可重放。"（docs/search-design.md §4/§11 基准方法论）
 *
 * Orthogonal intents:
 *   [1] 静态语料 + 标注 query 的端到端指标（真 service + 真持久索引）。
 *   [2] tokenizer/ranking 回归地板与输出可重放性。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSkillSearchServiceWithRoots } from "../src/daemon/skill-search/service.js";
import { scanSkillRoots, type SkillRoot } from "../src/daemon/skill-search/scanner.js";
import { GLOBAL_WORKSPACE_ID, ProviderIdSchema } from "../src/shared/contracts/workspaces.js";
import { setHomeOverride } from "../src/shared/paths.js";

interface CorpusEntry {
  directoryName: string;
  name: string;
  description: string;
  bodyHead: string;
}

interface SyntheticSkill {
  name: string;
  description: string;
  keywords: string[];
  triggers: string[];
  headings: string[];
  body: string;
}

interface LabeledQuery {
  q: string;
  expect: string[];
  category: "en" | "mixed" | "zh" | "ident" | "typo";
}

const fixturesDir = path.join(import.meta.dirname, "fixtures", "search-corpus");
const corpus: CorpusEntry[] = JSON.parse(
  fs.readFileSync(path.join(fixturesDir, "corpus.json"), "utf8"),
) as CorpusEntry[];
const syntheticSkills: SyntheticSkill[] = JSON.parse(
  fs.readFileSync(path.join(fixturesDir, "synthetic.json"), "utf8"),
) as SyntheticSkill[];
const labeledQueries: LabeledQuery[] = JSON.parse(
  fs.readFileSync(path.join(fixturesDir, "queries.json"), "utf8"),
) as LabeledQuery[];

let sandbox = "";
const previousHome = process.env.SKILL_CREATOR_HOME;

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "skill-search-benchmark-test-"));
  process.env.SKILL_CREATOR_HOME = path.join(sandbox, "state");
  setHomeOverride(path.join(sandbox, "state"));
});

afterEach(async () => {
  setHomeOverride(null);
  if (previousHome === undefined) delete process.env.SKILL_CREATOR_HOME;
  else process.env.SKILL_CREATOR_HOME = previousHome;
  // 引擎句柄先释放再删沙箱：dispose 是 async 完成屏障（引擎 close 落定）。
  for (const service of trackedServices) await service.dispose();
  trackedServices.length = 0;
  fs.rmSync(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

/** 创建即登记：afterEach 统一 dispose（watcher + sqlite 引擎句柄）。 */
function trackService<T extends { dispose: () => void | Promise<void> }>(service: T): T {
  trackedServices.push(service);
  return service;
}
const trackedServices: Array<{ dispose: () => void | Promise<void> }> = [];

/** 真实形态语料落盘：119 个 manifest 快照 + 11 个合成 skill（含 keywords/triggers）。 */
function materializeCorpus(): SkillRoot {
  const skillsRoot = path.join(sandbox, "roots", "claude", "skills");
  for (const entry of corpus) {
    const directory = path.join(skillsRoot, entry.directoryName);
    fs.mkdirSync(directory, { recursive: true });
    const frontmatter: string[] = [];
    if (entry.name) frontmatter.push(`name: ${JSON.stringify(entry.name)}`);
    if (entry.description) frontmatter.push(`description: ${JSON.stringify(entry.description)}`);
    const document =
      frontmatter.length > 0
        ? `---\n${frontmatter.join("\n")}\n---\n${entry.bodyHead}`
        : entry.bodyHead;
    fs.writeFileSync(path.join(directory, "SKILL.md"), document, "utf8");
  }
  for (const skill of syntheticSkills) {
    const directory = path.join(skillsRoot, skill.name);
    fs.mkdirSync(directory, { recursive: true });
    const frontmatter = [
      `name: ${JSON.stringify(skill.name)}`,
      `description: ${JSON.stringify(skill.description)}`,
      `keywords:\n${skill.keywords.map((keyword) => `  - ${JSON.stringify(keyword)}`).join("\n")}`,
    ];
    if (skill.triggers.length > 0) {
      frontmatter.push(
        `triggers:\n${skill.triggers.map((t) => `  - ${JSON.stringify(t)}`).join("\n")}`,
      );
    }
    const headings = skill.headings.map((heading) => `## ${heading}`).join("\n");
    fs.writeFileSync(
      path.join(directory, "SKILL.md"),
      `---\n${frontmatter.join("\n")}\n---\n${headings}\n${skill.body}\n`,
      "utf8",
    );
  }
  return {
    rootPath: skillsRoot,
    workspaceId: GLOBAL_WORKSPACE_ID,
    providerId: ProviderIdSchema.parse("claude-code"),
  };
}

interface Metrics {
  r5: number;
  r10: number;
  mrr: number;
  typoR5: number;
}

/** 指标计算：结果已由产品 ranking 按 contentHash 折叠；expect 为 any-of 语义。 */
function evaluate(run: (query: string) => Array<{ name: string }>): Metrics {
  let r5 = 0;
  let r10 = 0;
  let reciprocalRank = 0;
  let typoR5 = 0;
  let typoCount = 0;
  for (const { q, expect, category } of labeledQueries) {
    const top = run(q);
    const expected = new Set(expect);
    // 命中按期望名去重（同名不同 canonical 的多结果只计一次），保证 recall ≤ 1。
    const hitNamesAt = (count: number) =>
      new Set(
        top
          .slice(0, count)
          .filter((result) => expected.has(result.name))
          .map((r) => r.name),
      );
    const allHitNames = new Set(
      top.filter((result) => expected.has(result.name)).map((r) => r.name),
    );
    r5 += hitNamesAt(5).size / expect.length;
    r10 += allHitNames.size / expect.length;
    const firstIndex = top.findIndex((result) => expected.has(result.name));
    reciprocalRank += firstIndex >= 0 ? 1 / (firstIndex + 1) : 0;
    if (category === "typo") {
      typoR5 += hitNamesAt(5).size / expect.length;
      typoCount += 1;
    }
  }
  const total = labeledQueries.length;
  return {
    r5: r5 / total,
    r10: r10 / total,
    mrr: reciprocalRank / total,
    typoR5: typoR5 / typoCount,
  };
}

describe("skill search quality benchmark (frozen ranking pipeline)", () => {
  it("meets the regression floors on the frozen corpus", async () => {
    const root = materializeCorpus();
    expect(corpus.length).toBeGreaterThanOrEqual(80);
    expect(syntheticSkills).toHaveLength(11);
    expect(labeledQueries).toHaveLength(45);

    const service = trackService(createSkillSearchServiceWithRoots(() => [root]));
    const results = new Map<string, Array<{ name: string }>>();
    for (const { q } of labeledQueries) {
      results.set(
        q,
        (await service.search(q, { limit: 10 })).map((result) => ({ name: result.name })),
      );
    }
    const finalMetrics = evaluate((query) => results.get(query) ?? []);

    // 回归地板（docs/search-design.md §4：终版指标 R@5 0.985 / MRR 0.974 的安全余量）。
    expect(finalMetrics.r5).toBeGreaterThanOrEqual(0.95);
    expect(finalMetrics.r10).toBeGreaterThanOrEqual(0.95);
    expect(finalMetrics.mrr).toBeGreaterThanOrEqual(0.95);
    expect(finalMetrics.typoR5).toBe(1);
    // 控制台输出实际数字，便于回归时对比漂移。
    console.info(
      `[search-benchmark] corpus=${corpus.length + syntheticSkills.length} queries=${labeledQueries.length} ` +
        `R@5=${finalMetrics.r5.toFixed(3)} R@10=${finalMetrics.r10.toFixed(3)} ` +
        `MRR=${finalMetrics.mrr.toFixed(3)} typoR@5=${finalMetrics.typoR5.toFixed(2)}`,
    );
  });

  it("replays byte-identical output across a fresh (stat-stable) second run", async () => {
    const root = materializeCorpus();
    const service = trackService(createSkillSearchServiceWithRoots(() => [root]));
    const firstRun: string[] = [];
    for (const { q } of labeledQueries) {
      firstRun.push(JSON.stringify(await service.search(q, { limit: 10 })));
    }
    // 新进程视角：重新装配 service（freshen 走 stat 全等路径），输出必须逐字节相等。
    const secondService = trackService(createSkillSearchServiceWithRoots(() => [root]));
    for (const [index, { q }] of labeledQueries.entries()) {
      expect(JSON.stringify(await secondService.search(q, { limit: 10 }))).toBe(firstRun[index]);
    }
  });

  it("folds content duplicates in benchmark-shaped fixtures", async () => {
    const root = materializeCorpus();
    // 复制一份语料（同内容不同 canonical 路径）验证折叠端到端生效。
    const source = path.join(
      sandbox,
      "roots",
      "claude",
      "skills",
      corpus[0]?.directoryName ?? "acp",
    );
    const aliasRoot = path.join(sandbox, "roots", "codex", "skills");
    fs.mkdirSync(aliasRoot, { recursive: true });
    fs.cpSync(source, path.join(aliasRoot, path.basename(source)), { recursive: true });
    const service = trackService(
      createSkillSearchServiceWithRoots(() => [
        root,
        {
          rootPath: aliasRoot,
          workspaceId: GLOBAL_WORKSPACE_ID,
          providerId: ProviderIdSchema.parse("codex"),
        },
      ]),
    );
    const name = corpus[0]?.name || corpus[0]?.directoryName || "acp";
    const results = await service.search(name, { limit: 10 });
    const primary = results.find((result) => result.name === name);
    if (!primary) throw new Error("expected the duplicated skill to match");
    // 同 contentHash 两份物理拷贝（不同 canonical 路径）折叠为一：主结果 + 1 个
    // duplicate 指向 codex root 的拷贝；installations 仍按各自 canonical doc 绑定。
    expect(primary.duplicates).toHaveLength(1);
    expect(primary.duplicates[0]?.canonicalPath).toBe(
      fs.realpathSync(path.join(aliasRoot, path.basename(source))),
    );
  });
});
