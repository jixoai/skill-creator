/**
 * 用户原始需求 [2026-09-25]（切片③ skill-wiki-maintainer tasks 1.1）：「SDK 契约
 * 层：DistillBudgets/PromotedFromEntry（parse/merge）/DistillProposal/ItemResult
 * + planDistillation 纯函数」——门禁 fixture：追加合并/锚点未中/model-invalid
 * 诊断/预算超限/title≤120 + promotedFrom 四 fixture（null/单条/双条/坏值
 * round-trip，exact bytes）+ 同语料两次构建候选序与 corpusDigest 一致 + cluster
 * 并列 tie-break + slugify 双路。
 * 正交意图：[1] 钉死契约收窄与 plan 纯函数语义（零写盘）；[2] 钉死 promotedFrom
 * 信封与 corpus digest 的 canonical 字节。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DISTILL_BUDGETS,
  DISTILL_EVIDENCE_THRESHOLD,
  SkillWikiError,
  canonicalCorpusProjection,
  distillCorpusDigest,
  distillProposalDigest,
  formatPromotedFrom,
  mergePromotedFromEntry,
  openWikiWorkspace,
  parsePromotedFrom,
  patternContentHash,
  planDistillation,
  slugifyPatternTitle,
} from "../src/index.js";
import {
  RUN_A,
  RUN_B,
  SCOPE_A,
  SCOPE_B,
  corpusFixture,
  createProposalFixture,
} from "./distill-fixtures.js";

const tempDirs: string[] = [];
function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-wiki-distill-"));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  while (tempDirs.length > 0) fs.rmSync(tempDirs.pop() as string, { recursive: true, force: true });
});

describe("slugifyPatternTitle（W raw 导出：v1 = 现实现行为快照）", () => {
  it("keeps ASCII behaviour identical and strips mixed non-ASCII runs", () => {
    expect(slugifyPatternTitle("Pin Exit Codes")).toBe("pin-exit-codes");
    expect(slugifyPatternTitle("Error 处理 Guidelines")).toBe("error-guidelines");
    expect(slugifyPatternTitle("--Leading--and--trailing--")).toBe("leading-and-trailing");
  });

  it("truncates to 48 chars", () => {
    expect(slugifyPatternTitle("a".repeat(60))).toBe("a".repeat(48));
    expect(slugifyPatternTitle("a".repeat(60)).length).toBe(48);
  });

  it("returns the raw empty string for pure-CJK titles (no built-in fallback)", () => {
    expect(slugifyPatternTitle("错误处理心得")).toBe("");
  });

  it("dual path: distillation plans model-invalid(empty-slug) while appendPattern falls back to 'pattern'", () => {
    const dir = makeTempDir();
    const plan = planDistillation(dir, corpusFixture(), [
      createProposalFixture({ title: "错误处理心得" }),
    ]);
    expect(plan.items).toHaveLength(0);
    expect(plan.diagnostics).toEqual([
      { ordinal: 0, reason: "empty-slug", message: expect.stringContaining("empty") },
    ]);

    const wiki = openWikiWorkspace(makeTempDir());
    const appended = wiki.appendPattern({
      title: "错误处理心得",
      body: "纯汉字标题仍可经 append 通道落盘",
    });
    expect(appended.item.name).toBe("pattern");
    expect(appended.deduplicated).toBe(false);
  });

  it("appendPattern keeps its -N suffix branch for slug collisions on distinct content", () => {
    const wiki = openWikiWorkspace(makeTempDir());
    wiki.appendPattern({ title: "Same Title", body: "one" });
    const second = wiki.appendPattern({ title: "Same Title", body: "two" });
    expect(second.item.name).toBe("same-title-2");
  });
});

describe("promotedFrom 信封 round-trip（L：四 fixture，exact bytes）", () => {
  const entryA = { runId: RUN_A, sourceScope: SCOPE_A, sourcePatternIds: ["frag-one"] };
  const entryB = { runId: RUN_B, sourceScope: SCOPE_B, sourcePatternIds: ["frag-one"] };
  const singleBytes = `[{"runId":"${RUN_A}","sourcePatternIds":["frag-one"],"sourceScope":"${SCOPE_A}"}]`;
  const doubleBytes = `[{"runId":"${RUN_A}","sourcePatternIds":["frag-one"],"sourceScope":"${SCOPE_A}"},{"runId":"${RUN_B}","sourcePatternIds":["frag-one"],"sourceScope":"${SCOPE_B}"}]`;

  it("null round-trip: no footprint projects null; merging onto absent yields the single-entry array envelope", () => {
    expect(parsePromotedFrom(null)).toBeNull();
    expect(parsePromotedFrom("")).toBeNull();
    expect(parsePromotedFrom(undefined)).toBeNull();
    const merged = mergePromotedFromEntry("", entryA);
    expect(merged.canonical).toBe(singleBytes);
    expect(formatPromotedFrom(merged.entries)).toBe(singleBytes);
  });

  it("single round-trip: canonical single parses back; appending a different run re-sorts by runId ascending", () => {
    expect(parsePromotedFrom(singleBytes)).toEqual([entryA]);
    const merged = mergePromotedFromEntry(singleBytes, entryB);
    expect(merged.canonical).toBe(doubleBytes);
    // 乱序输入（后写小 runId）仍按 runId 升序落盘。
    const reversed = mergePromotedFromEntry(doubleBytes, {
      runId: "wd_000000000000000000000001",
      sourceScope: SCOPE_A,
      sourcePatternIds: ["frag-one"],
    });
    expect(reversed.entries[0]?.runId).toBe("wd_000000000000000000000001");
  });

  it("double round-trip: two entries parse losslessly; same-run replay unions ids without a third entry", () => {
    expect(parsePromotedFrom(doubleBytes)).toEqual([entryA, entryB]);
    const merged = mergePromotedFromEntry(doubleBytes, {
      runId: RUN_A,
      sourceScope: SCOPE_A,
      sourcePatternIds: ["frag-two"],
    });
    expect(merged.entries).toHaveLength(2);
    expect(merged.canonical).toBe(
      `[{"runId":"${RUN_A}","sourcePatternIds":["frag-one","frag-two"],"sourceScope":"${SCOPE_A}"},{"runId":"${RUN_B}","sourcePatternIds":["frag-one"],"sourceScope":"${SCOPE_B}"}]`,
    );
  });

  it("bad-value round-trip: unparseable/invalid values project null and merge rejects typed without touching the raw", () => {
    for (const bad of ["not json{", "{}", '[{"runId":"ws_x"}]', "plain text", "[1,2]"]) {
      expect(parsePromotedFrom(bad)).toBeNull();
      try {
        mergePromotedFromEntry(bad, entryA);
        expect.unreachable(`merge must reject: ${bad}`);
      } catch (error) {
        expect(error).toBeInstanceOf(SkillWikiError);
        expect((error as SkillWikiError).code).toBe("WIKI_INVALID_PATTERN");
      }
    }
    // 坏值原值逐字节保留由 apply 面 fixture 断言（本层断言 merge 不返回可写值）。
    expect(() => mergePromotedFromEntry("not json{", entryA)).toThrow(/fix it manually/);
  });

  it("merge narrows unknown entries via safeParse (typed reject)", () => {
    expect(() =>
      mergePromotedFromEntry(null, {
        runId: "wd_short",
        sourceScope: SCOPE_A,
        sourcePatternIds: ["a"],
      }),
    ).toThrow(SkillWikiError);
    expect(() =>
      mergePromotedFromEntry(null, { runId: RUN_A, sourceScope: "", sourcePatternIds: [] }),
    ).toThrow(SkillWikiError);
  });
});

describe("DistillCorpus digest（W：可复现冻结）", () => {
  it("same corpus built twice (shuffled cluster/candidate order) yields the identical digest", () => {
    const first = corpusFixture({
      clusters: [
        { members: ["frag-one", "frag-two"], score: 5 },
        { members: ["frag-three"], score: 4.5 },
      ],
      candidates: [
        {
          name: "global-x",
          title: "global-x",
          body: "bx",
          contentHash: "a".repeat(64),
          sourceScope: SCOPE_A,
          score: 0.9,
        },
        {
          name: "global-y",
          title: "global-y",
          body: "by",
          contentHash: "b".repeat(64),
          sourceScope: SCOPE_A,
          score: 0.8,
        },
      ],
    });
    const second = corpusFixture({
      clusters: [
        { members: ["frag-three"], score: 4.5 },
        { members: ["frag-two", "frag-one"], score: 5 },
      ],
      candidates: [
        {
          name: "global-y",
          title: "global-y",
          body: "by",
          contentHash: "b".repeat(64),
          sourceScope: SCOPE_A,
          score: 0.8,
        },
        {
          name: "global-x",
          title: "global-x",
          body: "bx",
          contentHash: "a".repeat(64),
          sourceScope: SCOPE_A,
          score: 0.9,
        },
      ],
    });
    expect(distillCorpusDigest(first)).toBe(distillCorpusDigest(second));
    expect(first.corpusDigest).toBe(distillCorpusDigest(first));
  });

  it("cluster tie-break: equal score with same first member orders by full member vector regardless of input order", () => {
    const tied = [
      { members: ["x-frag", "a-frag"], score: 5 },
      { members: ["b-frag", "a-frag"], score: 5 },
      { members: ["c-frag"], score: 4 },
    ];
    const corpus = corpusFixture({ clusters: tied });
    const projection = canonicalCorpusProjection(corpus) as {
      clusters: Array<{ members: string[]; score: number }>;
    };
    expect(projection.clusters.map((cluster) => cluster.members)).toEqual([
      ["a-frag", "b-frag"],
      ["a-frag", "x-frag"],
      ["c-frag"],
    ]);
    const reordered = corpusFixture({
      clusters: [
        { members: ["c-frag"], score: 4 },
        { members: ["a-frag", "b-frag"], score: 5 },
        { members: ["a-frag", "x-frag"], score: 5 },
      ],
    });
    expect(distillCorpusDigest(corpus)).toBe(distillCorpusDigest(reordered));
    // canonical 序唯一可序 → 不同成员集 digest 必变。
    const different = corpusFixture({
      clusters: [
        { members: ["a-frag", "z-frag"], score: 5 },
        { members: ["a-frag", "x-frag"], score: 5 },
        { members: ["c-frag"], score: 4 },
      ],
    });
    expect(distillCorpusDigest(corpus)).not.toBe(distillCorpusDigest(different));
  });

  it("digest excludes corpusDigest itself but includes retrieval/threshold/budgets/scoreVersion", () => {
    const corpus = corpusFixture();
    const bumpedThreshold = corpusFixture({ evidenceThreshold: DISTILL_EVIDENCE_THRESHOLD + 0.05 });
    expect(distillCorpusDigest(corpus)).not.toBe(distillCorpusDigest(bumpedThreshold));
    const projection = canonicalCorpusProjection(corpus) as Record<string, unknown>;
    expect("corpusDigest" in projection).toBe(false);
    expect(projection.scoreVersion).toBe("segmenter-bigram-v1/bm25-frozen");
  });
});

describe("planDistillation（纯函数）", () => {
  it("plans a create item: frozen slug target, afterBodyHash = contentHash(body), digest = proposal canonical sha256", () => {
    const dir = makeTempDir();
    const proposal = createProposalFixture();
    const plan = planDistillation(dir, corpusFixture(), [proposal]);
    expect(plan.diagnostics).toEqual([]);
    expect(plan.items).toHaveLength(1);
    const item = plan.items[0];
    expect(item?.action).toBe("create");
    if (item?.action !== "create") return;
    expect(item.ordinal).toBe(0);
    expect(item.targetPatternName).toBe("pin-exit-codes");
    expect(item.afterBodyHash).toBe(patternContentHash(proposal.body));
    expect(item.digest).toBe(distillProposalDigest(proposal));
  });

  it("is read-only: planning against a missing wiki directory creates nothing on disk", () => {
    const dir = makeTempDir();
    const missing = path.join(dir, "no-such-wiki");
    const plan = planDistillation(missing, corpusFixture(), [createProposalFixture()]);
    expect(plan.items).toHaveLength(1);
    expect(fs.existsSync(missing)).toBe(false);
    expect(fs.existsSync(path.join(missing, "patterns"))).toBe(false);
  });

  it("plans an absorb item against a seeded global page (before-hash pinned, anchors validated)", () => {
    const dir = makeTempDir();
    const wiki = openWikiWorkspace(dir);
    wiki.appendPattern({ title: "gate-exits", body: "Branch on exit code.\n" });
    const body = wiki.readPattern("gate-exits").body;
    const proposal = {
      action: "absorb" as const,
      targetPatternId: "gate-exits",
      edits: [{ op: "append" as const, content: "\nAlso use pipefail." }],
      expectedBeforeBodyHash: patternContentHash(body),
      sourcePatternIds: ["frag-one"],
    };
    const plan = planDistillation(
      dir,
      corpusFixture({
        candidates: [
          {
            name: "gate-exits",
            title: "gate-exits",
            body: "x",
            contentHash: "a".repeat(64),
            sourceScope: SCOPE_A,
            score: 0.9,
          },
        ],
      }),
      [proposal],
    );
    expect(plan.diagnostics).toEqual([]);
    const item = plan.items[0];
    expect(item?.action).toBe("absorb");
    if (item?.action !== "absorb") return;
    expect(item.afterBodyHash).toBe(patternContentHash(`${body}\nAlso use pipefail.`));
  });

  it("rejects anchors that miss (model-invalid(anchor-missed))", () => {
    const dir = makeTempDir();
    const wiki = openWikiWorkspace(dir);
    wiki.appendPattern({ title: "gate-exits", body: "Branch on exit code.\n" });
    const body = wiki.readPattern("gate-exits").body;
    const plan = planDistillation(
      dir,
      corpusFixture({
        candidates: [
          {
            name: "gate-exits",
            title: "gate-exits",
            body: "x",
            contentHash: "a".repeat(64),
            sourceScope: SCOPE_A,
            score: 0.9,
          },
        ],
      }),
      [
        {
          action: "absorb",
          targetPatternId: "gate-exits",
          edits: [{ op: "replace", target: "NO_SUCH_ANCHOR", content: "boom" }],
          expectedBeforeBodyHash: patternContentHash(body),
          sourcePatternIds: ["frag-one"],
        },
      ],
    );
    expect(plan.items).toHaveLength(0);
    expect(plan.diagnostics[0]?.reason).toBe("anchor-missed");
  });

  it("diagnoses unknown target, before-hash mismatch, and insufficient evidence", () => {
    const dir = makeTempDir();
    const wiki = openWikiWorkspace(dir);
    wiki.appendPattern({ title: "gate-exits", body: "Branch on exit code.\n" });
    wiki.appendPattern({ title: "weak-evidence", body: "Weak.\n" });
    const body = wiki.readPattern("gate-exits").body;
    const corpus = corpusFixture({
      candidates: [
        {
          name: "gate-exits",
          title: "gate-exits",
          body: "x",
          contentHash: "a".repeat(64),
          sourceScope: SCOPE_A,
          score: 0.9,
        },
        {
          name: "weak-evidence",
          title: "weak-evidence",
          body: "x",
          contentHash: "b".repeat(64),
          sourceScope: SCOPE_A,
          score: 0.1,
        },
      ],
    });
    const plan = planDistillation(dir, corpus, [
      {
        action: "absorb",
        targetPatternId: "missing-page",
        edits: [{ op: "append", content: "x" }],
        expectedBeforeBodyHash: patternContentHash(body),
        sourcePatternIds: ["frag-one"],
      },
      {
        action: "absorb",
        targetPatternId: "gate-exits",
        edits: [{ op: "append", content: "x" }],
        expectedBeforeBodyHash: "0".repeat(64),
        sourcePatternIds: ["frag-one"],
      },
      {
        action: "absorb",
        targetPatternId: "weak-evidence",
        edits: [{ op: "append", content: "x" }],
        expectedBeforeBodyHash: patternContentHash(wiki.readPattern("weak-evidence").body),
        sourcePatternIds: ["frag-one"],
      },
    ]);
    expect(plan.items).toHaveLength(0);
    expect(plan.diagnostics.map((diagnostic) => diagnostic.reason)).toEqual([
      "unknown-target",
      "before-hash-mismatch",
      "insufficient-evidence",
    ]);
  });

  it("narrows model output via strict schema: unknown keys, bad action, title > 120, body > 20k are model-invalid", () => {
    const dir = makeTempDir();
    const plan = planDistillation(dir, corpusFixture(), [
      { ...createProposalFixture(), extra: "unknown key" },
      { action: "delete", title: "x", body: "y", sourcePatternIds: ["frag-one"] },
      createProposalFixture({ title: "x".repeat(121) }),
      createProposalFixture({ title: "ok title", body: "y".repeat(20_001) }),
      createProposalFixture({
        title: "Boundary 120",
        body: "fine",
        sourcePatternIds: ["x".repeat(65)],
      }),
    ]);
    expect(plan.items).toHaveLength(0);
    expect(plan.diagnostics.every((diagnostic) => diagnostic.reason === "invalid-proposal")).toBe(
      true,
    );
    expect(plan.diagnostics).toHaveLength(5);
    // title 恰 120 合法（F：1..120 对齐既有 frontmatter 契约）。
    const boundary = planDistillation(dir, corpusFixture(), [
      createProposalFixture({ title: "y".repeat(120) }),
    ]);
    expect(boundary.diagnostics).toEqual([]);
    expect(boundary.items).toHaveLength(1);
  });

  it("enforces the proposals-per-run budget on ordinals beyond the limit", () => {
    const dir = makeTempDir();
    const proposals = Array.from({ length: DISTILL_BUDGETS.proposalsPerRun + 1 }, (_, index) =>
      createProposalFixture({ title: `Tip number ${index}`, body: `body ${index}` }),
    );
    const plan = planDistillation(dir, corpusFixture(), proposals);
    expect(plan.items).toHaveLength(DISTILL_BUDGETS.proposalsPerRun);
    expect(plan.diagnostics).toEqual([
      { ordinal: DISTILL_BUDGETS.proposalsPerRun, reason: "budget", message: expect.any(String) },
    ]);
  });

  it("rejects same-run target collisions at plan time: later ordinal loses deterministically", () => {
    const dir = makeTempDir();
    const wiki = openWikiWorkspace(dir);
    wiki.appendPattern({ title: "shared-name", body: "Existing global page.\n" });
    const body = wiki.readPattern("shared-name").body;
    const absorbIntoShared = {
      action: "absorb" as const,
      targetPatternId: "shared-name",
      edits: [{ op: "append" as const, content: "more" }],
      expectedBeforeBodyHash: patternContentHash(body),
      sourcePatternIds: ["frag-one"],
    };
    const corpus = corpusFixture({
      candidates: [
        {
          name: "shared-name",
          title: "shared-name",
          body: "x",
          contentHash: "a".repeat(64),
          sourceScope: SCOPE_A,
          score: 0.9,
        },
      ],
    });

    // 两 create 同 slug：后 ordinal 判 model-invalid(target-collision)，先项不受影响。
    const createFirst = planDistillation(dir, corpus, [
      createProposalFixture({ title: "Shared Name", body: "first" }),
      createProposalFixture({ title: "Shared Name", body: "second" }),
    ]);
    expect(createFirst.items).toHaveLength(1);
    expect(createFirst.items[0]?.ordinal).toBe(0);
    expect(createFirst.diagnostics).toEqual([
      { ordinal: 1, reason: "target-collision", message: expect.any(String) },
    ]);

    // create 先占、absorb 后到：absorb 判 target-collision。
    const createThenAbsorb = planDistillation(dir, corpus, [
      createProposalFixture({ title: "Shared Name", body: "fresh" }),
      absorbIntoShared,
    ]);
    expect(createThenAbsorb.items.map((item) => item.action)).toEqual(["create"]);
    expect(createThenAbsorb.diagnostics[0]?.reason).toBe("target-collision");

    // absorb 先占、create 后到：create 判 target-collision。
    const absorbThenCreate = planDistillation(dir, corpus, [
      absorbIntoShared,
      createProposalFixture({ title: "Shared Name", body: "fresh" }),
    ]);
    expect(absorbThenCreate.items.map((item) => item.action)).toEqual(["absorb"]);
    expect(absorbThenCreate.diagnostics[0]?.reason).toBe("target-collision");

    // absorb-absorb 同 target 允许（各自独立钉 beforeHash；后批 apply 期必然 stale）。
    const bothAbsorb = planDistillation(dir, corpus, [
      absorbIntoShared,
      { ...absorbIntoShared, edits: [{ op: "append", content: "other" }] },
    ]);
    expect(bothAbsorb.items).toHaveLength(2);
    expect(bothAbsorb.diagnostics).toEqual([]);
  });

  it("attaches deterministic warnings: content-duplicate and name-exists for create items", () => {
    const dir = makeTempDir();
    const wiki = openWikiWorkspace(dir);
    wiki.appendPattern({ title: "existing-page", body: "Existing body.\n" });
    wiki.appendPattern({ title: "twin-body", body: "Twin body.\n" });
    const plan = planDistillation(dir, corpusFixture(), [
      createProposalFixture({ title: "Existing Page", body: "New body.\n" }),
      createProposalFixture({ title: "Twin Title", body: "Twin body.\n" }),
    ]);
    expect(plan.warnings).toEqual([
      { ordinal: 0, note: "name-exists:existing-page" },
      { ordinal: 1, note: "content-duplicate:twin-body" },
    ]);
  });

  it("typed-rejects an invalid corpus (host-side bug, not model output)", () => {
    const dir = makeTempDir();
    try {
      planDistillation(dir, { clusters: "nope" }, []);
      expect.unreachable("must throw");
    } catch (error) {
      expect(error).toBeInstanceOf(SkillWikiError);
      expect((error as SkillWikiError).code).toBe("WIKI_INVALID_PATTERN");
    }
  });
});
