/**
 * 用户原始需求 [2026-09-21]：「P1 本质上是在收集一些碎片的认知，这和 skill-wiki
 * 是有一些重叠的，是 skill-wiki 输入的一部分」——轨迹即输入。
 * （WikiSkill 论文 §3.2 ReAct Skill Proposer 前置的分层采样：≤5 失败 + ≤3 通过，
 * 单条 15k 字符 cap；py 参考实现 metrics/orchestrator 移植为纯函数。）
 * 正交意图：
 *   [1] 轨迹分层采样纯函数：无 LLM / 无 fs / 无时钟依赖，输入输出全量确定。
 *   [2] 采样预算常量单源（后续 LLM 编排切片直接复用，不另立口径）。
 */
export interface TrajectoryEntry {
  /** 稳定条目 id（调用方转录存储的 messageId / stepId）。 */
  id: string;
  /** 该轨迹段的验证结果。 */
  outcome: "pass" | "fail";
  /** 转录文本（原样输入，不做规范化；截断只发生在采样输出侧）。 */
  content: string;
}

/** 每次采样最多纳入的失败条目数。 */
export const MAX_SAMPLED_FAILURES = 5;
/** 每次采样最多纳入的通过条目数。 */
export const MAX_SAMPLED_PASSES = 3;
/** 单条轨迹文本的字符上限（超出截断）。 */
export const ENTRY_CHAR_CAP = 15_000;

/**
 * 分层采样：按输入时序各取最近的失败（≤5）与通过（≤3）条目，输出保持与输入
 * 一致的相对顺序，单条文本截断到 ENTRY_CHAR_CAP。输入本身应为时序排列；
 * id 重复由调用方的转录存储契约排除。
 */
export function sampleTrajectories(entries: readonly TrajectoryEntry[]): TrajectoryEntry[] {
  const takeLast = (outcome: "pass" | "fail", max: number): TrajectoryEntry[] => {
    const matching: TrajectoryEntry[] = [];
    for (const entry of entries) {
      if (entry.outcome === outcome) matching.push(entry);
    }
    return matching.slice(Math.max(0, matching.length - max));
  };
  const picked = new Set([
    ...takeLast("fail", MAX_SAMPLED_FAILURES),
    ...takeLast("pass", MAX_SAMPLED_PASSES),
  ]);
  const sampled: TrajectoryEntry[] = [];
  for (const entry of entries) {
    if (!picked.has(entry)) continue;
    sampled.push({ ...entry, content: entry.content.slice(0, ENTRY_CHAR_CAP) });
  }
  return sampled;
}
