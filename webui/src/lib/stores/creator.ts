/**
 * 原始需求 [2026-07-14]：「我们还需要有一个 创造、编辑 技能的路由(/creator)。二者是有机互联的」。
 * 修订 [2026-10-09]（creator-skill-store 批 2）：new 模式创建与 store 编辑直连
 * creatorStore.*（auto-apply 收据/revision 契约原样透传，webui 不落第二份类型）。
 * 正交意图：
 * 1. 封装 Creator 的保存与加载命令。
 * 2. 以文档 revision 约束删除操作。
 * 3. 封装 origin store 的创建/读取/保存命令（typed result，业务失败不吞）。
 */
import type {
  CreatorStoreCreateInput,
  CreatorStoreCreateResult,
  CreatorStoreDocument,
  CreatorStoreSaveInput,
  CreatorStoreSaveResult,
  SaveSkillInput,
  SaveSkillResult,
  SkillDocument,
  SkillDirectoryName,
  SkillId,
  WorkspaceProviderTarget,
} from "../types";
import { requireRpc } from "./connection.svelte";

/**
 * 在显式 workspace 中新建或 revision-safe 更新技能。
 * WS5 走查 B（阻塞根因链）：async 化——`requireRpc()` 断线时抛出的是 rejected
 * promise 而非同步异常。同步异常若从 `$effect` 内裸调用逃逸，会打断 Svelte 的
 * 挂载 flush 并把整个 creator 渲染分支 discard 成僵尸 DOM（tab/高亮/按钮全冻结）。
 */
export async function saveSkill(input: SaveSkillInput): Promise<SaveSkillResult> {
  return requireRpc().creator.save(input);
}

/** 加载 Creator 可编辑的规范技能文档（async 化理由同 saveSkill）。 */
export async function loadSkillDoc(
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

/**
 * origin store 新建（唯一创建入口；auto-apply 收据随结果返回——成功/失败由调用
 * 方如实呈现，本包装不吞 typed result）。
 */
export async function createStoreSkill(
  input: CreatorStoreCreateInput,
): Promise<CreatorStoreCreateResult> {
  return requireRpc().creatorStore.create(input);
}

/** 读一份 store 文档（store 编辑页 body/revision 面；缺席由 daemon typed 拒绝）。 */
export async function loadStoreSkillDoc(
  directoryName: SkillDirectoryName,
): Promise<CreatorStoreDocument> {
  return requireRpc().creatorStore.load({ directoryName });
}

/** store 编辑保存（revision-safe；CONFLICT 由调用方按 revision 契约呈现）。 */
export async function saveStoreSkill(
  input: CreatorStoreSaveInput,
): Promise<CreatorStoreSaveResult> {
  return requireRpc().creatorStore.save(input);
}
