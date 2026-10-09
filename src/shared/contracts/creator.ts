/**
 * 原始需求 [2026-07-22]：「一个 Workspace 下，是可以包含多个 providers 的。」
 * 原始需求 [2026-10-09]（creator-skill-store）：「创建与应用分离——new 模式全部落
 * `<homeDir>/creator-skills` 唯一根源；应用走 ccski 两阶段。」
 * 正交意图：
 * 1. 编辑核心字段时保留未知 frontmatter（原语定义已下移 creator-store.ts，
 *    此处 re-export 保持既有导入面）。
 * 2. 物理区分「store 新建」与「provider-scoped 带 revision 的更新」输入。
 * 3. 每次写入后返回规范化文档与校验结果（create 分支 = store 文档 + auto-apply
 *    收据；update 分支 = provider 文档，契约零变化）。
 */
import { z } from "zod";
import {
  CreatorStoreApplyResultSchema,
  CreatorStoreCreateInputSchema,
  CreatorStoreDocumentSchema,
  SkillDirectoryNameSchema,
  SkillFrontmatterSchema,
} from "./creator-store.js";
import { SkillIdSchema, ValidateResultSchema } from "./skills.js";
import { WorkspaceProviderTargetSchema } from "./workspaces.js";

/** 技能目录名的运行时约束（定义在 creator-store；re-export 保持导入面）。 */
export { SkillDirectoryNameSchema, SkillFrontmatterSchema };
/** 通过运行时 schema 推导的技能 frontmatter。 */
export type SkillFrontmatter = z.infer<typeof SkillFrontmatterSchema>;

/** Creator 加载和保存的完整 provider-scoped 技能文档（edit 模式）。 */
export const SkillDocumentSchema = z.object({
  skillId: SkillIdSchema,
  ...WorkspaceProviderTargetSchema.shape,
  directoryName: SkillDirectoryNameSchema,
  frontmatter: SkillFrontmatterSchema,
  body: z.string(),
  revision: z.string().regex(/^sha256:[a-f0-9]{64}$/),
});
/** 带 workspace 身份与 revision 的技能文档。 */
export type SkillDocument = z.infer<typeof SkillDocumentSchema>;

/** 新建技能的输入约束（creator-skill-store：无 workspace/provider 身份，落 store）。 */
export const CreateSkillInputSchema = CreatorStoreCreateInputSchema.extend({
  mode: z.literal("create"),
});

/** 更新现有技能的 revision-safe 输入约束（已安装技能的 edit 模式，契约不动）。 */
export const UpdateSkillInputSchema = z.object({
  mode: z.literal("update"),
  ...WorkspaceProviderTargetSchema.shape,
  skillId: SkillIdSchema,
  expectedRevision: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  frontmatter: SkillFrontmatterSchema,
  body: z.string(),
});

/** Creator 保存命令的判别联合。 */
export const SaveSkillInputSchema = z.discriminatedUnion("mode", [
  CreateSkillInputSchema,
  UpdateSkillInputSchema,
]);
/** Creator 保存命令输入。 */
export type SaveSkillInput = z.infer<typeof SaveSkillInputSchema>;

/**
 * 保存后的规范结果（判别联合）：
 * - created=true：store 新建——store 文档 + 校验 + auto-apply 收据（默认 root =
 *   `~/.agents/skills`，entity-local 形态）。
 * - created=false：provider-scoped revision-safe 更新——SkillDocument + 校验。
 */
export const SaveSkillResultSchema = z.discriminatedUnion("created", [
  z.object({
    created: z.literal(true),
    document: CreatorStoreDocumentSchema,
    validation: ValidateResultSchema,
    autoApply: CreatorStoreApplyResultSchema,
  }),
  z.object({
    created: z.literal(false),
    document: SkillDocumentSchema,
    validation: ValidateResultSchema,
  }),
]);
/** Creator 保存命令结果。 */
export type SaveSkillResult = z.infer<typeof SaveSkillResultSchema>;

// ---------------------------------------------------------------------------
// Revision 历史（change 5：变更日志子视图）
// ---------------------------------------------------------------------------

/** creator.revisions 输入约束。 */
export const CreatorRevisionsInputSchema = z.object({
  ...WorkspaceProviderTargetSchema.shape,
  skillId: SkillIdSchema,
  /** 返回最近 N 条完整正文（含 diff）；默认 20。 */
  limit: z.number().int().positive().max(100).optional(),
});

/** 单条 revision 历史项。 */
export const CreatorRevisionEntrySchema = z.object({
  /** SHA-256 content hash。 */
  revision: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  /** 保存时间戳（ms since epoch）。 */
  timestamp: z.number().int().nonnegative(),
  /** 与前一条的 unified diff（仅当可用时；最早一条为 null）。 */
  diff: z.string().nullable(),
  /** 完整正文快照（仅最近 N 条持久化，更早的为 null）。 */
  content: z.string().nullable(),
});
/** 单条 revision 历史项。 */
export type CreatorRevisionEntry = z.infer<typeof CreatorRevisionEntrySchema>;

/** creator.revisions 输出约束。 */
export const CreatorRevisionsResultSchema = z.object({
  revisions: z.array(CreatorRevisionEntrySchema),
});
/** creator.revisions 输出。 */
