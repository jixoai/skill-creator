/**
 * 原始需求 [2026-07-22]：「下载到某个 Workspace.provider；另外这里应该要能多选。」
 * 正交意图：
 * 1. 将扫描会话固定到不可变 Git commit。
 * 2. 以不透明 ID 标识发现的技能。
 * 3. 无损表达带本地技能身份的安装结果与 dry-run 结果。
 */
import { z } from "zod";
import { SkillIdSchema } from "./skills.js";
import { WorkspaceProviderTargetSchema } from "./workspaces.js";

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

const InstallResultEntryBaseSchema = z.object({
  target: WorkspaceProviderTargetSchema,
  skill: z.string(),
  destination: z.string(),
  path: z.string(),
});

/** 单个技能安装结果项；只有实际落盘的技能拥有本地 Skill ID。 */
export const InstallResultEntrySchema = z.discriminatedUnion("status", [
  InstallResultEntryBaseSchema.extend({
    status: z.literal("installed"),
    skillId: SkillIdSchema,
  }),
  InstallResultEntryBaseSchema.extend({
    status: z.literal("overwritten"),
    skillId: SkillIdSchema,
  }),
  InstallResultEntryBaseSchema.extend({
    status: z.literal("skipped"),
    error: z.string().optional(),
  }),
  InstallResultEntryBaseSchema.extend({
    status: z.literal("failed"),
    error: z.string().optional(),
  }),
]);
/** 单个技能安装结果项。 */
export type InstallResultEntry = z.infer<typeof InstallResultEntrySchema>;

/** 实际安装操作的聚合结果。 */
export const InstallSummarySchema = z.object({
  kind: z.literal("result"),
  targets: z.array(WorkspaceProviderTargetSchema).min(1),
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
  destinations: z.array(
    z.object({ target: WorkspaceProviderTargetSchema, path: z.string(), exists: z.boolean() }),
  ),
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
  targets: z
    .array(WorkspaceProviderTargetSchema)
    .min(1)
    .superRefine((targets, context) => {
      const seen = new Set<string>();
      for (const [index, target] of targets.entries()) {
        const key = `${target.workspaceId}:${target.providerId}`;
        if (seen.has(key)) {
          context.addIssue({
            code: "custom",
            message: "Install targets must be unique.",
            path: [index],
          });
        }
        seen.add(key);
      }
    }),
  force: z.boolean().optional(),
  dryRun: z.boolean().optional(),
});
/** 对固定扫描会话执行安装的输入。 */
export type RepositoryInstallInput = z.infer<typeof RepositoryInstallInputSchema>;

/**
 * 原始需求 [2026-07-27]：「把 Repository 改造成 Discover 体验：内置精选源目录 + 用户自定义源持久化。」
 * 正交意图：
 *   [1] 用户自定义源 ID 与 curated id 命名空间隔离（`user_` 前缀）。
 *   [2] 用户源 gitUrl 仅 https、长度受限，外部输入经 Zod 严格校验。
 *   [3] `sources.json` schema 版本化，破坏性更新按空值加载。
 */

/** 用户自定义源稳定 ID；以 `user_` 前缀与 curated 命名空间隔离。 */
export const UserSourceIdSchema = z
  .string()
  .regex(/^user_[a-z0-9]{1,64}$/)
  .brand<"UserSourceId">();
/** 用户自定义源稳定 ID。 */
export type UserSourceId = z.infer<typeof UserSourceIdSchema>;

/** 仅 https、长度受限的 Git URL 形态。 */
const HttpsGitUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .refine((value) => value.startsWith("https://"), "Git URL must use the https scheme.")
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && url.hostname.length > 0;
    } catch {
      return false;
    }
  }, "Git URL must be a valid https URL.");

/** 一条用户自定义技能仓库源。 */
export const UserSourceSchema = z.object({
  id: UserSourceIdSchema,
  label: z.string().trim().min(1).max(120),
  gitUrl: HttpsGitUrlSchema,
  description: z.string().trim().max(400).default(""),
  addedAt: z.string().datetime(),
});
/** 一条用户自定义技能仓库源。 */
export type UserSource = z.infer<typeof UserSourceSchema>;

/** `sources.json` 落盘结构（schema 版本化，破坏性更新按空值加载）。 */
export const SourcesFileSchema = z.object({
  version: z.literal(1),
  sources: z.array(UserSourceSchema).default([]),
});
/** `sources.json` 落盘结构。 */
export type SourcesFile = z.infer<typeof SourcesFileSchema>;

/** 增加用户自定义源的输入约束。 */
export const AddUserSourceInputSchema = z.object({
  label: z.string().trim().min(1).max(120),
  gitUrl: HttpsGitUrlSchema,
  description: z.string().trim().max(400).optional(),
});
/** 增加用户自定义源的输入。 */
export type AddUserSourceInput = z.infer<typeof AddUserSourceInputSchema>;

/** 移除用户自定义源的输入约束。 */
export const RemoveUserSourceInputSchema = z.object({ id: UserSourceIdSchema });
/** 移除用户自定义源的输入。 */
