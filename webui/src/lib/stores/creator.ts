/**
 * 原始需求 [2026-07-14]：「我们还需要有一个 创造、编辑 技能的路由(/creator)。二者是有机互联的」。
 * 正交意图：
 * 1. 封装 Creator 的保存与加载命令。
 * 2. 以文档 revision 约束删除操作。
 */
import type {
  SaveSkillInput,
  SaveSkillResult,
  SkillDocument,
  SkillId,
  WorkspaceProviderTarget,
} from "../types";
import { requireRpc } from "./connection.svelte";

/** 在显式 workspace 中新建或 revision-safe 更新技能。 */
export function saveSkill(input: SaveSkillInput): Promise<SaveSkillResult> {
  return requireRpc().creator.save(input);
}

/** 加载 Creator 可编辑的规范技能文档。 */
export function loadSkillDoc(
  target: WorkspaceProviderTarget,
  skillId: SkillId,
): Promise<SkillDocument> {
  return requireRpc().creator.load({ ...target, skillId });
}

/** 按 caller 已加载文档的 revision 删除技能（stale revision 由 daemon 拒绝）。 */
export async function removeSkill(input: {
  target: WorkspaceProviderTarget;
  skillId: SkillId;
  expectedRevision: string;
}): Promise<void> {
  await requireRpc().creator.remove({
    workspaceId: input.target.workspaceId,
    providerId: input.target.providerId,
    skillId: input.skillId,
    expectedRevision: input.expectedRevision,
  });
}
