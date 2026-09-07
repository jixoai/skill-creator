/**
 * 用户原始需求 [2026-09-08]（dsh-kernel-rebase tasks 1.1）：「把 skillSteward 工具
 * registry 的既有能力逐项迁入，工具 registry 改为消费 capability-core 投影」。
 * 行为不变重构：七个域工具的 dispatch 逻辑逐字迁移为 capability 定义；权威等级
 * 映射——list/inspect/relations/validate=readonly，propose=proposal，
 * apply/rollback=approved-mutation（capability registry 对 agent 拒绝后者，与
 * 原 principal-forbidden 语义一致）。
 *
 * 正交意图：
 *   [1] steward 能力面：快照作用域工具的 typed 实现（opaque skill id 边界）。
 *   [2] proposal 通道：propose 走 bindProposalToSnapshot 全部类型化校验并存入
 *       Manager 分配 id 的 sink。
 * 妥协声明：无——与 tool-registry 原实现同构，仅换宿主层。
 */
import type { CapabilityCallResult, CapabilityDefinition } from "../capability/core.js";
import { z } from "zod";
import { SkillIdSchema } from "../../shared/contracts/skills.js";
import {
  SkillProposalSchema,
  StewardProposalIdSchema,
  bindProposalToSnapshot,
  type SkillProposal,
  type SkillStewardContextSnapshot,
  type SkillToolCallResult,
  type SkillToolPrincipal,
  type StewardProposalId,
} from "../../shared/contracts/skill-steward.js";
import { analyzeDocuments } from "../skill-intelligence/analyzer.js";

/** capabilities 对 proposal 存储/校验/执行器的依赖（与原 ToolRegistryOptions 同源）。 */
export interface StewardCapabilityDeps {
  snapshot: SkillStewardContextSnapshot;
  proposals: {
    store(proposal: SkillProposal): StewardProposalId;
    get(proposalId: StewardProposalId): SkillProposal | null;
  };
  validate: (proposalId: StewardProposalId) => {
    overall: "valid" | "invalid" | "stale";
    checks: Array<{ name: string; status: "passed" | "failed" | "skipped"; detail?: string }>;
  };
  apply?: (
    proposalId: StewardProposalId,
    principal: SkillToolPrincipal,
  ) => Promise<SkillToolCallResult>;
  rollback?: (auditId: string, principal: SkillToolPrincipal) => Promise<SkillToolCallResult>;
}

function ok(value: unknown): CapabilityCallResult {
  return { kind: "ok", value };
}

function failed(
  code: "NOT_FOUND" | "CONFLICT" | "INVALID_OPERATION" | "UNAVAILABLE" | "STALE",
  message: string,
): CapabilityCallResult {
  return { kind: "failed", code, message };
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

const listInputSchema = z.unknown();
const skillIdInputSchema = z.object({ skillId: SkillIdSchema });
const proposeInputSchema = z.object({ proposal: SkillProposalSchema });
const proposalIdInputSchema = z.object({ proposalId: StewardProposalIdSchema });
const auditIdInputSchema = z.object({ auditId: z.string().min(1) });

/** 构造 run 内 steward 能力定义（七个域工具；注册序与 SKILL_DOMAIN_TOOLS 一致）。 */
export function createStewardCapabilities(deps: StewardCapabilityDeps): CapabilityDefinition[] {
  const { snapshot, proposals, validate, apply, rollback } = deps;
  return [
    {
      name: "skills.list_context",
      description: "List the run's immutable skill snapshot: scope, target and skill entries.",
      authority: "readonly",
      input: listInputSchema,
      handler: () =>
        ok({
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
        }),
    },
    {
      name: "skills.inspect",
      description: "Inspect one snapshot skill entry (full document and metadata).",
      authority: "readonly",
      input: skillIdInputSchema,
      handler: (input) => {
        const skillId = parseSkillIdInput(input);
        if (!skillId) return failed("INVALID_OPERATION", "inspect input must be { skillId }.");
        const entry = snapshot.skills.find((skill) => skill.skillId === skillId);
        if (!entry) return failed("NOT_FOUND", `Skill not in snapshot: ${skillId}`);
        return ok({ ...entry });
      },
    },
    {
      name: "skills.relations",
      description: "Analyze the snapshot for cross-skill edges and findings.",
      authority: "readonly",
      input: listInputSchema,
      handler: () => {
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
      },
    },
    {
      name: "skills.propose",
      description: "Submit a typed proposal against the snapshot for Manager approval.",
      authority: "proposal",
      input: proposeInputSchema,
      handler: (input) => {
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
      },
    },
    {
      name: "skills.validate_proposal",
      description: "Run the Manager validation suite against one stored proposal.",
      authority: "readonly",
      input: proposalIdInputSchema,
      handler: (input) => {
        const proposalId = parseProposalIdInput(input);
        if (!proposalId)
          return failed("INVALID_OPERATION", "validate input must be { proposalId }.");
        if (!proposals.get(proposalId)) {
          return failed("NOT_FOUND", `Proposal not found: ${proposalId}`);
        }
        return ok(validate(proposalId));
      },
    },
    {
      name: "skills.apply_proposal",
      description: "Apply an approved proposal through the Manager transaction service.",
      authority: "approved-mutation",
      input: proposalIdInputSchema,
      handler: (input, principal) => {
        if (!apply) {
          return failed(
            "UNAVAILABLE",
            "apply is not wired in this runtime configuration; the Manager approval service owns the transaction.",
          );
        }
        const proposalId = parseProposalIdInput(input);
        if (!proposalId) return failed("INVALID_OPERATION", "apply input must be { proposalId }.");
        return apply(proposalId, principal);
      },
    },
    {
      name: "skills.rollback",
      description: "Prepare the reverse proposal for an applied audit entry.",
      authority: "approved-mutation",
      input: auditIdInputSchema,
      handler: (input, principal) => {
        if (!rollback) {
          return failed(
            "UNAVAILABLE",
            "rollback is not wired in this runtime configuration; the Manager approval service owns the transaction.",
          );
        }
        const auditId = parseAuditIdInput(input);
        if (!auditId) return failed("INVALID_OPERATION", "rollback input must be { auditId }.");
        return rollback(auditId, principal);
      },
    },
  ];
}
