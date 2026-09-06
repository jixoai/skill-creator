/**
 * Browser-safe oRPC contract composition.
 *
 * 用户原始需求 [2026-07-19]：「移除目前关于窗口半透明、倒计时关闭的相关前后端代码。」
 * Orthogonal intents:
 *   [1] Compose browser-safe workspace, skill, Creator, and repository procedures.
 *   [2] Apply one finite, strongly typed business-error vocabulary.
 */
import { oc } from "@orpc/contract";
import { z } from "zod";
import {
  AcpAgentInfoSchema,
  AcpSessionCloseInputSchema,
  AcpSessionOpenInputSchema,
  AcpSessionOpenResultSchema,
} from "./contracts/acp.js";
import {
  DshCredentialClearInputSchema,
  DshCredentialSetInputSchema,
  DshCredentialSetResultSchema,
  DshSessionStreamFrameSchema,
  DshSessionStreamsInputSchema,
  DshSettingsUpdateResultSchema,
  DshSettingsUpdateSchema,
  DshStewardSettingsViewSchema,
} from "./contracts/dsh-runtime.js";
import {
  StewardApproveResultSchema,
  StewardBackendsResultSchema,
  StewardCancelInputSchema,
  StewardCancelResultSchema,
  StewardDecidePermissionInputSchema,
  StewardDecidePermissionResultSchema,
  StewardEventsInputSchema,
  StewardEventsResultSchema,
  StewardListResultSchema,
  StewardProposalInputSchema,
  StewardRejectResultSchema,
  StewardStartInputSchema,
  StewardStartResultSchema,
} from "./contracts/agent-steward.js";
import {
  SkillStewardApplyResultSchema,
  SkillStewardApproveResultSchema,
  SkillStewardProposalInputSchema,
  SkillStewardRollbackInputSchema,
  SkillStewardRollbackResultSchema,
  SkillStewardRunInputSchema,
  SkillStewardRunResultSchema,
  SkillValidationResultSchema,
} from "./contracts/skill-steward.js";
import {
  SaveSkillInputSchema,
  SaveSkillResultSchema,
  SkillDocumentSchema,
  CreatorRevisionsInputSchema,
  CreatorRevisionsResultSchema,
} from "./contracts/creator.js";
import { DaemonStatusSchema } from "./contracts/daemon.js";
import { RpcErrorDefinitions } from "./contracts/errors.js";
import {
  AddUserSourceInputSchema,
  RemoveUserSourceInputSchema,
  RemoteRepoScanSchema,
  RemoteSkillPreviewSchema,
  RepositoryInstallInputSchema,
  InstallResultSchema,
  RepositorySessionIdSchema,
  RemoteSkillIdSchema,
  UserSourceSchema,
} from "./contracts/repository.js";
import {
  ApplyUpdateInputSchema,
  ApplyUpdateResultSchema,
  UpdateCheckInputSchema,
  UpdateCheckResultSchema,
} from "./contracts/skills-update.js";
import {
  AnalyzeInputSchema,
  AnalyzeResultSchema,
  ApproveProposalInputSchema,
  ApproveResultSchema,
  ListProposalsResultSchema,
  ProposeInputSchema,
  ProposeResultSchema,
  RejectProposalInputSchema,
  RejectProposalResultSchema,
} from "./contracts/skill-intelligence.js";
import {
  SkillIdSchema,
  SkillInfoSchema,
  SkillMetadataSchema,
  ToggleSummarySchema,
  ValidateResultSchema,
} from "./contracts/skills.js";
import {
  ImportedWorkspaceIdSchema,
  WorkspaceProviderTargetSchema,
  WorkspaceIdSchema,
  WorkspaceSchema,
} from "./contracts/workspaces.js";

const WorkspaceProviderReadInputSchema = z.object({
  ...WorkspaceProviderTargetSchema.shape,
  includeDisabled: z.boolean().optional(),
});

/** Complete browser-safe contract shared by the WebUI and daemon. */
export const rpcContract = oc.errors(RpcErrorDefinitions).router({
  skills: {
    /** Discover skills within one explicit Workspace Provider. */
    list: oc
      .input(WorkspaceProviderReadInputSchema)
      .output(z.object({ skills: z.array(SkillMetadataSchema) })),
    /** Read one Workspace Provider-scoped skill document. */
    info: oc
      .input(WorkspaceProviderReadInputSchema.extend({ skillId: SkillIdSchema }))
      .output(SkillInfoSchema),
    /** Enable or disable selected opaque skill IDs. */
    toggle: oc
      .input(
        z.object({
          ...WorkspaceProviderTargetSchema.shape,
          skillIds: z.array(SkillIdSchema).min(1),
          mode: z.enum(["enable", "disable"]),
        }),
      )
      .output(ToggleSummarySchema),
    /** Validate one Workspace Provider-scoped skill. */
    validate: oc
      .input(z.object({ ...WorkspaceProviderTargetSchema.shape, skillId: SkillIdSchema }))
      .output(ValidateResultSchema),
    update: {
      /** Compare skills-CLI lock hashes against upstream and report outdated skills. */
      check: oc.input(UpdateCheckInputSchema).output(UpdateCheckResultSchema),
      /** Reinstall approved outdated skills via the repository install pipeline. */
      apply: oc.input(ApplyUpdateInputSchema).output(ApplyUpdateResultSchema),
    },
  },
  workspace: {
    /** List Global and imported Workspaces with fresh Provider counts. */
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
      .input(z.object({ ...WorkspaceProviderTargetSchema.shape, skillId: SkillIdSchema }))
      .output(SkillDocumentSchema),
    /** Revision-check and delete one skill. */
    remove: oc
      .input(
        z.object({
          ...WorkspaceProviderTargetSchema.shape,
          skillId: SkillIdSchema,
          expectedRevision: z.string().regex(/^sha256:[a-f0-9]{64}$/),
        }),
      )
      .output(z.object({ removed: z.literal(true) })),
    /** Read revision history for one skill (change 5: change log sub-view). */
    revisions: oc.input(CreatorRevisionsInputSchema).output(CreatorRevisionsResultSchema),
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
    sources: {
      /** List curated (built-in) and user-persisted sources for the Discover grid. */
      list: oc.input(z.object({})).output(
        z.object({
          builtIn: z.array(
            z.object({
              id: z.string(),
              label: z.string(),
              gitUrl: z.string(),
              description: z.string(),
              homepage: z.string().optional(),
            }),
          ),
          user: z.array(UserSourceSchema),
        }),
      ),
      /** Persist a new user source (https git URL only). */
      add: oc.input(AddUserSourceInputSchema).output(z.object({ source: UserSourceSchema })),
      /** Remove one user-persisted source; built-in ids are rejected. */
      remove: oc.input(RemoveUserSourceInputSchema).output(z.object({ removed: z.literal(true) })),
    },
  },
  daemon: {
    /** Read the live daemon and tray status. */
    status: oc.input(z.object({})).output(DaemonStatusSchema),
  },
  skillIntelligence: {
    /** Read-only multi-skill analysis locked to observed revisions. */
    analyze: oc.input(AnalyzeInputSchema).output(AnalyzeResultSchema),
    /** Store a Manager-owned proposal draft; never mutates Providers. */
    propose: oc.input(ProposeInputSchema).output(ProposeResultSchema),
    /** List pending proposal drafts (newest first). */
    list: oc.input(z.object({})).output(ListProposalsResultSchema),
    /** Delete one proposal draft. */
    reject: oc.input(RejectProposalInputSchema).output(RejectProposalResultSchema),
    /** Apply one proposal through existing revision-safe mutations. */
    approve: oc.input(ApproveProposalInputSchema).output(ApproveResultSchema),
  },
  steward: {
    /** Probe every registered backend (typed unavailable; no auto fallback). */
    backends: oc.input(z.object({})).output(StewardBackendsResultSchema),
    /** List steward runs (newest first, bounded). */
    list: oc.input(z.object({})).output(StewardListResultSchema),
    /** Start a steward run on an explicit backend and Imported Workspace.Provider. */
    start: oc.input(StewardStartInputSchema).output(StewardStartResultSchema),
    /** Poll normalized run events after a seq cursor. */
    events: oc.input(StewardEventsInputSchema).output(StewardEventsResultSchema),
    /** Cancel one active run (idempotent; terminal runs return their projection). */
    cancel: oc.input(StewardCancelInputSchema).output(StewardCancelResultSchema),
    /** Resolve one pending agent permission request (one-shot). */
    decidePermission: oc
      .input(StewardDecidePermissionInputSchema)
      .output(StewardDecidePermissionResultSchema),
    /** Approve one run proposal through the Manager apply pipeline. */
    approveProposal: oc.input(StewardProposalInputSchema).output(StewardApproveResultSchema),
    /** Reject one run proposal (consumes the draft). */
    rejectProposal: oc.input(StewardProposalInputSchema).output(StewardRejectResultSchema),
  },
  skillSteward: {
    /** Start a fixture steward run: snapshot -> tools -> proposals (task 2.3f). */
    startRun: oc.input(SkillStewardRunInputSchema).output(SkillStewardRunResultSchema),
    /** Validate one proposal: report only, never authorization. */
    validate: oc.input(SkillStewardProposalInputSchema).output(SkillValidationResultSchema),
    /** Human-only approval: mint the one-shot Manager grant. */
    approve: oc.input(SkillStewardProposalInputSchema).output(SkillStewardApproveResultSchema),
    /** Consume the grant and run the journaled apply transaction. */
    apply: oc.input(SkillStewardProposalInputSchema).output(SkillStewardApplyResultSchema),
    /** Prepare a Manager-derived reverse proposal or rollback grant. */
    prepareRollback: oc
      .input(SkillStewardRollbackInputSchema)
      .output(SkillStewardRollbackResultSchema),
    /** Consume a rollback grant and replay the journal in reverse. */
    applyRollback: oc.input(SkillStewardRollbackInputSchema).output(SkillStewardApplyResultSchema),
  },
  dsh: {
    /** Steward DSH runtime settings（task 3.3）：model/preset/permission/session controls。 */
    settings: {
      /** 当前 settings 投影 + provider 凭据状态（永不包含凭据值）。 */
      get: oc.input(z.object({})).output(DshStewardSettingsViewSchema),
      /** 应用补丁；revision 只在真实变更时 +1；类型化 rejected 见契约 union。 */
      update: oc.input(DshSettingsUpdateSchema).output(DshSettingsUpdateResultSchema),
    },
    /** provider 凭据写入/清除（0600 私有文件；视图只回显 configured 状态）。 */
    credentials: {
      set: oc.input(DshCredentialSetInputSchema).output(DshCredentialSetResultSchema),
      clear: oc.input(DshCredentialClearInputSchema).output(DshStewardSettingsViewSchema),
    },
    sessions: {
      /** 脱敏 session stream 帧（后续 DSH client plugin 的实时投影入口）。 */
      streams: oc
        .input(DshSessionStreamsInputSchema)
        .output(z.object({ frames: z.array(DshSessionStreamFrameSchema) })),
    },
  },
  acp: {
    /** List ACP-capable agents installed on this machine (daemon-lifetime cached). */
    agents: {
      /** Probe known PATH binaries and return their availability projection. */
      list: oc.input(z.object({})).output(z.object({ agents: z.array(AcpAgentInfoSchema) })),
    },
    session: {
      /** Spawn the selected agent subprocess and register a daemon-owned session. */
      open: oc.input(AcpSessionOpenInputSchema).output(AcpSessionOpenResultSchema),
      /** Terminate the agent subprocess for one session (idempotent). */
      close: oc.input(AcpSessionCloseInputSchema).output(z.object({ closed: z.literal(true) })),
    },
  },
});

/** Static contract shape used to derive strongly typed clients. */
export type RpcContract = typeof rpcContract;
