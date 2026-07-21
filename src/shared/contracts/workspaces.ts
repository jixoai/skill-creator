/**
 * 原始需求 [2026-07-22]：「home 目录定义为特殊的 GlobalWorkspace；一个 Workspace 下可以包含多个 providers。」
 * 正交意图：
 * 1. 为 home 支持的 Agent roots 定义 Global Workspace。
 * 2. 将所有 skills 作用域收窄到 Workspace Provider 对。
 * 3. 向 UI 投影 Provider 的目录、可用性、可写性与技能数。
 */
import { z } from "zod";

/** Global Workspace 的特殊 ID。 */
export const GLOBAL_WORKSPACE_ID = "~" as const;
/** 受目录 catalog 约束的 Provider ID。具体成员由 daemon 解析。 */
export const ProviderIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]*$/)
  .brand<"ProviderId">();
/** 运行时校验后的 Provider ID。 */
export type ProviderId = z.infer<typeof ProviderIdSchema>;
/** 导入 workspace 的不透明、不可与普通字符串混用的 ID 约束。 */
export const ImportedWorkspaceIdSchema = z
  .string()
  .regex(/^ws_[a-f0-9]{24}$/)
  .brand<"ImportedWorkspaceId">();
/** 导入 workspace 的不透明 ID。 */
export type ImportedWorkspaceId = z.infer<typeof ImportedWorkspaceIdSchema>;
/** Global 与导入 Workspace 的联合 ID 约束。 */
export const WorkspaceIdSchema = z.union([
  z.literal(GLOBAL_WORKSPACE_ID),
  ImportedWorkspaceIdSchema,
]);
/** 可在路由与 RPC 中传递的 workspace ID。 */
export type WorkspaceId = z.infer<typeof WorkspaceIdSchema>;

/** Workspace 内一个 Agent Provider 的动态投影。 */
export const WorkspaceProviderSchema = z.object({
  id: ProviderIdSchema,
  label: z.string().min(1),
  path: z.string().min(1).nullable(),
  available: z.boolean(),
  writable: z.boolean(),
  skillCount: z.number().int().nonnegative(),
});
/** Workspace 内一个 Agent Provider 的动态投影。 */
export type WorkspaceProvider = z.infer<typeof WorkspaceProviderSchema>;

/** 所有跨进程 skills 操作必须使用的两层作用域。 */
export const WorkspaceProviderTargetSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  providerId: ProviderIdSchema,
});
/** 已验证的 Workspace Provider 作用域。 */
export type WorkspaceProviderTarget = z.infer<typeof WorkspaceProviderTargetSchema>;

const WorkspaceProjectionSchema = z.object({
  label: z.string().min(1),
  active: z.boolean(),
  available: z.boolean(),
  skillCount: z.number().int().nonnegative(),
  providers: z.array(WorkspaceProviderSchema),
});

/** workspace 导航投影的运行时约束，按 kind 保持路径与 ID 的关联。 */
export const WorkspaceSchema = z.discriminatedUnion("kind", [
  WorkspaceProjectionSchema.extend({
    id: z.literal(GLOBAL_WORKSPACE_ID),
    kind: z.literal("global"),
    path: z.null(),
  }),
  WorkspaceProjectionSchema.extend({
    id: ImportedWorkspaceIdSchema,
    kind: z.literal("directory"),
    path: z.string().min(1),
  }),
]);
/** workspace 导航投影。 */
export type Workspace = z.infer<typeof WorkspaceSchema>;
/** home Agent roots 的特殊 workspace 投影。 */
export type GlobalWorkspace = Extract<Workspace, { kind: "global" }>;
/** 可写入的导入 workspace 投影。 */
export type ImportedWorkspace = Extract<Workspace, { kind: "directory" }>;
