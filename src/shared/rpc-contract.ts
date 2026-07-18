/**
 * Browser-safe oRPC contract composition.
 *
 * User intent [2026-07-14]: CLI, daemon, and WebUI share one runtime-validated
 * protocol while workspace, creator, and repository remain orthogonal modules.
 * 用户原始需求 [2026-07-14]：「引入各种各样的功能（保持模块化、正交）」。
 * Orthogonal intents:
 *   [1] Compose browser-safe workspace, skill, Creator, and repository procedures.
 *   [2] Apply one finite, strongly typed business-error vocabulary.
 */
import { eventIterator, oc } from "@orpc/contract";
import { z } from "zod";
import {
  SaveSkillInputSchema,
  SaveSkillResultSchema,
  SkillDocumentSchema,
} from "./contracts/creator.js";
import { DaemonStatusSchema } from "./contracts/daemon.js";
import { RpcErrorDefinitions } from "./contracts/errors.js";
import {
  RemoteRepoScanSchema,
  RemoteSkillPreviewSchema,
  RepositoryInstallInputSchema,
  InstallResultSchema,
  RepositorySessionIdSchema,
  RemoteSkillIdSchema,
} from "./contracts/repository.js";
import {
  SkillIdSchema,
  SkillInfoSchema,
  SkillMetadataSchema,
  ToggleSummarySchema,
  ValidateResultSchema,
} from "./contracts/skills.js";
import { OkResponseSchema, PreferencesSchema, TrayPinFrameSchema } from "./contracts/tray.js";
import {
  ImportedWorkspaceIdSchema,
  WorkspaceIdSchema,
  WorkspaceSchema,
} from "./contracts/workspaces.js";

const WorkspaceReadInputSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  includeDisabled: z.boolean().optional(),
});

/**
 * daemon → WebUI 的单向投影帧。
 *
 * [1] `hello`：连接首帧，标记本协议需要 token 鉴权。
 * [2] `pin`：tray 窗口的操作可见性真相 + 自动隐藏意图；页面据此驱动退出动画。
 * [3] `preferences`：keep-onTop 偏好的当前快照；标题栏 pin 与原生自动隐藏共用。
 */
export const WsServerMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("hello") }),
  z.object({ type: z.literal("pin") }).extend(TrayPinFrameSchema.shape),
  z.object({ type: z.literal("preferences") }).extend({ preferences: PreferencesSchema }),
]);
export type WsServerMessage = z.infer<typeof WsServerMessageSchema>;

const TrayRouteChangedInputSchema = z.object({
  pathname: z.string().startsWith("/").max(2_048),
});

/** Complete browser-safe contract shared by the WebUI and daemon. */
export const rpcContract = oc.errors(RpcErrorDefinitions).router({
  skills: {
    /** Discover skills within one explicit workspace. */
    list: oc
      .input(WorkspaceReadInputSchema)
      .output(z.object({ skills: z.array(SkillMetadataSchema) })),
    /** Read one workspace-scoped skill document. */
    info: oc
      .input(WorkspaceReadInputSchema.extend({ skillId: SkillIdSchema }))
      .output(SkillInfoSchema),
    /** Enable or disable selected opaque skill IDs. */
    toggle: oc
      .input(
        z.object({
          workspaceId: WorkspaceIdSchema,
          skillIds: z.array(SkillIdSchema).min(1),
          mode: z.enum(["enable", "disable"]),
        }),
      )
      .output(ToggleSummarySchema),
    /** Validate one workspace-scoped skill. */
    validate: oc
      .input(z.object({ workspaceId: WorkspaceIdSchema, skillId: SkillIdSchema }))
      .output(ValidateResultSchema),
  },
  workspace: {
    /** List home and imported workspaces with fresh counts. */
    list: oc.input(z.object({})).output(z.object({ workspaces: z.array(WorkspaceSchema) })),
    /** Import a canonical directory workspace. */
    add: oc
      .input(
        z.object({ path: z.string().trim().min(1), label: z.string().trim().min(1).optional() }),
      )
      .output(z.object({ workspace: WorkspaceSchema })),
    /** Remove an imported workspace registration. */
    remove: oc
      .input(z.object({ id: ImportedWorkspaceIdSchema }))
      .output(z.object({ activeId: WorkspaceIdSchema })),
    /** Select the active workspace. */
    setActive: oc
      .input(z.object({ id: WorkspaceIdSchema }))
      .output(z.object({ activeId: WorkspaceIdSchema })),
  },
  creator: {
    /** Create or revision-check and update a skill. */
    save: oc.input(SaveSkillInputSchema).output(SaveSkillResultSchema),
    /** Load an editable skill document. */
    load: oc
      .input(z.object({ workspaceId: ImportedWorkspaceIdSchema, skillId: SkillIdSchema }))
      .output(SkillDocumentSchema),
    /** Revision-check and delete one skill. */
    remove: oc
      .input(
        z.object({
          workspaceId: ImportedWorkspaceIdSchema,
          skillId: SkillIdSchema,
          expectedRevision: z.string().regex(/^sha256:[a-f0-9]{64}$/),
        }),
      )
      .output(z.object({ removed: z.literal(true) })),
  },
  repository: {
    /** Clone, pin, and scan a repository source. */
    scan: oc
      .input(
        z.object({ source: z.string().trim().min(1), ref: z.string().trim().min(1).optional() }),
      )
      .output(RemoteRepoScanSchema),
    /** Preview one skill from a pinned repository session. */
    preview: oc
      .input(z.object({ sessionId: RepositorySessionIdSchema, skillId: RemoteSkillIdSchema }))
      .output(RemoteSkillPreviewSchema),
    /** Preview or install selected remote skills. */
    install: oc.input(RepositoryInstallInputSchema).output(InstallResultSchema),
  },
  daemon: {
    /** Read the live daemon and tray status. */
    status: oc.input(z.object({})).output(DaemonStatusSchema),
  },
  tray: {
    /** Complete the page-owned exit animation only while auto-close is still authorized. */
    completeAutoClose: oc.input(z.object({})).output(OkResponseSchema),
    /** Report the WebUI route that currently owns the tray window surface. */
    routeChanged: oc.input(TrayRouteChangedInputSchema).output(OkResponseSchema),
  },
  preferences: {
    /** Single write path for app-wide preferences (keep-onTop pin). */
    set: oc.input(z.object({ patch: PreferencesSchema.partial() })).output(OkResponseSchema),
  },
  state: {
    /** Subscribe to daemon→WebUI projection frames (pin / preferences / hello). */
    subscribe: oc.input(z.object({})).output(eventIterator(WsServerMessageSchema)),
  },
});

/** Static contract shape used to derive strongly typed clients. */
export type RpcContract = typeof rpcContract;
