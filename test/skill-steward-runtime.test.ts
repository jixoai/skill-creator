/**
 * Skill Steward runtime focused tests（openspec skill-steward-runtime tasks 2.1+）。
 *
 * 用户原始需求 [2026-09-06]（spec）：「only seven domain tools are callable; generic
 * file/shell requests are denied; every call is audited.」
 *
 * 正交意图：
 *   [1] 工具面闭合与 principal 边界（2.1）。
 *   [2] 快照作用域：inspect/propose 只接受快照成员；proposal bind 拒绝 stale/unknown。
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AGENT_ALLOWED_TOOLS,
  SkillProposalSchema,
  SkillStewardContextSnapshotSchema,
  StewardProposalIdSchema,
  StewardRunIdSchema,
  type SkillProposal,
  type SkillStewardContextSnapshot,
  type SkillToolCall,
  type StewardProposalId,
} from "../src/shared/contracts/skill-steward.js";
import {
  createStewardToolRegistry,
  type StewardProposalSink,
} from "../src/daemon/steward/tool-registry.js";

const fixtureDir = path.join(__dirname, "fixtures", "steward");

function loadSnapshot(name = "snapshot.imported.json"): SkillStewardContextSnapshot {
  const parsed = SkillStewardContextSnapshotSchema.safeParse(
    JSON.parse(fs.readFileSync(path.join(fixtureDir, name), "utf8")),
  );
  if (!parsed.success)
    throw new Error(`snapshot fixture invalid: ${JSON.stringify(parsed.error.issues)}`);
  return parsed.data;
}

function loadProposal(name: string): SkillProposal {
  return SkillProposalSchema.parse(
    JSON.parse(fs.readFileSync(path.join(fixtureDir, name), "utf8")),
  );
}

/** 内存 proposal sink（真实 store 由 approval-service 阶段接入）。 */
function memorySink(): StewardProposalSink & { stored: Map<StewardProposalId, SkillProposal> } {
  const stored = new Map<StewardProposalId, SkillProposal>();
  let counter = 0;
  return {
    stored,
    store(proposal) {
      counter += 1;
      const id = StewardProposalIdSchema.parse(`spp_${counter.toString(16).padStart(16, "0")}`);
      stored.set(id, proposal);
      return id;
    },
    get: (proposalId) => stored.get(proposalId) ?? null,
  };
}

const RUN_ID = StewardRunIdSchema.parse("sr_0123456789abcdef01234567");

describe("tool registry (task 2.1)", () => {
  function makeRegistry() {
    const snapshot = loadSnapshot();
    const sink = memorySink();
    const calls: SkillToolCall[] = [];
    const registry = createStewardToolRegistry({
      runId: RUN_ID,
      snapshot,
      proposals: sink,
      validate: () => ({ overall: "valid", checks: [{ name: "bind", status: "passed" }] }),
      onCall: (call) => calls.push(call),
    });
    return { registry, snapshot, sink, calls };
  }

  it("serves all agent tools and audits every call with revisions", async () => {
    const { registry, sink, snapshot, calls } = makeRegistry();
    const validProposal = loadProposal("proposal-edit.valid.json");
    const proposalId = sink.store(validProposal);
    for (const tool of AGENT_ALLOWED_TOOLS) {
      const input =
        tool === "skills.inspect"
          ? { skillId: snapshot.skills[0]!.skillId }
          : tool === "skills.propose"
            ? { proposal: validProposal }
            : tool === "skills.validate_proposal"
              ? { proposalId }
              : {};
      const result = await registry.call(tool, input, "agent");
      expect(result.kind, tool).toBe("ok");
    }
    expect(calls).toHaveLength(AGENT_ALLOWED_TOOLS.length);
    for (const call of calls) {
      expect(call.observedRevisions).toHaveLength(snapshot.skills.length);
      expect(call.runId).toBe(RUN_ID);
    }
  });

  it("denies generic file/shell requests as unsupported capability and audits them", async () => {
    const { registry, calls } = makeRegistry();
    for (const tool of ["write_file", "read_file", "bash", "skills.write_file"]) {
      const result = await registry.call(tool, { path: "/etc/passwd" }, "agent");
      expect(result).toEqual({
        kind: "denied",
        reason: "unsupported-capability",
        requestedOperation: tool,
      });
    }
    expect(calls).toHaveLength(4);
    expect(calls.every((call) => call.result.kind === "denied")).toBe(true);
  });

  it("denies agent principals from apply and rollback", async () => {
    const { registry, calls } = makeRegistry();
    for (const tool of ["skills.apply_proposal", "skills.rollback"]) {
      const result = await registry.call(tool, {}, "agent");
      expect(result).toEqual({
        kind: "denied",
        reason: "principal-forbidden",
        requestedOperation: tool,
      });
    }
    expect(calls).toHaveLength(2);
  });

  it("scopes inspect to snapshot members", async () => {
    const { registry } = makeRegistry();
    const insider = await registry.call(
      "skills.inspect",
      { skillId: loadSnapshot().skills[0]!.skillId },
      "agent",
    );
    expect(insider.kind).toBe("ok");
    const outsider = await registry.call(
      "skills.inspect",
      { skillId: "sk_ffffffffffffffffffffffff" },
      "agent",
    );
    expect(outsider).toMatchObject({ kind: "failed", code: "NOT_FOUND" });
    const malformed = await registry.call("skills.inspect", { skillId: 42 }, "agent");
    expect(malformed).toMatchObject({ kind: "failed", code: "INVALID_OPERATION" });
  });

  it("stores valid proposals and rejects malformed or unbound ones", async () => {
    const { registry, sink } = makeRegistry();
    const valid = loadProposal("proposal-disable.valid.json");
    const stored = await registry.call("skills.propose", { proposal: valid }, "agent");
    expect(stored.kind).toBe("ok");
    if (stored.kind === "ok") {
      expect(sink.stored.size).toBe(1);
    }
    // malformed：结构不符。
    const malformed = await registry.call("skills.propose", { proposal: { bogus: true } }, "agent");
    expect(malformed).toMatchObject({ kind: "failed", code: "INVALID_OPERATION" });
    // unbound：不同 snapshot。
    const stale = await registry.call(
      "skills.propose",
      { proposal: { ...valid, patch: { ...valid.patch, snapshotId: "snap_fedcba9876543210" } } },
      "agent",
    );
    expect(stale).toMatchObject({ kind: "failed", code: "INVALID_OPERATION" });
    expect(sink.stored.size).toBe(1);
  });

  it("validates stored proposals through the injected validator", async () => {
    const { registry, sink } = makeRegistry();
    const proposalId = sink.store(loadProposal("proposal-edit.valid.json"));
    const result = await registry.call("skills.validate_proposal", { proposalId }, "agent");
    expect(result.kind).toBe("ok");
    const missing = await registry.call(
      "skills.validate_proposal",
      { proposalId: "spp_00000000000000ff" as StewardProposalId },
      "agent",
    );
    expect(missing).toMatchObject({ kind: "failed", code: "NOT_FOUND" });
  });
});
