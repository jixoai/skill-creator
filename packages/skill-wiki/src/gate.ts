/**
 * 用户原始需求 [2026-09-21]：「将它移植进来，用 skill-wiki 这个包来承载」
 * （WikiSkill 论文 §3.2.6 Gating & Rollback：验证分数严格提升才接受提案，否则
 * 拒绝并只回滚 skills 层；决策足迹程序化追加到 skill-impact）。
 * 正交意图：
 *   [1] 纯决策函数：baseline vs candidate 分数 → accept/reject（严格提升语义，
 *       无 LLM / 无 fs 依赖；回滚动作由宿主编排执行）。
 *   [2] 决策 → SkillImpactEntry 构造：产出即过 schema，审计足迹不可绕过。
 */
import { SkillImpactEntrySchema, type SkillImpactEntry } from "./schema.js";

/** 待 gate 的单原子技能提案（action 词汇由宿主 skills 层定义）。 */
export interface GateProposal {
  action: string;
  skill: string;
  summary: string;
}

/** gate 输入（分数语义由宿主评估器定义；本包只比较）。 */
export interface GateInput {
  proposal: GateProposal;
  /** 基线验证分数（回滚点：当前 skills 层状态的评估）。 */
  baselineScore: number;
  /** 应用提案后的候选验证分数。 */
  candidateScore: number;
  /** 附加决策语境（可选，原样拼进 reason）。 */
  context?: string;
  /** 时间戳注入缝（测试确定性）；缺省取当前时间。 */
  date?: string;
}

/** gate 输出：决策 + 审计条目。 */
export interface GateDecision {
  decision: "accept" | "reject";
  /** 分数是否严格提升（decision === "accept" 当且仅当 improved）。 */
  improved: boolean;
  reason: string;
  entry: SkillImpactEntry;
}

/**
 * 严格提升门：candidateScore > baselineScore 才 accept；相等或回落一律 reject
 * （宿主据此回滚 skills 层）。分数为有限数由调用方评估器保证。
 */
export function decideGate(input: GateInput): GateDecision {
  const improved = input.candidateScore > input.baselineScore;
  const delta = input.candidateScore - input.baselineScore;
  const deltaText = `${delta >= 0 ? "+" : ""}${delta.toFixed(4)}`;
  const scoreText = `score ${input.baselineScore.toFixed(4)} -> ${input.candidateScore.toFixed(4)} (${deltaText})`;
  const contextSuffix = input.context === undefined ? "" : `: ${input.context}`;
  const decision: "accept" | "reject" = improved ? "accept" : "reject";
  const reason = improved
    ? `${scoreText}, strict improvement${contextSuffix}`
    : `${scoreText}, no strict improvement, skills layer rolled back${contextSuffix}`;
  const entry = SkillImpactEntrySchema.parse({
    date: input.date ?? new Date().toISOString(),
    proposal: input.proposal,
    decision,
    reason,
  });
  return { decision, improved, reason, entry };
}
