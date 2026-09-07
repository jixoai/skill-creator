/**
 * Steward workflow store 单测（openspec steward-product-workflow task 4.1）。
 *
 * 用户原始需求 [2026-09-07]（tasks 4.1）：「scope/task/runtime config and run
 * projection survive reconnect with latest-request-wins semantics inside the DSH host。」
 *
 * 正交意图：
 *   [1] 选择语义：per-target 键控 + toggle 去重 + instructions 钳制 + 显式重置。
 *   [2] latest-request-wins：迟到的 startRun/settings 响应不得覆盖新状态；
 *       断线（owner generation 变化）后回落的旧响应不得提交。
 *   [3] 重连存活：选择与 run 投影在连接世代更替后保持；新连接可继续提交。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const connection = vi.hoisted(() => ({
  generation: 0,
  rpc: null as unknown,
}));

vi.mock("../stores/connection.svelte", () => ({
  getConnectionGeneration: () => connection.generation,
  requireRpc: () => {
    if (!connection.rpc) throw new Error("not connected");
    return connection.rpc;
  },
}));

import {
  applyStewardProposal,
  applyStewardRollback,
  approveStewardProposal,
  applyStewardRuntimeConfigPatch,
  clampInstructions,
  framesForCurrentRun,
  isReverseProposalPlaceholder,
  loadStewardRuntimeConfig,
  loadStewardStreamFrames,
  prepareStewardRollback,
  proposalStates,
  resetStewardWorkflowSelections,
  resetStewardWorkflowEvidence,
  runtimeConfigState,
  selectionFor,
  startStewardWorkflowRun,
  streamFramesState,
  toggleSelectedSkill,
  validateStewardProposal,
  workflowRunState,
  workflowTargetKey,
  workflowTimeline,
  STEWARD_INSTRUCTIONS_MAX,
} from "../stores/steward-workflow.svelte";
import {
  StewardAuditIdSchema,
  StewardProposalIdSchema,
  StewardSnapshotIdSchema,
} from "$shared/contracts/skill-steward.js";
import { SkillIdSchema } from "$shared/contracts/skills.js";
import type { WorkspaceProviderTarget } from "$shared/contracts/workspaces.js";

const targetA: WorkspaceProviderTarget = {
  workspaceId: "ws_aaaaaaaaaaaaaaaa" as WorkspaceProviderTarget["workspaceId"],
  providerId: "openclaw" as WorkspaceProviderTarget["providerId"],
};
const targetB: WorkspaceProviderTarget = {
  workspaceId: "ws_bbbbbbbbbbbbbbbb" as WorkspaceProviderTarget["workspaceId"],
  providerId: "openclaw" as WorkspaceProviderTarget["providerId"],
};

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const runResult = (terminal: string) => ({
  snapshotId: "snap_test0000000000000000000",
  terminal,
  acceptedResponses: 1,
  droppedLateResponses: 0,
  toolCalls: 2,
  proposals: [],
});

const settingsView = {
  settings: {
    configVersion: 1,
    revision: 3,
    model: { provider: "deepseek", model: "v4" },
    preset: "deterministic",
    permissions: { approvalPolicy: "ask" },
    session: { streamRetention: 60, streamProjection: 40 },
  },
  providers: [],
};

beforeEach(() => {
  connection.generation = 0;
  connection.rpc = null;
  resetStewardWorkflowSelections();
  resetStewardWorkflowEvidence();
  runtimeConfigState.view = null;
  runtimeConfigState.loading = false;
  runtimeConfigState.error = null;
  workflowRunState.run = null;
  workflowRunState.targetKey = null;
  workflowRunState.starting = false;
  workflowRunState.error = null;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("steward workflow selection (task 4.1 stores)", () => {
  it("keys selection per provider target and toggles skills without duplicates", () => {
    const a = selectionFor(targetA);
    const b = selectionFor(targetB);
    expect(a).not.toBe(b);

    const first = SkillIdSchema.parse("sk_f12fffffffffffffffffffff");
    const second = SkillIdSchema.parse("sk_2ecfeeeeeeeeeeeeeeeeeeee");
    toggleSelectedSkill(targetA, first);
    toggleSelectedSkill(targetA, first);
    expect(a.selectedSkillIds).toEqual([]);
    toggleSelectedSkill(targetA, first);
    toggleSelectedSkill(targetA, second);
    expect(a.selectedSkillIds).toEqual([first, second]);
    expect(b.selectedSkillIds).toEqual([]);

    a.taskKind = "organize";
    expect(selectionFor(targetA).taskKind).toBe("organize");
    expect(selectionFor(targetB).taskKind).toBe("check");

    resetStewardWorkflowSelections();
    expect(selectionFor(targetA).selectedSkillIds).toEqual([]);
  });

  it("clamps instructions to the contract bound", () => {
    expect(clampInstructions("short")).toBe("short");
    const tooLong = "x".repeat(STEWARD_INSTRUCTIONS_MAX + 50);
    expect(clampInstructions(tooLong)).toHaveLength(STEWARD_INSTRUCTIONS_MAX);
  });
});

describe("latest-request-wins run projection", () => {
  it("a slow earlier start cannot overwrite a newer run", async () => {
    const slow = deferred<unknown>();
    const fastResult = runResult("fast terminal");
    connection.rpc = {
      skillSteward: {
        startRun: (input: { taskKind: string }) =>
          input.taskKind === "check" ? slow.promise : Promise.resolve(fastResult),
      },
    };
    const selection = selectionFor(targetA);
    selection.taskKind = "check";
    const first = startStewardWorkflowRun(targetA);
    selection.taskKind = "optimize";
    const second = startStewardWorkflowRun(targetA);
    expect(await second).toBe(fastResult);
    expect(workflowRunState.run).toBe(fastResult);

    slow.resolve(runResult("slow stale terminal"));
    expect(await first).toBeNull();
    expect(workflowRunState.run).toBe(fastResult);
    expect(workflowRunState.starting).toBe(false);
  });

  it("a response landing after reconnect (owner generation bump) never commits", async () => {
    const inFlight = deferred<unknown>();
    connection.rpc = {
      skillSteward: { startRun: () => inFlight.promise },
    };
    const pending = startStewardWorkflowRun(targetA);
    // 断线 + 重连：owner generation 变化，旧响应失去提交资格。
    connection.generation += 1;
    connection.rpc = {
      skillSteward: { startRun: () => Promise.resolve(runResult("after reconnect")) },
    };
    inFlight.resolve(runResult("stale across reconnect"));
    expect(await pending).toBeNull();
    expect(workflowRunState.run).toBeNull();

    // 选择在重连后原样存活，新连接的 run 正常提交。
    const selection = selectionFor(targetA);
    expect(selection.taskKind).toBe("check");
    const committed = await startStewardWorkflowRun(targetA);
    expect(committed?.terminal).toBe("after reconnect");
    expect(workflowRunState.targetKey).toBe(workflowTargetKey(targetA));
  });

  it("records the typed error when the connection is unavailable", async () => {
    connection.rpc = null;
    await startStewardWorkflowRun(targetA);
    expect(workflowRunState.error).toContain("not connected");
    expect(workflowRunState.run).toBeNull();
  });
});

describe("runtime config projection", () => {
  it("commits updated views, returns typed rejections untouched, and drops stale patches", async () => {
    connection.rpc = {
      agent: {
        settings: {
          get: () => Promise.resolve(settingsView),
          update: () =>
            Promise.resolve({
              outcome: "rejected",
              code: "PRESET_REQUIRES_CREDENTIAL",
              detail: "live preset needs a configured provider",
            }),
        },
      },
    };
    await loadStewardRuntimeConfig();
    expect(runtimeConfigState.view).toBe(settingsView);
    expect(runtimeConfigState.error).toBeNull();

    const rejected = await applyStewardRuntimeConfigPatch({
      preset: "live",
    });
    expect(rejected).toEqual({
      outcome: "rejected",
      code: "PRESET_REQUIRES_CREDENTIAL",
      detail: "live preset needs a configured provider",
    });
    // rejected 不动已提交视图。
    expect(runtimeConfigState.view).toBe(settingsView);

    // 迟到补丁：新请求已覆盖旧补丁，旧响应不得提交。
    const stale = deferred<unknown>();
    const fresh = deferred<unknown>();
    let call = 0;
    connection.rpc = {
      agent: {
        settings: {
          get: () => Promise.resolve(settingsView),
          update: () => {
            call += 1;
            return call === 1 ? stale.promise : fresh.promise;
          },
        },
      },
    };
    const stalePatch = applyStewardRuntimeConfigPatch({ preset: "live" });
    const freshPatch = applyStewardRuntimeConfigPatch({ preset: "deterministic" });
    stale.resolve({
      outcome: "updated",
      changed: true,
      previousRevision: 3,
      revision: 4,
      view: settingsView,
    });
    expect(await stalePatch).toBeNull();
    fresh.resolve({
      outcome: "updated",
      changed: true,
      previousRevision: 3,
      revision: 5,
      view: settingsView,
    });
    expect((await freshPatch) as { revision?: number }).toMatchObject({ revision: 5 });
  });
});

describe("proposal workflow states (task 4.2)", () => {
  // 走真实 schema parse（4.9：不用 as never 强行接受输入）。
  const PROPOSAL = StewardProposalIdSchema.parse("spp_37d173a4dfdc9f16");
  const AUDIT = StewardAuditIdSchema.parse("aud_0123456789abcdef");

  const validation = (overall: "valid" | "invalid" | "stale") => ({
    proposalId: PROPOSAL,
    overall,
    checks: [
      { name: "scope", status: "passed", detail: "inside provider root" },
      {
        name: "revision",
        status: overall === "valid" ? "passed" : "failed",
        detail: "fingerprint",
      },
    ],
  });
  const grant = {
    grantId: "grant_0123456789abcdef",
    fingerprint: "ab".repeat(32),
    issuedAt: "2026-09-07T00:00:00.000Z",
  };
  const applyResult = (outcomeStatus: "applied" | "compensated" | "recovery-required") => ({
    outcomeStatus,
    auditId: AUDIT,
    auditStatus: "applied",
    mutations: [
      {
        relPath: "skills/release-evidence-skill/SKILL.md",
        beforeRevision: "aa".repeat(32),
        afterRevision: "bb".repeat(32),
        semantic: "content",
      },
    ],
  });

  it("records the full validate→approve→apply fact chain with timeline events", async () => {
    connection.rpc = {
      skillSteward: {
        validate: () => Promise.resolve(validation("valid")),
        approve: () => Promise.resolve(grant),
        apply: () => Promise.resolve(applyResult("applied")),
      },
    };
    expect((await validateStewardProposal(PROPOSAL))?.overall).toBe("valid");
    expect(await approveStewardProposal(PROPOSAL)).toEqual(grant);
    const applied = await applyStewardProposal(PROPOSAL);
    expect(applied?.outcomeStatus).toBe("applied");
    const state = proposalStates[PROPOSAL]!;
    expect(state.validation?.overall).toBe("valid");
    expect(state.grant?.grantId).toBe(grant.grantId);
    expect(state.apply?.mutations[0]?.semantic).toBe("content");
    expect(state.busy).toBeNull();
    const kinds = workflowTimeline.map((event) => event.kind);
    expect(kinds).toEqual(["validated", "approved", "applied"]);
    expect(workflowTimeline[2]?.auditId).toBe(AUDIT);
    expect(workflowTimeline[2]?.text).toContain("1 mutations");
  });

  it("projects recovery-required terminal states and typed errors without faking success", async () => {
    connection.rpc = {
      skillSteward: { apply: () => Promise.resolve(applyResult("recovery-required")) },
    };
    const result = await applyStewardProposal(PROPOSAL);
    expect(result?.outcomeStatus).toBe("recovery-required");
    expect(proposalStates[PROPOSAL]!.apply?.outcomeStatus).toBe("recovery-required");

    connection.rpc = {
      skillSteward: { apply: () => Promise.reject(new Error("grant already consumed")) },
    };
    expect(await applyStewardProposal(PROPOSAL)).toBeNull();
    expect(proposalStates[PROPOSAL]!.error).toContain("grant already consumed");
    expect(workflowTimeline.at(-1)?.kind).toBe("error");
  });

  it("handles both rollback forms: grant replay and separately-approved reverse proposal", async () => {
    // split/merge 形态：占位零 id → 直接 applyRollback(auditId)。
    connection.rpc = {
      skillSteward: {
        prepareRollback: () =>
          Promise.resolve({
            reverseProposalId: `spp_${"0".repeat(16)}`,
            note: "Rollback grant minted; call applyRollback to consume it.",
          }),
        applyRollback: () => Promise.resolve(applyResult("applied")),
      },
    };
    expect(isReverseProposalPlaceholder(`spp_${"0".repeat(16)}`)).toBe(true);
    expect(isReverseProposalPlaceholder(PROPOSAL)).toBe(false);
    const prep = await prepareStewardRollback(PROPOSAL, AUDIT);
    expect(prep?.note).toContain("applyRollback");
    expect(proposalStates[PROPOSAL]!.rollbackPrep?.reverseProposalId).toBe(`spp_${"0".repeat(16)}`);
    const rolled = await applyStewardRollback(PROPOSAL, AUDIT);
    expect(rolled?.outcomeStatus).toBe("applied");

    // enablement 形态：真实 reverse id → approve + apply 走正常提案链。
    const REVERSE = StewardProposalIdSchema.parse("spp_ffffffffffffffff");
    connection.rpc = {
      skillSteward: {
        prepareRollback: () =>
          Promise.resolve({
            reverseProposalId: REVERSE,
            note: "Reverse edit proposal prepared; requires separate human approval.",
          }),
        approve: () => Promise.resolve(grant),
        apply: () => Promise.resolve(applyResult("applied")),
      },
    };
    const prep2 = await prepareStewardRollback(PROPOSAL, AUDIT);
    expect(isReverseProposalPlaceholder(prep2?.reverseProposalId)).toBe(false);
    expect(await approveStewardProposal(REVERSE)).toEqual(grant);
    expect((await applyStewardProposal(REVERSE))?.outcomeStatus).toBe("applied");
    const kinds = workflowTimeline.map((event) => event.kind);
    expect(kinds).toEqual(
      expect.arrayContaining(["rollback-prepared", "rolled-back", "approved", "applied"]),
    );
  });

  it("drops a stale proposal response after a newer request takes the gate", async () => {
    const slow = deferred<unknown>();
    const fast = validation("stale");
    let call = 0;
    connection.rpc = {
      skillSteward: {
        validate: () => {
          call += 1;
          return call === 1 ? slow.promise : Promise.resolve(fast);
        },
      },
    };
    const first = validateStewardProposal(PROPOSAL);
    const second = validateStewardProposal(PROPOSAL);
    expect((await second)?.overall).toBe("stale");
    slow.resolve(validation("valid"));
    expect(await first).toBeNull();
    expect(proposalStates[PROPOSAL]!.validation?.overall).toBe("stale");
  });

  it("loads stream frames and filters them to the current run's dsh session", async () => {
    const frames = [
      { seq: 1, at: "t1", runId: "sr_a", sessionId: "session-1", kind: "turn-start" },
      {
        seq: 2,
        at: "t2",
        runId: "sr_a",
        sessionId: "session-1",
        kind: "tool-call",
        toolName: "skills.list_context",
      },
      {
        seq: 3,
        at: "t3",
        runId: "sr_b",
        sessionId: "session-2",
        kind: "tool-result",
        toolName: "skills.relations",
      },
    ];
    connection.rpc = { agent: { sessions: { streams: () => Promise.resolve({ frames }) } } };
    await loadStewardStreamFrames();
    expect(streamFramesState.frames).toHaveLength(3);

    workflowRunState.run = {
      snapshotId: StewardSnapshotIdSchema.parse("snap_0123456789abcdef"),
      terminal: "completed",
      acceptedResponses: 1,
      droppedLateResponses: 0,
      toolCalls: 2,
      proposals: [],
      dshSessionId: "session-1",
    };
    const scoped = framesForCurrentRun();
    expect(scoped).toHaveLength(2);
    expect(scoped.every((frame) => frame.sessionId === "session-1")).toBe(true);
    expect(scoped.some((frame) => frame.kind === "tool-call")).toBe(true);
  });
});
