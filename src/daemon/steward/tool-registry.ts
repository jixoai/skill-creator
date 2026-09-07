/**
 * Manager-owned Skill Steward 域工具 registry（openspec skill-steward-runtime task 2.1；
 * dsh-kernel-rebase task 1.1 起改为 capability-core 投影宿主）。
 *
 * 用户原始需求 [2026-09-06]（spec）：「The runtime MUST expose only the typed skill domain
 * tools defined by the contracts change. Tool calls MUST be scoped to the immutable snapshot
 * and MUST record input, result, revision and permission.」
 *
 * 正交意图：
 *   [1] 审计宿主：每次调用（含 denied）都产出 SkillToolCall 记录（input、result、
 *       observed revisions、principal、run 归属）。
 *   [2] 能力投影：闭合工具面与 principal 边界由 capability registry 执行；
 *       agentTools 从 registry 投影（与契约 AGENT_ALLOWED_TOOLS 的一致性由测试钉死）。
 * 妥协声明：无——registry 不持文件句柄；真实 mutation 只能经 approval-service。
 */
import { randomBytes } from "node:crypto";
import {
  AGENT_ALLOWED_TOOLS,
  SKILL_DOMAIN_TOOLS,
  SkillToolCallIdSchema,
  type SkillProposal,
  type SkillStewardContextSnapshot,
  type SkillToolCall,
  type SkillToolCallResult,
  type SkillToolPrincipal,
  type StewardProposalId,
  type StewardRunId2,
} from "../../shared/contracts/skill-steward.js";
import { createCapabilityRegistry } from "../capability/core.js";
import { createStewardCapabilities } from "./capabilities.js";

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

/**
 * 构造一个 run 内的域工具 registry。工具面执行在 capability-core；本层只补
 * run 归属的审计记录。CapabilityCallResult 与 SkillToolCallResult 是值形状
 * 兼容的同构 union（capability-core 独立声明避免通用层依赖领域契约）。
 */
export function createStewardToolRegistry(options: ToolRegistryOptions) {
  const { runId, snapshot, onCall } = options;
  const registry = createCapabilityRegistry(
    createStewardCapabilities({
      snapshot,
      proposals: options.proposals,
      validate: options.validate,
      apply: options.apply,
      rollback: options.rollback,
    }),
  );

  /** 执行一次工具调用并强制审计。 */
  async function call(
    tool: string,
    input: unknown,
    principal: SkillToolPrincipal,
  ): Promise<SkillToolCallResult> {
    const id = SkillToolCallIdSchema.parse(`call_${randomBytes(8).toString("hex")}`);
    const result = (await registry.call(tool, input, principal)) as SkillToolCallResult;
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

  return {
    call,
    /** Agent 可用工具（测试/能力投影用）。 */
    agentTools: [...AGENT_ALLOWED_TOOLS],
    /** capability-core 清单投影（MCP descriptors / 对照表用）。 */
    describe: registry.describe,
  };
}

/** 既有测试与调用方对闭合集合的引用点（保持原导出面不变）。 */
export { SKILL_DOMAIN_TOOLS };
