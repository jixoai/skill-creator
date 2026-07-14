/**
 * 原始需求 [2026-07-14]：「我们还需要有一个 创造、编辑 技能的路由(/creator)。二者是有机互联的」。
 * 正交意图：
 * 1. 封装 Creator 的保存与加载命令。
 * 2. 以文档 revision 约束删除操作。
 */
import type { SaveSkillInput, SaveSkillResult, SkillDocument, SkillId } from "../types";
import { requireRpc } from "./connection.svelte";

/** 在显式 workspace 中新建或 revision-safe 更新技能。 */
export function saveSkill(input: SaveSkillInput): Promise<SaveSkillResult> {
  return requireRpc().creator.save(input);
}

/** 加载 Creator 可编辑的规范技能文档。 */
export function loadSkillDoc(
  workspaceId: SkillDocument["workspaceId"],
  skillId: SkillId,
): Promise<SkillDocument> {
  return requireRpc().creator.load({ workspaceId, skillId });
}

/** 按已加载文档的 revision 删除技能。 */
export async function removeSkill(document: SkillDocument): Promise<void> {
  await requireRpc().creator.remove({
    workspaceId: document.workspaceId,
    skillId: document.skillId,
    expectedRevision: document.revision,
  });
}
