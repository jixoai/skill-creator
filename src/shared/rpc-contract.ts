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
  AgentQueueListInputSchema,
  AgentQueueListResultSchema,
  AgentQueueUpdateInputSchema,
  AgentQueueUpdateResultSchema,
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
  UnifiedProposalViewSchema,
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
  SelfSkillKeepResultSchema,
  SelfSkillResolveInputSchema,
  SelfSkillResolveResultSchema,
  SelfSkillStatusSchema,
} from "./contracts/self-skill.js";
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
  SkillSearchOptionsSchema,
  SkillDuplicateGroupSchema,
  SkillSearchResultSchema,
  SkillListWorkspaceDuplicatesSchema,
} from "./contracts/search.js";
import {
  AnalyzeInputSchema,
  AnalyzeResultSchema,
  ApproveProposalInputSchema,
  ApproveResultSchema,
  ListProposalsResultSchema,
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
import { SkillFileReadResultSchema, SkillFilesResultSchema } from "./contracts/skill-files.js";
import {
  ImportedWorkspaceIdSchema,
  ProviderIdSchema,
  WorkspaceProviderTargetSchema,
  WorkspaceIdSchema,
  WorkspaceSchema,
} from "./contracts/workspaces.js";
import {
  WikiAppendInputSchema,
  WikiAppendResultSchema,
  WikiListInputSchema,
  WikiReadInputSchema,
  WikiReadResultSchema,
  WikiScopesResultSchema,
} from "./contracts/wiki.js";
import {
  DistillCancelOutputSchema,
  DistillStartInputSchema,
  DistillStartOutputSchema,
  DistillStatusOutputSchema,
  DistillRunInputSchema,
} from "./contracts/wiki-distill.js";
import { PatternListItemSchema } from "skill-wiki/schema";
import {
  EvaluationCaseCreateInputSchema,
  EvaluationCaseListInputSchema,
  EvaluationCaseRemoveInputSchema,
  EvaluationCaseSchema,
  EvaluationCaseUpdateInputSchema,
  EvaluationOverviewInputSchema,
  EvaluationOverviewOutputSchema,
  EvaluationResultViewSchema,
  EvaluationResultsListInputSchema,
  EvaluationRunRefInputSchema,
  EvaluationRunStartInputSchema,
} from "./contracts/evaluation.js";

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
/** skills.search 输入（query min-1 是 RPC 合同；limit 复用检索选项的 1..50 边界与默认值）。 */
export const SkillsSearchInputSchema = z
  .object({
    query: z.string().min(1),
    limit: SkillSearchOptionsSchema.shape.limit,
  })
  .strict();

/**
 * skills.listWorkspace 游标 codec：opaque 起始键（providerId, skillId；含起始行）。
 * 纯字符串往返（base64），输入 schema refine 与 daemon 分页共用同一判定源。
 */
export function encodeSkillsListWorkspaceCursor(key: {
  providerId: string;
  skillId: string;
}): string {
  return btoa(`${key.providerId}:${key.skillId}`);
}

/** 解码 listWorkspace 游标；非法形状返回 null（schema refine 据此拒绝 typed 校验错误）。 */
export function decodeSkillsListWorkspaceCursor(value: string): {
  providerId: string;
  skillId: string;
} | null {
  let decoded: string;
  try {
    decoded = atob(value);
  } catch {
    return null;
  }
  const separator = decoded.indexOf(":");
  if (separator === -1) return null;
  const providerId = decoded.slice(0, separator);
  const skillId = decoded.slice(separator + 1);
  if (!/^[a-z][a-z0-9-]*$/.test(providerId)) return null;
  if (!/^sk_[a-f0-9]{24}$/.test(skillId)) return null;
  return { providerId, skillId };
}

const SkillsListWorkspaceCursorSchema = z
  .string()
  .min(1)
  .refine((value) => decodeSkillsListWorkspaceCursor(value) !== null, {
    message: "malformed skills.listWorkspace cursor",
  });

/** skills.listWorkspace 输入（skills-dashboard design §5：limit 1..500 默认 200）。 */
export const SkillsListWorkspaceInputSchema = z.strictObject({
  wsId: WorkspaceIdSchema,
  /** server 端预过滤（name/description 包含式，大小写不敏感；非 BM25）。 */
  q: z.string().optional(),
  limit: z.number().int().min(1).max(500).default(200),
  cursor: SkillsListWorkspaceCursorSchema.optional(),
});

/** skills.listWorkspace 平铺行（SkillMetadata + typed providerId 归属）。 */
export const SkillsListWorkspaceRowSchema = SkillMetadataSchema.extend({
  providerId: ProviderIdSchema,
});

/** skills.listWorkspace 的 provider 摘要行（单 provider 失败 → typed error，整屏不失败）。 */
export const SkillsListWorkspaceProviderSchema = z.strictObject({
  providerId: ProviderIdSchema,
  label: z.string().min(1),
  available: z.boolean(),
  skillCount: z.number().int().nonnegative(),
  error: z
    .strictObject({
      code: z.enum(["unavailable", "scan-failed", "io-error"]),
      message: z.string(),
    })
    .optional(),
});

/** skills.listWorkspace 输出（skills 恒 ≤ limit；duplicates 三层有界投影）。 */
export const SkillsListWorkspaceOutputSchema = z.strictObject({
  providers: z.array(SkillsListWorkspaceProviderSchema),
  skills: z.array(SkillsListWorkspaceRowSchema),
  nextCursor: z.string().optional(),
  duplicates: SkillListWorkspaceDuplicatesSchema,
});
export type SkillsListWorkspaceOutput = z.infer<typeof SkillsListWorkspaceOutputSchema>;

/**
 * skills.listCanonical 游标 codec（skills-tabs-redesign 批 2，Δ1 定稿）：opaque
 * 起始组键（组名；含起始组）。纯字符串往返（base64 + `g:` 前缀），输入 schema
 * refine 与 daemon 分页共用同一判定源。
 */
export function encodeSkillsListCanonicalCursor(name: string): string {
  return btoa(`g:${name}`);
}

/** 解码 listCanonical 游标；非法形状返回 null（schema refine 据此拒绝 typed 校验错误）。 */
export function decodeSkillsListCanonicalCursor(value: string): string | null {
  let decoded: string;
  try {
    decoded = atob(value);
  } catch {
    return null;
  }
  if (!decoded.startsWith("g:")) return null;
  return decoded.slice(2);
}

const SkillsListCanonicalCursorSchema = z
  .string()
  .min(1)
  .refine((value) => decodeSkillsListCanonicalCursor(value) !== null, {
    message: "malformed skills.listCanonical cursor",
  });

/** skills.listCanonical 输入（Δ1：workspace-scoped `{wsId, q?, pagination?}`）。 */
export const SkillsListCanonicalInputSchema = z.strictObject({
  wsId: WorkspaceIdSchema,
  /** server 端预过滤（组名或任一 copy 的 description 包含式，大小写不敏感）。 */
  q: z.string().optional(),
  limit: z.number().int().min(1).max(500).default(200),
  cursor: SkillsListCanonicalCursorSchema.optional(),
});

/**
 * 组内 copy 行（Δ1：representative 与每个 copy 都携带完整 WorkspaceProviderTarget
 * 三元组——info/toggle/validate 按 target 解析是安全边界；workspaceId/skillId 是
 * id 的显式 target 形态，客户端不经推导直接组装 target）。unavailable = 投影时
 * canonical 目录已不可达（代表顺延、全组置灰的依据）；conflict = SKILL.md 与
 * .SKILL.md 并存（copy 级标记，组不丢行）；contentHash 来自 duplicates 同源投影，
 * 仅组内区分「同内容副本 / 同名不同内容」，不作列表身份（缺席 = 无重复内容）。
 */
export const SkillsCanonicalCopySchema = SkillMetadataSchema.extend({
  providerId: ProviderIdSchema,
  workspaceId: WorkspaceIdSchema,
  skillId: SkillIdSchema,
  unavailable: z.boolean(),
  conflict: z.boolean(),
  contentHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
});
export type SkillsCanonicalCopy = z.infer<typeof SkillsCanonicalCopySchema>;

/**
 * 唯一 name 组行（Δ1）：分组键 = skill name 精确匹配（trim 外无归一，plugin
 * namespace 原样入键）；representative = enabled 优先 → sourcePriority（缺失=最低）
 * → providerId → path 字典序，unavailable copy 顺延；groupMeta.copyCount 与
 * allUnavailable 显式给出（UI 两量纲明示，禁止单数字推导）。
 */
export const SkillsCanonicalGroupSchema = z.strictObject({
  name: z.string(),
  description: z.string(),
  representative: SkillsCanonicalCopySchema,
  copies: z.array(SkillsCanonicalCopySchema).min(1),
  groupMeta: z.strictObject({
    copyCount: z.number().int().positive(),
    allUnavailable: z.boolean(),
  }),
});
export type SkillsCanonicalGroup = z.infer<typeof SkillsCanonicalGroupSchema>;

/**
 * skills.listCanonical 输出（Δ1）：providers 摘要同 listWorkspace 同源（单
 * provider 失败 typed 隔离）；groupCount/copyCount 为 (wsId, q) 作用域内全量
 * 两量纲计数（与分页窗口无关）；groups 恒 ≤ limit，nextCursor = 下一首组键。
 */
export const SkillsListCanonicalOutputSchema = z.strictObject({
  providers: z.array(SkillsListWorkspaceProviderSchema),
  groups: z.array(SkillsCanonicalGroupSchema),
  groupCount: z.number().int().nonnegative(),
  copyCount: z.number().int().nonnegative(),
  nextCursor: z.string().optional(),
});
export type SkillsListCanonicalOutput = z.infer<typeof SkillsListCanonicalOutputSchema>;

// skills-tabs-redesign 批 3（design.md Δ2 定稿）：有界文件树与文件读。
// 每次调用重新 resolve（不信任先前 files 列表）；路径规则与预算语义见
// contracts/skill-files.ts；typed errors 六类中的 TOO_LARGE/TRUNCATED 为带内
// typed 字段（SkillFilesResult.truncationReason / SkillFileReadResult.truncated），
// INVALID_PATH/BINARY 为可抛错误码（contracts/errors.ts），客户端不解析字符串。
/** skills.files 输入（target + opaque skillId；每次重解析）。 */
export const SkillsFilesInputSchema = z.strictObject({
  ...WorkspaceProviderTargetSchema.shape,
  skillId: SkillIdSchema,
});
/** skills.fileRead 输入（path = `/` 分隔相对路径；绝对/`..`/NUL/反斜杠在 daemon 拒绝）。 */
export const SkillsFileReadInputSchema = SkillsFilesInputSchema.extend({
  path: z.string().min(1).max(1024),
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
    /**
     * Search local skills across all workspaces (daemon 长驻检索：canonical 去重 +
     * BM25 + 冻结 rerank；返回稳定 sk_ id 与 installations 作用域三元组)。
     */
    search: oc
      .input(SkillsSearchInputSchema)
      .output(z.object({ results: z.array(SkillSearchResultSchema) })),
    /**
     * 检索内容配置面：以系统默认编辑器打开 server-owned 的 search-config.toml
     * （排除目录清单；路径由 daemon 派生，不接受调用方输入）。
     */
    searchConfig: {
      open: oc.input(z.object({})).output(z.object({ opened: z.boolean() })),
    },
    /**
     * 内容重复组（索引 contentHash 分组 >1；无查询维度的全量重复清单，
     * 排序冻结可重放）。
     */
    duplicates: oc
      .input(z.object({}))
      .output(z.object({ groups: z.array(SkillDuplicateGroupSchema) })),
    /**
     * workspace 级有界聚合读（skills-dashboard design §5）：单一 workspace 全部
     * provider 平铺（q 预过滤 + (providerId, skillId) 字典序 + opaque cursor 分段，
     * skills 恒 ≤ limit）+ provider 计数（单 provider 失败 typed 隔离）+
     * duplicates 同源三层有界投影（组 ≤50 / 成员 ≤16 / installations {items≤8,
     * truncated}；完整数据走 skills.duplicates）。
     */
    listWorkspace: oc.input(SkillsListWorkspaceInputSchema).output(SkillsListWorkspaceOutputSchema),
    /**
     * workspace 级唯一 name 分组投影（skills-tabs-redesign 批 2，Δ1 定稿）：
     * 复用 listWorkspace 的 provider fan-out（不建第二套扫描）；组 = name 精确
     * 匹配（plugin namespace 原样），representative 携带完整 target（安全边界），
     * unavailable/conflict 为 copy 级标记（组保留不隐藏）；groupCount/copyCount
     * 两量纲分开返回；组名序 + opaque cursor 分段（groups 恒 ≤ limit）。
     */
    listCanonical: oc.input(SkillsListCanonicalInputSchema).output(SkillsListCanonicalOutputSchema),
    /**
     * 有界文件树（skills-tabs-redesign 批 3，Δ2 定稿）：target + opaque skillId
     * 每次重解析；遍历 ≤4 深、≤300 entries、响应 ≤64KB（超限 = 带内 typed
     * truncationReason:"TOO_LARGE"）；symlink 分量省略、conflict 双文件展示。
     */
    files: oc.input(SkillsFilesInputSchema).output(SkillFilesResultSchema),
    /**
     * 有界文件读（Δ2）：每次调用重新 resolve 后逐级验证相对路径（lstat 拒
     * symlink 分量 + O_NOFOLLOW fd + fstat 身份校验防 TOCTOU 换体）；单文件
     * ≤256KiB 超限返回前 256KiB + truncated:true（不拒读）；二进制 typed 拒读
     * （BINARY）。typed NOT_FOUND/UNAVAILABLE/INVALID_PATH/BINARY 经错误闭集。
     */
    fileRead: oc.input(SkillsFileReadInputSchema).output(SkillFileReadResultSchema),
    update: {
      /** Compare skills-CLI lock hashes against upstream and report outdated skills. */
      check: oc.input(UpdateCheckInputSchema).output(UpdateCheckResultSchema),
      /**
       * Reinstall approved outdated skills via the ccski entity kernel (updateEntity,
       * legacy 回退 ensureEntity+projectEntity)；成功条目携带 lockSyncPending
       * （分层单写者：npm lock 由 skills CLI 写，宿主只在内存覆盖层刷新）。
       */
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
    /**
     * 原生目录选择器（ext-dialog；tray 挂载后可用）。用户取消 → path:null；
     * 平台不支持 / headless → supported:false（WebUI 以此隐藏 Browse 入口）。
     */
    pickDirectory: oc
      .input(z.object({}))
      .output(z.object({ supported: z.boolean(), path: z.string().nullable() })),
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
  wiki: {
    /**
     * skill-wiki 知识库面（双级 scope：Global `~` + per-Imported ws_*）：
     * direct mutation（碎片追加不经 proposal 审批链——spec 裁决 2026-09-21）。
     */
    /** scope 索引（GUI Wiki 面板 home）：global 恒列 + 全部 registry workspace。 */
    scopes: oc.input(z.object({})).output(WikiScopesResultSchema),
    list: oc
      .input(WikiListInputSchema)
      .output(z.object({ patterns: z.array(PatternListItemSchema) })),
    /** 读单 pattern 全文（frontmatter + body）。 */
    read: oc.input(WikiReadInputSchema).output(WikiReadResultSchema),
    /** 追加碎片认知（contentHash 幂等去重；deduplicated=true 表示未新建页）。 */
    append: oc.input(WikiAppendInputSchema).output(WikiAppendResultSchema),
    /**
     * 蒸馏编排面（skill-wiki-maintainer E：三面同源、无 phase 字段——RunState
     * 即阶段真相；同 source 活跃 run ≤1；执行经 proposal 审批（wiki.distill_apply）。
     */
    distill: {
      /** 启动蒸馏 run（corpus → kernel → plan → 原子 admission；阻塞到 admission）。 */
      start: oc.input(DistillStartInputSchema).output(DistillStartOutputSchema),
      /** run 状态投影（终态幂等可轮询；counters 全键 + proposalRefs ledger 状态）。 */
      status: oc.input(DistillRunInputSchema).output(DistillStatusOutputSchema),
      /** 取消（kernel-running → dispose；awaiting-approval → C 失效语义；终态幂等）。 */
      cancel: oc.input(DistillRunInputSchema).output(DistillCancelOutputSchema),
    },
  },
  daemon: {
    /** Read the live daemon and tray status. */
    status: oc.input(z.object({})).output(DaemonStatusSchema),
    /**
     * 以系统默认应用打开 https URL（ext-opener；tray 挂载后为原生通道，
     * headless 降级 spawn）。server-owned https 闸；用户显式动作触发
     * （如 Discover 源卡「Open repo」），非 start/open 的启动副作用。
     */
    openExternal: oc
      .input(z.object({ url: z.string().url() }).strict())
      .output(z.object({ opened: z.literal(true) })),
  },
  selfSkill: {
    /** Live self-skill link state（conflict 折叠 kept；WebUI 首页 banner 数据源）。 */
    state: oc.input(z.object({}).strict()).output(SelfSkillStatusSchema),
    /** 覆盖安装产品版本（真目录可先备份到 skills-backup）。 */
    resolve: oc.input(SelfSkillResolveInputSchema).output(SelfSkillResolveResultSchema),
    /** 保留用户版本（fingerprint 记忆；条目变化后重新提醒）。 */
    keep: oc.input(z.object({}).strict()).output(SelfSkillKeepResultSchema),
  },
  evaluation: {
    /**
     * Evaluating 总览聚合（readonly；evaluating-dashboard design §1 r2 定稿）：
     * targets 摘要（三元组字典序 cursor 分页 + 单 target typed error 行 +
     * staleRatio 每-case-最新口径）+ recentRuns 固定窗口 20（仅 input.wsId，
     * 持久结果行 + 内存 running/queued 组合，不分页）。
     */
    overview: oc.input(EvaluationOverviewInputSchema).output(EvaluationOverviewOutputSchema),
    /** List cases for one skill scope（Imported 与 Global 均可读）. */
    cases: {
      list: oc
        .input(EvaluationCaseListInputSchema)
        .output(z.object({ cases: z.array(EvaluationCaseSchema) })),
      create: oc
        .input(EvaluationCaseCreateInputSchema)
        .output(z.object({ case_: EvaluationCaseSchema })),
      update: oc
        .input(EvaluationCaseUpdateInputSchema)
        .output(z.object({ case_: EvaluationCaseSchema })),
      remove: oc.input(EvaluationCaseRemoveInputSchema).output(z.object({ removed: z.boolean() })),
    },
    run: {
      /** Start a run（queued；竞态与终态语义见 spec）. */
      start: oc
        .input(EvaluationRunStartInputSchema)
        .output(z.object({ runId: z.string().min(1), status: z.literal("queued") })),
      status: oc.input(EvaluationRunRefInputSchema).output(
        z.object({
          status: z.enum(["queued", "running", "completed", "cancelled"]),
          resultIds: z.array(z.string()),
        }),
      ),
      cancel: oc.input(EvaluationRunRefInputSchema).output(
        z.object({
          runId: z.string().min(1),
          status: z.enum(["queued", "running", "completed", "cancelled"]),
        }),
      ),
    },
    /** Result list with display-level stale projection（结果本体不可变）. */
    results: {
      list: oc
        .input(EvaluationResultsListInputSchema)
        .output(z.object({ results: z.array(EvaluationResultViewSchema) })),
    },
  },
  skillIntelligence: {
    /** Read-only multi-skill analysis locked to observed revisions. */
    analyze: oc.input(AnalyzeInputSchema).output(AnalyzeResultSchema),
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
        .output(z.object({ proposals: z.array(UnifiedProposalViewSchema) })),
      approve: oc
        .input(AgentProposalDecisionInputSchema)
        .output(z.object({ proposal: UnifiedProposalViewSchema })),
      reject: oc
        .input(AgentProposalDecisionInputSchema)
        .output(z.object({ proposal: UnifiedProposalViewSchema })),
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
     * 内核 inbox 队列面（C2）：queue 真相在 ReactLoopInbox；list 投影待处理项，
     * update 执行行级 edit/remove/steer（官方 updateQueue 语义）。
     */
    queue: {
      /** 待处理项（非 live 会话 = 空 items；live next-step + next-turn 有序）。 */
      list: oc.input(AgentQueueListInputSchema).output(AgentQueueListResultSchema),
      /** 行级操作；messageId 已消费 = typed NOT_FOUND（竞态可见）。 */
      update: oc.input(AgentQueueUpdateInputSchema).output(AgentQueueUpdateResultSchema),
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
      /** 原生文件选择（R18 @xmorse/rfd）：mode 预置 filter；空 = 取消。 */
      pickFiles: oc
        .input(z.object({ mode: z.enum(["image", "file"]) }))
        .output(z.object({ paths: z.array(z.string().min(1)) })),
    },
    /** agent-models-config 标准生成物投影：全量 provider 画廊（filter 在 UI）。 */
    models: {
      catalog: oc.input(z.object({})).output(
        z.object({
          providers: z.array(ModelProviderCatalogEntrySchema),
          /** 目录数据上游修订号（agent-models-config 信封 revision；spec MUST 必携带）。 */
          sourceRevision: z.number().int().nonnegative(),
        }),
      ),
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
