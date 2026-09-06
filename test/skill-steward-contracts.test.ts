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
  StewardTaskIdSchema,
  bindProposalToSnapshot,
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
    edited.patch.edits[0]!.expectedRevision = `sha256:${"9".repeat(64)}`;
    const parsed = SkillProposalSchema.parse(edited);
    const bound = bindProposalToSnapshot(parsed, importedSnapshot);
    expect(bound.ok).toBe(false);
    if (!bound.ok) expect(bound.failure.code).toBe("STALE_REVISION");
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
      const turn = renderStewardTaskTurn({
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
      expect(turn).toContain(kind);
      expect(turn).toContain(importedSnapshot.id);
      expect(turn).toContain(STEWARD_PROMPT_VERSION);
      expect(turn).toContain("human approves");
    }
  });
});
