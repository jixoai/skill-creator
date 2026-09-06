/**
 * Skill Steward contracts focused tests（openspec skill-steward-contracts tasks 1.5/1.7）。
 *
 * 用户原始需求 [2026-09-06]：「valid payloads round-trip; malformed, stale and
 * path-traversal payloads produce typed failures.」「每种 action 提供正反各一份完整
 * JSON fixture；路径负例仅改变合法 fixture 的路径，不同时删 frontmatter/body。」
 *
 * 正交意图：
 *   [1] fixture 驱动的正反断言：每 action 正例 round-trip + bind 通过，负例在解析层拒绝。
 *   [2] 作用域/身份/revision 边界：Global 只允许 disable；stale/unknown skill 类型化失败。
 *   [3] 工具调用 principal 边界与 prompts/templates 版本化。
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AGENT_ALLOWED_TOOLS,
  SKILL_STEWARD_CONTRACT_VERSION,
  SkillProposalSchema,
  SkillStewardContextSnapshotSchema,
  SkillStewardResponseSchema,
  SkillToolCallSchema,
  StewardFindingSchema,
  StewardSnapshotIdSchema,
  StewardTaskIdSchema,
  bindManagerDerivedProposalToSnapshot,
  bindProposalToSnapshot,
  bindTaskToSnapshot,
  type SkillProposal,
  type SkillStewardContextSnapshot,
} from "../src/shared/contracts/skill-steward.js";
import { SkillIdSchema } from "../src/shared/contracts/skills.js";
import {
  assembleStewardSystemPrompt,
  STEWARD_PROMPT_VERSION,
  STEWARD_TOOL_VERSION,
} from "../src/daemon/steward/prompts.js";
import { renderStewardTaskTurn } from "../src/daemon/steward/templates.js";

const fixtureDir = path.join(__dirname, "fixtures", "steward");

function loadFixture<T>(name: string): T {
  return JSON.parse(fs.readFileSync(path.join(fixtureDir, name), "utf8")) as T;
}

const importedSnapshotRaw = loadFixture<unknown>("snapshot.imported.json");
const globalSnapshotRaw = loadFixture<unknown>("snapshot.global.json");

function parseSnapshot(raw: unknown): SkillStewardContextSnapshot {
  const parsed = SkillStewardContextSnapshotSchema.safeParse(raw);
  if (!parsed.success)
    throw new Error(`snapshot fixture invalid: ${JSON.stringify(parsed.error.issues)}`);
  return parsed.data;
}

const importedSnapshot = parseSnapshot(importedSnapshotRaw);
const globalSnapshot = parseSnapshot(globalSnapshotRaw);

function parseProposal(name: string): { ok: boolean; proposal?: SkillProposal } {
  const raw = loadFixture<unknown>(name);
  const parsed = SkillProposalSchema.safeParse(raw);
  return parsed.success ? { ok: true, proposal: parsed.data } : { ok: false };
}

describe("snapshot fixtures", () => {
  it("parses the imported and global snapshots and round-trips them", () => {
    for (const snapshot of [importedSnapshot, globalSnapshot]) {
      const roundTrip = SkillStewardContextSnapshotSchema.parse(
        JSON.parse(JSON.stringify(snapshot)),
      );
      expect(roundTrip.id).toBe(snapshot.id);
      expect(roundTrip.skills.length).toBe(3);
      expect(roundTrip.capabilities.backendId).toBe("fixture");
    }
    expect(importedSnapshot.scopeKind).toBe("imported");
    expect(globalSnapshot.scopeKind).toBe("global");
  });

  it("rejects a snapshot that exceeds the content budget", () => {
    const oversized = structuredClone(importedSnapshotRaw) as SkillStewardContextSnapshot;
    oversized.skills[0]!.content = "x".repeat(256 * 1024 + 1);
    oversized.skills[0]!.byteSize = 256 * 1024 + 1;
    expect(SkillStewardContextSnapshotSchema.safeParse(oversized).success).toBe(false);
  });

  it("rejects resources pointing at unknown skills", () => {
    const orphan = structuredClone(importedSnapshotRaw) as SkillStewardContextSnapshot;
    orphan.resources.push({
      skillId: SkillIdSchema.parse("sk_ffffffffffffffffffffffff"),
      relPath: "scripts/ghost.sh",
      hash: "f".repeat(64),
      byteSize: 1,
      kind: "file",
    });
    expect(SkillStewardContextSnapshotSchema.safeParse(orphan).success).toBe(false);
  });
});

describe("per-action fixtures (task 1.7)", () => {
  it("accepts the four valid proposals and binds them to the imported snapshot", () => {
    for (const name of [
      "proposal-edit.valid.json",
      "proposal-disable.valid.json",
      "proposal-split.valid.json",
      "proposal-merge.valid.json",
    ]) {
      const result = parseProposal(name);
      expect(result.ok, name).toBe(true);
      const bound = bindProposalToSnapshot(result.proposal!, importedSnapshot);
      expect(bound.ok, name).toBe(true);
    }
  });

  it("rejects the negative fixtures at parse time (single-variable mutations)", () => {
    // edit: action 与 patch.kind 不一致（仅改 action 字段）。
    expect(parseProposal("proposal-edit.negative-action-mismatch.json").ok).toBe(false);
    // disable: 缺 evidence（spec 场景：incomplete disable recommendation）。
    expect(parseProposal("proposal-disable.negative-missing-evidence.json").ok).toBe(false);
    // split: 目标 directoryName 穿越（仅改路径，frontmatter/body 保持完整）。
    expect(parseProposal("proposal-split.negative-traversal.json").ok).toBe(false);
    // merge: 资源映射 targetPath 穿越（仅改路径）。
    expect(parseProposal("proposal-merge.negative-traversal.json").ok).toBe(false);
  });

  it("wraps each valid proposal as a structured response and rejects unknown kinds", () => {
    const valid = parseProposal("proposal-split.valid.json").proposal!;
    const response = SkillStewardResponseSchema.safeParse({ kind: "proposal", proposal: valid });
    expect(response.success).toBe(true);
    for (const kind of ["hack", "tool_call", "message"]) {
      expect(SkillStewardResponseSchema.safeParse({ kind }).success).toBe(false);
    }
    // 终态 reason 是闭合集合。
    expect(
      SkillStewardResponseSchema.safeParse({ kind: "terminal", reason: "vibes" }).success,
    ).toBe(false);
    expect(
      SkillStewardResponseSchema.safeParse({ kind: "terminal", reason: "needs-review" }).success,
    ).toBe(true);
  });
});

describe("scope and identity binding", () => {
  it("allows disable on the global scope but rejects edit/split/merge", () => {
    const disable = parseProposal("proposal-disable.valid.json").proposal!;
    expect(bindProposalToSnapshot(disable, globalSnapshot)).toEqual({ ok: true });

    for (const name of [
      "proposal-edit.valid.json",
      "proposal-split.valid.json",
      "proposal-merge.valid.json",
    ]) {
      const proposal = parseProposal(name).proposal!;
      const bound = bindProposalToSnapshot(proposal, globalSnapshot);
      expect(bound.ok, name).toBe(false);
      if (!bound.ok) expect(bound.failure.code).toBe("UNSUPPORTED_WRITE_SCOPE");
    }
  });

  it("rejects stale revisions with a typed failure", () => {
    const raw = loadFixture<unknown>("proposal-edit.valid.json") as SkillProposal;
    const edited = structuredClone(raw);
    // schema 层要求 observed == expected（Codex P1-2）：一致篡改两处，让 bind 层对快照判 stale。
    edited.patch.edits[0]!.expectedRevision = `sha256:${"9".repeat(64)}`;
    edited.observedRevisions[0]!.revision = `sha256:${"9".repeat(64)}`;
    const parsed = SkillProposalSchema.parse(edited);
    const bound = bindProposalToSnapshot(parsed, importedSnapshot);
    expect(bound.ok).toBe(false);
    if (!bound.ok) expect(bound.failure.code).toBe("STALE_REVISION");
  });

  it("Codex P1-2: rejects observed revisions disagreeing with patch expectations at parse time", () => {
    const raw = loadFixture<unknown>("proposal-edit.valid.json") as SkillProposal;
    const edited = structuredClone(raw);
    edited.observedRevisions[0]!.revision = `sha256:${"9".repeat(64)}`;
    expect(SkillProposalSchema.safeParse(edited).success).toBe(false);
  });

  it("Codex P1-1: rejects nested traversal, backslash, and Windows roots in mapping paths", () => {
    for (const badPath of [
      "assets/../../outside.env",
      "foo/../bar",
      "..\\outside.env",
      "C:\\outside.env",
      "\\\\srv\\share\\f",
    ]) {
      const raw = loadFixture<unknown>("proposal-merge.valid.json") as SkillProposal;
      const edited = structuredClone(raw);
      edited.patch.target.resources[0]!.targetPath = badPath;
      const result = SkillProposalSchema.safeParse(edited);
      expect(result.success, badPath).toBe(false);
    }
  });

  it("Codex P1-3: rejects duplicate identities in patch arrays", () => {
    const raw = loadFixture<unknown>("proposal-merge.valid.json") as SkillProposal;
    const edited = structuredClone(raw);
    const first = edited.patch.sources[0]!;
    edited.patch.sources[1] = { ...first };
    expect(SkillProposalSchema.safeParse(edited).success).toBe(false);

    const rawDisable = loadFixture<unknown>("proposal-disable.valid.json") as SkillProposal;
    const dupDisable = structuredClone(rawDisable);
    dupDisable.patch.selections.push({ ...dupDisable.patch.selections[0]! });
    expect(SkillProposalSchema.safeParse(dupDisable).success).toBe(false);
  });

  it("Codex P1-4: rejects forged byteSize and computed budget overruns", () => {
    const forged = structuredClone(importedSnapshotRaw) as {
      skills: Array<Record<string, unknown>>;
    };
    forged.skills[0] = { ...forged.skills[0]!, byteSize: 0 };
    expect(SkillStewardContextSnapshotSchema.safeParse(forged).success).toBe(false);

    const emoji = structuredClone(importedSnapshotRaw) as {
      skills: Array<Record<string, unknown>>;
    };
    emoji.skills[0] = { ...emoji.skills[0]!, content: "😀".repeat(70000), byteSize: 280000 };
    expect(SkillStewardContextSnapshotSchema.safeParse(emoji).success).toBe(false);
  });

  it("Codex P2-1: rejects targets whose frontmatter name differs from directoryName", () => {
    const raw = loadFixture<unknown>("proposal-split.valid.json") as SkillProposal;
    const edited = structuredClone(raw);
    edited.patch.targets[0]!.frontmatter = {
      ...edited.patch.targets[0]!.frontmatter,
      name: "different-name",
    };
    expect(SkillProposalSchema.safeParse(edited).success).toBe(false);
  });

  it("Codex P2-2: rejects scopeKind forged against a global workspace id", () => {
    const forged = structuredClone(globalSnapshotRaw) as Record<string, unknown>;
    forged.scopeKind = "imported";
    expect(SkillStewardContextSnapshotSchema.safeParse(forged).success).toBe(false);
  });

  it("Codex P2-3: bindTaskToSnapshot rejects outsider skills and accepts members", () => {
    const task = {
      id: "task_0123456789abcdef",
      kind: "check",
      snapshotId: importedSnapshot.id,
      skillIds: ["sk_ffffffffffffffffffffffff"],
      promptVersion: "1.0.0",
      toolVersion: "1.0.0",
      createdAt: "2026-09-06T00:00:00.000Z",
    };
    const insider = { ...task, skillIds: importedSnapshot.skills.map((skill) => skill.skillId) };
    expect(bindTaskToSnapshot(insider, importedSnapshot).ok).toBe(true);
    const bound = bindTaskToSnapshot(task, importedSnapshot);
    expect(bound.ok).toBe(false);
    if (!bound.ok) expect(bound.failure.code).toBe("UNKNOWN_SKILL");
  });

  it("rejects skills outside the snapshot", () => {
    const raw = loadFixture<unknown>("proposal-edit.valid.json") as SkillProposal;
    const edited = structuredClone(raw);
    const outsider = SkillIdSchema.parse("sk_ffffffffffffffffffffffff");
    edited.patch.edits[0]!.skillId = outsider;
    edited.skillIds = [outsider];
    edited.observedRevisions = [
      { skillId: outsider, revision: edited.patch.edits[0]!.expectedRevision },
    ];
    edited.evidence = [{ skillId: outsider, snippet: "x" }];
    const parsed = SkillProposalSchema.parse(edited);
    const bound = bindProposalToSnapshot(parsed, importedSnapshot);
    expect(bound.ok).toBe(false);
    if (!bound.ok) expect(bound.failure.code).toBe("UNKNOWN_SKILL");
  });

  it("rejects proposals bound to a different snapshot", () => {
    const proposal = parseProposal("proposal-disable.valid.json").proposal!;
    const otherSnapshot = structuredClone(importedSnapshot);
    otherSnapshot.id = SkillStewardContextSnapshotSchema.shape.id.parse("snap_fedcba9876543210");
    const bound = bindProposalToSnapshot(proposal, otherSnapshot);
    expect(bound.ok).toBe(false);
    if (!bound.ok) expect(bound.failure.code).toBe("SNAPSHOT_MISMATCH");
  });

  it("rejects proposals carrying a different contract version", () => {
    const raw = loadFixture<unknown>("proposal-disable.valid.json") as SkillProposal;
    const edited = structuredClone(raw);
    edited.contractVersion = "0.9.0";
    const parsed = SkillProposalSchema.parse(edited);
    const bound = bindProposalToSnapshot(parsed, importedSnapshot);
    expect(bound.ok).toBe(false);
    if (!bound.ok) expect(bound.failure.code).toBe("CONTRACT_VERSION");
  });
});

describe("structured findings and evidence", () => {
  it("requires an evidence locator (path, snippet, or line range)", () => {
    const bare = {
      contractVersion: SKILL_STEWARD_CONTRACT_VERSION,
      origin: "agent-semantic",
      severity: "warning",
      category: "unclear-description",
      message: "Description does not state the scope.",
      skillIds: [importedSnapshot.skills[0]!.skillId],
      observedRevisions: [
        {
          skillId: importedSnapshot.skills[0]!.skillId,
          revision: importedSnapshot.skills[0]!.revision,
        },
      ],
      evidence: [{ skillId: importedSnapshot.skills[0]!.skillId, note: "just a feeling" }],
    };
    const response = SkillStewardResponseSchema.safeParse({ kind: "finding", finding: bare });
    expect(response.success).toBe(false);
    const withSnippet = structuredClone(bare);
    withSnippet.evidence[0]!.snippet = "description: Audit log exports.";
    expect(
      SkillStewardResponseSchema.safeParse({ kind: "finding", finding: withSnippet }).success,
    ).toBe(true);
  });

  it("allows agent-semantic findings without an id but requires ids for deterministic ones", () => {
    const base = {
      contractVersion: SKILL_STEWARD_CONTRACT_VERSION,
      severity: "warning",
      category: "duplicate-trigger",
      message: "Two skills share the same trigger surface.",
      skillIds: [importedSnapshot.skills[0]!.skillId],
      observedRevisions: [
        {
          skillId: importedSnapshot.skills[0]!.skillId,
          revision: importedSnapshot.skills[0]!.revision,
        },
      ],
      evidence: [
        { skillId: importedSnapshot.skills[0]!.skillId, snippet: "allowed-tools: Bash, Read" },
      ],
    };
    expect(
      SkillStewardResponseSchema.safeParse({
        kind: "finding",
        finding: { ...base, origin: "agent-semantic" },
      }).success,
    ).toBe(true);
    expect(
      SkillStewardResponseSchema.safeParse({
        kind: "finding",
        finding: { ...base, origin: "deterministic" },
      }).success,
    ).toBe(false);
  });
});

describe("domain tool call contract", () => {
  const callBase = {
    id: "call_0123456789abcdef",
    at: "2026-09-06T00:00:00.000Z",
    runId: "sr_0123456789abcdef01234567",
    principal: "agent",
    input: {},
  } as const;

  it("accepts agent calls to the allowed tools", () => {
    for (const tool of AGENT_ALLOWED_TOOLS) {
      const parsed = SkillToolCallSchema.safeParse({
        ...callBase,
        tool,
        result: { kind: "ok", value: {} },
      });
      expect(parsed.success, tool).toBe(true);
    }
  });

  it("rejects an agent invoking apply_proposal or rollback", () => {
    for (const tool of ["skills.apply_proposal", "skills.rollback"]) {
      const parsed = SkillToolCallSchema.safeParse({
        ...callBase,
        tool,
        result: { kind: "ok", value: {} },
      });
      expect(parsed.success, tool).toBe(false);
    }
    // 人类 UI 主体可以。
    expect(
      SkillToolCallSchema.safeParse({
        ...callBase,
        principal: "human-ui",
        tool: "skills.apply_proposal",
        result: { kind: "ok", value: {} },
      }).success,
    ).toBe(true);
  });

  it("only lets non-domain tools exist as denied records", () => {
    expect(
      SkillToolCallSchema.safeParse({
        ...callBase,
        tool: "write_file",
        result: { kind: "ok", value: {} },
      }).success,
    ).toBe(false);
    const denied = SkillToolCallSchema.safeParse({
      ...callBase,
      tool: "write_file",
      result: {
        kind: "denied",
        reason: "unsupported-capability",
        requestedOperation: "write_file",
      },
    });
    expect(denied.success).toBe(true);
  });
});

describe("versioned prompts and templates (task 1.4)", () => {
  it("assembles a stable system prompt with the required rule sections", () => {
    const prompt = assembleStewardSystemPrompt();
    expect(STEWARD_PROMPT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(STEWARD_TOOL_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    for (const tool of AGENT_ALLOWED_TOOLS) {
      expect(prompt).toContain(tool);
    }
    expect(prompt).not.toContain("skills.apply_proposal\n- ");
    expect(prompt).toContain("Never modify");
    expect(prompt).toContain("one-shot grant");
    expect(prompt).toContain("needs-review");
    expect(prompt).toContain(SKILL_STEWARD_CONTRACT_VERSION);
  });

  it("renders deterministic check/optimize/organize turns bound to the snapshot", () => {
    const taskId = StewardTaskIdSchema.parse("task_0123456789abcdef");
    for (const kind of ["check", "optimize", "organize"] as const) {
      const rendered = renderStewardTaskTurn({
        task: {
          id: taskId,
          kind,
          snapshotId: importedSnapshot.id,
          skillIds: importedSnapshot.skills.map((skill) => skill.skillId),
          promptVersion: STEWARD_PROMPT_VERSION,
          toolVersion: STEWARD_TOOL_VERSION,
          createdAt: "2026-09-06T00:00:00.000Z",
        },
        snapshot: importedSnapshot,
      });
      if (!rendered.ok) throw new Error(`render failed: ${rendered.failure.message}`);
      const turn = rendered.text;
      expect(turn).toContain(kind);
      expect(turn).toContain(importedSnapshot.id);
      expect(turn).toContain(STEWARD_PROMPT_VERSION);
      expect(turn).toContain("human approves");
    }
  });

  it("refuses to render a task turn whose identity does not match the snapshot (Codex R2 P2-4)", () => {
    const taskId = StewardTaskIdSchema.parse("task_0123456789abcdef");
    const mismatched = renderStewardTaskTurn({
      task: {
        id: taskId,
        kind: "check",
        snapshotId: StewardSnapshotIdSchema.parse("snap_ffffffffffffffff"),
        skillIds: importedSnapshot.skills.map((skill) => skill.skillId),
        promptVersion: STEWARD_PROMPT_VERSION,
        toolVersion: STEWARD_TOOL_VERSION,
        createdAt: "2026-09-06T00:00:00.000Z",
      },
      snapshot: importedSnapshot,
    });
    expect(mismatched).toMatchObject({ ok: false, failure: { code: "SNAPSHOT_MISMATCH" } });
    const outsider = renderStewardTaskTurn({
      task: {
        id: taskId,
        kind: "check",
        snapshotId: importedSnapshot.id,
        skillIds: [SkillIdSchema.parse("sk_ffffffffffffffffffffffff")],
        promptVersion: STEWARD_PROMPT_VERSION,
        toolVersion: STEWARD_TOOL_VERSION,
        createdAt: "2026-09-06T00:00:00.000Z",
      },
      snapshot: importedSnapshot,
    });
    expect(outsider).toMatchObject({ ok: false, failure: { code: "UNKNOWN_SKILL" } });
  });
});

describe("codex round-2 review probes (contract 1.3.0)", () => {
  it("P1-1: snapshot resource manifest rejects traversal, backslash, drive-letter and UNC relPaths", () => {
    const base = structuredClone(importedSnapshot);
    for (const relPath of [
      "assets/../../outside",
      "assets\\..\\outside",
      "C:/x",
      "//server/share/x",
    ]) {
      const snapshot = structuredClone(base);
      snapshot.resources = [
        {
          skillId: snapshot.skills[0]!.skillId,
          relPath,
          hash: "a".repeat(64),
          byteSize: 1,
          kind: "file",
        },
      ];
      expect(SkillStewardContextSnapshotSchema.safeParse(snapshot).success, relPath).toBe(false);
    }
  });

  it("P1-2: split mapping source must be the patch source skill at parse time", () => {
    const raw = loadFixture<unknown>("proposal-split.valid.json") as SkillProposal;
    const edited = structuredClone(raw);
    const first = edited.patch.targets[0]!.resources[0]!;
    first.sourceSkillId = "sk_b1b2c3d4e5f6a7b8c9d0e1f2";
    first.sourcePath = "assets/api.env";
    expect(SkillProposalSchema.safeParse(edited).success).toBe(false);
  });

  it("P1-2: merge mapping source must belong to the patch sources at parse time", () => {
    const raw = loadFixture<unknown>("proposal-merge.valid.json") as SkillProposal;
    const edited = structuredClone(raw);
    edited.patch.target.resources[0]!.sourceSkillId = "sk_c1b2c3d4e5f6a7b8c9d0e1f2";
    expect(SkillProposalSchema.safeParse(edited).success).toBe(false);
  });

  it("P1-2: bind rejects a mapping whose sourcePath is outside the snapshot manifest", () => {
    const raw = loadFixture<unknown>("proposal-split.valid.json") as SkillProposal;
    const edited = structuredClone(raw);
    edited.patch.targets[0]!.resources[0]!.sourcePath = "references/missing.md";
    const parsed = SkillProposalSchema.parse(edited);
    const bound = bindProposalToSnapshot(parsed, importedSnapshot);
    expect(bound).toMatchObject({ ok: false, failure: { code: "RESOURCE_MAPPING" } });
  });

  it("P1-3: agent proposals cannot enable on any scope; Manager-derived bind can", () => {
    const raw = loadFixture<unknown>("proposal-disable.valid.json") as SkillProposal;
    const enableProposal = () => {
      const edited = structuredClone(raw);
      edited.action = "enable";
      edited.patch = {
        kind: "enable",
        snapshotId: edited.patch.snapshotId,
        selections: edited.patch.selections,
        reason: "Manager-derived rollback inverse.",
      };
      return SkillProposalSchema.parse(edited);
    };
    const imported = bindProposalToSnapshot(enableProposal(), importedSnapshot);
    expect(imported).toMatchObject({ ok: false, failure: { code: "UNSUPPORTED_WRITE_SCOPE" } });
    const global = bindProposalToSnapshot(enableProposal(), globalSnapshot);
    expect(global).toMatchObject({ ok: false, failure: { code: "UNSUPPORTED_WRITE_SCOPE" } });
    // Manager 派生入口允许 enable（Global 的 rollback-of-disable 逆）。
    expect(bindManagerDerivedProposalToSnapshot(enableProposal(), importedSnapshot)).toEqual({
      ok: true,
    });
    expect(bindManagerDerivedProposalToSnapshot(enableProposal(), globalSnapshot)).toEqual({
      ok: true,
    });
    // Agent 的 Global disable 仍可用。
    const disable = parseProposal("proposal-disable.valid.json").proposal!;
    expect(bindProposalToSnapshot(disable, globalSnapshot)).toEqual({ ok: true });
  });

  it("P2-1: evidence outside the proposal skillIds fails at parse time", () => {
    const raw = loadFixture<unknown>("proposal-disable.valid.json") as SkillProposal;
    const edited = structuredClone(raw);
    edited.evidence[0]!.skillId = "sk_c1b2c3d4e5f6a7b8c9d0e1f2";
    expect(SkillProposalSchema.safeParse(edited).success).toBe(false);
  });

  it("P2-1: finding observedRevisions must equal skillIds exactly", () => {
    const finding = {
      contractVersion: SKILL_STEWARD_CONTRACT_VERSION,
      origin: "agent-semantic",
      severity: "warning",
      category: "unclear-description",
      message: "Description does not state the scope.",
      skillIds: [importedSnapshot.skills[0]!.skillId],
      observedRevisions: [
        {
          skillId: importedSnapshot.skills[0]!.skillId,
          revision: importedSnapshot.skills[0]!.revision,
        },
        {
          skillId: importedSnapshot.skills[1]!.skillId,
          revision: importedSnapshot.skills[1]!.revision,
        },
      ],
      evidence: [{ skillId: importedSnapshot.skills[0]!.skillId, snippet: "x" }],
    };
    expect(StewardFindingSchema.safeParse(finding).success).toBe(false);
  });

  it("P2-2: split/merge targets colliding with snapshot directories fail with TARGET_COLLISION", () => {
    const splitRaw = loadFixture<unknown>("proposal-split.valid.json") as SkillProposal;
    const splitEdited = structuredClone(splitRaw);
    splitEdited.patch.targets[0]!.directoryName = "deploy-api";
    splitEdited.patch.targets[0]!.frontmatter.name = "deploy-api";
    const splitBound = bindProposalToSnapshot(
      SkillProposalSchema.parse(splitEdited),
      importedSnapshot,
    );
    expect(splitBound).toMatchObject({ ok: false, failure: { code: "TARGET_COLLISION" } });

    const mergeRaw = loadFixture<unknown>("proposal-merge.valid.json") as SkillProposal;
    const mergeEdited = structuredClone(mergeRaw);
    mergeEdited.patch.target.directoryName = "audit-logs";
    mergeEdited.patch.target.frontmatter.name = "audit-logs";
    const mergeBound = bindProposalToSnapshot(
      SkillProposalSchema.parse(mergeEdited),
      importedSnapshot,
    );
    expect(mergeBound).toMatchObject({ ok: false, failure: { code: "TARGET_COLLISION" } });
  });
});
