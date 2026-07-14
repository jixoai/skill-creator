/**
 * 原始需求 [2026-07-14]：「skills manager 只是路由的一部分(`/workspace/~/`)；我们还需要支持导入 workspace」。
 * 正交意图：
 * 1. 投影 workspace 范围内的技能列表与详情。
 * 2. 编排启停和校验命令。
 * 3. 派生查询过滤与统计数据。
 */
import type {
  SkillId,
  SkillInfo,
  SkillMetadata,
  ToggleSummary,
  ValidateResult,
  WorkspaceId,
} from "../types";
import { requireRpc } from "./connection.svelte";

/** 当前 workspace 的技能列表、选中项与加载状态。 */
export const skillsState = $state<{
  workspaceId: WorkspaceId;
  skills: SkillMetadata[];
  selected: SkillInfo | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  query: string;
}>({
  workspaceId: "~",
  skills: [],
  selected: null,
  loading: false,
  refreshing: false,
  error: null,
  query: "",
});

/** 加载指定 workspace 的完整技能列表。 */
export async function loadSkills(
  workspaceId: WorkspaceId = skillsState.workspaceId,
): Promise<void> {
  const workspaceChanged = skillsState.workspaceId !== workspaceId;
  if (workspaceChanged) {
    skillsState.workspaceId = workspaceId;
    skillsState.skills = [];
    skillsState.selected = null;
  }
  skillsState.loading = skillsState.skills.length === 0;
  skillsState.refreshing = skillsState.skills.length > 0;
  skillsState.error = null;
  try {
    const { skills } = await requireRpc().skills.list({ workspaceId, includeDisabled: true });
    skillsState.skills = skills;
    if (skillsState.selected && !skills.some((skill) => skill.id === skillsState.selected?.id)) {
      skillsState.selected = null;
    }
  } catch (error) {
    skillsState.error = error instanceof Error ? error.message : String(error);
  } finally {
    skillsState.loading = false;
    skillsState.refreshing = false;
  }
}

/** 加载并选中当前 workspace 内的技能详情。 */
export async function selectSkill(skillId: SkillId): Promise<void> {
  skillsState.error = null;
  try {
    skillsState.selected = await requireRpc().skills.info({
      workspaceId: skillsState.workspaceId,
      skillId,
      includeDisabled: true,
    });
  } catch (error) {
    skillsState.error = error instanceof Error ? error.message : String(error);
  }
}

/** 清除当前技能详情选择。 */
export function clearSelection(): void {
  skillsState.selected = null;
}

/** 批量启用或禁用当前 workspace 内的技能并刷新投影。 */
export async function toggleSkills(
  skillIds: SkillId[],
  mode: "enable" | "disable",
): Promise<ToggleSummary> {
  const result = await requireRpc().skills.toggle({
    workspaceId: skillsState.workspaceId,
    skillIds,
    mode,
  });
  await loadSkills();
  if (skillsState.selected && skillIds.includes(skillsState.selected.id)) {
    await selectSkill(skillsState.selected.id);
  }
  return result;
}

/** 校验当前 workspace 内的一个技能。 */
export function validateSkill(skillId: SkillId): Promise<ValidateResult> {
  return requireRpc().skills.validate({ workspaceId: skillsState.workspaceId, skillId });
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

/** 派生技能总数、启停数与 provider 分布。 */
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
