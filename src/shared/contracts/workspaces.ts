/**
 * 原始需求 [2026-07-14]：「skills manager 只是路由的一部分(`/workspace/~/`)；我们还需要支持导入 workspace」。
 * 正交意图：
 * 1. 为 ccski 默认 agent 位置保留 `~`。
 * 2. 以不透明 ID 标识导入目录。
 * 3. 向 UI 投影可用性与当前状态。
 */
import { z } from "zod";

/** ccski 默认 agent 位置的保留 workspace ID。 */
export const HOME_WORKSPACE_ID = "~" as const;
/** 导入 workspace 的不透明、不可与普通字符串混用的 ID 约束。 */
export const ImportedWorkspaceIdSchema = z
  .string()
  .regex(/^ws_[a-f0-9]{24}$/)
  .brand<"ImportedWorkspaceId">();
/** 导入 workspace 的不透明 ID。 */
export type ImportedWorkspaceId = z.infer<typeof ImportedWorkspaceIdSchema>;
/** home 与导入 workspace 的联合 ID 约束。 */
export const WorkspaceIdSchema = z.union([z.literal(HOME_WORKSPACE_ID), ImportedWorkspaceIdSchema]);
/** 可在路由与 RPC 中传递的 workspace ID。 */
export type WorkspaceId = z.infer<typeof WorkspaceIdSchema>;

const WorkspaceProjectionSchema = z.object({
  label: z.string().min(1),
  active: z.boolean(),
  available: z.boolean(),
  skillCount: z.number().int().nonnegative(),
});

/** workspace 导航投影的运行时约束，按 kind 保持路径与 ID 的关联。 */
export const WorkspaceSchema = z.discriminatedUnion("kind", [
  WorkspaceProjectionSchema.extend({
    id: z.literal(HOME_WORKSPACE_ID),
    kind: z.literal("home"),
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
/** ccski 默认位置的 workspace 投影。 */
export type HomeWorkspace = Extract<Workspace, { kind: "home" }>;
/** 可写入的导入 workspace 投影。 */
export type ImportedWorkspace = Extract<Workspace, { kind: "directory" }>;
