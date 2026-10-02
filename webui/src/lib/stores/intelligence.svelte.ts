/**
 * 用户原始需求 [2026-09-06]（openspec skill-intelligence）：
 * 「所有优化只产生 Manager-owned draft/patch，必须经过 validation、revision check 和显式 approval。」
 * 修订 [2026-10-02]（e2e 审批面缺口）：proposal 列表/决定切到统一审批面
 * agent.proposals.*——mcp:（外部 MCP client 造的 mutation proposal）与 si:
 * （agent tool call 草稿）双源合并；直连 skillIntelligence.* 决定面退役（该面
 * 只见 si: 草稿，外部 proposal 在 WebUI 无浏览面）。
 * 正交意图：
 *   [1] 按连接所有权与最新请求代次投影只读分析报告（per-call gate，组件持结果）。
 *   [2] proposal 的列表/审批/拒绝经统一面（mcp:|si: 前缀路由）按同一代次门
 *       管理，失效结果投影为无结果。
 */
import type { UnifiedProposalView } from "$shared/contracts/agent.js";
import type {
  AnalyzeFailure,
  IntelligenceReport,
  SkillSelection,
} from "$shared/contracts/skill-intelligence.js";
import { getConnectionGeneration, requireRpc } from "./connection.svelte";
import { createRequestGenerationGate } from "./request-generation.js";

/** per-call 代次令牌（组件持结果前用以识别 stale 响应）。 */
interface RequestGeneration {
  isCurrent: () => boolean;
}

/**
 * 模块级 latest-request-wins 代次门（按操作类别共享）：新请求撤销旧请求的提交资格，
 * 连接替换同样撤销；组件卸载即由结果无人接收自然丢弃。
 */
const analyzeGate = createRequestGenerationGate(getConnectionGeneration);
const listGate = createRequestGenerationGate(getConnectionGeneration);
const rejectGate = createRequestGenerationGate(getConnectionGeneration);
const approveGate = createRequestGenerationGate(getConnectionGeneration);

/** 只读分析一组技能；结果交给调用方持有。 */
export async function analyzeSkills(selections: SkillSelection[]): Promise<{
  report: IntelligenceReport | null;
  failures: AnalyzeFailure[];
  error: string | null;
}> {
  const request = analyzeGate.issue();
  try {
    const result = await requireRpc().skillIntelligence.analyze({ selections });
    return request.isCurrent()
      ? { report: result.report, failures: result.failures, error: null }
      : { report: null, failures: [], error: null };
  } catch (error) {
    if (!request.isCurrent()) return { report: null, failures: [], error: null };
    return {
      report: null,
      failures: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * 拉取统一审批面列表（agent.proposals.list：mcp: + si: 双源合并，含决定态）；
 * 结果交给调用方持有。
 */
export async function loadProposals(): Promise<{
  proposals: UnifiedProposalView[] | null;
  error: string | null;
}> {
  const request = listGate.issue();
  try {
    const result = await requireRpc().agent.proposals.list({});
    return request.isCurrent()
      ? { proposals: result.proposals, error: null }
      : { proposals: null, error: null };
  } catch (error) {
    if (!request.isCurrent()) return { proposals: null, error: null };
    return { proposals: null, error: error instanceof Error ? error.message : String(error) };
  }
}

/** 经统一审批面拒绝（id 携带 mcp:|si: 前缀，daemon 按前缀路由）；结果交给调用方持有。 */
export async function rejectProposal(
  proposalId: string,
): Promise<{ rejected: boolean; error: string | null }> {
  const request = rejectGate.issue();
  try {
    await requireRpc().agent.proposals.reject({ proposalId });
    return request.isCurrent() ? { rejected: true, error: null } : { rejected: false, error: null };
  } catch (error) {
    if (!request.isCurrent()) return { rejected: false, error: null };
    return { rejected: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * 经统一审批面审批（id 携带 mcp:|si: 前缀）：mcp 面阻塞到执行终态；si 面
 * 消费草稿走 grant 链。决定后的统一视图交给调用方持有（stale → rejected +
 * rejectCause:"stale"，草稿保留待重提案）。
 */
export async function approveProposal(
  proposalId: string,
): Promise<{ proposal: UnifiedProposalView | null; error: string | null }> {
  const request = approveGate.issue();
  try {
    const result = await requireRpc().agent.proposals.approve({ proposalId });
    return request.isCurrent()
      ? { proposal: result.proposal, error: null }
      : { proposal: null, error: null };
  } catch (error) {
    if (!request.isCurrent()) return { proposal: null, error: null };
    return { proposal: null, error: error instanceof Error ? error.message : String(error) };
  }
}
