/**
 * Skill Steward pipeline service（openspec skill-steward-runtime task 2.3f）。
 *
 * 用户原始需求 [2026-09-06]：「串联 snapshot、finding、proposal、validation、
 * approval、apply、audit、rollback。」
 * 串联层把 contracts/registry/fixture runtime/approval/audit-store 组装为
 * human-UI 面向的 RPC surface；agent 侧只能经 tool registry。
 *
 * 正交意图：
 *   [1] run 串联：snapshot（单遍读取）→ fixture scenario（真实工具面）→ 提案清单。
 *   [2] 审批面：validate/approve/apply/rollback 直接委托 approval-service
 *       （principal 固定 human-ui：本 surface 只服务人类 UI）。
 *   [3] 持久投影：terminal run 写入 audit-store（重启可读）。
 */
import { randomBytes } from "node:crypto";
import { STEWARD_PROMPT_VERSION, STEWARD_TOOL_VERSION } from "./prompts.js";
import { buildContextSnapshot } from "./context-snapshot.js";
import { createStewardAuditStore } from "./audit-store.js";
import { createStewardApprovalService } from "./approval-service.js";
import { runFixtureStewardScenario } from "./runtime.js";
import type { FixtureScenario } from "./fixture-agent.js";
import {
  StewardRunIdSchema,
  type SkillProposal,
  type SkillStewardContextSnapshot,
  type SkillStewardRunInput,
  type SkillStewardRunResult,
  type SkillValidationResult,
  type SkillStewardApproveResult,
  type SkillStewardApplyResult,
  type SkillStewardRollbackResult,
  type StewardProposalId,
} from "../../shared/contracts/skill-steward.js";
import type { CreatorService } from "../creator-service.js";
import type { SkillService } from "../skill-service.js";
import type { WorkspaceRegistry } from "../workspace-registry/index.js";

/** fixture 任务类别 → 默认场景。 */
const TASK_SCENARIO: Record<SkillStewardRunInput["taskKind"], FixtureScenario> = {
  check: "valid-check",
  optimize: "valid-optimize",
  organize: "valid-organize",
};

/** 创建 pipeline 服务（domain 组装点）。 */
export function createSkillStewardPipelineService(deps: {
  workspaces: WorkspaceRegistry;
  skills: SkillService;
  creator: CreatorService;
}) {
  const store = createStewardAuditStore();
  const approval = createStewardApprovalService({
    workspaces: deps.workspaces,
    skills: deps.skills,
    creator: deps.creator,
    store,
  });
  /** run 内提案清单（proposalId → action），供 run 结果投影。 */
  const runProposals = new Map<string, SkillStewardRunResult["proposals"]>();

  /** 启动一次 run：snapshot → fixture scenario（真实工具面）。 */
  async function startRun(input: SkillStewardRunInput): Promise<SkillStewardRunResult> {
    const scenario = input.scenario ?? TASK_SCENARIO[input.taskKind];
    const snapshot: SkillStewardContextSnapshot = await buildContextSnapshot(deps.skills, {
      target: input.target,
      skillIds: input.skillIds,
      promptVersion: STEWARD_PROMPT_VERSION,
      toolVersion: STEWARD_TOOL_VERSION,
      capabilities: {
        backendId: "fixture",
        version: "fixture-1",
        streamingEvents: true,
        cancellation: true,
        permissionRequests: true,
        executionRoot: "isolated",
      },
    });
    const runId = StewardRunIdSchema.parse(`sr_${randomBytes(12).toString("hex")}`);
    const proposals: SkillStewardRunResult["proposals"] = [];
    const sink = {
      store(proposal: SkillProposal): StewardProposalId {
        const proposalId = approval.submit(proposal, snapshot, runId);
        proposals.push({ proposalId, action: proposal.action });
        return proposalId;
      },
      get(proposalId: StewardProposalId) {
        return null;
      },
    };
    const output = await runFixtureStewardScenario({
      runId,
      scenario,
      snapshot,
      proposals: sink,
      validate: (proposalId) => {
        void proposalId;
        return { overall: "valid", checks: [{ name: "bind", status: "passed" }] };
      },
    });
    runProposals.set(snapshot.id, proposals);
    // terminal run 持久投影（重启可读）。
    await store.appendRun({
      runId,
      snapshotId: snapshot.id,
      terminal: output.result.terminalReason,
      endedAt: new Date().toISOString(),
    });
    return {
      snapshotId: snapshot.id,
      terminal: output.result.terminalReason,
      acceptedResponses: output.acceptedResponses.length,
      droppedLateResponses: output.droppedLateResponses.length,
      toolCalls: output.toolCalls.length,
      proposals,
    };
  }

  return {
    startRun,
    validate: (proposalId: StewardProposalId): Promise<SkillValidationResult> =>
      approval.validate(proposalId),
    approve: async (proposalId: StewardProposalId): Promise<SkillStewardApproveResult> => {
      const grant = await approval.approve(proposalId, "human-ui");
      return { grantId: grant.id, fingerprint: grant.fingerprint, issuedAt: grant.issuedAt };
    },
    apply: async (proposalId: StewardProposalId): Promise<SkillStewardApplyResult> => {
      const { outcome, audit } = await approval.apply(proposalId, "human-ui");
      return {
        outcomeStatus: outcome.status,
        ...(outcome.status === "applied" ? {} : { failure: outcome.failure }),
        auditId: audit.id,
        auditStatus: audit.status,
        mutations: audit.mutations,
      };
    },
    prepareRollback: (auditId: string): Promise<SkillStewardRollbackResult> =>
      approval.prepareRollback(auditId, "human-ui"),
    applyRollback: async (auditId: string): Promise<SkillStewardApplyResult> => {
      const { audit } = await approval.applyRollback(auditId, "human-ui");
      return {
        outcomeStatus:
          audit.status === "rolled-back"
            ? "applied"
            : audit.status === "recovery-required"
              ? "recovery-required"
              : "compensated",
        auditId: audit.id,
        auditStatus: audit.status,
        mutations: audit.mutations,
      };
    },
  };
}

/** pipeline 服务实例接口。 */
export type SkillStewardPipelineService = ReturnType<typeof createSkillStewardPipelineService>;
