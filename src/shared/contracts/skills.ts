/**
 * 原始需求 [2026-07-14]：「skills manager 只是路由的一部分(`/workspace/~/`)；我们还需要支持导入 workspace」。
 * 正交意图：
 * 1. 定义服务端持有的稳定技能身份。
 * 2. 运行时校验技能列表与详情。
 * 3. 表达冲突安全的启停和校验结果。
 */
import { z } from "zod";

/** 服务端生成的不透明、不可与普通字符串混用的技能 ID。 */
export const SkillIdSchema = z
  .string()
  .regex(/^sk_[a-f0-9]{24}$/)
  .brand<"SkillId">();
/** 服务端生成的不透明技能 ID。 */
export type SkillId = z.infer<typeof SkillIdSchema>;

/** 技能来源位置的有限集合。 */
export const SkillLocationSchema = z.enum(["user", "project", "plugin"]);

/** 插件技能附带的来源元数据。 */
export const PluginInfoSchema = z.object({
  pluginName: z.string(),
  marketplace: z.string(),
  version: z.string(),
});

/** 技能安装来源的判别标签；缺失按 `unknown` 兜底。 */
export const SkillInstalledViaSchema = z.enum(["skills-cli", "manual", "unknown"]);

/** 技能列表项的运行时约束。 */
export const SkillMetadataSchema = z.object({
  id: SkillIdSchema,
  name: z.string(),
  description: z.string(),
  directoryName: z.string(),
  disabled: z.boolean(),
  provider: z.string(),
  location: SkillLocationSchema,
  sourcePriority: z.number().optional(),
  sourceKind: z.string().optional(),
  path: z.string(),
  hasReferences: z.boolean(),
  hasScripts: z.boolean(),
  hasAssets: z.boolean(),
  pluginInfo: PluginInfoSchema.nullable(),
  /**
   * 安装来源 provenance 标签（可选）。
   * daemon `skills.list` 投影时设置；老 daemon 缺省为 `unknown`。
   */
  installedVia: SkillInstalledViaSchema.optional(),
  /**
   * 是否存在可用的 skills-CLI lock 条目、可被 update-check/apply 处理（可选）。
   * daemon `skills.list` 投影时设置；老 daemon 缺省为 `false`。
   */
  updatable: z.boolean().optional(),
});
/** 技能列表项。 */
export type SkillMetadata = z.infer<typeof SkillMetadataSchema>;

/** 包含正文与 revision 的技能详情。 */
export const SkillInfoSchema = SkillMetadataSchema.extend({
  size: z.number().int().nonnegative(),
  content: z.string(),
  revision: z.string().regex(/^sha256:[a-f0-9]{64}$/),
});
/** 包含正文与 revision 的技能详情。 */
export type SkillInfo = z.infer<typeof SkillInfoSchema>;

/** 单个技能启停操作的结果项。 */
export const ToggleResultEntrySchema = z.object({
  skillId: SkillIdSchema,
  name: z.string(),
  status: z.enum(["enabled", "disabled", "skipped", "conflict", "failed"]),
  error: z.string().optional(),
});

/** 批量启停操作的聚合结果。 */
export const ToggleSummarySchema = z.object({
  mode: z.enum(["enable", "disable"]),
  results: z.array(ToggleResultEntrySchema),
  succeeded: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  conflicts: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
});
/** 批量启停操作的聚合结果。 */
export type ToggleSummary = z.infer<typeof ToggleSummarySchema>;

/** 单个技能校验结果的运行时约束。 */
export const ValidateResultSchema = z.object({
  skillId: SkillIdSchema,
  name: z.string(),
  success: z.boolean(),
  errors: z.array(z.string()),
  warnings: z.array(z.string()),
});
/** 单个技能的错误与警告集合。 */
export type ValidateResult = z.infer<typeof ValidateResultSchema>;
