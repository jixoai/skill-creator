/**
 * 统一 proposal 投影（intelligence-proposal-parity C′2；工作计划 Ch4）。
 *
 * 用户原始需求 [2026-09-30]：「edit/disable/split/merge 均从实际 DSH tool calls
 * 形成方案」（GOAL 105）——agent.proposals.* 成为唯一审批入口，双 store 各自
 * 映射不改存储，无审计信息丢失（MCP 五态 + 执行结果保全）。
 *
 * 正交意图：
 *   [1] 双源投影：McpProposalView（mcp:）与 skill-intelligence 草稿（si:）
 *       → UnifiedProposalView；kind/targets/observedRevisions 的域内推导。
 *   [2] 路由键解析：`mcp:`|`si:` 前缀 → {source, id}（approve/reject 分发）。
 */
import type { UnifiedProposalView } from "../shared/contracts/agent.js";
import type { McpProposalView } from "./mcp/proposals.js";
import type { ProposalDraft } from "../shared/contracts/skill-intelligence.js";

const SkillRefSchemaShape = {
  workspaceId: String,
  providerId: String,
  skillId: String,
} as const;
void SkillRefSchemaShape;

/** mcp capability slug → kind（dots→dashes；如 wiki.append → wiki-append）。 */
function capabilityKind(capability: string): string {
  return capability.replaceAll(/[._]/g, "-");
}

/** MCP 面：input 未知形状——目标/finding 由 capability 语义决定，投影层不猜
 * （target=null + payload 面（input）原样留在各自 store，视图只承担审批路由）。 */
export function projectMcpProposal(view: McpProposalView): UnifiedProposalView {
  return {
    id: `mcp:${view.proposalId}`,
    source: "mcp",
    origin: "agent-tool",
    capability: view.capability,
    payload: view.input,
    kind: capabilityKind(view.capability),
    target: null,
    observedRevision: null,
    before: null,
    after: null,
    finding: null,
    validation: null,
    status: view.status,
    ...(view.rejectedCause !== undefined ? { rejectCause: "user" as const } : {}),
    ...(view.result !== undefined
      ? {
          result: {
            applied: view.result.kind === "ok",
            ...(view.result.kind === "failed"
              ? { error: view.result.message || "capability failed" }
              : {}),
          },
        }
      : {}),
    createdAt: view.createdAt,
    ...(view.decidedAt !== undefined ? { decidedAt: view.decidedAt } : {}),
  };
}

/** si 面：草稿 = pending（拒绝即删除；approve 消费草稿走 skillSteward grant 链）。 */
export function projectIntelligenceDraft(draft: ProposalDraft): UnifiedProposalView {
  const selections = selectionsOf(draft);
  const primary = selections[0] ?? null;
  return {
    id: `si:${draft.id}`,
    source: "skill-intelligence",
    origin: "agent-tool",
    capability: null,
    payload: draft.payload,
    kind: draft.payload.kind,
    target: primary
      ? {
          workspaceId: primary.workspaceId,
          providerId: primary.providerId,
          skillId: primary.skillId,
        }
      : null,
    ...(selections.length > 1
      ? {
          targets: selections.map((selection) => ({
            workspaceId: selection.workspaceId,
            providerId: selection.providerId,
            skillId: selection.skillId,
          })),
        }
      : {}),
    observedRevision: draft.observedRevisions[0]?.revision ?? null,
    ...(draft.observedRevisions.length > 1
      ? { observedRevisions: draft.observedRevisions.map((entry) => entry.revision) }
      : {}),
    before: null,
    after: null,
    finding:
      draft.findingIds.length > 0
        ? { id: draft.findingIds[0], summary: draft.rationale.slice(0, 200) }
        : null,
    validation: null,
    status: "pending",
    createdAt: draft.createdAt,
  };
}

/** payload 内的全部受影响技能选择（多源对齐源）。 */
function selectionsOf(draft: ProposalDraft): ProposalDraft["payload"] extends never
  ? never[]
  : Array<{
      workspaceId: ProposalDraft["observedRevisions"][number]["workspaceId"];
      providerId: ProposalDraft["observedRevisions"][number]["providerId"];
      skillId: ProposalDraft["observedRevisions"][number]["skillId"];
    }> {
  return draft.observedRevisions.map((entry) => ({
    workspaceId: entry.workspaceId,
    providerId: entry.providerId,
    skillId: entry.skillId,
  }));
}

/** 统一 id → 源路由（approve/reject 分发键）。 */
export function parseUnifiedProposalRef(id: string): {
  source: "mcp" | "skill-intelligence";
  id: string;
} {
  if (id.startsWith("mcp:")) return { source: "mcp", id: id.slice(4) };
  if (id.startsWith("si:")) return { source: "skill-intelligence", id: id.slice(3) };
  throw new Error(
    `INVALID_OPERATION: unified proposal id must carry an mcp:|si: prefix (got ${id})`,
  );
}
