/**
 * 用户原始需求 [2026-07-27]：「读取 lock 文件、对比上游 hash、按需重装并刷新 lock 条目。」
 * 正交意图：
 *   [1] 投影 skills.update.check 的逐技能状态（updated/already-current/failed/unavailable）。
 *   [2] 编排 skills.update.apply 的受控重装（仅限 check 确认过时的 selected IDs）。
 *   [3] 检查与重装是两个独立 mutation，各自 busy 锁与终态；结果只属于当前 target。
 */
import type {
  ApplyUpdateResultEntry,
  SkillId,
  UpdateCheckResultEntry,
  WorkspaceProviderTarget,
} from "../types";
import { getConnectionGeneration, requireRpc } from "./connection.svelte";
import { createRequestGenerationGate } from "./request-generation.js";
import { targetsEqual } from "./skills.svelte";

const updateRequests = createRequestGenerationGate(getConnectionGeneration);

/** 当前 Provider 的更新检查 / 重装投影。 */
export const skillsUpdateState = $state<{
  target: WorkspaceProviderTarget | null;
  checking: boolean;
  applying: boolean;
  checkError: string | null;
  /** 最近一次 check 的逐技能结果（apply 后被 apply 结果替换语义详见 applyUpdates）。 */
  results: UpdateCheckResultEntry[];
  /** 最近一次 apply 的逐技能结果；null 表示尚未 apply。 */
  applyResults: ApplyUpdateResultEntry[] | null;
}>({
  target: null,
  checking: false,
  applying: false,
  checkError: null,
  results: [],
  applyResults: null,
});

/** 对当前 Provider 执行更新检查（全量或 selected skillIds）。 */
export async function checkUpdates(
  target: WorkspaceProviderTarget,
  skillIds?: SkillId[],
): Promise<void> {
  const request = updateRequests.issue();
  const canCommit = (): boolean =>
    request.isCurrent() && targetsEqual(skillsUpdateState.target, target);
  skillsUpdateState.target = target;
  skillsUpdateState.checking = true;
  skillsUpdateState.checkError = null;
  skillsUpdateState.results = [];
  skillsUpdateState.applyResults = null;
  try {
    const { results } = await requireRpc().skills.update.check({ ...target, skillIds });
    if (!canCommit()) return;
    skillsUpdateState.results = results;
  } catch (error) {
    if (!canCommit()) return;
    skillsUpdateState.checkError = error instanceof Error ? error.message : String(error);
  } finally {
    if (request.isLatest()) skillsUpdateState.checking = false;
  }
}

/** 重装 check 确认过时的技能（caller 只允许传入 status=updated 的 skillIds）。 */
export async function applyUpdates(
  target: WorkspaceProviderTarget,
  skillIds: SkillId[],
): Promise<ApplyUpdateResultEntry[] | null> {
  const request = updateRequests.issue();
  const canCommit = (): boolean =>
    request.isCurrent() && targetsEqual(skillsUpdateState.target, target);
  skillsUpdateState.applying = true;
  try {
    const { results } = await requireRpc().skills.update.apply({ ...target, skillIds });
    if (!canCommit()) return null;
    skillsUpdateState.applyResults = results;
    return results;
  } catch (error) {
    if (!canCommit()) return null;
    throw error;
  } finally {
    if (request.isLatest()) skillsUpdateState.applying = false;
  }
}

/** 清除当前更新报告（切换 Provider / 关闭面板）。 */
export function clearUpdateReport(): void {
  updateRequests.invalidate();
  skillsUpdateState.results = [];
  skillsUpdateState.applyResults = null;
  skillsUpdateState.checkError = null;
}

/** 汇总当前 check 结果的计数（供报告头与 toast 分类）。 */
export function updateCheckCounts(results: readonly UpdateCheckResultEntry[]): {
  outdated: number;
  current: number;
  failed: number;
  unavailable: number;
} {
  let outdated = 0;
  let current = 0;
  let failed = 0;
  let unavailable = 0;
  for (const entry of results) {
    if (entry.status === "updated") outdated += 1;
    else if (entry.status === "already-current") current += 1;
    else if (entry.status === "failed") failed += 1;
    else unavailable += 1;
  }
  return { outdated, current, failed, unavailable };
}

/** 汇总当前 apply 结果的计数。 */
export function updateApplyCounts(results: readonly ApplyUpdateResultEntry[]): {
  updated: number;
  current: number;
  failed: number;
} {
  let updated = 0;
  let current = 0;
  let failed = 0;
  for (const entry of results) {
    if (entry.status === "updated") updated += 1;
    else if (entry.status === "already-current") current += 1;
    else failed += 1;
  }
  return { updated, current, failed };
}
