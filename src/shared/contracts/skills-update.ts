/**
 * skills-CLI 更新能力的输入/输出契约（skills.update.check / skills.update.apply）。
 *
 * 用户原始需求 [2026-07-27]：「读取 lock 文件、对比上游 hash、按需重装并刷新 lock 条目。」
 * 正交意图：
 *   [1] 表达 update-check 的输入与逐技能状态结果。
 *   [2] 表达 apply-update 的输入与逐技能重装结果。
 * 妥协声明：update-check 的 `status` 与 apply 的 `status` 是两套判别联合，分别提示「可重试 / 暂时不可检查 / 已最新」等不同语义，不合并以让 UI 分别提示。
 */
import { z } from "zod";
import { SkillIdSchema } from "./skills.js";
import { WorkspaceProviderTargetSchema } from "./workspaces.js";

/** update-check 的输入：作用域 + 可选的待检查技能 ID 集合；缺省检查全部 skills-CLI 来源技能。 */
export const UpdateCheckInputSchema = z.object({
  ...WorkspaceProviderTargetSchema.shape,
  /** 仅检查这些技能；缺省检查当前作用域下所有 skills-CLI 来源技能。 */
  skillIds: z.array(SkillIdSchema).optional(),
});
/** update-check 的输入。 */
export type UpdateCheckInput = z.infer<typeof UpdateCheckInputSchema>;

/** update-check 单个技能的判别状态。 */
export const UpdateCheckStatusSchema = z.enum([
  /** hash 改变，待升级。 */
  "updated",
  /** hash 相等，已是最新。 */
  "already-current",
  /** 检查过程出错（如克隆失败）。 */
  "failed",
  /** 上游不可达（如限流 / 无网络）。 */
  "unavailable",
]);

/** update-check 单条结果。 */
export const UpdateCheckResultEntrySchema = z.object({
  skillId: SkillIdSchema,
  /** 技能显示名。 */
  name: z.string(),
  /** 当前记录的 hash。 */
  currentHash: z.string(),
  /** 上游算出的 hash；`unavailable` 时可为空串。 */
  upstreamHash: z.string(),
  /** 源 URL（用于在 UI 中展示来源）。 */
  source: z.string(),
  status: UpdateCheckStatusSchema,
  /** 失败 / 不可达时的原因（可选）。 */
  error: z.string().optional(),
});
/** update-check 单条结果。 */
export type UpdateCheckResultEntry = z.infer<typeof UpdateCheckResultEntrySchema>;

/** update-check 的输出。 */
export const UpdateCheckResultSchema = z.object({
  results: z.array(UpdateCheckResultEntrySchema),
});
/** update-check 的输出。 */
export type UpdateCheckResult = z.infer<typeof UpdateCheckResultSchema>;

/** apply-update 的输入：作用域 + 待升级的技能 ID 集合。 */
export const ApplyUpdateInputSchema = z.object({
  ...WorkspaceProviderTargetSchema.shape,
  skillIds: z.array(SkillIdSchema).min(1),
});
/** apply-update 的输入。 */
export type ApplyUpdateInput = z.infer<typeof ApplyUpdateInputSchema>;

/** apply-update 单个技能的判别状态。 */
export const ApplyUpdateStatusSchema = z.enum([
  /** 重装成功且 hash 已刷新。 */
  "updated",
  /** 执行前已与上游一致，未实际重装。 */
  "already-current",
  /** 重装或 hash 刷新失败。 */
  "failed",
]);

/** apply-update 单条结果。 */
export const ApplyUpdateResultEntrySchema = z.object({
  skillId: SkillIdSchema,
  name: z.string(),
  status: ApplyUpdateStatusSchema,
  /** 失败原因（可选）。 */
  error: z.string().optional(),
});
/** apply-update 单条结果。 */
export type ApplyUpdateResultEntry = z.infer<typeof ApplyUpdateResultEntrySchema>;

/** apply-update 的输出。 */
export const ApplyUpdateResultSchema = z.object({
  results: z.array(ApplyUpdateResultEntrySchema),
});
/** apply-update 的输出。 */
export type ApplyUpdateResult = z.infer<typeof ApplyUpdateResultSchema>;
