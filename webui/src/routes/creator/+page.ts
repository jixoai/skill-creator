/**
 * 原始需求 [2026-07-22]：「Workspace 下可以包含多个 providers。」
 * 正交意图：
 * 1. 将 Creator 深链收窄为无 query、Workspace Provider 创建与 Workspace Provider+skill 编辑三态。
 * 2. 在组件创建前移除不完整或非法 Provider 作用域，禁止静默改写编辑作用域。
 */
import { redirect } from "@sveltejs/kit";
import { SkillIdSchema } from "$shared/contracts/skills.js";
import { ProviderIdSchema, WorkspaceIdSchema } from "$shared/contracts/workspaces.js";
import { providerCatalogEntry } from "$shared/provider-catalog.js";
import type { PageLoad } from "./$types";

export const load: PageLoad = ({ url }) => {
  const workspaceValue = url.searchParams.get("workspace");
  const providerValue = url.searchParams.get("provider");
  const skillValue = url.searchParams.get("skill");
  if (workspaceValue === null && providerValue === null && skillValue === null) {
    return { workspaceId: null, providerId: null, skillId: null };
  }

  const workspace = WorkspaceIdSchema.safeParse(workspaceValue);
  const provider = ProviderIdSchema.safeParse(providerValue);
  const skill = skillValue === null ? null : SkillIdSchema.safeParse(skillValue);
  if (
    !workspace.success ||
    !provider.success ||
    !providerCatalogEntry(provider.data) ||
    (skill !== null && !skill.success)
  ) {
    throw redirect(307, "/creator");
  }

  return {
    workspaceId: workspace.data,
    providerId: provider.data,
    skillId: skill?.data ?? null,
  };
};
