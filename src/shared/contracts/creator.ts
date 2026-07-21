/**
 * 原始需求 [2026-07-22]：「一个 Workspace 下，是可以包含多个 providers 的。」
 * 正交意图：
 * 1. 编辑核心字段时保留未知 frontmatter。
 * 2. 物理区分新建与带 revision 的更新输入。
 * 3. 每次写入后返回规范化文档与校验结果。
 */
import { z } from "zod";
import { SkillIdSchema, ValidateResultSchema } from "./skills.js";
import { WorkspaceProviderTargetSchema } from "./workspaces.js";

/** 技能目录名的运行时约束。 */
export const SkillDirectoryNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers, and hyphens.");

/** 可扩展的 SKILL.md frontmatter 约束。 */
export const SkillFrontmatterSchema = z
  .object({
    name: z.string().trim().min(1),
    description: z.string().trim().min(1),
  })
  .passthrough();
/** 通过运行时 schema 推导的技能 frontmatter。 */
export type SkillFrontmatter = z.infer<typeof SkillFrontmatterSchema>;

/** Creator 加载和保存的完整技能文档。 */
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

/** 新建技能的输入约束。 */
export const CreateSkillInputSchema = z.object({
  mode: z.literal("create"),
  ...WorkspaceProviderTargetSchema.shape,
  directoryName: SkillDirectoryNameSchema,
  frontmatter: SkillFrontmatterSchema,
  body: z.string(),
});

/** 更新现有技能的 revision-safe 输入约束。 */
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

/** 保存后的规范文档与校验结果。 */
export const SaveSkillResultSchema = z.object({
  created: z.boolean(),
  document: SkillDocumentSchema,
  validation: ValidateResultSchema,
});
/** Creator 保存命令结果。 */
export type SaveSkillResult = z.infer<typeof SaveSkillResultSchema>;
