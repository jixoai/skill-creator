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
import type { DshSessionBinder } from "./dsh-session-binder.js";

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
  /**
   * DSH session 绑定（task 2.1 可选面）：宿主可用时 run 绑定官方 session 并投影
   * 终态叙述；缺失/失败不影响 Manager run 本身（展示面降级，audit 仍完整）。
   */
  dshSessionBinder?: DshSessionBinder;
}) {
  const store = createStewardAuditStore();
  // 4.2：DSH host 在 daemon 内晚于 domain 组合挂载——binder 经此运行时注入点
  // 接入（host 降级时保持 null，run 不绑定 session，stream 为空——typed 缺席）。
  let activeBinder = deps.dshSessionBinder ?? null;
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
        // 由实际 handler 决定（4.9）：确定性 pipeline 不注册 permission handler，
        // run 期间不会产生 permission request——capability 如实为 false。
        permissionRequests: false,
        executionRoot: "isolated",
      },
    });
    const runId = StewardRunIdSchema.parse(`sr_${randomBytes(12).toString("hex")}`);
    // task 2.1：run ↔ DSH session 绑定（宿主可用时）。失败降级为无绑定，不阻塞 run。
    let dshSessionId: string | undefined;
    const binder = activeBinder;
    if (binder) {
      const workspaceDir = deps.workspaces.resolveWritable(input.target).directory;
      const bound = await binder.openBoundSession({
        runId,
        workspaceDir,
        taskText: `Skill Steward ${input.taskKind} run（Manager run id ${runId}${input.skillIds?.length ? `；选定 ${input.skillIds.length} 个技能` : "；全量快照"}）`,
      });
      if (bound.ok) dshSessionId = bound.dshSessionId;
    }
    const proposals: SkillStewardRunResult["proposals"] = [];
    // 本 run 内 store 的提案（4.9 浏览器实测修复）：registry 的
    // skills.validate_proposal 先经 get 校验提案存在——返回 null 会让确定性
    // optimize 场景在 validate 步骤永远 NOT_FOUND 失败（terminal=failed 但
    // 提案已铸出，终态误导）。提案本体保存在本 run 闭包，终态后随 run 丢弃。
    const storedProposals = new Map<StewardProposalId, SkillProposal>();
    const sink = {
      store(proposal: SkillProposal): StewardProposalId {
        const proposalId = approval.submit(proposal, snapshot, runId);
        storedProposals.set(proposalId, proposal);
        proposals.push({ proposalId, action: proposal.action });
        return proposalId;
      },
      get(proposalId: StewardProposalId) {
        return storedProposals.get(proposalId) ?? null;
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
    // terminal run 持久投影（重启可读）。toolCalls 携带关联 id（task 2.2：与 DSH
    // transcript 的 tool/call callId 一一对应；denied 的非域调用也如实入档）。
    await store.appendRun({
      runId,
      snapshotId: snapshot.id,
      terminal: output.result.terminalReason,
      endedAt: new Date().toISOString(),
      ...(dshSessionId === undefined ? {} : { dshSessionId }),
      toolCalls: output.toolCalls.map((call) => ({
        id: call.id,
        tool: call.tool,
        resultKind: call.result.kind,
      })),
    });
    // task 2.1：run 终态投影到 DSH session（turn/end 语义对齐 agent-loop）。
    if (binder && dshSessionId !== undefined) {
      // task 2.2：先投影 Manager 域工具轮（callId 关联），再收束 turn。
      binder.recordToolRounds(dshSessionId, output.toolCalls);
      binder.completeBoundSession({
        dshSessionId,
        summary: {
          terminal: output.result.terminalReason,
          acceptedResponses: output.acceptedResponses.length,
          droppedLateResponses: output.droppedLateResponses.length,
          toolCalls: output.toolCalls.length,
          proposals: proposals.length,
        },
        ...(output.result.terminalReason === "completed"
          ? {}
          : { failureMessage: `terminal: ${output.result.terminalReason}` }),
      });
    }
    return {
      snapshotId: snapshot.id,
      ...(dshSessionId === undefined ? {} : { dshSessionId }),
      terminal: output.result.terminalReason,
      acceptedResponses: output.acceptedResponses.length,
      droppedLateResponses: output.droppedLateResponses.length,
      toolCalls: output.toolCalls.length,
      proposals,
    };
  }

  return {
    startRun,
    /** 运行时注入/替换 DSH session binder（bootDaemon 在 DSH host 挂载后调用）。 */
    setDshSessionBinder(binder: DshSessionBinder | null): void {
      activeBinder = binder;
    },
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
      const { audit, failure } = await approval.applyRollback(auditId, "human-ui");
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
        ...(failure !== undefined ? { failure } : {}),
      };
    },
  };
}

/** pipeline 服务实例接口。 */
export type SkillStewardPipelineService = ReturnType<typeof createSkillStewardPipelineService>;
