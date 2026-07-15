/**
 * 原始需求 [2026-07-14]：「我们还需要有一个 创造、编辑 技能的路由(/creator)。二者是有机互联的」。
 * 正交意图：
 * 1. 将 Creator 深链收窄为无 query、workspace-only 创建与 workspace+skill 编辑三态。
 * 2. 在组件创建前移除非法 ID 或 skill-only query，禁止静默改写编辑作用域。
 */
import { redirect } from "@sveltejs/kit";
import { SkillIdSchema } from "$shared/contracts/skills.js";
import { ImportedWorkspaceIdSchema } from "$shared/contracts/workspaces.js";
import type { PageLoad } from "./$types";

export const load: PageLoad = ({ url }) => {
  const workspaceValue = url.searchParams.get("workspace");
  const skillValue = url.searchParams.get("skill");
  if (workspaceValue === null && skillValue === null) {
    return { workspaceId: null, skillId: null };
  }

  const workspace = ImportedWorkspaceIdSchema.safeParse(workspaceValue);
  const skill = skillValue === null ? null : SkillIdSchema.safeParse(skillValue);
  if (!workspace.success || (skill !== null && !skill.success)) throw redirect(307, "/creator");

  return {
    workspaceId: workspace.data,
    skillId: skill?.data ?? null,
  };
};
