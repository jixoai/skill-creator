/**
 * 用户原始需求 [2026-09-25]（切片③ skill-wiki-maintainer tasks 1.2）：「SDK 执行
 * 层：applyDistillation 幂等矩阵（typed ledgerRecord 输入：首放/applying/applied
 * ×before-after 全分支，含 applied+beforeHash 人工回退 stale 零写）+ 足迹回填
 * + ledger 行产出 + IO typed」——门禁 fixture：崩溃重放 absorb+create 双分支/
 * 人工编辑后 stale/人工回退不重放/absorb 目标缺页与畸形页 stale/同 target 竞争/
 * create 同名人工页零覆盖且不 -N 改名/pending 项不被执行路径迁移/追加合并。
 * 正交意图：[1] 钉死 H 双矩阵每个分支的页面字节与 hooks 顺序契约。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  SkillWikiError,
  applyDistillation,
  openWikiWorkspace,
  parsePromotedFrom,
  patternContentHash,
  planDistillation,
  type DistillPlanItem,
} from "../src/index.js";
import {
  RUN_A,
  RUN_B,
  SCOPE_A,
  SCOPE_B,
  absorbRecord,
  corpusFixture,
  createProposalFixture,
  createRecord,
  hookRecorder,
} from "./distill-fixtures.js";

const tempDirs: string[] = [];
function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-wiki-apply-"));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  while (tempDirs.length > 0) fs.rmSync(tempDirs.pop() as string, { recursive: true, force: true });
});

const provenanceA = { runId: RUN_A, sourceScope: SCOPE_A };
const provenanceB = { runId: RUN_B, sourceScope: SCOPE_B };
const footprintA = `[{"runId":"${RUN_A}","sourcePatternIds":["frag-one"],"sourceScope":"${SCOPE_A}"}]`;
const footprintAB = `[{"runId":"${RUN_A}","sourcePatternIds":["frag-one"],"sourceScope":"${SCOPE_A}"},{"runId":"${RUN_B}","sourcePatternIds":["frag-one"],"sourceScope":"${SCOPE_B}"}]`;

function seedPage(dir: string, name: string, body: string): void {
  openWikiWorkspace(dir).appendPattern({ title: name, body });
}

function pageFile(dir: string, name: string): string {
  return path.join(dir, "patterns", `${name}.md`);
}

function readBytes(dir: string, name: string): string {
  return fs.readFileSync(pageFile(dir, name), "utf8");
}

function planSingle(
  dir: string,
  proposals: readonly unknown[],
  names: readonly string[],
): DistillPlanItem {
  const candidates = names.map((name) => ({
    name,
    title: name,
    body: "evidence",
    contentHash: "a".repeat(64),
    sourceScope: SCOPE_A,
    score: 0.9,
  }));
  const plan = planDistillation(dir, corpusFixture({ candidates }), proposals);
  expect(plan.diagnostics).toEqual([]);
  expect(plan.items).toHaveLength(1);
  return plan.items[0] as DistillPlanItem;
}

function planAbsorb(dir: string, name: string, content: string): DistillPlanItem {
  return planSingle(
    dir,
    [
      {
        action: "absorb",
        targetPatternId: name,
        edits: [{ op: "append", content }],
        expectedBeforeBodyHash: patternContentHash(openWikiWorkspace(dir).readPattern(name).body),
        sourcePatternIds: ["frag-one"],
      },
    ],
    [name],
  );
}

function planCreate(dir: string, title: string, body: string): DistillPlanItem {
  return planSingle(dir, [createProposalFixture({ title, body })], []);
}

describe("applyDistillation: absorb 矩阵", () => {
  it("applies a first-time absorb: edits on the pinned body, footprint merged, index rebuilt, hooks in order", () => {
    const dir = makeTempDir();
    seedPage(dir, "gate-exits", "Branch on exit code.\n");
    const item = planAbsorb(dir, "gate-exits", "\nAlso use pipefail.");
    const recorder = hookRecorder();
    const result = applyDistillation(dir, item, provenanceA, { hooks: recorder.hooks });

    expect(result).toEqual({ ordinal: 0, status: "applied", appliedHash: item.afterBodyHash });
    const read = openWikiWorkspace(dir).readPattern("gate-exits");
    expect(read.body).toBe("Branch on exit code.\n\nAlso use pipefail.\n");
    expect(read.frontmatter.promotedFrom).toBe(footprintA);
    expect(fs.readFileSync(path.join(dir, "index.md"), "utf8")).toContain("gate-exits");

    expect(recorder.events).toHaveLength(2);
    expect(recorder.events[0]?.phase).toBe("intent");
    expect(recorder.events[0]?.record).toEqual(absorbRecord(item, "applying", 0));
    expect(recorder.events[1]?.phase).toBe("commit");
    expect(recorder.events[1]?.record).toEqual(
      absorbRecord(item, "applied", 0, item.afterBodyHash),
    );
  });

  it("crash replay (applying + page already at afterHash): pure recovery — rebuild + idempotent commit, page bytes untouched", () => {
    const dir = makeTempDir();
    seedPage(dir, "gate-exits", "Branch on exit code.\n");
    const item = planAbsorb(dir, "gate-exits", "\nAlso use pipefail.");
    applyDistillation(dir, item, provenanceA);
    const bytesAfterFirstApply = readBytes(dir, "gate-exits");

    const recorder = hookRecorder();
    const replay = applyDistillation(dir, item, provenanceA, {
      ledgerRecord: absorbRecord(item, "applying", 1),
      hooks: recorder.hooks,
    });
    expect(replay).toEqual({ ordinal: 0, status: "idempotent", appliedHash: item.afterBodyHash });
    expect(readBytes(dir, "gate-exits")).toBe(bytesAfterFirstApply);
    expect(recorder.events).toHaveLength(1);
    expect(recorder.events[0]?.phase).toBe("commit");
    expect(recorder.events[0]?.record.status).toBe("idempotent");
    // 不产生重复页/重复足迹。
    expect(
      parsePromotedFrom(openWikiWorkspace(dir).readPattern("gate-exits").frontmatter.promotedFrom),
    ).toHaveLength(1);
  });

  it("replay without a ledger record onto the after-state also recovers idempotently (write-before-intent defense)", () => {
    const dir = makeTempDir();
    seedPage(dir, "gate-exits", "Branch on exit code.\n");
    const item = planAbsorb(dir, "gate-exits", "\nAlso use pipefail.");
    applyDistillation(dir, item, provenanceA);
    const replay = applyDistillation(dir, item, provenanceA);
    expect(replay.status).toBe("idempotent");
  });

  it("applied + afterHash: no-op idempotent with zero writes and no hooks", () => {
    const dir = makeTempDir();
    seedPage(dir, "gate-exits", "Branch on exit code.\n");
    const item = planAbsorb(dir, "gate-exits", "\nAlso use pipefail.");
    applyDistillation(dir, item, provenanceA);
    const bytes = readBytes(dir, "gate-exits");
    const recorder = hookRecorder();
    const replay = applyDistillation(dir, item, provenanceA, {
      ledgerRecord: absorbRecord(item, "applied", 0, item.afterBodyHash),
      hooks: recorder.hooks,
    });
    expect(replay).toEqual({ ordinal: 0, status: "idempotent", appliedHash: item.afterBodyHash });
    expect(readBytes(dir, "gate-exits")).toBe(bytes);
    expect(recorder.events).toEqual([]);
  });

  it("applied + beforeHash: manual rollback — stale(manual-rollback), zero writes, page keeps the human-reverted state", () => {
    const dir = makeTempDir();
    seedPage(dir, "gate-exits", "Branch on exit code.\n");
    const originalBytes = readBytes(dir, "gate-exits");
    const item = planAbsorb(dir, "gate-exits", "\nAlso use pipefail.");
    applyDistillation(dir, item, provenanceA);
    // 人工把整页恢复为 apply 前的原始字节。
    fs.writeFileSync(pageFile(dir, "gate-exits"), originalBytes, "utf8");

    const recorder = hookRecorder();
    const replay = applyDistillation(dir, item, provenanceA, {
      ledgerRecord: absorbRecord(item, "applied", 0, item.afterBodyHash),
      hooks: recorder.hooks,
    });
    expect(replay).toEqual({ ordinal: 0, status: "stale", detail: "manual-rollback" });
    expect(readBytes(dir, "gate-exits")).toBe(originalBytes);
    expect(recorder.events).toEqual([]);
  });

  it("applied/applying + neither hash (human edit): stale(diverged) zero-write", () => {
    const dir = makeTempDir();
    seedPage(dir, "gate-exits", "Branch on exit code.\n");
    const item = planAbsorb(dir, "gate-exits", "\nAlso use pipefail.");
    applyDistillation(dir, item, provenanceA);
    fs.writeFileSync(
      pageFile(dir, "gate-exits"),
      readBytes(dir, "gate-exits").replace("Branch", "Human edited"),
      "utf8",
    );
    const replay = applyDistillation(dir, item, provenanceA, {
      ledgerRecord: absorbRecord(item, "applied", 0, item.afterBodyHash),
    });
    expect(replay).toEqual({ ordinal: 0, status: "stale", detail: "diverged" });

    // applying 窗口内人工改页同样 stale（保持合法 frontmatter 的正文改写）。
    const dir2 = makeTempDir();
    seedPage(dir2, "gate-exits", "Branch on exit code.\n");
    const item2 = planAbsorb(dir2, "gate-exits", "\nAlso use pipefail.");
    openWikiWorkspace(dir2).editPattern("gate-exits", [
      { op: "replace", target: "Branch on exit code.", content: "Rewritten by hand." },
    ]);
    const replay2 = applyDistillation(dir2, item2, provenanceA, {
      ledgerRecord: absorbRecord(item2, "applying", 1),
    });
    expect(replay2).toEqual({ ordinal: 0, status: "stale", detail: "diverged" });
  });

  it("applying + beforeHash (human restored before-state inside the window): replay executes the approved intent again", () => {
    const dir = makeTempDir();
    seedPage(dir, "gate-exits", "Branch on exit code.\n");
    const item = planAbsorb(dir, "gate-exits", "\nAlso use pipefail.");
    const result = applyDistillation(dir, item, provenanceA, {
      ledgerRecord: absorbRecord(item, "applying", 1),
    });
    expect(result.status).toBe("applied");
    expect(openWikiWorkspace(dir).readPattern("gate-exits").body).toBe(
      "Branch on exit code.\n\nAlso use pipefail.\n",
    );
  });

  it("preflight: missing target → stale(missing-target); malformed target → stale(invalid-target); both zero-write", () => {
    const dir = makeTempDir();
    seedPage(dir, "gate-exits", "Branch on exit code.\n");
    const item = planAbsorb(dir, "gate-exits", "\nAlso use pipefail.");
    const originalBytes = readBytes(dir, "gate-exits");

    fs.rmSync(pageFile(dir, "gate-exits"));
    const missing = applyDistillation(dir, item, provenanceA);
    expect(missing).toEqual({ ordinal: 0, status: "stale", detail: "missing-target" });
    expect(fs.existsSync(pageFile(dir, "gate-exits"))).toBe(false);

    fs.writeFileSync(pageFile(dir, "gate-exits"), "no frontmatter at all\n", "utf8");
    const invalid = applyDistillation(dir, item, provenanceA);
    expect(invalid).toEqual({ ordinal: 0, status: "stale", detail: "invalid-target" });
    expect(readBytes(dir, "gate-exits")).toBe("no frontmatter at all\n");
    expect(originalBytes).not.toBe("no frontmatter at all\n");
  });

  it("anchor miss during execution: patch-failed with zero page writes (intent recorded, no commit)", () => {
    const dir = makeTempDir();
    seedPage(dir, "gate-exits", "Branch on exit code.\n");
    const item = planAbsorb(dir, "gate-exits", "\nAlso use pipefail.");
    const beforeBytes = readBytes(dir, "gate-exits");
    const recorder = hookRecorder();
    // 手工构造锚点必未中的 item（plan 期本会拒绝；apply 层防御分支）。
    const sabotaged =
      item.action === "absorb"
        ? {
            ...item,
            proposal: {
              ...item.proposal,
              edits: [{ op: "replace" as const, target: "NO_SUCH_ANCHOR", content: "x" }],
            },
          }
        : item;
    const result = applyDistillation(dir, sabotaged, provenanceA, { hooks: recorder.hooks });
    expect(result).toEqual({ ordinal: 0, status: "patch-failed" });
    expect(readBytes(dir, "gate-exits")).toBe(beforeBytes);
    expect(recorder.events.map((event) => event.phase)).toEqual(["intent"]);
  });

  it("pending ledger record: typed refusal, zero writes, no hooks — approval red line (even with a missing target)", () => {
    const dir = makeTempDir();
    seedPage(dir, "gate-exits", "Branch on exit code.\n");
    const item = planAbsorb(dir, "gate-exits", "\nAlso use pipefail.");
    const originalBytes = readBytes(dir, "gate-exits");
    const recorder = hookRecorder();
    try {
      applyDistillation(dir, item, provenanceA, {
        ledgerRecord: absorbRecord(item, "pending", 0),
        hooks: recorder.hooks,
      });
      expect.unreachable("must refuse pending records");
    } catch (error) {
      expect(error).toBeInstanceOf(SkillWikiError);
      expect((error as SkillWikiError).code).toBe("WIKI_INVALID_PATTERN");
    }
    expect(readBytes(dir, "gate-exits")).toBe(originalBytes);
    expect(recorder.events).toEqual([]);
  });

  it("terminal replay reports the original terminal status with zero writes (io-failed never revives)", () => {
    const dir = makeTempDir();
    seedPage(dir, "gate-exits", "Branch on exit code.\n");
    const item = planAbsorb(dir, "gate-exits", "\nAlso use pipefail.");
    const bytes = readBytes(dir, "gate-exits");
    const recorder = hookRecorder();
    const ioFailed = applyDistillation(dir, item, provenanceA, {
      ledgerRecord: absorbRecord(item, "io-failed", 3),
      hooks: recorder.hooks,
    });
    expect(ioFailed).toEqual({ ordinal: 0, status: "io-failed" });
    const staleReplay = applyDistillation(dir, item, provenanceA, {
      ledgerRecord: absorbRecord(item, "stale", 0),
      hooks: recorder.hooks,
    });
    expect(staleReplay).toEqual({ ordinal: 0, status: "stale" });
    expect(readBytes(dir, "gate-exits")).toBe(bytes);
    expect(recorder.events).toEqual([]);
  });

  it("write-budget exhausted (applying + attempts >= 3 + write still needed): io-failed, zero writes, no hooks", () => {
    const dir = makeTempDir();
    seedPage(dir, "gate-exits", "Branch on exit code.\n");
    const item = planAbsorb(dir, "gate-exits", "\nAlso use pipefail.");
    const bytes = readBytes(dir, "gate-exits");
    const recorder = hookRecorder();
    const result = applyDistillation(dir, item, provenanceA, {
      ledgerRecord: absorbRecord(item, "applying", 3),
      hooks: recorder.hooks,
    });
    expect(result).toEqual({ ordinal: 0, status: "io-failed", detail: "attempts-exhausted" });
    expect(readBytes(dir, "gate-exits")).toBe(bytes);
    expect(recorder.events).toEqual([]);
  });

  it("maps page-write IO failures to typed WIKI_IO (host drives the attempts-budget retry)", () => {
    if (process.platform === "win32") return; // chmod 对 Windows ACL 无效
    const dir = makeTempDir();
    seedPage(dir, "gate-exits", "Branch on exit code.\n");
    const item = planAbsorb(dir, "gate-exits", "\nAlso use pipefail.");
    fs.chmodSync(path.join(dir, "patterns"), 0o555);
    try {
      applyDistillation(dir, item, provenanceA);
      expect.unreachable("must surface IO failure typed");
    } catch (error) {
      expect(error).toBeInstanceOf(SkillWikiError);
      expect((error as SkillWikiError).code).toBe("WIKI_IO");
    } finally {
      fs.chmodSync(path.join(dir, "patterns"), 0o755);
    }
    // 预算门在重试耗尽后接管：attempts=3 + 仍需写页 → io-failed（不再写页）。
    const result = applyDistillation(dir, item, provenanceA, {
      ledgerRecord: absorbRecord(item, "applying", 3),
    });
    expect(result.status).toBe("io-failed");
  });

  it("same-target competition inside one run: first applies, second stales on the diverged body", () => {
    const dir = makeTempDir();
    seedPage(dir, "gate-exits", "Branch on exit code.\n");
    const beforeHash = patternContentHash(openWikiWorkspace(dir).readPattern("gate-exits").body);
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
          edits: [{ op: "append", content: "\nFirst." }],
          expectedBeforeBodyHash: beforeHash,
          sourcePatternIds: ["frag-one"],
        },
        {
          action: "absorb",
          targetPatternId: "gate-exits",
          edits: [{ op: "append", content: "\nSecond." }],
          expectedBeforeBodyHash: beforeHash,
          sourcePatternIds: ["frag-two"],
        },
      ],
    );
    expect(plan.diagnostics).toEqual([]);
    expect(plan.items).toHaveLength(2);
    const [itemA, itemB] = plan.items as [DistillPlanItem, DistillPlanItem];
    const applied = applyDistillation(dir, itemA, provenanceA);
    expect(applied.status).toBe("applied");
    const competed = applyDistillation(dir, itemB, provenanceB);
    expect(competed).toEqual({ ordinal: 1, status: "stale", detail: "diverged" });
    expect(openWikiWorkspace(dir).readPattern("gate-exits").body).toBe(
      "Branch on exit code.\n\nFirst.\n",
    );
  });
});

describe("applyDistillation: create 矩阵", () => {
  it("applies a first-time create at the exact frozen name with canonical footprint, origin '~'", () => {
    const dir = makeTempDir();
    const item = planCreate(dir, "Pin Exit Codes", "Gate on exit codes.\n");
    const recorder = hookRecorder();
    const result = applyDistillation(dir, item, provenanceA, { hooks: recorder.hooks });

    expect(result).toEqual({ ordinal: 0, status: "applied", appliedHash: item.afterBodyHash });
    expect(fs.existsSync(pageFile(dir, "pin-exit-codes"))).toBe(true);
    const read = openWikiWorkspace(dir).readPattern("pin-exit-codes");
    expect(read.body).toBe("Gate on exit codes.\n");
    expect(read.frontmatter.promotedFrom).toBe(footprintA);
    expect(read.frontmatter.origin).toBe("~");
    expect(read.frontmatter.title).toBe("Pin Exit Codes");
    expect(recorder.events).toHaveLength(2);
    expect(recorder.events[0]?.record).toEqual(createRecord(item, "applying", 0));
    expect(recorder.events[1]?.record).toEqual(
      createRecord(item, "applied", 0, item.afterBodyHash),
    );
  });

  it("crash replay (applying + page exists at afterHash): pure recovery idempotent, page bytes untouched", () => {
    const dir = makeTempDir();
    const item = planCreate(dir, "Pin Exit Codes", "Gate on exit codes.\n");
    applyDistillation(dir, item, provenanceA);
    const bytes = readBytes(dir, "pin-exit-codes");
    const recorder = hookRecorder();
    const replay = applyDistillation(dir, item, provenanceA, {
      ledgerRecord: createRecord(item, "applying", 1),
      hooks: recorder.hooks,
    });
    expect(replay).toEqual({ ordinal: 0, status: "idempotent", appliedHash: item.afterBodyHash });
    expect(readBytes(dir, "pin-exit-codes")).toBe(bytes);
    expect(recorder.events).toHaveLength(1);
    expect(recorder.events[0]?.record.status).toBe("idempotent");
  });

  it("first apply onto an existing same-body page: dedup + footprint backfill, body bytes unchanged", () => {
    const dir = makeTempDir();
    seedPage(dir, "pin-exit-codes", "Gate on exit codes.\n");
    const beforeBytes = readBytes(dir, "pin-exit-codes");
    const item = planCreate(dir, "Pin Exit Codes", "Gate on exit codes.\n");
    const recorder = hookRecorder();
    const result = applyDistillation(dir, item, provenanceA, { hooks: recorder.hooks });
    expect(result.status).toBe("idempotent");
    expect(result.appliedHash).toBe(item.afterBodyHash);
    const read = openWikiWorkspace(dir).readPattern("pin-exit-codes");
    expect(read.frontmatter.promotedFrom).toBe(footprintA);
    expect(read.body).toBe("Gate on exit codes.\n");
    expect(readBytes(dir, "pin-exit-codes")).not.toBe(beforeBytes); // frontmatter 足迹回填（正文不变）
    expect(recorder.events.map((event) => event.phase)).toEqual(["intent", "commit"]);
  });

  it("applied + page deleted: manual rollback — stale, never re-appends the page", () => {
    const dir = makeTempDir();
    const item = planCreate(dir, "Pin Exit Codes", "Gate on exit codes.\n");
    applyDistillation(dir, item, provenanceA);
    fs.rmSync(pageFile(dir, "pin-exit-codes"));
    const recorder = hookRecorder();
    const replay = applyDistillation(dir, item, provenanceA, {
      ledgerRecord: createRecord(item, "applied", 0, item.afterBodyHash),
      hooks: recorder.hooks,
    });
    expect(replay).toEqual({ ordinal: 0, status: "stale", detail: "manual-rollback" });
    expect(fs.existsSync(pageFile(dir, "pin-exit-codes"))).toBe(false);
    expect(recorder.events).toEqual([]);
  });

  it("same-name human page with different content: stale(name-conflict), page byte-identical, no -N renamed sibling", () => {
    const dir = makeTempDir();
    seedPage(dir, "pin-exit-codes", "Human authored body.\n");
    const humanBytes = readBytes(dir, "pin-exit-codes");
    const item = planCreate(dir, "Pin Exit Codes", "Gate on exit codes.\n");
    const result = applyDistillation(dir, item, provenanceA);
    expect(result).toEqual({ ordinal: 0, status: "stale", detail: "name-conflict" });
    expect(readBytes(dir, "pin-exit-codes")).toBe(humanBytes);
    expect(fs.readdirSync(path.join(dir, "patterns"))).toEqual(["pin-exit-codes.md"]);
  });

  it("applying + name missing (crash before write, or human deleted inside the window): re-executes the approved intent", () => {
    const dir = makeTempDir();
    const item = planCreate(dir, "Pin Exit Codes", "Gate on exit codes.\n");
    const result = applyDistillation(dir, item, provenanceA, {
      ledgerRecord: createRecord(item, "applying", 1),
    });
    expect(result.status).toBe("applied");
    expect(openWikiWorkspace(dir).readPattern("pin-exit-codes").body).toBe("Gate on exit codes.\n");
  });

  it("appended merge: a second run distilling the same body appends its footprint (runId ascending), never a third page", () => {
    const dir = makeTempDir();
    const item = planCreate(dir, "Pin Exit Codes", "Gate on exit codes.\n");
    applyDistillation(dir, item, provenanceA);
    const second = applyDistillation(dir, item, provenanceB);
    expect(second.status).toBe("idempotent");
    const read = openWikiWorkspace(dir).readPattern("pin-exit-codes");
    expect(read.frontmatter.promotedFrom).toBe(footprintAB);
    expect(fs.readdirSync(path.join(dir, "patterns"))).toEqual(["pin-exit-codes.md"]);
  });

  it("maps patterns-directory IO failures to typed WIKI_IO", () => {
    const dir = makeTempDir();
    fs.writeFileSync(path.join(dir, "patterns"), "not a directory\n", "utf8");
    const item = planCreate(dir, "Pin Exit Codes", "Gate on exit codes.\n");
    // plan 期只读列举把「patterns 是文件」当空目录 → create 成案；apply 期 mkdir
    // 失败 → typed WIKI_IO（宿主进 attempts 预留重试）。
    try {
      applyDistillation(dir, item, provenanceA);
      expect.unreachable("must surface IO failure typed");
    } catch (error) {
      expect(error).toBeInstanceOf(SkillWikiError);
      expect((error as SkillWikiError).code).toBe("WIKI_IO");
    }
  });
});

describe("applyDistillation: 输入收窄", () => {
  it("rejects malformed ledger records and kind/ordinal mismatches typed", () => {
    const dir = makeTempDir();
    seedPage(dir, "gate-exits", "Branch on exit code.\n");
    const item = planAbsorb(dir, "gate-exits", "\nMore.");
    for (const badRecord of [
      { kind: "absorb", status: "weird" },
      {
        kind: "absorb",
        ordinal: 7,
        status: "applying",
        beforeHash: "0".repeat(64),
        afterHash: "1".repeat(64),
        attempts: 0,
      },
    ]) {
      try {
        applyDistillation(dir, item, provenanceA, { ledgerRecord: badRecord });
        expect.unreachable("must reject malformed record");
      } catch (error) {
        expect((error as SkillWikiError).code).toBe("WIKI_INVALID_PATTERN");
      }
    }
    // create item + absorb record → 判别联合形状不匹配。
    const createItem = planCreate(makeTempDir(), "Pin Exit Codes", "Body.\n");
    try {
      applyDistillation(makeTempDir(), createItem, provenanceA, {
        ledgerRecord: absorbRecord(item, "applying", 0),
      });
      expect.unreachable("must reject kind mismatch");
    } catch (error) {
      expect((error as SkillWikiError).code).toBe("WIKI_INVALID_PATTERN");
    }
  });

  it("rejects invalid provenance (runId shape) typed before any write", () => {
    const dir = makeTempDir();
    const item = planCreate(dir, "Pin Exit Codes", "Gate on exit codes.\n");
    try {
      applyDistillation(dir, item, { runId: "not-a-run-id", sourceScope: SCOPE_A });
      expect.unreachable("must reject invalid provenance");
    } catch (error) {
      expect((error as SkillWikiError).code).toBe("WIKI_INVALID_PATTERN");
    }
    expect(fs.existsSync(path.join(dir, "patterns"))).toBe(false);
  });
});
