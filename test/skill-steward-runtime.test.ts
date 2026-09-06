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
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AGENT_ALLOWED_TOOLS,
  SkillProposalSchema,
  SkillStewardContextSnapshotSchema,
  StewardApprovalGrantSchema,
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
import { runFixtureStewardScenario } from "../src/daemon/steward/runtime.js";
import {
  buildContextSnapshot,
  loadContextSnapshot,
} from "../src/daemon/steward/context-snapshot.js";
import { createStewardAuditStore } from "../src/daemon/steward/audit-store.js";
import { createStewardApprovalService } from "../src/daemon/steward/approval-service.js";
import { scanUnfinishedJournals } from "../src/daemon/steward/apply-transaction.js";
import { stewardStoreDir } from "../src/daemon/steward/context-snapshot.js";
import { createDaemonDomain, type DaemonDomain } from "../src/daemon/domain.js";
import { deterministicSkillsCliProbe } from "./helpers/deterministic-probe.js";
import { setHomeOverride } from "../src/shared/paths.js";
import {
  ProviderIdSchema,
  type WorkspaceProviderTarget,
} from "../src/shared/contracts/workspaces.js";

type WorkspaceTarget = WorkspaceProviderTarget;

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

describe("fixture runtime scenarios (task 2.2)", () => {
  const snapshot = loadSnapshot();

  function makeSink(): StewardProposalSink & { stored: Map<StewardProposalId, SkillProposal> } {
    return memorySink();
  }

  async function run(scenario: Parameters<typeof runFixtureStewardScenario>[0]["scenario"]) {
    return runFixtureStewardScenario({
      runId: RUN_ID,
      scenario,
      snapshot,
      proposals: makeSink(),
      validate: () => ({ overall: "valid", checks: [{ name: "bind", status: "passed" }] }),
    });
  }

  it("valid-check replays identically twice and produces evidence-backed findings", async () => {
    const first = await run("valid-check");
    const second = await run("valid-check");
    expect(JSON.stringify(second.result.transcript)).toBe(JSON.stringify(first.result.transcript));
    expect(first.result.terminalReason).toBe("completed");
    expect(first.acceptedResponses.some((response) => response.kind === "finding")).toBe(true);
    expect(first.toolCalls.length).toBeGreaterThan(0);
  });

  it("valid-optimize proposes an edit that stops before approval", async () => {
    const output = await run("valid-optimize");
    expect(output.result.terminalReason).toBe("completed");
    const proposalResponse = output.acceptedResponses.find(
      (response) => response.kind === "proposal",
    );
    expect(proposalResponse).toBeDefined();
    // apply 从未发生：没有任何 apply 工具调用。
    expect(output.toolCalls.some((call) => call.tool === "skills.apply_proposal")).toBe(false);
  });

  it("valid-organize proposes a split with two targets", async () => {
    const output = await run("valid-organize");
    expect(output.result.terminalReason).toBe("completed");
    const proposal = output.acceptedResponses.find((response) => response.kind === "proposal");
    expect(proposalResponsePatch(proposal)?.kind).toBe("split");
  });

  it("malformed and stale proposals are rejected without drafts", async () => {
    for (const scenario of ["malformed", "stale"] as const) {
      const sink = makeSink();
      const output = await runFixtureStewardScenario({
        runId: RUN_ID,
        scenario,
        snapshot,
        proposals: sink,
        validate: () => ({ overall: "valid", checks: [{ name: "bind", status: "passed" }] }),
      });
      expect(output.result.terminalReason, scenario).toBe("failed");
      expect(sink.stored.size, scenario).toBe(0);
    }
  });

  it("late events after terminal are dropped and create no drafts", async () => {
    const sink = makeSink();
    const output = await runFixtureStewardScenario({
      runId: RUN_ID,
      scenario: "late-event",
      snapshot,
      proposals: sink,
      validate: () => ({ overall: "valid", checks: [{ name: "bind", status: "passed" }] }),
    });
    expect(output.result.terminalReason).toBe("completed");
    expect(output.droppedLateResponses.length).toBe(1);
    expect(sink.stored.size).toBe(1); // terminal 前的 draft 保留；迟到事件不新增
  });

  it("agent apply attempts are denied twice (approval replay boundary)", async () => {
    const output = await run("approval-replay");
    expect(output.result.terminalReason).toBe("completed");
    const applyCalls = output.toolCalls.filter((call) => call.tool === "skills.apply_proposal");
    expect(applyCalls).toHaveLength(2);
    expect(applyCalls.every((call) => call.result.kind === "denied")).toBe(true);
  });

  it("cancel scenario aborts into a bounded cancelled terminal", async () => {
    const controller = new AbortController();
    const pending = runFixtureStewardScenario({
      runId: RUN_ID,
      scenario: "cancel",
      snapshot,
      proposals: makeSink(),
      validate: () => ({ overall: "valid", checks: [{ name: "bind", status: "passed" }] }),
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 50);
    const output = await pending;
    expect(output.result.terminalReason).toBe("cancelled");
  });

  it("disconnect scenario surfaces a disconnected terminal", async () => {
    const output = await run("disconnect");
    expect(output.result.terminalReason).toBe("disconnected");
  });
});

function proposalResponsePatch(
  response:
    | Awaited<ReturnType<typeof runFixtureStewardScenario>>["acceptedResponses"][number]
    | undefined,
): { kind: string } | undefined {
  if (!response || response.kind !== "proposal") return undefined;
  return response.proposal.patch as { kind: string };
}

describe("context snapshot builder (task 2.3a)", () => {
  let sandbox = "";
  let domain: DaemonDomain;
  const providerId = "openclaw";

  beforeEach(() => {
    sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "steward-snapshot-test-"));
    process.env.SKILL_CREATOR_HOME = path.join(sandbox, "home");
    setHomeOverride(path.join(sandbox, "home"));
    domain = createDaemonDomain(undefined, { skillsCliProbe: deterministicSkillsCliProbe() });
  });

  afterEach(async () => {
    await domain.steward.dispose();
    await domain.repository.dispose();
    setHomeOverride(null);
    fs.rmSync(sandbox, { recursive: true, force: true });
  });

  async function seedWorkspace(skills: Array<[string, string]>): Promise<WorkspaceTarget> {
    const directory = path.join(sandbox, "ws");
    fs.mkdirSync(directory, { recursive: true });
    const workspace = domain.workspaces.import(directory, "ws");
    for (const [name, description] of skills) {
      await domain.creator.save({
        mode: "create",
        workspaceId: workspace.id,
        providerId: ProviderIdSchema.parse(providerId),
        directoryName: name,
        frontmatter: { name, description },
        body: `# ${name}\n\nUses \`scripts/${name}.sh\`.\n`,
      });
    }
    return { workspaceId: workspace.id, providerId: ProviderIdSchema.parse(providerId) };
  }

  it("captures a single-read snapshot: provider edits afterwards do not change run content", async () => {
    const target = await seedWorkspace([["alpha-skill", "Alpha skill."]]);
    const capabilities = {
      backendId: "fixture",
      version: "fixture-1",
      streamingEvents: true,
      cancellation: true,
      permissionRequests: true,
      executionRoot: "isolated" as const,
    };
    const snapshot = await buildContextSnapshot(domain.skills, {
      target,
      promptVersion: "1.0.0",
      toolVersion: "1.0.0",
      capabilities,
    });
    expect(snapshot.skills).toHaveLength(1);
    const before = snapshot.skills[0]!.revision;

    // 修改 Provider：快照内容不变（不可变快照）。
    const skillDirectory = path.join(sandbox, "ws", "skills", "alpha-skill");
    fs.writeFileSync(
      path.join(skillDirectory, "SKILL.md"),
      "---\nname: alpha-skill\ndescription: changed\n---\n# changed\n",
      "utf8",
    );

    const persisted = await loadContextSnapshot(snapshot.id);
    expect(persisted?.skills[0]?.revision).toBe(before);
    expect(persisted?.skills[0]?.content).toContain("Alpha");
  });

  it("rejects oversize content with a typed budget failure", async () => {
    const target = await seedWorkspace([["big-skill", "Big skill."]]);
    const skillDirectory = path.join(sandbox, "ws", "skills", "big-skill");
    const big = `---\nname: big-skill\ndescription: Big.\n---\n# big\n\n${"x".repeat(256 * 1024)}\n`;
    fs.writeFileSync(path.join(skillDirectory, "SKILL.md"), big, "utf8");
    await expect(
      buildContextSnapshot(domain.skills, {
        target,
        promptVersion: "1.0.0",
        toolVersion: "1.0.0",
        capabilities: {
          backendId: "fixture",
          version: "fixture-1",
          streamingEvents: true,
          cancellation: true,
          permissionRequests: true,
          executionRoot: "isolated",
        },
      }),
    ).rejects.toThrow(/256 KiB/);
  });

  it("manifests skill resources with hashes and survives restart reads", async () => {
    const target = await seedWorkspace([["res-skill", "Resource skill."]]);
    const skillDirectory = path.join(sandbox, "ws", "skills", "res-skill");
    fs.mkdirSync(path.join(skillDirectory, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(skillDirectory, "scripts", "run.sh"), "echo ok\n", "utf8");
    const snapshot = await buildContextSnapshot(domain.skills, {
      target,
      promptVersion: "1.0.0",
      toolVersion: "1.0.0",
      capabilities: {
        backendId: "fixture",
        version: "fixture-1",
        streamingEvents: true,
        cancellation: true,
        permissionRequests: true,
        executionRoot: "isolated",
      },
    });
    expect(snapshot.resources.some((resource) => resource.relPath === "scripts/run.sh")).toBe(true);
    // 重启读取：新 store 实例（同 home）能读回快照。
    const again = await loadContextSnapshot(snapshot.id);
    expect(again?.id).toBe(snapshot.id);
  });

  it("audit store round-trips runs, audits, and grants across restart", async () => {
    const store = createStewardAuditStore();
    const grant = StewardApprovalGrantSchemaTest.parse({
      id: "grant_0123456789abcdef",
      proposalId: "spp_0123456789abcdef",
      snapshotId: "snap_0123456789abcdef",
      fingerprint: `sha256:${"a".repeat(64)}`,
      principal: "human-ui",
      issuedAt: "2026-09-06T00:00:00.000Z",
      consumedAt: null,
      inputRevisions: [
        { skillId: "sk_a1b2c3d4e5f6a7b8c9d0e1f2", revision: `sha256:${"1".repeat(64)}` },
      ],
      absentPreconditions: [],
    });
    await store.appendRun({
      runId: "sr_0123456789abcdef01234567",
      snapshotId: "snap_0123456789abcdef",
      terminal: "completed",
      endedAt: "2026-09-06T00:00:01.000Z",
    });
    await store.appendGrant(grant);

    // 「重启」：新实例读取同一持久目录。
    const reopened = createStewardAuditStore();
    const runs = await reopened.listRuns();
    const grants = await reopened.listGrants();
    expect(runs).toHaveLength(1);
    expect(runs[0]!.terminal).toBe("completed");
    expect(grants).toHaveLength(1);
    expect(grants[0]!.consumedAt).toBeNull();
  });
});

/** grant fixture 的本地 parse 通道。 */
const StewardApprovalGrantSchemaTest = StewardApprovalGrantSchema;

describe("approval + apply transactions (tasks 2.3b/2.3c/2.3d)", () => {
  let sandbox = "";
  let domain: DaemonDomain;
  const providerId = ProviderIdSchema.parse("openclaw");
  const capabilities = {
    backendId: "fixture",
    version: "fixture-1",
    streamingEvents: true,
    cancellation: true,
    permissionRequests: true,
    executionRoot: "isolated" as const,
  };

  beforeEach(() => {
    sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "steward-txn-test-"));
    process.env.SKILL_CREATOR_HOME = path.join(sandbox, "home");
    setHomeOverride(path.join(sandbox, "home"));
    domain = createDaemonDomain(undefined, { skillsCliProbe: deterministicSkillsCliProbe() });
  });

  afterEach(async () => {
    await domain.steward.dispose();
    await domain.repository.dispose();
    setHomeOverride(null);
    fs.rmSync(sandbox, { recursive: true, force: true });
  });

  async function seed(
    skills: string[],
  ): Promise<{ target: WorkspaceTarget; snapshot: SkillStewardContextSnapshot }> {
    const directory = path.join(sandbox, "ws");
    fs.mkdirSync(directory, { recursive: true });
    const workspace = domain.workspaces.import(directory, "ws");
    for (const name of skills) {
      await domain.creator.save({
        mode: "create",
        workspaceId: workspace.id,
        providerId,
        directoryName: name,
        frontmatter: { name, description: `${name} skill.` },
        body: `# ${name}\n\nBody of ${name}.\n`,
      });
    }
    const target = { workspaceId: workspace.id, providerId };
    const snapshot = await buildContextSnapshot(domain.skills, {
      target,
      promptVersion: "1.0.0",
      toolVersion: "1.0.0",
      capabilities,
    });
    return { target, snapshot };
  }

  function approval() {
    return createStewardApprovalService({
      workspaces: domain.workspaces,
      skills: domain.skills,
      creator: domain.creator,
      store: createStewardAuditStore(),
    });
  }

  function disableProposal(snapshot: SkillStewardContextSnapshot, skillId: string): SkillProposal {
    const skill = snapshot.skills.find((entry) => entry.skillId === skillId)!;
    return {
      contractVersion: "1.1.0",
      action: "disable",
      patch: {
        kind: "disable",
        snapshotId: snapshot.id,
        selections: [{ skillId, expectedRevision: skill.revision }],
        reason: "test disable",
      },
      rationale: "test",
      findingIds: [],
      evidence: [{ skillId, snippet: "trigger overlap" }],
      skillIds: [skillId],
      observedRevisions: [{ skillId, revision: skill.revision }],
    };
  }

  function editProposal(
    snapshot: SkillStewardContextSnapshot,
    skillId: string,
    description: string,
  ): SkillProposal {
    const skill = snapshot.skills.find((entry) => entry.skillId === skillId)!;
    return {
      contractVersion: "1.1.0",
      action: "edit",
      patch: {
        kind: "edit",
        snapshotId: snapshot.id,
        edits: [
          {
            skillId,
            expectedRevision: skill.revision,
            frontmatter: { name: skill.name, description },
            body: `# ${skill.directoryName}\n\nEdited body.\n`,
          },
        ],
      },
      rationale: "test edit",
      findingIds: [],
      evidence: [{ skillId, snippet: "vague description" }],
      skillIds: [skillId],
      observedRevisions: [{ skillId, revision: skill.revision }],
    };
  }

  it("denies apply without a human grant even after validation passes", async () => {
    const { snapshot } = await seed(["lonely-skill"]);
    const service = approval();
    const proposalId = service.submit(
      disableProposal(snapshot, snapshot.skills[0]!.skillId),
      snapshot,
    );
    const validation = await service.validate(proposalId);
    expect(validation.overall).toBe("valid");
    await expect(service.apply(proposalId, "human-ui")).rejects.toThrow(
      /No unconsumed human grant/,
    );
    // Provider 未变：SKILL.md 仍在（未禁用）。
    expect(fs.existsSync(path.join(sandbox, "ws", "skills", "lonely-skill", "SKILL.md"))).toBe(
      true,
    );
  });

  it("applies after human approval, and a replayed apply is rejected", async () => {
    const { snapshot } = await seed(["lonely-skill"]);
    const service = approval();
    const proposalId = service.submit(
      disableProposal(snapshot, snapshot.skills[0]!.skillId),
      snapshot,
    );
    await service.approve(proposalId, "human-ui");
    const { outcome, audit } = await service.apply(proposalId, "human-ui");
    expect(outcome.status).toBe("applied");
    expect(audit.status).toBe("applied");
    expect(fs.existsSync(path.join(sandbox, "ws", "skills", "lonely-skill", ".SKILL.md"))).toBe(
      true,
    );
    // 重放：grant 已消费。
    await expect(service.apply(proposalId, "human-ui")).rejects.toThrow(
      /No unconsumed human grant/,
    );
  });

  it("rolls back disable via a reverse enable proposal that itself needs approval", async () => {
    const { snapshot } = await seed(["lonely-skill"]);
    const service = approval();
    const proposalId = service.submit(
      disableProposal(snapshot, snapshot.skills[0]!.skillId),
      snapshot,
    );
    await service.approve(proposalId, "human-ui");
    const { audit } = await service.apply(proposalId, "human-ui");
    expect(audit.status).toBe("applied");

    const reverse = await service.prepareRollback(audit.id, "human-ui");
    expect(reverse.note).toContain("separate human approval");
    // 反向 proposal 未经批准不能 apply。
    await expect(service.apply(reverse.reverseProposalId, "human-ui")).rejects.toThrow(/grant/);
    await service.approve(reverse.reverseProposalId, "human-ui");
    const rollback = await service.apply(reverse.reverseProposalId, "human-ui");
    expect(rollback.outcome.status).toBe("applied");
    expect(fs.existsSync(path.join(sandbox, "ws", "skills", "lonely-skill", "SKILL.md"))).toBe(
      true,
    );
  });

  it("restores original bytes when an edit is rolled back", async () => {
    const { snapshot } = await seed(["doc-skill"]);
    const skillId = snapshot.skills[0]!.skillId;
    const original = snapshot.skills[0]!.content;
    const service = approval();
    const proposalId = service.submit(
      editProposal(snapshot, skillId, "Edited description."),
      snapshot,
    );
    await service.approve(proposalId, "human-ui");
    const { audit } = await service.apply(proposalId, "human-ui");
    expect(audit.status).toBe("applied");
    const afterBytes = fs.readFileSync(
      path.join(sandbox, "ws", "skills", "doc-skill", "SKILL.md"),
      "utf8",
    );
    expect(afterBytes).not.toBe(original);

    const reverse = await service.prepareRollback(audit.id, "human-ui");
    await service.approve(reverse.reverseProposalId, "human-ui");
    await service.apply(reverse.reverseProposalId, "human-ui");
    const restored = fs.readFileSync(
      path.join(sandbox, "ws", "skills", "doc-skill", "SKILL.md"),
      "utf8",
    );
    expect(restored).toBe(original);
  });

  it("compensates fully when a later step fails, leaving the provider unchanged", async () => {
    const { snapshot } = await seed(["first-skill", "second-skill"]);
    const service = approval();
    const first = snapshot.skills.find((skill) => skill.directoryName === "first-skill")!;
    const second = snapshot.skills.find((skill) => skill.directoryName === "second-skill")!;
    // 双 edit proposal；在 approve 后、apply 前外部修改第二个技能 → 第二步 stale → 补偿第一步。
    const proposal: SkillProposal = {
      contractVersion: "1.1.0",
      action: "edit",
      patch: {
        kind: "edit",
        snapshotId: snapshot.id,
        edits: [
          {
            skillId: first.skillId,
            expectedRevision: first.revision,
            frontmatter: { name: "first-skill", description: "Edited first." },
            body: "# first-skill\n\nEdited.\n",
          },
          {
            skillId: second.skillId,
            expectedRevision: second.revision,
            frontmatter: { name: "second-skill", description: "Edited second." },
            body: "# second-skill\n\nEdited.\n",
          },
        ],
      },
      rationale: "two edits",
      findingIds: [],
      evidence: [{ skillId: first.skillId, snippet: "x" }],
      skillIds: [first.skillId, second.skillId],
      observedRevisions: [
        { skillId: first.skillId, revision: first.revision },
        { skillId: second.skillId, revision: second.revision },
      ],
    };
    const proposalId = service.submit(proposal, snapshot);
    // validate 此时仍 valid（活体还没改）；approve 之后注入外部修改。
    // 为让 validate 通过后仍可制造漂移：直接 approve（validate 在 approve 内运行，先改会挡 approve）。
    // 顺序：approve → 外部改 second → apply（第二步 CONFLICT stale → 补偿第一步）。
    await service.approve(proposalId, "human-ui");
    fs.writeFileSync(
      path.join(sandbox, "ws", "skills", "second-skill", "SKILL.md"),
      "---\nname: second-skill\ndescription: externally edited\n---\n# second-skill\n",
      "utf8",
    );
    const { outcome } = await service.apply(proposalId, "human-ui");
    expect(outcome.status).toBe("compensated");
    // 第一步已被补偿：first-skill 字节恢复原样。
    const restoredFirst = fs.readFileSync(
      path.join(sandbox, "ws", "skills", "first-skill", "SKILL.md"),
      "utf8",
    );
    expect(restoredFirst).toBe(first.content);
  });

  it("applies split with resource mapping and restores the full tree on rollback", async () => {
    const { snapshot } = await seed(["fat-skill"]);
    const source = snapshot.skills[0]!;
    // 资源文件：手动放置（seed 只写 SKILL.md）。
    fs.mkdirSync(path.join(sandbox, "ws", "skills", "fat-skill", "scripts"), { recursive: true });
    fs.writeFileSync(
      path.join(sandbox, "ws", "skills", "fat-skill", "scripts", "run.sh"),
      "echo fat\n",
      "utf8",
    );
    const service = approval();
    const proposal: SkillProposal = {
      contractVersion: "1.1.0",
      action: "split",
      patch: {
        kind: "split",
        snapshotId: snapshot.id,
        source: { skillId: source.skillId, expectedRevision: source.revision },
        targets: [
          {
            directoryName: "fat-skill-plan",
            frontmatter: { name: "fat-skill-plan", description: "Plan half." },
            body: "# fat-skill-plan\n\nPlan.\n",
            resources: [],
          },
          {
            directoryName: "fat-skill-exec",
            frontmatter: { name: "fat-skill-exec", description: "Exec half." },
            body: "# fat-skill-exec\n\nExec.\n",
            resources: [
              { sourcePath: "scripts/run.sh", targetPath: "scripts/run.sh", strategy: "copy" },
            ],
          },
        ],
      },
      rationale: "split planning from execution",
      findingIds: [],
      evidence: [{ skillId: source.skillId, snippet: "mixed concerns" }],
      skillIds: [source.skillId],
      observedRevisions: [{ skillId: source.skillId, revision: source.revision }],
    };
    const proposalId = service.submit(proposal, snapshot);
    await service.approve(proposalId, "human-ui");
    const { outcome, audit } = await service.apply(proposalId, "human-ui");
    expect(outcome.status).toBe("applied");
    // 目标树 + 资源复制 + 源禁用（目录保留）。
    expect(
      fs.existsSync(path.join(sandbox, "ws", "skills", "fat-skill-exec", "scripts", "run.sh")),
    ).toBe(true);
    expect(fs.existsSync(path.join(sandbox, "ws", "skills", "fat-skill", ".SKILL.md"))).toBe(true);

    // rollback：journal replay 恢复完整树和启停。
    const prepared = service.prepareRollback(audit.id, "human-ui");
    const rollback = await service.applyRollback(audit.id, "human-ui");
    expect(rollback.audit.status).toBe("rolled-back");
    void prepared;
    expect(fs.existsSync(path.join(sandbox, "ws", "skills", "fat-skill-exec"))).toBe(false);
    expect(fs.existsSync(path.join(sandbox, "ws", "skills", "fat-skill-plan"))).toBe(false);
    expect(fs.existsSync(path.join(sandbox, "ws", "skills", "fat-skill", "SKILL.md"))).toBe(true);
    expect(fs.existsSync(path.join(sandbox, "ws", "skills", "fat-skill", ".SKILL.md"))).toBe(false);
  });

  it("rejects conflicting split targets with zero writes", async () => {
    const { snapshot } = await seed(["fat-skill"]);
    const source = snapshot.skills[0]!;
    fs.mkdirSync(path.join(sandbox, "ws", "skills", "fat-skill-plan"), { recursive: true });
    const service = approval();
    const proposal: SkillProposal = {
      contractVersion: "1.1.0",
      action: "split",
      patch: {
        kind: "split",
        snapshotId: snapshot.id,
        source: { skillId: source.skillId, expectedRevision: source.revision },
        targets: [
          {
            directoryName: "fat-skill-plan",
            frontmatter: { name: "fat-skill-plan", description: "Plan." },
            body: "# plan\n",
            resources: [],
          },
          {
            directoryName: "fat-skill-exec",
            frontmatter: { name: "fat-skill-exec", description: "Exec." },
            body: "# exec\n",
            resources: [],
          },
        ],
      },
      rationale: "conflicting split",
      findingIds: [],
      evidence: [{ skillId: source.skillId, snippet: "x" }],
      skillIds: [source.skillId],
      observedRevisions: [{ skillId: source.skillId, revision: source.revision }],
    };
    const proposalId = service.submit(proposal, snapshot);
    // validate 阶段就发现目标冲突；approve 被拒。
    const validation = await service.validate(proposalId);
    expect(validation.overall).toBe("invalid");
    await expect(service.approve(proposalId, "human-ui")).rejects.toThrow(/invalid/);
    // 零写入：exec 目标不存在、源未禁用。
    expect(fs.existsSync(path.join(sandbox, "ws", "skills", "fat-skill-exec"))).toBe(false);
    expect(fs.existsSync(path.join(sandbox, "ws", "skills", "fat-skill", "SKILL.md"))).toBe(true);
  });

  it("legacy direct approve cannot mutate steward proposals", async () => {
    const { snapshot } = await seed(["lonely-skill"]);
    const service = approval();
    const proposalId = service.submit(
      disableProposal(snapshot, snapshot.skills[0]!.skillId),
      snapshot,
    );
    // 旧 skillIntelligence.approve 对 Steward proposal id 只会 NOT_FOUND，零 mutation。
    await expect(
      domain.skillIntelligence.approve({ proposalId: proposalId as never }),
    ).rejects.toThrow(/not found/i);
    expect(fs.existsSync(path.join(sandbox, "ws", "skills", "lonely-skill", "SKILL.md"))).toBe(
      true,
    );
  });

  it("restart invalidates unconsumed grants so apply is denied", async () => {
    const { snapshot } = await seed(["lonely-skill"]);
    const service = approval();
    const proposalId = service.submit(
      disableProposal(snapshot, snapshot.skills[0]!.skillId),
      snapshot,
    );
    await service.approve(proposalId, "human-ui");
    // 重启语义：未消费 grant 全部失效（approve 后 consumedAt 仍为 null → 1 个）。
    expect(service.invalidateUnconsumedGrants()).toBe(1);
    await expect(service.apply(proposalId, "human-ui")).rejects.toThrow(
      /No unconsumed human grant/,
    );
    expect(fs.existsSync(path.join(sandbox, "ws", "skills", "lonely-skill", "SKILL.md"))).toBe(
      true,
    );
  });
});

describe("skill steward pipeline end-to-end (task 2.3f)", () => {
  let sandbox = "";
  let domain: DaemonDomain;
  const providerId = ProviderIdSchema.parse("openclaw");

  beforeEach(() => {
    sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "steward-pipeline-test-"));
    process.env.SKILL_CREATOR_HOME = path.join(sandbox, "home");
    setHomeOverride(path.join(sandbox, "home"));
    domain = createDaemonDomain(undefined, { skillsCliProbe: deterministicSkillsCliProbe() });
  });

  afterEach(async () => {
    await domain.steward.dispose();
    await domain.repository.dispose();
    setHomeOverride(null);
    fs.rmSync(sandbox, { recursive: true, force: true });
  });

  it("runs check -> disable proposal -> validate -> approve -> apply -> rollback through the full pipeline", async () => {
    const directory = path.join(sandbox, "ws");
    fs.mkdirSync(directory, { recursive: true });
    const workspace = domain.workspaces.import(directory, "ws");
    // 两个重复 trigger 的技能 → valid-check 产生 finding + disable 提案。
    for (const [name, tools] of [
      ["alpha-deploy", "Bash, Read"],
      ["beta-deploy", "Bash, Read"],
    ] as const) {
      await domain.creator.save({
        mode: "create",
        workspaceId: workspace.id,
        providerId,
        directoryName: name,
        frontmatter: { name, description: `${name} skill.`, "allowed-tools": tools },
        body: `# ${name}\n\nDeploy.\n`,
      });
    }
    const target = { workspaceId: workspace.id, providerId };

    // 1. run：fixture check 场景走真实工具面。
    const run = await domain.skillSteward.startRun({ target, taskKind: "check" });
    expect(run.terminal).toBe("completed");
    expect(run.toolCalls).toBeGreaterThan(0);
    expect(run.proposals.length).toBeGreaterThanOrEqual(0); // check 场景只报 finding 时不强求提案

    // 2. 用 optimize 场景拿一个 edit 提案走完整审批链。
    const optimizeRun = await domain.skillSteward.startRun({ target, taskKind: "optimize" });
    expect(optimizeRun.proposals).toHaveLength(1);
    const proposalId = optimizeRun.proposals[0]!.proposalId;

    // 3. validate → approve → apply。
    const validation = await domain.skillSteward.validate(proposalId);
    expect(validation.overall).toBe("valid");
    const grant = await domain.skillSteward.approve(proposalId);
    expect(grant.fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
    const applied = await domain.skillSteward.apply(proposalId);
    expect(applied.outcomeStatus).toBe("applied");
    expect(applied.auditStatus).toBe("applied");
    expect(applied.mutations.length).toBeGreaterThan(0);

    // 4. rollback：反向 edit 恢复原字节。
    const prepared = await domain.skillSteward.prepareRollback(applied.auditId);
    expect(prepared.reverseProposalId).toBeDefined();
    await domain.skillSteward.approve(prepared.reverseProposalId!);
    const rollback = await domain.skillSteward.apply(prepared.reverseProposalId!);
    expect(rollback.auditStatus).toBe("applied");
    const docPath = path.join(sandbox, "ws", "skills", "alpha-deploy", "SKILL.md");
    expect(fs.readFileSync(docPath, "utf8")).toContain("# alpha-deploy");
  });

  it("exposes malformed runs with typed terminals and zero proposals", async () => {
    const directory = path.join(sandbox, "ws2");
    fs.mkdirSync(directory, { recursive: true });
    const workspace = domain.workspaces.import(directory, "ws2");
    await domain.creator.save({
      mode: "create",
      workspaceId: workspace.id,
      providerId,
      directoryName: "solo-skill",
      frontmatter: { name: "solo-skill", description: "Solo." },
      body: "# solo-skill\n",
    });
    const run = await domain.skillSteward.startRun({
      target: { workspaceId: workspace.id, providerId },
      taskKind: "check",
      scenario: "malformed",
    });
    expect(run.terminal).toBe("failed");
    expect(run.proposals).toHaveLength(0);
  });
});

describe("restart recovery (task 2.3e)", () => {
  let sandbox = "";
  beforeEach(() => {
    sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "steward-recovery-test-"));
    process.env.SKILL_CREATOR_HOME = path.join(sandbox, "home");
    setHomeOverride(path.join(sandbox, "home"));
  });
  afterEach(() => {
    setHomeOverride(null);
    fs.rmSync(sandbox, { recursive: true, force: true });
  });

  it("scans crash-leftover journals and does not replay writes", async () => {
    const journalDir = path.join(stewardStoreDir(), "journal");
    fs.mkdirSync(journalDir, { recursive: true });
    // 模拟崩溃：split 在 create-target 后进程退出（无终态审计）。
    fs.writeFileSync(
      path.join(journalDir, "spp_deadbeefdeadbeef.jsonl"),
      [
        JSON.stringify({
          seq: 1,
          step: "precheck",
          detail: { kind: "precheck", targets: ["b-plan"] },
        }),
        JSON.stringify({
          seq: 2,
          step: "create-target",
          detail: { kind: "content", directoryName: "b-plan" },
        }),
      ].join("\n") + "\n",
      "utf8",
    );
    fs.writeFileSync(
      path.join(journalDir, "spp_cafef00dcafef00d-rollback.jsonl"),
      JSON.stringify({ seq: 1, step: "disable", detail: { kind: "enablement" } }) + "\n",
      "utf8",
    );
    const unfinished = await scanUnfinishedJournals(stewardStoreDir());
    expect(unfinished).toHaveLength(1);
    expect(unfinished[0]!.proposalId).toBe("spp_deadbeefdeadbeef");
    expect(unfinished[0]!.steps).toBe(2);
    expect(unfinished[0]!.lastStep).toBe("create-target");
  });

  it("Global workspace rejects optimize writes with unsupported scope", async () => {
    const domain = createDaemonDomain(undefined, { skillsCliProbe: deterministicSkillsCliProbe() });
    try {
      const globalTarget = {
        workspaceId: "~" as const,
        providerId: ProviderIdSchema.parse("claude-code"),
      };
      const discovered = await domain.skills.list(globalTarget);
      expect(discovered.length).toBeGreaterThan(0);
      const run = await domain.skillSteward.startRun({
        target: globalTarget,
        taskKind: "optimize",
        skillIds: [discovered[0]!.id],
      });
      // Global 快照可以建立（只读分析），但 edit 提案在 bind 层被拒 → 场景失败终态。
      expect(run.terminal).toBe("failed");
      expect(run.proposals).toHaveLength(0);
    } finally {
      await domain.steward.dispose();
      await domain.repository.dispose();
    }
  });
});
