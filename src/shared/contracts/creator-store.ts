/**
 * 用户原始需求 [2026-10-09]（creator-skill-store proposal）：「我们得有一个专门管理
 * 我们创建出来的这些 skills，比如 ~/.skill-creator/creator-skills，然后再通过
 * ccski-sdk 将这些 skill 安装到本地 agent skills 目录（包括 .agents/skills
 * .codex/skills 等）。所以架构上是两个分开的。这样的好处是，我们本地创建的这个
 * 技能，它始终会有一个唯一的根源目录。」
 * 正交意图：
 *   [1] 技能文档原语（directoryName / frontmatter / store 文档形状）——从
 *       creator.ts 物理下移到 store 域（origin store 拥有文档契约；creator.ts
 *       re-export 保持既有导入面不变，避免双向依赖）。
 *   [2] store 身份与状态投影：CreatorStoreSkill（name/description/directoryName/
 *       revision/updatedAt + 可选 appliedRoots/outdated）与 status 的 store hash
 *       对比（computeSkillFolderHash 单源，宿主不落第二实现）。
 *   [3] 内核应用收据契约：apply（逐 target 收据 + entity 阶段）、sync（updateEntity
 *       逐 root 收据 + degradedProjectionState fail-closed 透传）、uninstall
 *       （逐 scope 收据 + 末投影 GC 结果）、delete-origin（剩余应用面如实列出）。
 * 妥协声明：收据 code token 携带 ccski 冻结词表码（GUARD_PROJECTION 等），解释
 * 文案由 daemon 有限词表生成——契约只承诺 token 形状，不透传内核 message。
 */
import { z } from "zod";
import { SkillIdSchema, ValidateResultSchema } from "./skills.js";
import { ImportedWorkspaceIdSchema, WorkspaceProviderTargetSchema } from "./workspaces.js";

// ---------------------------------------------------------------------------
// [1] 技能文档原语（自 creator.ts 下移；creator.ts re-export 保持导入面）
// ---------------------------------------------------------------------------

/** 技能目录名的运行时约束。 */
export const SkillDirectoryNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers, and hyphens.");
/** 运行时校验后的技能目录名。 */
export type SkillDirectoryName = z.infer<typeof SkillDirectoryNameSchema>;

/** 可扩展的 SKILL.md frontmatter 约束。 */
export const SkillFrontmatterSchema = z
  .object({
    name: z.string().trim().min(1),
    description: z.string().trim().min(1),
  })
  .passthrough();
/** 通过运行时 schema 推导的技能 frontmatter。 */
export type SkillFrontmatter = z.infer<typeof SkillFrontmatterSchema>;

/**
 * creator store 文档（无 workspace/provider 归属）：身份 = store 目录 canonical
 * path 的 opaque 摘要（与发现层 sk_ id 同一构造法则）；revision = SKILL.md 内容
 * sha256（现行 creator 文档契约）。
 */
export const CreatorStoreDocumentSchema = z.object({
  skillId: SkillIdSchema,
  directoryName: SkillDirectoryNameSchema,
  frontmatter: SkillFrontmatterSchema,
  body: z.string(),
  revision: z.string().regex(/^sha256:[a-f0-9]{64}$/),
});
/** creator store 内的可编辑技能文档。 */
export type CreatorStoreDocument = z.infer<typeof CreatorStoreDocumentSchema>;

// ---------------------------------------------------------------------------
// [2] store 身份与状态投影
// ---------------------------------------------------------------------------

/**
 * 一处已应用面（一个 scope 的内核实体 + 其投影根）：entityRevision 是 state 实体
 * 记录的 64-hex folder hash；roots 含 entity-local 实体库根（实体目录在场时）与
 * 全部注册投影根。
 */
export const CreatorStoreApplicationSchema = z.object({
  scope: z.enum(["global", "project"]),
  /** project 应用携带归属的 Imported Workspace；global 缺省。 */
  workspaceId: ImportedWorkspaceIdSchema.optional(),
  entityRevision: z.string().regex(/^[a-f0-9]{64}$/),
  roots: z.array(z.string().min(1)),
});
/** 一处已应用面。 */
export type CreatorStoreApplication = z.infer<typeof CreatorStoreApplicationSchema>;

/** creator store 技能行（list 无状态字段；status 填充 appliedRoots/outdated）。 */
export const CreatorStoreSkillSchema = z.object({
  skillId: SkillIdSchema,
  name: z.string().min(1),
  description: z.string().min(1),
  directoryName: SkillDirectoryNameSchema,
  revision: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  /** SKILL.md mtime（ms since epoch）。 */
  updatedAt: z.number().int().nonnegative(),
  appliedRoots: z.array(CreatorStoreApplicationSchema).optional(),
  /** 任一已应用实体 hash ≠ store hash（status 面填充）。 */
  outdated: z.boolean().optional(),
});
/** creator store 技能行。 */
export type CreatorStoreSkill = z.infer<typeof CreatorStoreSkillSchema>;

/** creatorStore.list 输出（不兼容条目跳过计数，不硬失败）。 */
export const CreatorStoreListResultSchema = z.object({
  skills: z.array(CreatorStoreSkillSchema),
  skipped: z.number().int().nonnegative(),
});
/** creator store 技能列表。 */
export type CreatorStoreListResult = z.infer<typeof CreatorStoreListResultSchema>;

/** creatorStore.load 输入（store 编辑页的文档读取面；身份 = directoryName）。 */
export const CreatorStoreLoadInputSchema = z.object({
  directoryName: SkillDirectoryNameSchema,
});
/** creator store 文档读取输入。 */
export type CreatorStoreLoadInput = z.infer<typeof CreatorStoreLoadInputSchema>;

/** creatorStore.status 输入。 */
export const CreatorStoreStatusInputSchema = z.object({
  directoryName: SkillDirectoryNameSchema,
});
/** creator store 状态查询输入。 */
export type CreatorStoreStatusInput = z.infer<typeof CreatorStoreStatusInputSchema>;

/** creatorStore.status 输出（appliedRoots/outdated 恒填充）。 */
export const CreatorStoreStatusResultSchema = z.object({
  skill: CreatorStoreSkillSchema,
  /** store 目录的单源 folder hash（与实体 revision 同币种可比）。 */
  storeHash: z.string().regex(/^[a-f0-9]{64}$/),
});
/** creator store 技能状态。 */
export type CreatorStoreStatusResult = z.infer<typeof CreatorStoreStatusResultSchema>;

// ---------------------------------------------------------------------------
// [3] 内核应用收据契约（apply / sync / uninstall / create / save / remove）
// ---------------------------------------------------------------------------

/** creatorStore.create 输入（new 模式；无 workspace/provider 身份）。 */
export const CreatorStoreCreateInputSchema = z.object({
  directoryName: SkillDirectoryNameSchema,
  frontmatter: SkillFrontmatterSchema,
  body: z.string(),
  /** 创建成功后自动应用到默认 root（`~/.agents/skills` entity-local）；缺省 true。 */
  autoApply: z.boolean().optional(),
});
/** creator store 新建输入。 */
export type CreatorStoreCreateInput = z.infer<typeof CreatorStoreCreateInputSchema>;

/** creatorStore.save（store 编辑）输入：revision-safe，与 provider 编辑同契约。 */
export const CreatorStoreSaveInputSchema = z.object({
  directoryName: SkillDirectoryNameSchema,
  expectedRevision: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  frontmatter: SkillFrontmatterSchema,
  body: z.string(),
});
/** creator store 保存输入。 */
export type CreatorStoreSaveInput = z.infer<typeof CreatorStoreSaveInputSchema>;

/** creatorStore.remove（delete-origin）输入：store 文档 revision 闸门。 */
export const CreatorStoreRemoveInputSchema = z.object({
  directoryName: SkillDirectoryNameSchema,
  expectedRevision: z.string().regex(/^sha256:[a-f0-9]{64}$/),
});
/** creator store 删除根源输入。 */
export type CreatorStoreRemoveInput = z.infer<typeof CreatorStoreRemoveInputSchema>;

/** creatorStore.apply 输入：显式 targets（server 解析为投影根，不收调用方路径）。 */
export const CreatorStoreApplyInputSchema = z.object({
  directoryName: SkillDirectoryNameSchema,
  targets: z.array(WorkspaceProviderTargetSchema).min(1),
});
/** creator store 应用输入。 */
export type CreatorStoreApplyInput = z.infer<typeof CreatorStoreApplyInputSchema>;

/**
 * 逐 target 应用收据：mode 来自内核规范化最终形态（含 entity-local）。target
 * 缺席 = server-initiated 默认 root（create 的 auto-apply canonical 条目）。
 */
export const CreatorStoreApplyResultEntrySchema = z.object({
  target: WorkspaceProviderTargetSchema.optional(),
  /** resolve 归一后的投影根。 */
  root: z.string(),
  path: z.string(),
  status: z.enum(["applied", "unchanged", "failed"]),
  mode: z.enum(["link", "materialized", "entity-local"]).optional(),
  /** 该 target 所属 scope 的实体入库阶段（ensureEntity 收据）。 */
  entity: z.enum(["created", "exists", "replaced"]).optional(),
  error: z.string().optional(),
});
/** 逐 target 应用收据。 */
export type CreatorStoreApplyResultEntry = z.infer<typeof CreatorStoreApplyResultEntrySchema>;

/** creatorStore.apply 输出（typed result；逐 target 收据不抛业务错）。 */
export const CreatorStoreApplyResultSchema = z.object({
  kind: z.literal("result"),
  results: z.array(CreatorStoreApplyResultEntrySchema),
  applied: z.number().int().nonnegative(),
  unchanged: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
});
/** creator store 应用结果。 */
export type CreatorStoreApplyResult = z.infer<typeof CreatorStoreApplyResultSchema>;

/** creatorStore.sync 输入（对全部已登记应用面重投影）。 */
export const CreatorStoreSyncInputSchema = z.object({
  directoryName: SkillDirectoryNameSchema,
});

/** 逐 root 同步收据：status/code 对齐 updateEntity 收据词表。 */
export const CreatorStoreSyncResultEntrySchema = z.object({
  scope: z.enum(["global", "project"]),
  workspaceId: ImportedWorkspaceIdSchema.optional(),
  root: z.string(),
  path: z.string(),
  status: z.enum(["updated", "unchanged", "skipped", "failed"]),
  /** ccski 冻结词表码（GUARD_PROJECTION / PINNED / STATE_DEGRADED…）。 */
  code: z.string().optional(),
  detail: z.string().optional(),
});
/** 逐 root 同步收据。 */
export type CreatorStoreSyncResultEntry = z.infer<typeof CreatorStoreSyncResultEntrySchema>;

/** creatorStore.sync 输出（degraded fail-closed 如实透传）。 */
export const CreatorStoreSyncResultSchema = z.object({
  kind: z.literal("result"),
  results: z.array(CreatorStoreSyncResultEntrySchema),
  updated: z.number().int().nonnegative(),
  unchanged: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  /** 任一 scope 的投影记录损坏（无收据 ≠ 未登记；宿主已按 root 保守失败）。 */
  degradedProjectionState: z.boolean(),
});
/** creator store 同步结果。 */
export type CreatorStoreSyncResult = z.infer<typeof CreatorStoreSyncResultSchema>;

/** 卸载的应用面引用（scope 级；缺省 = 全部已登记应用）。 */
export const CreatorStoreScopeRefSchema = z.discriminatedUnion("scope", [
  z.object({ scope: z.literal("global") }),
  z.object({ scope: z.literal("project"), workspaceId: ImportedWorkspaceIdSchema }),
]);
/** 应用面 scope 引用。 */
export type CreatorStoreScopeRef = z.infer<typeof CreatorStoreScopeRefSchema>;

/** creatorStore.uninstall 输入。 */
export const CreatorStoreUninstallInputSchema = z.object({
  directoryName: SkillDirectoryNameSchema,
  scopes: z.array(CreatorStoreScopeRefSchema).optional(),
});
/** creator store 卸载输入。 */
export type CreatorStoreUninstallInput = z.infer<typeof CreatorStoreUninstallInputSchema>;

/** 逐 scope 卸载收据：removed = 投影全摘 + 实体退役；partial = 摘除后被引用阻塞。 */
export const CreatorStoreUninstallResultEntrySchema = z.object({
  scope: z.enum(["global", "project"]),
  workspaceId: ImportedWorkspaceIdSchema.optional(),
  status: z.enum(["removed", "partial", "failed"]),
  /** 内核实体是否已退役（末投影 GC / deleteEntity 完成）。 */
  entityRemoved: z.boolean(),
  detail: z.string().optional(),
  error: z.string().optional(),
});
/** 逐 scope 卸载收据。 */
export type CreatorStoreUninstallResultEntry = z.infer<
  typeof CreatorStoreUninstallResultEntrySchema
>;

/** creatorStore.uninstall 输出。 */
export const CreatorStoreUninstallResultSchema = z.object({
  kind: z.literal("result"),
  results: z.array(CreatorStoreUninstallResultEntrySchema),
  removed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
});
/** creator store 卸载结果。 */
export type CreatorStoreUninstallResult = z.infer<typeof CreatorStoreUninstallResultSchema>;

/** creatorStore.create 输出（autoApply 收据如实并入；关闭时为零条目结果）。 */
export const CreatorStoreCreateResultSchema = z.object({
  document: CreatorStoreDocumentSchema,
  validation: ValidateResultSchema,
  autoApply: CreatorStoreApplyResultSchema,
});
/** creator store 新建结果。 */
export type CreatorStoreCreateResult = z.infer<typeof CreatorStoreCreateResultSchema>;

/** creatorStore.save 输出。 */
export const CreatorStoreSaveResultSchema = z.object({
  document: CreatorStoreDocumentSchema,
  validation: ValidateResultSchema,
});
/** creator store 保存结果。 */
export type CreatorStoreSaveResult = z.infer<typeof CreatorStoreSaveResultSchema>;

/** creatorStore.remove 输出：删除时仍存在的应用面如实列出（不阻止删除）。 */
export const CreatorStoreRemoveResultSchema = z.object({
  removed: z.literal(true),
  remainingApplications: z.array(CreatorStoreApplicationSchema),
});
/** creator store 删除根源结果。 */
export type CreatorStoreRemoveResult = z.infer<typeof CreatorStoreRemoveResultSchema>;
