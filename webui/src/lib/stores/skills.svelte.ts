/**
 * 用户原始需求 [2026-07-22]：「一个 Workspace 下，是可以包含多个 providers 的。」
 * 正交意图：
 *   [1] 按 Workspace Provider 对投影技能列表与详情。
 *   [2] 编排同一 Provider 根目录内的启停和校验命令。
 *   [3] 派生查询过滤与统计数据。
 */
import type {
  SkillId,
  SkillInfo,
  SkillMetadata,
  ToggleSummary,
  ValidateResult,
  WorkspaceProviderTarget,
} from "../types";
import { getConnectionGeneration, requireRpc } from "./connection.svelte";
import { createRequestGenerationGate } from "./request-generation.js";

const listRequests = createRequestGenerationGate(getConnectionGeneration);
const selectionRequests = createRequestGenerationGate(getConnectionGeneration);
const mutationRequests = createRequestGenerationGate(getConnectionGeneration);
const validationRequests = createRequestGenerationGate(getConnectionGeneration);

/** 当前 Workspace Provider 的技能列表、选中项与加载状态。 */
export const skillsState = $state<{
  target: WorkspaceProviderTarget | null;
  skills: SkillMetadata[];
  selected: SkillInfo | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  query: string;
}>({
  target: null,
  skills: [],
  selected: null,
  loading: false,
  refreshing: false,
  error: null,
  query: "",
});

/** 加载指定 Workspace Provider 的完整技能列表。 */
export async function loadSkills(target: WorkspaceProviderTarget): Promise<void> {
  const request = listRequests.issue();
  const canCommit = (): boolean => request.isCurrent() && targetsEqual(skillsState.target, target);
  const targetChanged = !targetsEqual(skillsState.target, target);
  if (targetChanged) {
    selectionRequests.invalidate();
    skillsState.target = target;
    skillsState.skills = [];
    skillsState.selected = null;
  }
  skillsState.loading = skillsState.skills.length === 0;
  skillsState.refreshing = skillsState.skills.length > 0;
  skillsState.error = null;
  try {
    const { skills } = await requireRpc().skills.list({ ...target, includeDisabled: true });
    if (!canCommit()) return;
    skillsState.skills = skills;
    if (skillsState.selected && !skills.some((skill) => skill.id === skillsState.selected?.id)) {
      skillsState.selected = null;
    }
  } catch (error) {
    if (!canCommit()) return;
    skillsState.error = error instanceof Error ? error.message : String(error);
  } finally {
    if (request.isLatest()) {
      skillsState.loading = false;
      skillsState.refreshing = false;
    }
  }
}

/** 加载并选中当前 Workspace Provider 内的技能详情。 */
export async function selectSkill(skillId: SkillId): Promise<void> {
  const target = skillsState.target;
  if (!target) return;
  const request = selectionRequests.issue();
  const canCommit = (): boolean => request.isCurrent() && targetsEqual(skillsState.target, target);
  skillsState.error = null;
  try {
    const selected = await requireRpc().skills.info({ ...target, skillId, includeDisabled: true });
    if (canCommit()) skillsState.selected = selected;
  } catch (error) {
    if (!canCommit()) return;
    skillsState.error = error instanceof Error ? error.message : String(error);
  }
}

/** 清除当前技能详情选择。 */
export function clearSelection(): void {
  selectionRequests.invalidate();
  skillsState.selected = null;
}

/** 批量启用或禁用当前 Provider 内的技能并刷新投影。 */
export async function toggleSkills(
  skillIds: SkillId[],
  mode: "enable" | "disable",
): Promise<ToggleSummary | null> {
  const target = skillsState.target;
  if (!target) return null;
  const request = mutationRequests.issue();
  const canCommit = (): boolean => request.isCurrent() && targetsEqual(skillsState.target, target);
  let result: ToggleSummary;
  try {
    result = await requireRpc().skills.toggle({ ...target, skillIds, mode });
  } catch (error) {
    if (!canCommit()) return null;
    throw error;
  }
  if (!canCommit()) return null;
  await loadSkills(target);
  if (!canCommit()) return null;
  if (skillsState.selected && skillIds.includes(skillsState.selected.id)) {
    await selectSkill(skillsState.selected.id);
  }
  return canCommit() ? result : null;
}

/** 校验当前 Provider 内的一个技能。 */
export async function validateSkill(skillId: SkillId): Promise<ValidateResult | null> {
  const target = skillsState.target;
  if (!target) return null;
  const request = validationRequests.issue();
  const canCommit = (): boolean => request.isCurrent() && targetsEqual(skillsState.target, target);
  try {
    const result = await requireRpc().skills.validate({ ...target, skillId });
    return canCommit() ? result : null;
  } catch (error) {
    if (!canCommit()) return null;
    throw error;
  }
}

/** 按当前查询词派生可见技能列表。 */
export function filteredSkills(): SkillMetadata[] {
  const query = skillsState.query.trim().toLowerCase();
  if (!query) return skillsState.skills;
  return skillsState.skills.filter((skill) =>
    [skill.name, skill.description, skill.provider].some((value) =>
      value.toLowerCase().includes(query),
    ),
  );
}

/**
 * 直接从 daemon RPC 拉取单个技能详情（含正文与 revision）。
 *
 * 与 `selectSkill` 不同：本函数不写入全局 `skillsState`，结果交由调用方在组件级
 * `$state` 内持有（符合状态分层：技能正文不缓存在前端 memory 跨渲染周期）。
 */
export function fetchSkillInfo(
  target: WorkspaceProviderTarget,
  skillId: SkillId,
): Promise<SkillInfo> {
  return requireRpc().skills.info({ ...target, skillId, includeDisabled: true });
}

/** 派生技能总数、启停数与 Provider 分布。 */
export function skillCounts(): {
  total: number;
  enabled: number;
  disabled: number;
  byProvider: Record<string, number>;
} {
  const byProvider: Record<string, number> = {};
  let enabled = 0;
  let disabled = 0;
  for (const skill of skillsState.skills) {
    if (skill.disabled) disabled += 1;
    else enabled += 1;
    byProvider[skill.provider] = (byProvider[skill.provider] ?? 0) + 1;
  }
  return { total: skillsState.skills.length, enabled, disabled, byProvider };
}

/** Compare the authority-carrying fields of a Workspace Provider target. */
export function targetsEqual(
  left: WorkspaceProviderTarget | null,
  right: WorkspaceProviderTarget | null,
): boolean {
  return left?.workspaceId === right?.workspaceId && left?.providerId === right?.providerId;
}
