/**
 * Browser-safe oRPC contract composition.
 *
 * 用户原始需求 [2026-07-19]：「移除目前关于窗口半透明、倒计时关闭的相关前后端代码。」
 * Orthogonal intents:
 *   [1] Compose browser-safe workspace, skill, Creator, and repository procedures.
 *   [2] Apply one finite, strongly typed business-error vocabulary.
 */
import { ModelProviderCatalogEntrySchema } from "./contracts/dsh-runtime.js";
import { oc } from "@orpc/contract";
import { z } from "zod";
import {
  AcpAgentInfoSchema,
  AcpSessionCloseInputSchema,
  AcpSessionOpenInputSchema,
  AcpSessionOpenResultSchema,
} from "./contracts/acp.js";
import {
  DshRouteConnectionTestInputSchema,
  DshRouteConnectionTestResultSchema,
  DshSessionStreamFrameSchema,
} from "./contracts/dsh-runtime.js";
import {
  AgentCredentialClearInputSchema,
  AgentCredentialSetInputSchema,
  AgentCredentialSetResultSchema,
  AgentFilesListInputSchema,
  AgentFilesListResultSchema,
  AgentFilesPreviewInputSchema,
  AgentFilesPreviewResultSchema,
  AgentSessionCreateInputSchema,
  AgentSessionCreateResultSchema,
  AgentSessionCancelInputSchema,
  AgentSessionCancelResultSchema,
  AgentSessionAnswerInputSchema,
  AgentSessionAnswerResultSchema,
  AgentCardGetInputSchema,
  AgentCardGetResultSchema,
  AgentMcpProposalViewSchema,
  AgentProposalDecisionInputSchema,
  AgentSessionPromptInputSchema,
  AgentSessionPromptResultSchema,
  AgentSessionSetModeInputSchema,
  AgentSessionSetModeResultSchema,
  AgentSessionStreamInputSchema,
  AgentSessionStreamResultSchema,
  AgentSessionsCleanupInputSchema,
  AgentSessionsCleanupResultSchema,
  AgentSessionsStreamsInputSchema,
  AgentSessionSummarySchema,
  AgentSettingsUpdateResultSchema,
  AgentSettingsUpdateSchema,
  AgentSettingsViewSchema,
} from "./contracts/agent.js";
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

// dsh-kernel-rebase tasks 1.2：领域 capability 输入与 RPC 输入必须同源（禁止第二份
// 手写镜像），以下具名导出供 capability-core 的 domain-capabilities 复用。
/** skills.list / info 输入（info 追加 skillId）。 */
export const SkillsListInputSchema = WorkspaceProviderReadInputSchema;
/** skills.info / validate / creator.load 输入（同形状，validate 复用）。 */
export const SkillsInfoInputSchema = WorkspaceProviderReadInputSchema.extend({
  skillId: SkillIdSchema,
});
/** skills.toggle 输入。 */
export const SkillsToggleInputSchema = z.object({
  ...WorkspaceProviderTargetSchema.shape,
  skillIds: z.array(SkillIdSchema).min(1),
  mode: z.enum(["enable", "disable"]),
});
/** workspace.add 输入。 */
export const WorkspaceAddInputSchema = z.object({
  path: z.string().trim().min(1),
  label: z.string().trim().min(1).optional(),
});
/** workspace.remove 输入。 */
export const WorkspaceRemoveInputSchema = z.object({ id: ImportedWorkspaceIdSchema });
/** workspace.setActive 输入。 */
export const WorkspaceSetActiveInputSchema = z.object({ id: WorkspaceIdSchema });
/** creator.remove 输入。 */
export const CreatorRemoveInputSchema = z.object({
  ...WorkspaceProviderTargetSchema.shape,
  skillId: SkillIdSchema,
  expectedRevision: z.string().regex(/^sha256:[a-f0-9]{64}$/),
});
/** repository.scan 输入。 */
export const RepositoryScanInputSchema = z.object({
  source: z.string().trim().min(1),
  ref: z.string().trim().min(1).optional(),
});
/** repository.preview 输入。 */
export const RepositoryPreviewInputSchema = z.object({
  sessionId: RepositorySessionIdSchema,
  skillId: RemoteSkillIdSchema,
});

/** Complete browser-safe contract shared by the WebUI and daemon. */
export const rpcContract = oc.errors(RpcErrorDefinitions).router({
  skills: {
    /** Discover skills within one explicit Workspace Provider. */
    list: oc
      .input(SkillsListInputSchema)
      .output(z.object({ skills: z.array(SkillMetadataSchema) })),
    /** Read one Workspace Provider-scoped skill document. */
    info: oc.input(SkillsInfoInputSchema).output(SkillInfoSchema),
    /** Enable or disable selected opaque skill IDs. */
    toggle: oc.input(SkillsToggleInputSchema).output(ToggleSummarySchema),
    /** Validate one Workspace Provider-scoped skill. */
    validate: oc.input(SkillsInfoInputSchema).output(ValidateResultSchema),
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
    add: oc.input(WorkspaceAddInputSchema).output(z.object({ workspace: WorkspaceSchema })),
    /** Remove an imported workspace registration. */
    remove: oc.input(WorkspaceRemoveInputSchema).output(z.object({ activeId: WorkspaceIdSchema })),
    /** Select the active workspace. */
    setActive: oc
      .input(WorkspaceSetActiveInputSchema)
      .output(z.object({ activeId: WorkspaceIdSchema })),
  },
  creator: {
    /** Create or revision-check and update a skill. */
    save: oc.input(SaveSkillInputSchema).output(SaveSkillResultSchema),
    /** Load an editable skill document. */
    load: oc.input(SkillsInfoInputSchema).output(SkillDocumentSchema),
    /** Revision-check and delete one skill. */
    remove: oc.input(CreatorRemoveInputSchema).output(z.object({ removed: z.literal(true) })),
    /** Read revision history for one skill (change 5: change log sub-view). */
    revisions: oc.input(CreatorRevisionsInputSchema).output(CreatorRevisionsResultSchema),
  },
  repository: {
    /** Clone, pin, and scan a repository source. */
    scan: oc.input(RepositoryScanInputSchema).output(RemoteRepoScanSchema),
    /** Preview one skill from a pinned repository session. */
    preview: oc.input(RepositoryPreviewInputSchema).output(RemoteSkillPreviewSchema),
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
  agent: {
    /** ui:// 卡片资源代理（task 4.2；面板按 tool-result 的 resourceUri 拉取）。 */
    card: {
      get: oc.input(AgentCardGetInputSchema).output(AgentCardGetResultSchema),
    },
    /** MCP mutation proposal 审批链（task 4.4；Manager authority 的决定面）。 */
    proposals: {
      list: oc
        .input(z.object({}))
        .output(z.object({ proposals: z.array(AgentMcpProposalViewSchema) })),
      approve: oc
        .input(AgentProposalDecisionInputSchema)
        .output(z.object({ proposal: AgentMcpProposalViewSchema })),
      reject: oc
        .input(AgentProposalDecisionInputSchema)
        .output(z.object({ proposal: AgentMcpProposalViewSchema })),
    },
    /** 面板会话：内核 agent 会话的生命周期投影（task 2.2；旧 dsh.* 收敛并入）。 */
    sessions: {
      /** 列出内核 live 会话（含非面板会话的 disposed 投影）。 */
      list: oc
        .input(z.object({}))
        .output(z.object({ sessions: z.array(AgentSessionSummarySchema) })),
      /** 脱敏 run/session 帧查询（原 dsh.sessions.streams 平移；steward 投影消费）。 */
      streams: oc
        .input(AgentSessionsStreamsInputSchema)
        .output(z.object({ frames: z.array(DshSessionStreamFrameSchema) })),
      /**
       * 清理面板会话转录（R14-C）：按保留天数 / 全量 / 显式 ID 删除产品转录层
       * （sessions/YYYY/MM/DD），running 会话跳过；不触碰 $DSH_HOME 内核日志。
       */
      cleanup: oc.input(AgentSessionsCleanupInputSchema).output(AgentSessionsCleanupResultSchema),
    },
    session: {
      /** 创建产品会话（产品 preset + 工具面收窄；可选首 prompt）。 */
      create: oc.input(AgentSessionCreateInputSchema).output(AgentSessionCreateResultSchema),
      /** 驱动一轮用户输入（终态经 stream 轮询观察）。 */
      prompt: oc.input(AgentSessionPromptInputSchema).output(AgentSessionPromptResultSchema),
      /** 取消当前活动（幂等）。 */
      cancel: oc.input(AgentSessionCancelInputSchema).output(AgentSessionCancelResultSchema),
      /** 回答一个待答审批/提问请求（approval-request 帧的应答通道）。 */
      answer: oc.input(AgentSessionAnswerInputSchema).output(AgentSessionAnswerResultSchema),
      /** 增量帧读取（afterSeq 游标 + status 快照）。 */
      stream: oc.input(AgentSessionStreamInputSchema).output(AgentSessionStreamResultSchema),
      /** 切换会话模式（add-agent-settings-modes：running 拒绝；live 句柄释放，
       * 下一次 prompt 以新模式 setup 复活，历史由内核 session log 保留）。 */
      setMode: oc.input(AgentSessionSetModeInputSchema).output(AgentSessionSetModeResultSchema),
    },
    /**
     * 后端文件选择器（R17-B）：真实路径浏览 + 单文件预览。用户本机自由浏览是
     * 功能目的（读面，无 Workspace containment）；prompt 附件 path 通道在
     * session.prompt 的 daemon 侧读盘。
     */
    files: {
      /** 列目录（dir 缺省 = home；canonical realpath + 目录优先字典序 + 有界截断）。 */
      list: oc.input(AgentFilesListInputSchema).output(AgentFilesListResultSchema),
      /** 单文件预览：图片缩略（jSquash）/ 文本头 / 二进制名投影。 */
      preview: oc.input(AgentFilesPreviewInputSchema).output(AgentFilesPreviewResultSchema),
    },
    /** pi-ai 装配目录（models.dev 镜像）投影：全量 provider 画廊（filter 在 UI）。 */
    models: {
      catalog: oc
        .input(z.object({}))
        .output(z.object({ providers: z.array(ModelProviderCatalogEntrySchema) })),
    },
    /** model/preset/permission/approval 投影（原 dsh.settings 平移）。 */
    settings: {
      /** 当前 settings 投影 + provider 凭据（apiKey 按 R16 用户裁决回显）。 */
      get: oc.input(z.object({})).output(AgentSettingsViewSchema),
      /** 应用补丁；revision 只在真实变更时 +1；类型化 rejected 见契约 union。 */
      update: oc.input(AgentSettingsUpdateSchema).output(AgentSettingsUpdateResultSchema),
      /**
       * 路由连接测试（R7 2026-09-12）：用户显式触发的外呼探活（草案即可测）。
       * 逐协议最小探测 + 10s 超时；结果 typed（ok{latencyMs}/failed{detail}），
       * detail ≤200ch 且不含 key。UI 前置条件：路由已保存 key（configured）。
       */
      testConnection: oc
        .input(DshRouteConnectionTestInputSchema)
        .output(DshRouteConnectionTestResultSchema),
    },
    /** provider 凭据写入/清除（0600 私有文件；视图按 R16 回显 apiKey）。 */
    credentials: {
      set: oc.input(AgentCredentialSetInputSchema).output(AgentCredentialSetResultSchema),
      clear: oc.input(AgentCredentialClearInputSchema).output(AgentSettingsViewSchema),
    },
  },
  /**
   * Internal legacy ACP bridge（dsh-webui-composition 3.2）：generic ACP session 已从
   * 产品入口移除——Agent 会话由 DSH host 唯一承载。此 namespace 仅供 daemon 内部
   * 诊断/测试使用，不再是 Steward/Creator 的产品入口，不向前追加能力。
   */
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
