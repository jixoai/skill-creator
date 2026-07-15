/**
 * 原始需求 [2026-07-14]：「我们还需要一个 `/repository/`，来支持远程仓库预览 skills 并安装 它们」。
 * 正交意图：
 * 1. 将扫描会话固定到不可变 Git commit。
 * 2. 以不透明 ID 标识发现的技能。
 * 3. 无损表达安装与 dry-run 结果。
 */
import { z } from "zod";
import { ImportedWorkspaceIdSchema } from "./workspaces.js";

/** 固定仓库扫描快照的、不透明会话 ID。 */
export const RepositorySessionIdSchema = z
  .string()
  .regex(/^repo_[a-f0-9]{24}$/)
  .brand<"RepositorySessionId">();
/** 固定仓库扫描快照的不透明会话 ID。 */
export type RepositorySessionId = z.infer<typeof RepositorySessionIdSchema>;
/** 扫描会话内的、不透明远程技能 ID。 */
export const RemoteSkillIdSchema = z
  .string()
  .regex(/^rsk_[a-f0-9]{24}$/)
  .brand<"RemoteSkillId">();
/** 固定仓库扫描会话内的远程技能 ID。 */
export type RemoteSkillId = z.infer<typeof RemoteSkillIdSchema>;
/** Git 返回并经运行时收窄的完整 commit identity。 */
export const PinnedCommitSchema = z.string().regex(/^[a-f0-9]{40,64}$/);

/** 仓库扫描发现的技能摘要。 */
export const RemoteSkillSchema = z.object({
  id: RemoteSkillIdSchema,
  name: z.string(),
  description: z.string(),
  relativePath: z.string(),
  installable: z.boolean(),
  issues: z.array(z.string()),
});
/** 仓库扫描发现的技能摘要。 */
export type RemoteSkill = z.infer<typeof RemoteSkillSchema>;

/** 固定 commit 的仓库扫描结果。 */
export const RemoteRepoScanSchema = z.object({
  sessionId: RepositorySessionIdSchema,
  source: z.string(),
  title: z.string(),
  commit: PinnedCommitSchema,
  skills: z.array(RemoteSkillSchema),
});
/** 固定 commit 的仓库扫描结果。 */
export type RemoteRepoScan = z.infer<typeof RemoteRepoScanSchema>;

/** 单个远程技能的可审阅内容。 */
export const RemoteSkillPreviewSchema = z.object({
  sessionId: RepositorySessionIdSchema,
  skill: RemoteSkillSchema,
  content: z.string(),
});
/** 单个远程技能的可审阅内容。 */
export type RemoteSkillPreview = z.infer<typeof RemoteSkillPreviewSchema>;

/** 单个技能安装结果项。 */
export const InstallResultEntrySchema = z.object({
  skill: z.string(),
  destination: z.string(),
  path: z.string(),
  status: z.enum(["installed", "skipped", "overwritten", "failed"]),
  error: z.string().optional(),
});

/** 实际安装操作的聚合结果。 */
export const InstallSummarySchema = z.object({
  kind: z.literal("result"),
  results: z.array(InstallResultEntrySchema),
  installed: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  overwritten: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
});
/** 实际安装操作的聚合结果。 */
export type InstallSummary = z.infer<typeof InstallSummarySchema>;

/** dry-run 生成的目标路径预览。 */
export const InstallPreviewSchema = z.object({
  kind: z.literal("preview"),
  skills: z.array(z.object({ name: z.string(), description: z.string() })),
  destinations: z.array(z.object({ path: z.string(), exists: z.boolean() })),
  totalInstalls: z.number().int().nonnegative(),
});
/** dry-run 生成的目标路径预览。 */
export type InstallPreview = z.infer<typeof InstallPreviewSchema>;

/** 安装或 dry-run 的判别联合结果。 */
export const InstallResultSchema = z.discriminatedUnion("kind", [
  InstallSummarySchema,
  InstallPreviewSchema,
]);
/** 安装或 dry-run 的判别联合结果。 */
export type InstallResult = z.infer<typeof InstallResultSchema>;

/** 对固定扫描会话执行安装的输入约束。 */
export const RepositoryInstallInputSchema = z.object({
  sessionId: RepositorySessionIdSchema,
  skillIds: z.array(RemoteSkillIdSchema).min(1),
  workspaceId: ImportedWorkspaceIdSchema,
  force: z.boolean().optional(),
  dryRun: z.boolean().optional(),
});
/** 对固定扫描会话执行安装的输入。 */
export type RepositoryInstallInput = z.infer<typeof RepositoryInstallInputSchema>;
