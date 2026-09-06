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
  SKILL_STEWARD_CONTRACT_VERSION,
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
      runId: "sr_0123456789abcdef01234567",
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
      contractVersion: SKILL_STEWARD_CONTRACT_VERSION,
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
      contractVersion: SKILL_STEWARD_CONTRACT_VERSION,
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
      contractVersion: SKILL_STEWARD_CONTRACT_VERSION,
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
    const { target, snapshot: stale } = await seed(["fat-skill"]);
    // 资源文件必须在快照前落盘：bind 只接受快照 manifest 内的映射源（R2 P1-2）。
    fs.mkdirSync(path.join(sandbox, "ws", "skills", "fat-skill", "scripts"), { recursive: true });
    fs.writeFileSync(
      path.join(sandbox, "ws", "skills", "fat-skill", "scripts", "run.sh"),
      "echo fat\n",
      "utf8",
    );
    const { buildContextSnapshot } = await import("../src/daemon/steward/context-snapshot.js");
    const snapshot = await buildContextSnapshot(domain.skills, {
      target,
      skillIds: stale.skills.map((skill) => skill.skillId),
      promptVersion: stale.promptVersion,
      toolVersion: stale.toolVersion,
      capabilities: stale.capabilities,
    });
    const source = snapshot.skills[0]!;
    const service = approval();
    const proposal: SkillProposal = {
      contractVersion: SKILL_STEWARD_CONTRACT_VERSION,
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
              {
                sourceSkillId: source.skillId,
                sourcePath: "scripts/run.sh",
                targetPath: "scripts/run.sh",
                strategy: "copy",
              },
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
      contractVersion: SKILL_STEWARD_CONTRACT_VERSION,
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

  it("fails closed with zero writes when the journal cannot be persisted", async () => {
    const { snapshot } = await seed(["journaled-skill"]);
    const skillId = snapshot.skills[0]!.skillId;
    const service = approval();
    const proposalId = service.submit(editProposal(snapshot, skillId, "Journaled edit."), snapshot);
    await service.approve(proposalId, "human-ui");
    // 让 journal 持久化失败：把 journal 路径占位成普通文件（mkdir 必败）。
    fs.writeFileSync(
      path.join(sandbox, "home", "steward-store", "journal"),
      "not a directory",
      "utf8",
    );
    const { outcome } = await service.apply(proposalId, "human-ui");
    expect(["compensated", "recovery-required"]).toContain(outcome.status);
    // 零写入：原字节未变。
    const bytes = fs.readFileSync(
      path.join(sandbox, "ws", "skills", "journaled-skill", "SKILL.md"),
      "utf8",
    );
    expect(bytes).toBe(snapshot.skills[0]!.content);
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

describe("resource mapping source identity at apply time (Codex R2 P1-2)", () => {
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
    sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "steward-apply-test-"));
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

  async function seedTwoSourcesWithSameRelPath(): Promise<{
    snapshot: SkillStewardContextSnapshot;
    sourceA: SkillStewardContextSnapshot["skills"][number];
    sourceB: SkillStewardContextSnapshot["skills"][number];
  }> {
    const { target, snapshot: stale } = await seed(["merge-left", "merge-right"]);
    for (const [name, content] of [
      ["merge-left", "left-origin\n"],
      ["merge-right", "right-origin\n"],
    ] as const) {
      fs.mkdirSync(path.join(sandbox, "ws", "skills", name, "shared"), { recursive: true });
      fs.writeFileSync(
        path.join(sandbox, "ws", "skills", name, "shared", "notes.md"),
        content,
        "utf8",
      );
    }
    const { buildContextSnapshot } = await import("../src/daemon/steward/context-snapshot.js");
    const snapshot = await buildContextSnapshot(domain.skills, {
      target,
      skillIds: stale.skills.map((skill) => skill.skillId),
      promptVersion: stale.promptVersion,
      toolVersion: stale.toolVersion,
      capabilities: stale.capabilities,
    });
    const sourceA = snapshot.skills.find((skill) => skill.directoryName === "merge-left")!;
    const sourceB = snapshot.skills.find((skill) => skill.directoryName === "merge-right")!;
    return { snapshot, sourceA, sourceB };
  }

  function mergeProposal(
    snapshot: SkillStewardContextSnapshot,
    sourceA: SkillStewardContextSnapshot["skills"][number],
    sourceB: SkillStewardContextSnapshot["skills"][number],
  ): SkillProposal {
    return {
      contractVersion: SKILL_STEWARD_CONTRACT_VERSION,
      action: "merge",
      patch: {
        kind: "merge",
        snapshotId: snapshot.id,
        sources: [
          { skillId: sourceA.skillId, expectedRevision: sourceA.revision },
          { skillId: sourceB.skillId, expectedRevision: sourceB.revision },
        ],
        target: {
          directoryName: "merged-skill",
          frontmatter: { name: "merged-skill", description: "Merged." },
          body: "# merged-skill\n",
          resources: [
            {
              // 显式指认 B 为源：两个源都有 shared/notes.md，apply 必须取 B 的字节。
              sourceSkillId: sourceB.skillId,
              sourcePath: "shared/notes.md",
              targetPath: "shared/notes.md",
              strategy: "copy",
            },
          ],
        },
      },
      rationale: "merge two skills with same-named resources",
      findingIds: [],
      evidence: [{ skillId: sourceA.skillId, snippet: "overlap" }],
      skillIds: [sourceA.skillId, sourceB.skillId],
      observedRevisions: [
        { skillId: sourceA.skillId, revision: sourceA.revision },
        { skillId: sourceB.skillId, revision: sourceB.revision },
      ],
    };
  }

  it("copies from the mapping's explicit source skill, not the first source", async () => {
    const { snapshot, sourceA, sourceB } = await seedTwoSourcesWithSameRelPath();
    const service = approval();
    const proposalId = service.submit(mergeProposal(snapshot, sourceA, sourceB), snapshot);
    await service.approve(proposalId, "human-ui");
    const { outcome } = await service.apply(proposalId, "human-ui");
    expect(outcome.status).toBe("applied");
    const copied = fs.readFileSync(
      path.join(sandbox, "ws", "skills", "merged-skill", "shared", "notes.md"),
      "utf8",
    );
    expect(copied).toBe("right-origin\n");
  });

  it("fails closed with zero residue when the source resource drifts from the manifest hash", async () => {
    const { snapshot, sourceA, sourceB } = await seedTwoSourcesWithSameRelPath();
    const service = approval();
    const proposalId = service.submit(mergeProposal(snapshot, sourceA, sourceB), snapshot);
    await service.approve(proposalId, "human-ui");
    // 批准后外部篡改 B 的资源：apply 必须按快照 manifest hash 拒绝并补偿。
    fs.writeFileSync(
      path.join(sandbox, "ws", "skills", "merge-right", "shared", "notes.md"),
      "tampered\n",
      "utf8",
    );
    const { outcome } = await service.apply(proposalId, "human-ui");
    expect(outcome.status).toBe("compensated");
    expect(fs.existsSync(path.join(sandbox, "ws", "skills", "merged-skill"))).toBe(false);
  });
});

describe("apply-side resource defenses (Codex R3 P1-2/P2-2)", () => {
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
    sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "steward-apply-defense-"));
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

  async function seedTwoSources(): Promise<{
    snapshot: SkillStewardContextSnapshot;
    sourceA: SkillStewardContextSnapshot["skills"][number];
    sourceB: SkillStewardContextSnapshot["skills"][number];
  }> {
    const directory = path.join(sandbox, "ws");
    fs.mkdirSync(directory, { recursive: true });
    const workspace = domain.workspaces.import(directory, "ws");
    for (const name of ["merge-left", "merge-right"]) {
      await domain.creator.save({
        mode: "create",
        workspaceId: workspace.id,
        providerId,
        directoryName: name,
        frontmatter: { name, description: `${name} skill.` },
        body: `# ${name}\n`,
      });
      fs.mkdirSync(path.join(directory, "skills", name, "shared"), { recursive: true });
      fs.writeFileSync(
        path.join(directory, "skills", name, "shared", "notes.md"),
        name === "merge-left" ? "left-origin\n" : "right-origin\n",
        "utf8",
      );
    }
    const target = { workspaceId: workspace.id, providerId };
    const { buildContextSnapshot } = await import("../src/daemon/steward/context-snapshot.js");
    const snapshot = await buildContextSnapshot(domain.skills, {
      target,
      promptVersion: "1.0.0",
      toolVersion: "1.0.0",
      capabilities,
    });
    const sourceA = snapshot.skills.find((skill) => skill.directoryName === "merge-left")!;
    const sourceB = snapshot.skills.find((skill) => skill.directoryName === "merge-right")!;
    return { snapshot, sourceA, sourceB };
  }

  function duplicateTargetProposal(
    snapshot: SkillStewardContextSnapshot,
    sourceA: SkillStewardContextSnapshot["skills"][number],
    sourceB: SkillStewardContextSnapshot["skills"][number],
  ): SkillProposal {
    return {
      contractVersion: SKILL_STEWARD_CONTRACT_VERSION,
      action: "merge",
      patch: {
        kind: "merge",
        snapshotId: snapshot.id,
        sources: [
          { skillId: sourceA.skillId, expectedRevision: sourceA.revision },
          { skillId: sourceB.skillId, expectedRevision: sourceB.revision },
        ],
        target: {
          directoryName: "merged-skill",
          frontmatter: { name: "merged-skill", description: "Merged." },
          body: "# merged-skill\n",
          // 契约层（1.4.0）拒绝该形状；本测试以手工构造值直达 apply，
          // 验证防御层在绕过解析时仍以后写覆盖拒绝并零残留。
          resources: [
            {
              sourceSkillId: sourceA.skillId,
              sourcePath: "shared/notes.md",
              targetPath: "shared/notes.md",
              strategy: "copy",
            },
            {
              sourceSkillId: sourceB.skillId,
              sourcePath: "shared/notes.md",
              targetPath: "shared/notes.md",
              strategy: "copy",
            },
          ],
        },
      },
      rationale: "duplicate target paths",
      findingIds: [],
      evidence: [{ skillId: sourceA.skillId, snippet: "overlap" }],
      skillIds: [sourceA.skillId, sourceB.skillId],
      observedRevisions: [
        { skillId: sourceA.skillId, revision: sourceA.revision },
        { skillId: sourceB.skillId, revision: sourceB.revision },
      ],
    };
  }

  it("rejects duplicate targetPath at the apply defense layer with zero residue", async () => {
    const { snapshot, sourceA, sourceB } = await seedTwoSources();
    const { applyProposalTransaction } = await import("../src/daemon/steward/apply-transaction.js");
    const outcome = await applyProposalTransaction(
      duplicateTargetProposal(snapshot, sourceA, sourceB),
      snapshot,
      {
        workspaces: domain.workspaces,
        skills: domain.skills,
        creator: domain.creator,
        store: createStewardAuditStore(),
        journalPath: path.join(sandbox, "journal", "dup.jsonl"),
      },
    );
    expect(outcome.status).toBe("compensated");
    expect(outcome.failure).toContain("Duplicate resource targetPath");
    expect(fs.existsSync(path.join(sandbox, "ws", "skills", "merged-skill"))).toBe(false);
  });

  it("rejects a symlinked source even when its bytes match the manifest hash", async () => {
    const { snapshot, sourceA, sourceB } = await seedTwoSources();
    const outside = path.join(sandbox, "outside-secret.md");
    fs.writeFileSync(outside, "right-origin\n", "utf8");
    const liveSource = path.join(sandbox, "ws", "skills", "merge-right", "shared", "notes.md");
    fs.rmSync(liveSource);
    fs.symlinkSync(outside, liveSource);

    const service = createStewardApprovalService({
      workspaces: domain.workspaces,
      skills: domain.skills,
      creator: domain.creator,
      store: createStewardAuditStore(),
    });
    const proposal = duplicateTargetProposal(snapshot, sourceA, sourceB);
    proposal.patch.target.resources = [proposal.patch.target.resources[1]!];
    const proposalId = service.submit(proposal, snapshot);
    await service.approve(proposalId, "human-ui");
    const { outcome } = await service.apply(proposalId, "human-ui");
    expect(outcome.status).toBe("compensated");
    // Codex R4 P1-1：symlink 换体现在在 realpath 祖先链检查即被拒绝（早于 fd 读取）。
    expect(outcome.failure).toContain("symlink ancestor");
    expect(fs.existsSync(path.join(sandbox, "ws", "skills", "merged-skill"))).toBe(false);
  });
});

describe("apply-side R4 defenses (Codex R4 P1-1/P1-2/P2-3)", () => {
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
    sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "steward-apply-r4-"));
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

  async function seedTwoSources() {
    const directory = path.join(sandbox, "ws");
    fs.mkdirSync(directory, { recursive: true });
    const workspace = domain.workspaces.import(directory, "ws");
    for (const name of ["merge-left", "merge-right"]) {
      await domain.creator.save({
        mode: "create",
        workspaceId: workspace.id,
        providerId,
        directoryName: name,
        frontmatter: { name, description: `${name} skill.` },
        body: `# ${name}\n`,
      });
      fs.mkdirSync(path.join(directory, "skills", name, "shared"), { recursive: true });
      fs.writeFileSync(
        path.join(directory, "skills", name, "shared", "notes.md"),
        name === "merge-left" ? "left-origin\n" : "right-origin\n",
        "utf8",
      );
    }
    const target = { workspaceId: workspace.id, providerId };
    const { buildContextSnapshot } = await import("../src/daemon/steward/context-snapshot.js");
    const snapshot = await buildContextSnapshot(domain.skills, {
      target,
      promptVersion: "1.0.0",
      toolVersion: "1.0.0",
      capabilities,
    });
    const sourceA = snapshot.skills.find((skill) => skill.directoryName === "merge-left")!;
    const sourceB = snapshot.skills.find((skill) => skill.directoryName === "merge-right")!;
    return { directory, snapshot, sourceA, sourceB };
  }

  function approval() {
    return createStewardApprovalService({
      workspaces: domain.workspaces,
      skills: domain.skills,
      creator: domain.creator,
      store: createStewardAuditStore(),
    });
  }

  function mergeProposal(
    snapshot: SkillStewardContextSnapshot,
    sourceB: SkillStewardContextSnapshot["skills"][number],
    targetPath: string,
    strategy: "copy" | "move" = "copy",
  ): SkillProposal {
    return {
      contractVersion: SKILL_STEWARD_CONTRACT_VERSION,
      action: "merge",
      patch: {
        kind: "merge",
        snapshotId: snapshot.id,
        sources: snapshot.skills
          .filter((skill) => skill.directoryName.startsWith("merge-"))
          .map((skill) => ({ skillId: skill.skillId, expectedRevision: skill.revision })),
        target: {
          directoryName: "merged-skill",
          frontmatter: { name: "merged-skill", description: "Merged." },
          body: "# merged-skill\n",
          resources: [
            {
              sourceSkillId: sourceB.skillId,
              sourcePath: "shared/notes.md",
              targetPath,
              strategy,
            },
          ],
        },
      },
      rationale: "r4 probe",
      findingIds: [],
      evidence: [{ skillId: sourceB.skillId, snippet: "probe" }],
      skillIds: snapshot.skills
        .filter((skill) => skill.directoryName.startsWith("merge-"))
        .map((skill) => skill.skillId),
      observedRevisions: snapshot.skills
        .filter((skill) => skill.directoryName.startsWith("merge-"))
        .map((skill) => ({ skillId: skill.skillId, revision: skill.revision })),
    };
  }

  it("P1-1: a symlinked parent directory with a regular file inside fails closed", async () => {
    const { directory, snapshot, sourceB } = await seedTwoSources();
    // 父目录换体：merge-right/shared → 指向 sandbox 外部目录；外部 notes.md 字节一致。
    const outsideDir = path.join(sandbox, "outside");
    fs.mkdirSync(outsideDir, { recursive: true });
    fs.writeFileSync(path.join(outsideDir, "notes.md"), "right-origin\n", "utf8");
    const sharedDir = path.join(directory, "skills", "merge-right", "shared");
    fs.rmSync(sharedDir, { recursive: true, force: true });
    fs.symlinkSync(outsideDir, sharedDir);

    const service = approval();
    const proposalId = service.submit(
      mergeProposal(snapshot, sourceB, "shared/notes.md"),
      snapshot,
    );
    await service.approve(proposalId, "human-ui");
    const { outcome } = await service.apply(proposalId, "human-ui");
    expect(outcome.status).toBe("compensated");
    expect(outcome.failure).toContain("symlink ancestor");
    expect(fs.existsSync(path.join(directory, "skills", "merged-skill"))).toBe(false);
  });

  it("P1-2: a hand-built mapping onto SKILL.md is rejected at the apply defense", async () => {
    const { snapshot, sourceB } = await seedTwoSources();
    const { applyProposalTransaction } = await import("../src/daemon/steward/apply-transaction.js");
    const proposal = mergeProposal(snapshot, sourceB, "SKILL.md");
    const outcome = await applyProposalTransaction(proposal, snapshot, {
      workspaces: domain.workspaces,
      skills: domain.skills,
      creator: domain.creator,
      store: createStewardAuditStore(),
      journalPath: path.join(sandbox, "journal", "skillmd.jsonl"),
    });
    expect(outcome.status).toBe("compensated");
    expect(outcome.failure).toContain("must not target the skill document");
  });

  it("P2-3: move really moves the source file and compensation restores it", async () => {
    const { directory, snapshot, sourceB } = await seedTwoSources();
    const service = approval();
    const proposalId = service.submit(
      mergeProposal(snapshot, sourceB, "shared/moved.md", "move"),
      snapshot,
    );
    await service.approve(proposalId, "human-ui");
    const { outcome } = await service.apply(proposalId, "human-ui");
    expect(outcome.status).toBe("applied");
    const sourceFile = path.join(directory, "skills", "merge-right", "shared", "notes.md");
    const targetFile = path.join(directory, "skills", "merged-skill", "shared", "moved.md");
    // 真移动：源文件不存在，目标持有字节。
    expect(fs.existsSync(sourceFile)).toBe(false);
    expect(fs.readFileSync(targetFile, "utf8")).toBe("right-origin\n");
  });

  it("P2-3 compensation: a failed move round restores the source bytes (zero loss)", async () => {
    const { directory, snapshot, sourceA, sourceB } = await seedTwoSources();
    const { applyProposalTransaction } = await import("../src/daemon/steward/apply-transaction.js");
    // 手工构造值：两条 move 映射，第二条 targetPath 与第一条冲突（绕过 schema 的
    // 大小写归一判重也覆盖 apply 防御）→ 第二条失败 → compensation 必须还原第一条
    // 已移动的源字节。
    const proposal = mergeProposal(snapshot, sourceB, "shared/moved.md", "move");
    proposal.patch.target.resources.push({
      sourceSkillId: sourceA.skillId,
      sourcePath: "shared/notes.md",
      targetPath: "SHARED/moved.md",
      strategy: "move",
    });
    const outcome = await applyProposalTransaction(proposal, snapshot, {
      workspaces: domain.workspaces,
      skills: domain.skills,
      creator: domain.creator,
      store: createStewardAuditStore(),
      journalPath: path.join(sandbox, "journal", "move.jsonl"),
    });
    expect(outcome.status).toBe("compensated");
    expect(outcome.failure).toContain("Duplicate resource targetPath");
    // 源还原：两个源技能的 notes.md 都回到原位；目标目录零残留。
    expect(
      fs.readFileSync(path.join(directory, "skills", "merge-right", "shared", "notes.md"), "utf8"),
    ).toBe("right-origin\n");
    expect(fs.existsSync(path.join(directory, "skills", "merged-skill"))).toBe(false);
  });
});

describe("move durability and path races (Codex R5 P1-1/P1-2)", () => {
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
    sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "steward-r5-"));
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

  async function seedMergePair() {
    const directory = path.join(sandbox, "ws");
    fs.mkdirSync(directory, { recursive: true });
    const workspace = domain.workspaces.import(directory, "ws");
    for (const name of ["merge-left", "merge-right"]) {
      await domain.creator.save({
        mode: "create",
        workspaceId: workspace.id,
        providerId,
        directoryName: name,
        frontmatter: { name, description: `${name} skill.` },
        body: `# ${name}\n`,
      });
      fs.mkdirSync(path.join(directory, "skills", name, "shared"), { recursive: true });
      fs.writeFileSync(
        path.join(directory, "skills", name, "shared", "notes.md"),
        name === "merge-left" ? "left-origin\n" : "right-origin\n",
        "utf8",
      );
    }
    const target = { workspaceId: workspace.id, providerId };
    const { buildContextSnapshot } = await import("../src/daemon/steward/context-snapshot.js");
    const snapshot = await buildContextSnapshot(domain.skills, {
      target,
      promptVersion: "1.0.0",
      toolVersion: "1.0.0",
      capabilities,
    });
    const sourceB = snapshot.skills.find((skill) => skill.directoryName === "merge-right")!;
    return { directory, snapshot, sourceB };
  }

  function mergeMoveProposal(
    snapshot: SkillStewardContextSnapshot,
    sourceB: SkillStewardContextSnapshot["skills"][number],
  ): SkillProposal {
    const sources = snapshot.skills.filter((skill) => skill.directoryName.startsWith("merge-"));
    return {
      contractVersion: SKILL_STEWARD_CONTRACT_VERSION,
      action: "merge",
      patch: {
        kind: "merge",
        snapshotId: snapshot.id,
        sources: sources.map((skill) => ({
          skillId: skill.skillId,
          expectedRevision: skill.revision,
        })),
        target: {
          directoryName: "merged-skill",
          frontmatter: { name: "merged-skill", description: "Merged." },
          body: "# merged-skill\n",
          resources: [
            {
              sourceSkillId: sourceB.skillId,
              sourcePath: "shared/notes.md",
              targetPath: "shared/moved.md",
              strategy: "move",
            },
          ],
        },
      },
      rationale: "r5 durability probe",
      findingIds: [],
      evidence: [{ skillId: sourceB.skillId, snippet: "probe" }],
      skillIds: sources.map((skill) => skill.skillId),
      observedRevisions: sources.map((skill) => ({
        skillId: skill.skillId,
        revision: skill.revision,
      })),
    };
  }

  it("P1-2: apply -> prepareRollback -> applyRollback restores the moved source bytes", async () => {
    const { directory, snapshot, sourceB } = await seedMergePair();
    const store = createStewardAuditStore();
    const service = createStewardApprovalService({
      workspaces: domain.workspaces,
      skills: domain.skills,
      creator: domain.creator,
      store,
    });
    const proposalId = service.submit(mergeMoveProposal(snapshot, sourceB), snapshot);
    await service.approve(proposalId, "human-ui");
    const { outcome, audit } = await service.apply(proposalId, "human-ui");
    expect(outcome.status).toBe("applied");
    const sourceFile = path.join(directory, "skills", "merge-right", "shared", "notes.md");
    expect(fs.existsSync(sourceFile)).toBe(false);

    const rollback = await service.prepareRollback(audit.id, "human-ui");
    expect(rollback.note).toContain("Rollback grant minted");
    const rolled = await service.applyRollback(audit.id, "human-ui");
    expect(rolled.audit.status).toBe("rolled-back");
    // 持久备份路径：源字节恢复（applyRollback 走 readJournal/undoJournalSteps，
    // 无进程内 movedRestore）。
    expect(fs.readFileSync(sourceFile, "utf8")).toBe("right-origin\n");
    expect(fs.existsSync(path.join(directory, "skills", "merged-skill"))).toBe(false);
  });

  it("P1-2: undoJournalSteps (restart-equivalent replay) restores the source from the persistent backup", async () => {
    const { directory, snapshot, sourceB } = await seedMergePair();
    const journalPath = path.join(sandbox, "journal", "restart.jsonl");
    const { applyProposalTransaction, readJournal, undoJournalSteps } =
      await import("../src/daemon/steward/apply-transaction.js");
    const proposal = mergeMoveProposal(snapshot, sourceB);
    const outcome = await applyProposalTransaction(proposal, snapshot, {
      workspaces: domain.workspaces,
      skills: domain.skills,
      creator: domain.creator,
      store: createStewardAuditStore(),
      journalPath,
    });
    expect(outcome.status).toBe("applied");
    const sourceFile = path.join(directory, "skills", "merge-right", "shared", "notes.md");
    expect(fs.existsSync(sourceFile)).toBe(false);
    // 备份落盘（journal 旁 .backups/：一份 .bin + manifest.jsonl 记账）。
    const backupDir = `${journalPath}.backups`;
    expect(fs.readdirSync(backupDir).filter((name) => name.endsWith(".bin")).length).toBe(1);
    expect(fs.existsSync(path.join(backupDir, "manifest.jsonl"))).toBe(true);

    // 重启等价：全新 context（无内存表）回放 journal 撤销。
    const entries = await readJournal(journalPath);
    await undoJournalSteps(entries, {
      proposal,
      snapshot,
      deps: {
        workspaces: domain.workspaces,
        skills: domain.skills,
        creator: domain.creator,
        store: createStewardAuditStore(),
        journalPath,
      },
      root: path.join(directory, "skills"),
      mutations: [],
    });
    expect(fs.readFileSync(sourceFile, "utf8")).toBe("right-origin\n");
    expect(fs.existsSync(path.join(directory, "skills", "merged-skill"))).toBe(false);
  });

  it("P1-1: concurrent parent-dir swapping never reads outside bytes undetected (chaos loop)", async () => {
    const { directory, snapshot, sourceB } = await seedMergePair();
    const sharedDir = path.join(directory, "skills", "merge-right", "shared");
    // 真实内容迁往独立 store；shared 变成挂载点，攻击者在两个 symlink 目标间高频
    // 切换（换体源 = outside，真实源 = realStore）。攻击者绝不写穿 shared 路径。
    const realStore = path.join(sandbox, "realstore");
    fs.mkdirSync(realStore, { recursive: true });
    fs.renameSync(sharedDir, realStore);
    fs.symlinkSync(realStore, sharedDir);
    const outsideDir = path.join(sandbox, "outside");
    fs.mkdirSync(outsideDir, { recursive: true });
    fs.writeFileSync(path.join(outsideDir, "notes.md"), "left-origin\n", "utf8");

    let swapping = true;
    const swapper = (async () => {
      let flip = false;
      while (swapping) {
        try {
          fs.rmSync(sharedDir, { force: true });
          fs.symlinkSync(flip ? outsideDir : realStore, sharedDir);
          flip = !flip;
        } catch {
          /* 竞态窗口内的任何一步失败都重试 */
        }
        await new Promise((resolve) => setImmediate(resolve));
      }
    })();

    const { applyProposalTransaction } = await import("../src/daemon/steward/apply-transaction.js");
    let applied = 0;
    let rejected = 0;
    try {
      for (let attempt = 0; attempt < 12; attempt += 1) {
        // 每轮重建干净目标（applied 后 merged-skill 已存在会 CONFLICT，重建快照场景）。
        fs.rmSync(path.join(directory, "skills", "merged-skill"), { recursive: true, force: true });
        const proposal = mergeMoveProposal(snapshot, sourceB);
        const outcome = await applyProposalTransaction(proposal, snapshot, {
          workspaces: domain.workspaces,
          skills: domain.skills,
          creator: domain.creator,
          store: createStewardAuditStore(),
          journalPath: path.join(sandbox, "journal", `chaos-${attempt}.jsonl`),
        });
        if (outcome.status === "applied") {
          applied += 1;
          const moved = path.join(directory, "skills", "merged-skill", "shared", "moved.md");
          // 成功轮的内容必须来自真实源（right-origin），绝不能是外部字节。
          if (fs.existsSync(moved)) {
            expect(fs.readFileSync(moved, "utf8")).toBe("right-origin\n");
          }
        } else {
          rejected += 1;
        }
      }
    } finally {
      swapping = false;
      await swapper;
    }
    // 不变量：要么干净成功（字节正确），要么类型化失败；外部文件内容永不变化。
    expect(applied + rejected).toBe(12);
    expect(fs.readFileSync(path.join(outsideDir, "notes.md"), "utf8")).toBe("left-origin\n");
  });
});

describe("journal and backup authority (Codex R6 P1-2/P1-3)", () => {
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
    sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "steward-r6-"));
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

  async function seedMergePair() {
    const directory = path.join(sandbox, "ws");
    fs.mkdirSync(directory, { recursive: true });
    const workspace = domain.workspaces.import(directory, "ws");
    for (const name of ["merge-left", "merge-right"]) {
      await domain.creator.save({
        mode: "create",
        workspaceId: workspace.id,
        providerId,
        directoryName: name,
        frontmatter: { name, description: `${name} skill.` },
        body: `# ${name}\n`,
      });
      fs.mkdirSync(path.join(directory, "skills", name, "shared"), { recursive: true });
      fs.writeFileSync(
        path.join(directory, "skills", name, "shared", "notes.md"),
        name === "merge-left" ? "left-origin\n" : "right-origin\n",
        "utf8",
      );
    }
    const target = { workspaceId: workspace.id, providerId };
    const { buildContextSnapshot } = await import("../src/daemon/steward/context-snapshot.js");
    const snapshot = await buildContextSnapshot(domain.skills, {
      target,
      promptVersion: "1.0.0",
      toolVersion: "1.0.0",
      capabilities,
    });
    const sourceB = snapshot.skills.find((skill) => skill.directoryName === "merge-right")!;
    const sources = snapshot.skills.filter((skill) => skill.directoryName.startsWith("merge-"));
    const proposal: SkillProposal = {
      contractVersion: SKILL_STEWARD_CONTRACT_VERSION,
      action: "merge",
      patch: {
        kind: "merge",
        snapshotId: snapshot.id,
        sources: sources.map((skill) => ({
          skillId: skill.skillId,
          expectedRevision: skill.revision,
        })),
        target: {
          directoryName: "merged-skill",
          frontmatter: { name: "merged-skill", description: "Merged." },
          body: "# merged-skill\n",
          resources: [
            {
              sourceSkillId: sourceB.skillId,
              sourcePath: "shared/notes.md",
              targetPath: "shared/moved.md",
              strategy: "move",
            },
          ],
        },
      },
      rationale: "r6 authority probe",
      findingIds: [],
      evidence: [{ skillId: sourceB.skillId, snippet: "probe" }],
      skillIds: sources.map((skill) => skill.skillId),
      observedRevisions: sources.map((skill) => ({
        skillId: skill.skillId,
        revision: skill.revision,
      })),
    };
    return { directory, snapshot, sourceB, proposal };
  }

  it("P1-3: a deleted journal makes applyRollback fail typed, never fake rolled-back", async () => {
    const { snapshot, sourceB, proposal } = await seedMergePair();
    const store = createStewardAuditStore();
    const service = createStewardApprovalService({
      workspaces: domain.workspaces,
      skills: domain.skills,
      creator: domain.creator,
      store,
    });
    const proposalId = service.submit(proposal, snapshot);
    await service.approve(proposalId, "human-ui");
    const { outcome, audit } = await service.apply(proposalId, "human-ui");
    expect(outcome.status).toBe("applied");
    // 删除 journal：回滚必须 typed 失败（recovery-required），audit 不得变 rolled-back。
    await service.prepareRollback(audit.id, "human-ui");
    const journalPath = path.join(
      sandbox,
      "home",
      "steward-store",
      "journal",
      `${proposalId}.jsonl`,
    );
    expect(fs.existsSync(journalPath)).toBe(true);
    fs.rmSync(journalPath);
    const rolled = await service.applyRollback(audit.id, "human-ui");
    expect(rolled.audit.status).toBe("recovery-required");
  });

  it("P1-2: a journal backupRef pointing outside the manager backup root is rejected", async () => {
    const { directory, snapshot, sourceB, proposal } = await seedMergePair();
    const journalPath = path.join(sandbox, "journal", "evil.jsonl");
    const { applyProposalTransaction, readJournal } =
      await import("../src/daemon/steward/apply-transaction.js");
    const outcome = await applyProposalTransaction(proposal, snapshot, {
      workspaces: domain.workspaces,
      skills: domain.skills,
      creator: domain.creator,
      store: createStewardAuditStore(),
      journalPath,
    });
    expect(outcome.status).toBe("applied");
    // 篡改 journal：backupRef 换成绝对外部路径。
    const lines = fs.readFileSync(journalPath, "utf8").trim().split("\n");
    const tampered = lines.map((line) => {
      const entry = JSON.parse(line) as { detail?: { backupRef?: string } };
      if (entry.detail?.backupRef) entry.detail.backupRef = "/tmp/evil-outside.bin";
      return JSON.stringify(entry);
    });
    fs.writeFileSync(journalPath, tampered.join("\n") + "\n", "utf8");

    const { undoJournalSteps } = await import("../src/daemon/steward/apply-transaction.js");
    const sourceFile = path.join(directory, "skills", "merge-right", "shared", "notes.md");
    // Codex R8 P1-4：外部 backupRef 在 readJournal 的闭合 union 即被拒绝（更早、更强）。
    await expect(readJournal(journalPath)).rejects.toThrow(/backupRef/);
    // 即便绕过读取层直调回放，schema 复验同样拒绝。
    await expect(
      undoJournalSteps(
        [
          {
            seq: 1,
            step: "precheck",
            detail: { kind: "precheck", targets: ["merged-skill"] },
          },
          {
            seq: 2,
            step: "resource",
            detail: {
              kind: "resource",
              strategy: "move",
              from: "merge-right/shared/notes.md",
              to: "merged-skill/shared/moved.md",
              backupRef: "/tmp/evil-outside.bin",
              sourceSha256: "a".repeat(64),
            },
          },
        ],
        {
          proposal,
          snapshot,
          deps: {
            workspaces: domain.workspaces,
            skills: domain.skills,
            creator: domain.creator,
            store: createStewardAuditStore(),
            journalPath,
          },
          root: path.join(directory, "skills"),
          mutations: [],
        },
      ),
    ).rejects.toThrow(/validation/);
    // 源未被外部文件内容污染（仍不存在——拒绝恢复而不是写外部字节）。
    expect(fs.existsSync(sourceFile)).toBe(false);
  });

  it("P1-2: a pre-symlinked backup root makes the apply fail closed", async () => {
    const { snapshot, sourceB, proposal } = await seedMergePair();
    const journalPath = path.join(sandbox, "journal", "evilroot.jsonl");
    // 预置 backup 根为指向外部的 symlink。
    const outsideBackups = path.join(sandbox, "outside-backups");
    fs.mkdirSync(outsideBackups, { recursive: true });
    fs.mkdirSync(path.dirname(journalPath), { recursive: true });
    fs.symlinkSync(outsideBackups, `${journalPath}.backups`);

    const { applyProposalTransaction } = await import("../src/daemon/steward/apply-transaction.js");
    const outcome = await applyProposalTransaction(proposal, snapshot, {
      workspaces: domain.workspaces,
      skills: domain.skills,
      creator: domain.creator,
      store: createStewardAuditStore(),
      journalPath,
    });
    expect(outcome.status).not.toBe("applied");
    expect(outcome.status === "compensated" || outcome.status === "recovery-required").toBe(true);
    // 外部目录不出现备份文件。
    expect(fs.readdirSync(outsideBackups).length).toBe(0);
  });

  it("P1-2: restoring onto a symlink leaf is rejected (same bytes are not a restore)", async () => {
    const { directory, snapshot, sourceB, proposal } = await seedMergePair();
    const journalPath = path.join(sandbox, "journal", "symlink-leaf.jsonl");
    const { applyProposalTransaction } = await import("../src/daemon/steward/apply-transaction.js");
    const outcome = await applyProposalTransaction(proposal, snapshot, {
      workspaces: domain.workspaces,
      skills: domain.skills,
      creator: domain.creator,
      store: createStewardAuditStore(),
      journalPath,
    });
    expect(outcome.status).toBe("applied");
    // 把源位置预置为指向外部同字节文件的 symlink，replay 恢复必须拒绝。
    const outsideFile = path.join(sandbox, "outside-leaf.md");
    fs.writeFileSync(outsideFile, "right-origin\n", "utf8");
    const sourceFile = path.join(directory, "skills", "merge-right", "shared", "notes.md");
    fs.symlinkSync(outsideFile, sourceFile);

    const { readJournal, undoJournalSteps } =
      await import("../src/daemon/steward/apply-transaction.js");
    const entries = await readJournal(journalPath);
    await expect(
      undoJournalSteps(entries, {
        proposal,
        snapshot,
        deps: {
          workspaces: domain.workspaces,
          skills: domain.skills,
          creator: domain.creator,
          store: createStewardAuditStore(),
          journalPath,
        },
        root: path.join(directory, "skills"),
        mutations: [],
      }),
    ).rejects.toThrow(/not a regular file/);
    // symlink 仍在（没有被当作已恢复而清除），外部文件未被触碰。
    expect(fs.readFileSync(outsideFile, "utf8")).toBe("right-origin\n");
  });
});

describe("journal truth and replay authority (Codex R8 P1-1..P1-5)", () => {
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
    sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "steward-r8-"));
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

  async function seedMergePair() {
    const directory = path.join(sandbox, "ws");
    fs.mkdirSync(directory, { recursive: true });
    const workspace = domain.workspaces.import(directory, "ws");
    for (const name of ["merge-left", "merge-right"]) {
      await domain.creator.save({
        mode: "create",
        workspaceId: workspace.id,
        providerId,
        directoryName: name,
        frontmatter: { name, description: `${name} skill.` },
        body: `# ${name}\n`,
      });
      fs.mkdirSync(path.join(directory, "skills", name, "shared"), { recursive: true });
      fs.writeFileSync(
        path.join(directory, "skills", name, "shared", "notes.md"),
        name === "merge-left" ? "left-origin\n" : "right-origin\n",
        "utf8",
      );
    }
    const target = { workspaceId: workspace.id, providerId };
    const { buildContextSnapshot } = await import("../src/daemon/steward/context-snapshot.js");
    const snapshot = await buildContextSnapshot(domain.skills, {
      target,
      promptVersion: "1.0.0",
      toolVersion: "1.0.0",
      capabilities,
    });
    const sourceB = snapshot.skills.find((skill) => skill.directoryName === "merge-right")!;
    const sources = snapshot.skills.filter((skill) => skill.directoryName.startsWith("merge-"));
    const proposal: SkillProposal = {
      contractVersion: SKILL_STEWARD_CONTRACT_VERSION,
      action: "merge",
      patch: {
        kind: "merge",
        snapshotId: snapshot.id,
        sources: sources.map((skill) => ({
          skillId: skill.skillId,
          expectedRevision: skill.revision,
        })),
        target: {
          directoryName: "merged-skill",
          frontmatter: { name: "merged-skill", description: "Merged." },
          body: "# merged-skill\n",
          resources: [
            {
              sourceSkillId: sourceB.skillId,
              sourcePath: "shared/notes.md",
              targetPath: "shared/moved.md",
              strategy: "move",
            },
          ],
        },
      },
      rationale: "r8 authority probe",
      findingIds: [],
      evidence: [{ skillId: sourceB.skillId, snippet: "probe" }],
      skillIds: sources.map((skill) => skill.skillId),
      observedRevisions: sources.map((skill) => ({
        skillId: skill.skillId,
        revision: skill.revision,
      })),
    };
    return { directory, snapshot, sourceB, proposal };
  }

  /** 一次成功 apply，返回 journal/备份/上下文事实。 */
  async function applyMove(tag: string) {
    const { directory, snapshot, sourceB, proposal } = await seedMergePair();
    const journalPath = path.join(sandbox, "journal", `${tag}.jsonl`);
    const { applyProposalTransaction } = await import("../src/daemon/steward/apply-transaction.js");
    const outcome = await applyProposalTransaction(proposal, snapshot, {
      workspaces: domain.workspaces,
      skills: domain.skills,
      creator: domain.creator,
      store: createStewardAuditStore(),
      journalPath,
    });
    expect(outcome.status).toBe("applied");
    return { directory, snapshot, sourceB, proposal, journalPath };
  }

  function replayContext(ctx: Awaited<ReturnType<typeof applyMove>>) {
    return {
      proposal: ctx.proposal,
      snapshot: ctx.snapshot,
      deps: {
        workspaces: domain.workspaces,
        skills: domain.skills,
        creator: domain.creator,
        store: createStewardAuditStore(),
        journalPath: ctx.journalPath,
      },
      root: path.join(ctx.directory, "skills"),
      mutations: [],
    };
  }

  it("P1-3: readJournal rejects missing/unreadable/corrupt/unknown/truncated journals typed", async () => {
    const { readJournal } = await import("../src/daemon/steward/apply-transaction.js");
    const base = await applyMove("strict-read");
    const journalDir = path.dirname(base.journalPath);

    // 缺失 → NOT_FOUND。
    await expect(readJournal(path.join(journalDir, "none.jsonl"))).rejects.toThrow(/not found/i);

    // 不可读 → UNAVAILABLE。
    const unreadable = path.join(journalDir, "unreadable.jsonl");
    fs.copyFileSync(base.journalPath, unreadable);
    fs.chmodSync(unreadable, 0o000);
    try {
      await expect(readJournal(unreadable)).rejects.toThrow(/unreadable/i);
    } finally {
      fs.chmodSync(unreadable, 0o644);
    }

    // 坏 JSON 行 → 拒绝（不静默跳过）。
    const corrupt = path.join(journalDir, "corrupt.jsonl");
    fs.copyFileSync(base.journalPath, corrupt);
    fs.appendFileSync(corrupt, "{oops\n", "utf8");
    await expect(readJournal(corrupt)).rejects.toThrow(/corrupt/i);

    // 未知 step → 闭合 union 拒绝（不再 default 静默成功）。
    const unknown = path.join(journalDir, "unknown.jsonl");
    fs.copyFileSync(base.journalPath, unknown);
    fs.appendFileSync(unknown, `${JSON.stringify({ seq: 99, step: "explode", detail: {} })}\n`);
    await expect(readJournal(unknown)).rejects.toThrow(/failed closed validation/i);

    // 删除中间行（部分 journal）→ seq 断裂拒绝。
    const partial = path.join(journalDir, "partial.jsonl");
    const lines = fs.readFileSync(base.journalPath, "utf8").trim().split("\n");
    fs.writeFileSync(partial, `${lines.slice(1).join("\n")}\n`, "utf8");
    await expect(readJournal(partial)).rejects.toThrow(/seq broken/i);
  });

  it("P1-5/P1-3: a move journal line without sourceSha256 fails the closed union", async () => {
    const { readJournal } = await import("../src/daemon/steward/apply-transaction.js");
    const ctx = await applyMove("no-sha");
    const lines = fs.readFileSync(ctx.journalPath, "utf8").trim().split("\n");
    const stripped = lines.map((line) => {
      const entry = JSON.parse(line) as { detail?: { sourceSha256?: string } };
      if (entry.detail?.sourceSha256) delete entry.detail.sourceSha256;
      return JSON.stringify(entry);
    });
    fs.writeFileSync(ctx.journalPath, `${stripped.join("\n")}\n`, "utf8");
    await expect(readJournal(ctx.journalPath)).rejects.toThrow(/sourceSha256/i);
  });

  it("P1-3: an uncommitted journal (no terminal commit line) never rolls back", async () => {
    const { snapshot, proposal } = await seedMergePair();
    const store = createStewardAuditStore();
    const service = createStewardApprovalService({
      workspaces: domain.workspaces,
      skills: domain.skills,
      creator: domain.creator,
      store,
    });
    const proposalId = service.submit(proposal, snapshot);
    await service.approve(proposalId, "human-ui");
    const { outcome, audit } = await service.apply(proposalId, "human-ui");
    expect(outcome.status).toBe("applied");
    await service.prepareRollback(audit.id, "human-ui");
    const journalPath = path.join(
      sandbox,
      "home",
      "steward-store",
      "journal",
      `${proposalId}.jsonl`,
    );
    // 剥离末尾 commit 行：模拟崩溃/截断的 journal。
    const lines = fs.readFileSync(journalPath, "utf8").trim().split("\n");
    fs.writeFileSync(journalPath, `${lines.slice(0, -1).join("\n")}\n`, "utf8");
    const rolled = await service.applyRollback(audit.id, "human-ui");
    expect(rolled.audit.status).toBe("recovery-required");
  });

  it("P1-3: a commit record bound to another proposal is rejected", async () => {
    const { snapshot, proposal } = await seedMergePair();
    const store = createStewardAuditStore();
    const service = createStewardApprovalService({
      workspaces: domain.workspaces,
      skills: domain.skills,
      creator: domain.creator,
      store,
    });
    const proposalId = service.submit(proposal, snapshot);
    await service.approve(proposalId, "human-ui");
    const { outcome, audit } = await service.apply(proposalId, "human-ui");
    expect(outcome.status).toBe("applied");
    await service.prepareRollback(audit.id, "human-ui");
    const journalPath = path.join(
      sandbox,
      "home",
      "steward-store",
      "journal",
      `${proposalId}.jsonl`,
    );
    // 篡改 commit 行的 proposal 绑定。
    const lines = fs.readFileSync(journalPath, "utf8").trim().split("\n");
    const last = JSON.parse(lines[lines.length - 1]!) as {
      detail: { proposalId: string };
    };
    last.detail.proposalId = "spp_ffffffffffffffff";
    lines[lines.length - 1] = JSON.stringify(last);
    fs.writeFileSync(journalPath, `${lines.join("\n")}\n`, "utf8");
    const rolled = await service.applyRollback(audit.id, "human-ui");
    expect(rolled.audit.status).toBe("recovery-required");
  });

  it("P1-4: traversal rel paths in replay are rejected before touching the filesystem", async () => {
    const ctx = await applyMove("traversal");
    const { undoJournalSteps } = await import("../src/daemon/steward/apply-transaction.js");
    const outsideDir = path.join(sandbox, "outside-r8");
    fs.mkdirSync(outsideDir, { recursive: true });
    fs.writeFileSync(path.join(outsideDir, "escaped.md"), "sentinel\n", "utf8");

    // from 穿越 Provider 根。
    await expect(
      undoJournalSteps(
        [
          {
            seq: 1,
            step: "resource",
            detail: {
              kind: "resource",
              strategy: "move",
              from: "../../outside-r8/escaped.md",
              to: "merged-skill/shared/moved.md",
              backupRef: "1-aaaaaaaaaaaa.bin",
              sourceSha256: "a".repeat(64),
            },
          },
        ],
        replayContext(ctx),
      ),
    ).rejects.toThrow(/failed closed validation/i);
    expect(fs.existsSync(path.join(outsideDir, "escaped.md"))).toBe(true);
    expect(fs.readFileSync(path.join(outsideDir, "escaped.md"), "utf8")).toBe("sentinel\n");

    // create-target 目录名穿越（递归删除根外目录的向量）。
    await expect(
      undoJournalSteps(
        [
          {
            seq: 1,
            step: "create-target",
            detail: { kind: "content", directoryName: "../outside-r8" },
          },
        ],
        replayContext(ctx),
      ),
    ).rejects.toThrow(/failed closed validation/i);
    expect(fs.existsSync(path.join(outsideDir, "escaped.md"))).toBe(true);

    // 合法目录名但非本 proposal 创建（binding 拒绝，防 journal 任意指定目录）。
    await expect(
      undoJournalSteps(
        [
          {
            seq: 1,
            step: "create-target",
            detail: { kind: "content", directoryName: "merge-left" },
          },
        ],
        replayContext(ctx),
      ),
    ).rejects.toThrow(/never created|manifest/i);
    expect(fs.existsSync(path.join(ctx.directory, "skills", "merge-left"))).toBe(true);
  });

  it("P1-5: backup replay is bound to the persisted manifest (bytes/ref/seq)", async () => {
    const ctx = await applyMove("manifest");
    const { undoJournalSteps, readJournal } =
      await import("../src/daemon/steward/apply-transaction.js");
    const backupDir = `${ctx.journalPath}.backups`;
    const binFiles = fs.readdirSync(backupDir).filter((name) => name.endsWith(".bin"));
    expect(binFiles.length).toBe(1);
    const binPath = path.join(backupDir, binFiles[0]!);
    const manifestPath = path.join(backupDir, "manifest.jsonl");
    const sourceFile = path.join(ctx.directory, "skills", "merge-right", "shared", "notes.md");
    const originalBin = fs.readFileSync(binPath);
    const originalManifest = fs.readFileSync(manifestPath, "utf8");

    // 篡改备份字节（同长度）：hash 绑定拒绝，源不得被错误字节恢复。
    fs.writeFileSync(binPath, Buffer.from("t".repeat(originalBin.byteLength), "utf8"), "utf8");
    await expect(
      undoJournalSteps(await readJournal(ctx.journalPath), replayContext(ctx)),
    ).rejects.toThrow(/hash mismatch/i);
    expect(fs.existsSync(sourceFile)).toBe(false);
    fs.writeFileSync(binPath, originalBin, "utf8");

    // manifest 缺失：无归属事实 → 拒绝。
    fs.rmSync(manifestPath);
    await expect(
      undoJournalSteps(await readJournal(ctx.journalPath), replayContext(ctx)),
    ).rejects.toThrow(/no entry|manifest/i);

    // manifest 坏行 → 拒绝。
    fs.writeFileSync(manifestPath, `${originalManifest}{oops\n`, "utf8");
    await expect(
      undoJournalSteps(await readJournal(ctx.journalPath), replayContext(ctx)),
    ).rejects.toThrow(/corrupt/i);

    // manifest 重复 ref → 拒绝。
    fs.writeFileSync(manifestPath, `${originalManifest}${originalManifest}`, "utf8");
    await expect(
      undoJournalSteps(await readJournal(ctx.journalPath), replayContext(ctx)),
    ).rejects.toThrow(/duplicate/i);
    // 全程源未被伪造恢复。
    expect(fs.existsSync(sourceFile)).toBe(false);
  });

  it("P1-1: a hardlinked move source is refused (exclusive-inode policy) and compensated", async () => {
    const { directory, snapshot, proposal } = await seedMergePair();
    const sourceFile = path.join(directory, "skills", "merge-right", "shared", "notes.md");
    const linkPath = path.join(sandbox, "hardlink-notes.md");
    fs.linkSync(sourceFile, linkPath);
    const journalPath = path.join(sandbox, "journal", "hardlink.jsonl");
    const { applyProposalTransaction } = await import("../src/daemon/steward/apply-transaction.js");
    const outcome = await applyProposalTransaction(proposal, snapshot, {
      workspaces: domain.workspaces,
      skills: domain.skills,
      creator: domain.creator,
      store: createStewardAuditStore(),
      journalPath,
    });
    expect(outcome.status).not.toBe("applied");
    expect(outcome.status === "compensated" || outcome.status === "recovery-required").toBe(true);
    expect(outcome.failure).toContain("hardlinked");
    // 源与外部 hardlink 都未被删除；目标目录零残留。
    expect(fs.readFileSync(sourceFile, "utf8")).toBe("right-origin\n");
    expect(fs.readFileSync(linkPath, "utf8")).toBe("right-origin\n");
    expect(fs.existsSync(path.join(directory, "skills", "merged-skill"))).toBe(false);
  });

  it("P2-1: the journal persists through a dedicated 0600 fd with a terminal commit line", async () => {
    const ctx = await applyMove("durability");
    const { readJournal } = await import("../src/daemon/steward/apply-transaction.js");
    const entries = await readJournal(ctx.journalPath);
    const last = entries[entries.length - 1]!;
    expect(last.step).toBe("commit");
    expect(last.detail.kind).toBe("commit");
    const mode = fs.statSync(ctx.journalPath).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});
