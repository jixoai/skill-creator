/**
 * 用户原始需求 [2026-09-06]（openspec skill-intelligence）：
 * 「所有优化只产生 Manager-owned draft/patch，必须经过 validation、revision check 和显式 approval。」
 * 正交意图：
 *   [1] 按连接所有权与最新请求代次投影只读分析报告（per-call gate，组件持结果）。
 *   [2] proposal 草稿的提交/审批/拒绝按同一代次门管理，失效结果投影为无结果。
 */
import type {
  AnalyzeFailure,
  ApproveResult,
  IntelligenceReport,
  ProposalDraft,
  ProposalId,
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
const proposeGate = createRequestGenerationGate(getConnectionGeneration);
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

/** 提交一份 proposal 草稿；结果交给调用方持有。 */
export async function submitProposal(input: {
  payload: ProposalDraft["payload"];
  findingIds: ProposalDraft["findingIds"];
  rationale: string;
}): Promise<{ proposal: ProposalDraft | null; error: string | null }> {
  const request = proposeGate.issue();
  try {
    const result = await requireRpc().skillIntelligence.propose(input);
    return request.isCurrent()
      ? { proposal: result.proposal, error: null }
      : { proposal: null, error: null };
  } catch (error) {
    if (!request.isCurrent()) return { proposal: null, error: null };
    return { proposal: null, error: error instanceof Error ? error.message : String(error) };
  }
}

/** 拉取当前草稿列表；结果交给调用方持有。 */
export async function loadProposals(): Promise<{
  proposals: ProposalDraft[] | null;
  error: string | null;
}> {
  const request = listGate.issue();
  try {
    const result = await requireRpc().skillIntelligence.list({});
    return request.isCurrent()
      ? { proposals: result.proposals, error: null }
      : { proposals: null, error: null };
  } catch (error) {
    if (!request.isCurrent()) return { proposals: null, error: null };
    return { proposals: null, error: error instanceof Error ? error.message : String(error) };
  }
}

/** 拒绝并删除草稿；结果交给调用方持有。 */
export async function rejectProposal(
  proposalId: ProposalId,
): Promise<{ rejected: boolean; error: string | null }> {
  const request = rejectGate.issue();
  try {
    await requireRpc().skillIntelligence.reject({ proposalId });
    return request.isCurrent() ? { rejected: true, error: null } : { rejected: false, error: null };
  } catch (error) {
    if (!request.isCurrent()) return { rejected: false, error: null };
    return { rejected: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** 审批草稿（daemon 侧复核 revision）；逐项结果交给调用方持有。 */
export async function approveProposal(
  proposalId: ProposalId,
): Promise<{ result: ApproveResult | null; error: string | null }> {
  const request = approveGate.issue();
  try {
    const result = await requireRpc().skillIntelligence.approve({ proposalId });
    return request.isCurrent() ? { result, error: null } : { result: null, error: null };
  } catch (error) {
    if (!request.isCurrent()) return { result: null, error: null };
    return { result: null, error: error instanceof Error ? error.message : String(error) };
  }
}
