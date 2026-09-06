/**
 * Manager-owned Skill Steward 域工具 registry（openspec skill-steward-runtime task 2.1）。
 *
 * 用户原始需求 [2026-09-06]（spec）：「The runtime MUST expose only the typed skill domain
 * tools defined by the contracts change. Tool calls MUST be scoped to the immutable snapshot
 * and MUST record input, result, revision and permission.」
 *
 * 正交意图：
 *   [1] 闭合工具面：七个域工具之外一律 denied（unsupported-capability）并记账。
 *   [2] principal 边界：apply/rollback 永不开放给 agent。
 *   [3] 快照作用域：inspect/relations/propose 只接受快照内 opaque skill id；
 *       proposal 走 bindProposalToSnapshot 的全部类型化校验。
 *   [4] 全量审计：每次调用都产出 SkillToolCall 记录（含 observed revisions）。
 * 妥协声明：无——registry 不持文件句柄；真实 mutation 只能经 approval-service。
 */
import { randomBytes } from "node:crypto";
import {
  AGENT_ALLOWED_TOOLS,
  SKILL_DOMAIN_TOOLS,
  SkillToolCallIdSchema,
  SkillProposalSchema,
  StewardProposalIdSchema,
  bindProposalToSnapshot,
  type SkillProposal,
  type SkillStewardContextSnapshot,
  type SkillToolCall,
  type SkillToolCallResult,
  type SkillToolPrincipal,
  type StewardProposalId,
  type StewardRunId2,
} from "../../shared/contracts/skill-steward.js";
import { SkillIdSchema } from "../../shared/contracts/skills.js";
import { analyzeDocuments } from "../skill-intelligence/analyzer.js";

/** registry 对 proposal 存储的最小接口（由 runtime/approval-service 提供）。 */
export interface StewardProposalSink {
  /** 存入一份已通过 bind 校验的 proposal；返回 Manager 分配的 proposal id。 */
  store(proposal: SkillProposal): StewardProposalId;
  /** 读取 proposal（不存在返回 null）。 */
  get(proposalId: StewardProposalId): SkillProposal | null;
}

/** registry 依赖。 */
export interface ToolRegistryOptions {
  runId: StewardRunId2;
  snapshot: SkillStewardContextSnapshot;
  proposals: StewardProposalSink;
  /** validate_proposal 的实际校验实现（approval-service 注入；registry 不重复实现）。 */
  validate: (proposalId: StewardProposalId) => {
    overall: "valid" | "invalid" | "stale";
    checks: Array<{ name: string; status: "passed" | "failed" | "skipped"; detail?: string }>;
  };
  /** 审计接收器：每次调用（含 denied）都必须被记录。 */
  onCall: (call: SkillToolCall) => void;
  /** apply 执行器（approval-service 注入；未注入时 apply 返回 UNAVAILABLE）。 */
  apply?: (
    proposalId: StewardProposalId,
    principal: SkillToolPrincipal,
  ) => Promise<SkillToolCallResult>;
  /** rollback 执行器（approval-service 注入；只准备反向 proposal）。 */
  rollback?: (auditId: string, principal: SkillToolPrincipal) => Promise<SkillToolCallResult>;
}

function ok(value: unknown): SkillToolCallResult {
  return { kind: "ok", value };
}

function denied(
  reason: "unsupported-capability" | "principal-forbidden",
  operation: string,
): SkillToolCallResult {
  return { kind: "denied", reason, requestedOperation: operation };
}

function failed(
  code: "NOT_FOUND" | "CONFLICT" | "INVALID_OPERATION" | "UNAVAILABLE" | "STALE",
  message: string,
): SkillToolCallResult {
  return { kind: "failed", code, message };
}

/** 构造一个 run 内的域工具 registry。 */
export function createStewardToolRegistry(options: ToolRegistryOptions) {
  const { runId, snapshot, proposals, validate, onCall } = options;

  /** 执行一次工具调用并强制审计。 */
  async function call(
    tool: string,
    input: unknown,
    principal: SkillToolPrincipal,
  ): Promise<SkillToolCallResult> {
    const id = SkillToolCallIdSchema.parse(`call_${randomBytes(8).toString("hex")}`);
    const result = await dispatch(tool, input, principal);
    const call: SkillToolCall = {
      id,
      at: new Date().toISOString(),
      runId,
      tool,
      principal,
      input,
      result,
      observedRevisions: snapshot.skills.map((skill) => ({
        skillId: skill.skillId,
        revision: skill.revision,
      })),
    };
    onCall(call);
    return result;
  }

  async function dispatch(
    tool: string,
    input: unknown,
    principal: SkillToolPrincipal,
  ): Promise<SkillToolCallResult> {
    if (!(SKILL_DOMAIN_TOOLS as readonly string[]).includes(tool)) {
      return denied("unsupported-capability", tool);
    }
    if ((tool === "skills.apply_proposal" || tool === "skills.rollback") && principal === "agent") {
      return denied("principal-forbidden", tool);
    }
    switch (tool) {
      case "skills.list_context":
        return ok({
          snapshotId: snapshot.id,
          scopeKind: snapshot.scopeKind,
          target: snapshot.target,
          skills: snapshot.skills.map((skill) => ({
            skillId: skill.skillId,
            name: skill.name,
            directoryName: skill.directoryName,
            revision: skill.revision,
            disabled: skill.disabled,
            byteSize: skill.byteSize,
          })),
          resources: snapshot.resources.length,
        });
      case "skills.inspect": {
        const skillId = parseSkillIdInput(input);
        if (!skillId) return failed("INVALID_OPERATION", "inspect input must be { skillId }.");
        const entry = snapshot.skills.find((skill) => skill.skillId === skillId);
        if (!entry) return failed("NOT_FOUND", `Skill not in snapshot: ${skillId}`);
        return ok({ ...entry });
      }
      case "skills.relations": {
        const report = analyzeDocuments(
          snapshot.skills.map((skill) => ({
            workspaceId: snapshot.target.workspaceId,
            providerId: snapshot.target.providerId,
            skillId: skill.skillId,
            name: skill.name,
            directoryName: skill.directoryName,
            disabled: skill.disabled,
            revision: skill.revision,
            content: skill.content,
          })),
        );
        return ok({
          edges: report.edges,
          findings: report.findings,
        });
      }
      case "skills.propose": {
        const parsed = SkillProposalSchema.safeParse(
          typeof input === "object" && input !== null
            ? (input as Record<string, unknown>).proposal
            : undefined,
        );
        if (!parsed.success) {
          return failed(
            "INVALID_OPERATION",
            `Proposal failed contract validation: ${parsed.error.issues[0]?.path.join(".") ?? ""} ${parsed.error.issues[0]?.message ?? ""}`.trim(),
          );
        }
        const bound = bindProposalToSnapshot(parsed.data, snapshot);
        if (!bound.ok) {
          return failed(
            bound.failure.code === "STALE_REVISION"
              ? "STALE"
              : bound.failure.code === "UNKNOWN_SKILL"
                ? "NOT_FOUND"
                : "INVALID_OPERATION",
            bound.failure.message,
          );
        }
        const proposalId = proposals.store(parsed.data);
        return ok({ proposalId });
      }
      case "skills.validate_proposal": {
        const proposalId = parseProposalIdInput(input);
        if (!proposalId)
          return failed("INVALID_OPERATION", "validate input must be { proposalId }.");
        if (!proposals.get(proposalId)) {
          return failed("NOT_FOUND", `Proposal not found: ${proposalId}`);
        }
        const result = validate(proposalId);
        return ok(result);
      }
      case "skills.apply_proposal": {
        if (!options.apply) {
          return failed(
            "UNAVAILABLE",
            "apply is not wired in this runtime configuration; the Manager approval service owns the transaction.",
          );
        }
        const proposalId = parseProposalIdInput(input);
        if (!proposalId) return failed("INVALID_OPERATION", "apply input must be { proposalId }.");
        return options.apply(proposalId, principal);
      }
      case "skills.rollback": {
        if (!options.rollback) {
          return failed(
            "UNAVAILABLE",
            "rollback is not wired in this runtime configuration; the Manager approval service owns the transaction.",
          );
        }
        const auditId = parseAuditIdInput(input);
        if (!auditId) return failed("INVALID_OPERATION", "rollback input must be { auditId }.");
        return options.rollback(auditId, principal);
      }
    }
    // tool: string 使 TS 无法证明穷尽；上面的 includes 已排除非域工具，此处不可达。
    return denied("unsupported-capability", tool);
  }

  return {
    call,
    /** Agent 可用工具（测试/能力投影用）。 */
    agentTools: [...AGENT_ALLOWED_TOOLS],
  };
}

/** 解析 { skillId } 输入（unknown 收窄）。 */
function parseSkillIdInput(input: unknown): ReturnType<typeof SkillIdSchema.parse> | null {
  if (typeof input !== "object" || input === null) return null;
  const value = (input as Record<string, unknown>).skillId;
  const parsed = SkillIdSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** 解析 { proposalId } 输入（unknown 收窄）。 */
function parseProposalIdInput(input: unknown): StewardProposalId | null {
  if (typeof input !== "object" || input === null) return null;
  const value = (input as Record<string, unknown>).proposalId;
  const parsed = StewardProposalIdSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** 解析 { auditId } 输入（unknown 收窄）。 */
function parseAuditIdInput(input: unknown): string | null {
  if (typeof input !== "object" || input === null) return null;
  const value = (input as Record<string, unknown>).auditId;
  return typeof value === "string" && value.length > 0 ? value : null;
}
