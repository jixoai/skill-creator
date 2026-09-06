/**
 * Skill Steward 领域契约（provider-neutral boundary）。
 *
 * 用户原始需求 [2026-09-06]（openspec skill-steward-contracts）：
 * 「定义 Manager-owned 的上下文快照、任务、结构化响应、专属工具调用与 patch 契约。」
 * 「Agent 是技能管家；不得直接修改 Provider；每个建议必须引用 skill id、revision 和
 * evidence；不确定时输出 needs-review。」
 *
 * DSH 集成边界（依据 openspec/changes/skill-steward-contracts/artifacts/dsh-webui-audit.md，
 * 官方源码证据：deepseek-ai/deepseek-harness commit d347e703908d0406b7a7ef80e3a0e594d86b2215，
 * 根版本 0.1.3-alpha.1，MIT；可组合 seam 为 @deepseek-ai/dsh-agent、dsh-agent-loop、dsh-session、
 * dsh-tools（defineTool/register/restrict/guard）、dsh-system-prompt、dsh-agent-presets、
 * dsh-user-approval、dsh-sandbox、dsh-api-session-controller、dsh-client-*）：
 * 本阶段【不 import 任何 DSH 包】——这些 seam 只约束后续 dsh-runtime-integration 阶段的
 * adapter 实现选择；DSH store/profile/session log 不是 Manager 事实源。
 *
 * 正交意图：
 *   [1] 不可变上下文快照：scope + 身份 + observed revisions + 有界内容 + 版本 + 能力。
 *   [2] 有限 typed 域工具调用记录：七个 Manager 工具 + principal 边界 + 拒绝记录。
 *   [3] Agent 结构化响应与闭合 patch union：edit/disable/split/merge，缺身份/revision/
 *       evidence/version、非法目的地、身份不一致一律在解析层拒绝。
 *   [4] 审批/审计事实形状：grant 一次性、validation 只出报告、audit 记录 mutation 终态。
 * 妥协声明：无——纯契约层，零 runtime 依赖，可被 fixture/DSH/Codex runtime 共同消费。
 */
import { z } from "zod";
import { SkillDirectoryNameSchema, SkillFrontmatterSchema } from "./creator.js";
import { FindingIdSchema, SeveritySchema } from "./skill-intelligence.js";
import { SkillIdSchema, type SkillId } from "./skills.js";
import { WorkspaceProviderTargetSchema } from "./workspaces.js";

/** 本模块契约版本；Agent 输出必须携带同一版本才可解析。 */
export const SKILL_STEWARD_CONTRACT_VERSION = "1.0.0" as const;
/** 契约版本字符串约束（稳定语义化字符串）。 */
export const ContractVersionSchema = z.string().regex(/^\d+\.\d+\.\d+$/);
/** 契约版本。 */
export type ContractVersion = z.infer<typeof ContractVersionSchema>;

// ---------------------------------------------------------------------------
// branded IDs
// ---------------------------------------------------------------------------

/** daemon 签发的不可变快照 ID。 */
export const StewardSnapshotIdSchema = z
  .string()
  .regex(/^snap_[a-f0-9]{16}$/)
  .brand<"StewardSnapshotId">();
/** 快照 ID。 */
export type StewardSnapshotId = z.infer<typeof StewardSnapshotIdSchema>;

/** daemon 签发的 steward run ID。 */
export const StewardRunIdSchema = z
  .string()
  .regex(/^sr_[a-f0-9]{24}$/)
  .brand<"StewardRunId2">();
/** run ID。 */
export type StewardRunId2 = z.infer<typeof StewardRunIdSchema>;

/** daemon 签发的任务实例 ID。 */
export const StewardTaskIdSchema = z
  .string()
  .regex(/^task_[a-f0-9]{16}$/)
  .brand<"StewardTaskId">();
/** 任务 ID。 */
export type StewardTaskId = z.infer<typeof StewardTaskIdSchema>;

/** daemon 签发的工具调用记录 ID。 */
export const SkillToolCallIdSchema = z
  .string()
  .regex(/^call_[a-f0-9]{16}$/)
  .brand<"SkillToolCallId">();
/** 工具调用 ID。 */
export type SkillToolCallId = z.infer<typeof SkillToolCallIdSchema>;

/** Manager 签发的 proposal ID（Agent 输出无 ID；由 Manager 校验后分配）。 */
export const StewardProposalIdSchema = z
  .string()
  .regex(/^spp_[a-f0-9]{16}$/)
  .brand<"StewardProposalId">();
/** proposal ID。 */
export type StewardProposalId = z.infer<typeof StewardProposalIdSchema>;

/** Manager 签发的一次性授权 grant ID。 */
export const StewardGrantIdSchema = z
  .string()
  .regex(/^grant_[a-f0-9]{16}$/)
  .brand<"StewardGrantId">();
/** grant ID。 */
export type StewardGrantId = z.infer<typeof StewardGrantIdSchema>;

/** Manager 审计记录 ID。 */
export const StewardAuditIdSchema = z
  .string()
  .regex(/^aud_[a-f0-9]{16}$/)
  .brand<"StewardAuditId">();
/** 审计 ID。 */
export type StewardAuditId = z.infer<typeof StewardAuditIdSchema>;

// ---------------------------------------------------------------------------
// revisions & capabilities
// ---------------------------------------------------------------------------

/** 内容 revision（与 contentRevision 一致：sha256 + 64 hex）。 */
export const ContentRevisionSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
/** 内容 revision。 */
export type ContentRevision = z.infer<typeof ContentRevisionSchema>;

/** 单技能 revision 观察。 */
export const RevisionObservationSchema = z.object({
  skillId: SkillIdSchema,
  revision: ContentRevisionSchema,
});
/** revision 观察。 */
export type RevisionObservation = z.infer<typeof RevisionObservationSchema>;

/** Agent runtime 能力声明（backend 无关；真实能力必须有 handler 测试支撑）。 */
export const AgentRuntimeCapabilitiesSchema = z.object({
  /** backend 标识（fixture / dsh / codex / …；契约层不封闭，由 runtime 阶段锁版本）。 */
  backendId: z.string().min(1).max(64),
  /** backend 报告的协议/产品版本证据。 */
  version: z.string().min(1).max(200),
  streamingEvents: z.boolean(),
  cancellation: z.boolean(),
  permissionRequests: z.boolean(),
  /** Agent 只允许在隔离根或 Manager 批准的 patch 上下文内工作。 */
  executionRoot: z.enum(["isolated", "patch-context"]),
});
/** Agent runtime 能力。 */
export type AgentRuntimeCapabilities = z.infer<typeof AgentRuntimeCapabilitiesSchema>;

// ---------------------------------------------------------------------------
// [1] 不可变上下文快照
// ---------------------------------------------------------------------------

/** 快照预算：技能数、单技能内容与总内容上限（超出即拒绝，不静默截断）。 */
export const SNAPSHOT_MAX_SKILLS = 100;
export const SNAPSHOT_MAX_CONTENT_BYTES_PER_SKILL = 256 * 1024;
export const SNAPSHOT_MAX_TOTAL_CONTENT_BYTES = 2 * 1024 * 1024;

/** 快照内单个技能的只读条目。 */
export const StewardSkillSnapshotEntrySchema = z.object({
  skillId: SkillIdSchema,
  name: z.string().min(1).max(200),
  directoryName: SkillDirectoryNameSchema,
  revision: ContentRevisionSchema,
  disabled: z.boolean(),
  /** SKILL.md 全文（UTF-8；builder 保证字节预算）。 */
  content: z.string().max(SNAPSHOT_MAX_CONTENT_BYTES_PER_SKILL),
  byteSize: z.number().int().nonnegative(),
});
/** 快照技能条目。 */
export type StewardSkillSnapshotEntry = z.infer<typeof StewardSkillSnapshotEntrySchema>;

/** 技能配套资源清单条目（相对路径 + hash + 类型 + 大小；不跟随目录外 symlink）。 */
export const StewardResourceEntrySchema = z.object({
  skillId: SkillIdSchema,
  /** 技能目录内的相对路径（无 .. / 无绝对路径）。 */
  relPath: z
    .string()
    .regex(/^(?!\/)(?!\.\.(\/|$))[^\0]+$/, "Relative path inside the skill directory."),
  hash: z.string().regex(/^[a-f0-9]{64}$/),
  byteSize: z.number().int().nonnegative(),
  kind: z.enum(["file", "other"]),
});
/** 资源清单条目。 */
export type StewardResourceEntry = z.infer<typeof StewardResourceEntrySchema>;

/**
 * 一次 steward run 的不可变上下文快照：runtime 收到任务前必须已存在。
 * revision 漂移后引用该快照的 proposal 全部 stale，不允许 mutation。
 */
export const SkillStewardContextSnapshotSchema = z
  .object({
    id: StewardSnapshotIdSchema,
    createdAt: z.string().datetime(),
    target: WorkspaceProviderTargetSchema,
    /** Global 支持 只读分析 + 批准后 disable；edit/split/merge 由 bind 层拒绝。 */
    scopeKind: z.enum(["global", "imported"]),
    skills: z.array(StewardSkillSnapshotEntrySchema).min(1).max(SNAPSHOT_MAX_SKILLS),
    resources: z.array(StewardResourceEntrySchema).max(4000),
    promptVersion: ContractVersionSchema,
    toolVersion: ContractVersionSchema,
    capabilities: AgentRuntimeCapabilitiesSchema,
  })
  .superRefine((snapshot, ctx) => {
    const total = snapshot.skills.reduce((sum, skill) => sum + skill.byteSize, 0);
    if (total > SNAPSHOT_MAX_TOTAL_CONTENT_BYTES) {
      ctx.addIssue({
        code: "custom",
        message: `Snapshot content budget exceeded: ${total} > ${SNAPSHOT_MAX_TOTAL_CONTENT_BYTES} bytes.`,
      });
    }
    const ids = new Set(snapshot.skills.map((skill) => skill.skillId));
    if (ids.size !== snapshot.skills.length) {
      ctx.addIssue({ code: "custom", message: "Snapshot contains duplicate skill ids." });
    }
    for (const resource of snapshot.resources) {
      if (!ids.has(resource.skillId)) {
        ctx.addIssue({
          code: "custom",
          message: `Snapshot resource references unknown skill: ${resource.skillId}.`,
        });
      }
    }
  });
/** 上下文快照。 */
export type SkillStewardContextSnapshot = z.infer<typeof SkillStewardContextSnapshotSchema>;

// ---------------------------------------------------------------------------
// 任务（check / optimize / organize）
// ---------------------------------------------------------------------------

/** 三类维护任务。 */
export const StewardTaskKindSchema = z.enum(["check", "optimize", "organize"]);
/** 任务类别。 */
export type StewardTaskKind = z.infer<typeof StewardTaskKindSchema>;

/** 一次 steward 任务实例：绑定一个快照与技能子集。 */
export const SkillStewardTaskSchema = z
  .object({
    id: StewardTaskIdSchema,
    kind: StewardTaskKindSchema,
    snapshotId: StewardSnapshotIdSchema,
    /** 任务涉及的技能（必须是快照成员；bind 层校验）。 */
    skillIds: z.array(SkillIdSchema).min(1),
    /** 面向 Agent 的补充指令（可空；模板已含领域约束）。 */
    instructions: z.string().max(2000).optional(),
    promptVersion: ContractVersionSchema,
    toolVersion: ContractVersionSchema,
    createdAt: z.string().datetime(),
  })
  .superRefine((task, ctx) => {
    if (new Set(task.skillIds).size !== task.skillIds.length) {
      ctx.addIssue({ code: "custom", message: "Task skillIds contain duplicates." });
    }
  });
/** 任务实例。 */
export type SkillStewardTask = z.infer<typeof SkillStewardTaskSchema>;

// ---------------------------------------------------------------------------
// [2] 有限 typed 域工具调用
// ---------------------------------------------------------------------------

/** Manager 暴露给 steward 协议的全部域工具（闭合集合）。 */
export const SKILL_DOMAIN_TOOLS = [
  "skills.list_context",
  "skills.inspect",
  "skills.relations",
  "skills.propose",
  "skills.validate_proposal",
  "skills.apply_proposal",
  "skills.rollback",
] as const;
/** 域工具名。 */
export const SkillDomainToolSchema = z.enum(SKILL_DOMAIN_TOOLS);
/** 域工具名。 */
export type SkillDomainTool = z.infer<typeof SkillDomainToolSchema>;

/** Agent 可直接调用的子集；apply/rollback 只属于人类 UI / Manager 恢复代码。 */
export const AGENT_ALLOWED_TOOLS: readonly SkillDomainTool[] = [
  "skills.list_context",
  "skills.inspect",
  "skills.relations",
  "skills.propose",
  "skills.validate_proposal",
];

/** 调用主体：模型、人类 UI、Manager 恢复代码。 */
export const SkillToolPrincipalSchema = z.enum(["agent", "human-ui", "manager-recovery"]);
/** 调用主体。 */
export type SkillToolPrincipal = z.infer<typeof SkillToolPrincipalSchema>;

/** 工具调用的闭合结果 union：成功 / 类型化拒绝 / 类型化失败。 */
export const SkillToolCallResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ok"), value: z.unknown() }),
  z.object({
    kind: z.literal("denied"),
    /** 通用 fs/shell 请求 → unsupported-capability；越权主体 → principal-forbidden。 */
    reason: z.enum(["unsupported-capability", "principal-forbidden"]),
    requestedOperation: z.string().min(1).max(200),
  }),
  z.object({
    kind: z.literal("failed"),
    code: z.enum(["NOT_FOUND", "CONFLICT", "INVALID_OPERATION", "UNAVAILABLE", "STALE"]),
    message: z.string().min(1).max(2000),
  }),
]);
/** 工具调用结果。 */
export type SkillToolCallResult = z.infer<typeof SkillToolCallResultSchema>;

/**
 * 一次工具调用记录：input、result、observed revisions、principal、run 归属。
 * 非域工具（如 read_file/write_file/shell）只能以 denied 记录存在；
 * apply_proposal / rollback 永不允许 agent 主体。
 */
export const SkillToolCallSchema = z
  .object({
    id: SkillToolCallIdSchema,
    at: z.string().datetime(),
    runId: StewardRunIdSchema,
    /** 被请求的工具名；非域工具必须产生 denied 结果。 */
    tool: z.string().min(1).max(200),
    principal: SkillToolPrincipalSchema,
    input: z.unknown(),
    result: SkillToolCallResultSchema,
    observedRevisions: z.array(RevisionObservationSchema).default([]),
  })
  .superRefine((call, ctx) => {
    const isDomain = (SKILL_DOMAIN_TOOLS as readonly string[]).includes(call.tool);
    if (!isDomain && call.result.kind !== "denied") {
      ctx.addIssue({
        code: "custom",
        message: `Non-domain tool "${call.tool}" must record a denied result.`,
      });
    }
    if (
      (call.tool === "skills.apply_proposal" || call.tool === "skills.rollback") &&
      call.principal === "agent"
    ) {
      ctx.addIssue({
        code: "custom",
        message: `Agent principal cannot invoke ${call.tool}.`,
      });
    }
  });
/** 工具调用记录。 */
export type SkillToolCall = z.infer<typeof SkillToolCallSchema>;

// ---------------------------------------------------------------------------
// [3] evidence / finding / patch / proposal / response
// ---------------------------------------------------------------------------

/** 证据：技能内相对定位（path / 行范围 / 精确片段至少其一）。 */
export const StewardEvidenceSchema = z
  .object({
    skillId: SkillIdSchema,
    path: z
      .string()
      .regex(/^(?!\/)(?!\.\.(\/|$))[^\0]+$/)
      .optional(),
    lineStart: z.number().int().positive().optional(),
    lineEnd: z.number().int().positive().optional(),
    snippet: z.string().max(2000).optional(),
    note: z.string().max(500).optional(),
  })
  .superRefine((evidence, ctx) => {
    const hasPath = evidence.path !== undefined;
    const hasSnippet = evidence.snippet !== undefined && evidence.snippet.length > 0;
    const hasRange = evidence.lineStart !== undefined && evidence.lineEnd !== undefined;
    if (!hasPath && !hasSnippet && !hasRange) {
      ctx.addIssue({ code: "custom", message: "Evidence needs a path, snippet, or line range." });
    }
    if (
      evidence.lineStart !== undefined &&
      evidence.lineEnd !== undefined &&
      evidence.lineEnd < evidence.lineStart
    ) {
      ctx.addIssue({ code: "custom", message: "Evidence line range is inverted." });
    }
  });
/** 证据。 */
export type StewardEvidence = z.infer<typeof StewardEvidenceSchema>;

/** finding 来源：确定性 analyzer 或 Agent 语义发现（后者由 Manager 校验后分配 ID）。 */
export const StewardFindingOriginSchema = z.enum(["deterministic", "agent-semantic"]);
/** finding 来源。 */
export type StewardFindingOrigin = z.infer<typeof StewardFindingOriginSchema>;

/** 结构化 finding：身份、revision、evidence、契约版本全部必填。 */
export const StewardFindingSchema = z
  .object({
    contractVersion: ContractVersionSchema,
    origin: StewardFindingOriginSchema,
    severity: SeveritySchema,
    /** deterministic 时必须取 intelligence 的封闭 FindingKind；agent-semantic 为自由类别。 */
    category: z.string().min(1).max(100),
    message: z.string().min(1).max(2000),
    skillIds: z.array(SkillIdSchema).min(1),
    observedRevisions: z.array(RevisionObservationSchema).min(1),
    evidence: z.array(StewardEvidenceSchema).min(1).max(20),
    /** 仅 Manager 分配；Agent 输出不得携带。 */
    findingId: FindingIdSchema.optional(),
  })
  .superRefine((finding, ctx) => {
    if (finding.origin === "deterministic" && finding.findingId === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "Deterministic findings must carry their Manager-assigned id.",
      });
    }
    const covered = new Set(finding.observedRevisions.map((observed) => observed.skillId));
    for (const skillId of finding.skillIds) {
      if (!covered.has(skillId)) {
        ctx.addIssue({
          code: "custom",
          message: `Finding references skill ${skillId} without an observed revision.`,
        });
      }
    }
  });
/** 结构化 finding。 */
export type StewardFinding = z.infer<typeof StewardFindingSchema>;

/** 技能目录内相对路径（资源映射/审计使用；拒绝穿越与绝对路径）。 */
const RelPathSchema = z
  .string()
  .regex(
    /^(?!\/)(?!\.\.(\/|$))([^\0]+)$/,
    "Relative path inside the skill directory (no traversal, no absolute path).",
  );

/** split/merge 的显式资源映射：copy / move / reference。 */
export const StewardResourceMappingSchema = z.object({
  sourcePath: RelPathSchema,
  targetPath: RelPathSchema,
  strategy: z.enum(["copy", "move", "reference"]),
});
/** 资源映射。 */
export type StewardResourceMapping = z.infer<typeof StewardResourceMappingSchema>;

/** split/merge 新目标的完整文档（安全目录名 + frontmatter + body + 显式资源映射）。 */
export const StewardPatchTargetDocumentSchema = z.object({
  directoryName: SkillDirectoryNameSchema,
  frontmatter: SkillFrontmatterSchema,
  body: z.string().max(SNAPSHOT_MAX_CONTENT_BYTES_PER_SKILL),
  resources: z.array(StewardResourceMappingSchema).max(200).default([]),
});
/** patch 目标文档。 */
export type StewardPatchTargetDocument = z.infer<typeof StewardPatchTargetDocumentSchema>;

/** patch 类别（闭合 union；与 proposal.action 必须一致）。 */
export const StewardPatchKindSchema = z.enum(["edit", "disable", "split", "merge"]);
/** patch 类别。 */
export type StewardPatchKind = z.infer<typeof StewardPatchKindSchema>;

/** 已有技能的 revision 期望（stale 判定依据；inverse 由 Manager 从快照派生）。 */
export const PatchSkillRefSchema = z.object({
  skillId: SkillIdSchema,
  expectedRevision: ContentRevisionSchema,
});
/** patch 技能引用。 */
export type PatchSkillRef = z.infer<typeof PatchSkillRefSchema>;

/** edit：逐技能整文档替换（保留未知合法 frontmatter 由 apply 层执行）。 */
export const EditSkillPatchSchema = z.object({
  kind: z.literal("edit"),
  snapshotId: StewardSnapshotIdSchema,
  edits: z
    .array(
      z.object({
        skillId: SkillIdSchema,
        expectedRevision: ContentRevisionSchema,
        frontmatter: SkillFrontmatterSchema,
        body: z.string().max(SNAPSHOT_MAX_CONTENT_BYTES_PER_SKILL),
      }),
    )
    .min(1)
    .max(SNAPSHOT_MAX_SKILLS),
});

/** disable：仅启停语义（apply 走 Provider 真实启停机制，不是 UI flag）。 */
export const DisableSkillPatchSchema = z.object({
  kind: z.literal("disable"),
  snapshotId: StewardSnapshotIdSchema,
  selections: z.array(PatchSkillRefSchema).min(1).max(SNAPSHOT_MAX_SKILLS),
  reason: z.string().min(1).max(2000),
});

/** split：一个源拆为 >=2 个不存在的新目标；源保留目录、校验后禁用。 */
export const SplitSkillPatchSchema = z
  .object({
    kind: z.literal("split"),
    snapshotId: StewardSnapshotIdSchema,
    source: PatchSkillRefSchema,
    targets: z.array(StewardPatchTargetDocumentSchema).min(2).max(20),
  })
  .superRefine((patch, ctx) => {
    const names = new Set(patch.targets.map((target) => target.directoryName));
    if (names.size !== patch.targets.length) {
      ctx.addIssue({ code: "custom", message: "Split targets must have unique directory names." });
    }
  });

/** merge：>=2 个源合并为一个新目标；源保留目录、验证后全部禁用。 */
export const MergeSkillPatchSchema = z.object({
  kind: z.literal("merge"),
  snapshotId: StewardSnapshotIdSchema,
  sources: z.array(PatchSkillRefSchema).min(2).max(SNAPSHOT_MAX_SKILLS),
  target: StewardPatchTargetDocumentSchema,
});

/** 四类 patch 的闭合 union；未知 action 在解析层被拒绝。 */
export const SkillPatchSchema = z.discriminatedUnion("kind", [
  EditSkillPatchSchema,
  DisableSkillPatchSchema,
  SplitSkillPatchSchema,
  MergeSkillPatchSchema,
]);
/** patch。 */
export type SkillPatch = z.infer<typeof SkillPatchSchema>;

/** proposal：Agent 的结构化建议（契约版本 + action/patch 一致 + 证据必填）。 */
export const SkillProposalSchema = z
  .object({
    contractVersion: ContractVersionSchema,
    action: StewardPatchKindSchema,
    patch: SkillPatchSchema,
    rationale: z.string().min(1).max(4000),
    /** 引用的确定性 finding（可空：语义优化可自带新证据）。 */
    findingIds: z.array(FindingIdSchema).max(20).default([]),
    /** 语义证据至少一条；缺证据的 proposal 在解析层拒绝。 */
    evidence: z.array(StewardEvidenceSchema).min(1).max(20),
    /** 受影响身份必须与 patch 展开一致（superRefine）。 */
    skillIds: z.array(SkillIdSchema).min(1),
    observedRevisions: z.array(RevisionObservationSchema).min(1),
  })
  .superRefine((proposal, ctx) => {
    if (proposal.action !== proposal.patch.kind) {
      ctx.addIssue({
        code: "custom",
        message: `Proposal action "${proposal.action}" does not match patch kind "${proposal.patch.kind}".`,
      });
    }
    const affected = affectedSkillIdsOfPatch(proposal.patch);
    const declared = new Set(proposal.skillIds);
    for (const skillId of affected) {
      if (!declared.has(skillId)) {
        ctx.addIssue({
          code: "custom",
          message: `Patch affects skill ${skillId} missing from proposal skillIds.`,
        });
      }
    }
    for (const skillId of proposal.skillIds) {
      if (!affected.includes(skillId)) {
        ctx.addIssue({
          code: "custom",
          message: `Proposal declares skill ${skillId} which the patch does not affect.`,
        });
      }
    }
    const covered = new Set(proposal.observedRevisions.map((observed) => observed.skillId));
    for (const skillId of proposal.skillIds) {
      if (!covered.has(skillId)) {
        ctx.addIssue({
          code: "custom",
          message: `Proposal references skill ${skillId} without an observed revision.`,
        });
      }
    }
  });
/** proposal。 */
export type SkillProposal = z.infer<typeof SkillProposalSchema>;

/** patch 展开的受影响已有技能身份（新目标目录不是已有身份，不在此列）。 */
export function affectedSkillIdsOfPatch(patch: SkillPatch): SkillId[] {
  switch (patch.kind) {
    case "edit":
      return patch.edits.map((edit) => edit.skillId);
    case "disable":
      return patch.selections.map((selection) => selection.skillId);
    case "split":
      return [patch.source.skillId];
    case "merge":
      return patch.sources.map((source) => source.skillId);
  }
}

/** Agent 终态原因（闭合集合；needs-review 表示模型不确定，禁止臆断）。 */
export const StewardTerminalReasonSchema = z.enum([
  "completed",
  "needs-review",
  "scope-limit",
  "failed",
]);
/** 终态原因。 */
export type StewardTerminalReason = z.infer<typeof StewardTerminalReasonSchema>;

/** Agent 阶段事件（仅进度展示；不驱动 mutation）。 */
export const StewardStageSchema = z.enum([
  "started",
  "collecting",
  "analyzing",
  "proposing",
  "validating",
  "done",
]);
/** 阶段。 */
export type StewardStage = z.infer<typeof StewardStageSchema>;

/**
 * Agent 输出的唯一合法形态：闭合 discriminated union。
 * 自然语言只能作为 transcript 展示；未知 kind / 缺字段在解析层整体拒绝。
 */
export const SkillStewardResponseSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("stage"),
    stage: StewardStageSchema,
    note: z.string().max(1000).optional(),
  }),
  z.object({ kind: z.literal("finding"), finding: StewardFindingSchema }),
  z.object({ kind: z.literal("proposal"), proposal: SkillProposalSchema }),
  z.object({
    kind: z.literal("question"),
    question: z.string().min(1).max(2000),
    options: z.array(z.string().min(1).max(500)).max(10).optional(),
  }),
  z.object({
    kind: z.literal("terminal"),
    reason: StewardTerminalReasonSchema,
    message: z.string().max(2000).optional(),
  }),
]);
/** Agent 结构化响应。 */
export type SkillStewardResponse = z.infer<typeof SkillStewardResponseSchema>;

// ---------------------------------------------------------------------------
// [4] validation / approval grant / audit
// ---------------------------------------------------------------------------

/** validation 检查项。 */
export const StewardValidationCheckSchema = z.object({
  name: z.string().min(1).max(100),
  status: z.enum(["passed", "failed", "skipped"]),
  detail: z.string().max(2000).optional(),
});
/** 检查项。 */
export type StewardValidationCheck = z.infer<typeof StewardValidationCheckSchema>;

/**
 * validation 结果：只出报告，不签发授权（authorization 只来自人类 UI RPC）。
 * overall=stale 表示 revision 漂移，proposal 必须重新快照与审批。
 */
export const SkillValidationResultSchema = z.object({
  proposalId: StewardProposalIdSchema,
  overall: z.enum(["valid", "invalid", "stale"]),
  checks: z.array(StewardValidationCheckSchema).min(1).max(50),
});
/** validation 结果。 */
export type SkillValidationResult = z.infer<typeof SkillValidationResultSchema>;

/**
 * Manager-owned 一次性授权 grant：绑定 run、snapshot、完整 patch fingerprint、
 * 全部输入 revision 与 absent precondition；消费即失效。
 */
export const StewardApprovalGrantSchema = z.object({
  id: StewardGrantIdSchema,
  proposalId: StewardProposalIdSchema,
  snapshotId: StewardSnapshotIdSchema,
  /** 规范化 patch 的 sha256 fingerprint；apply 时必须再次匹配。 */
  fingerprint: ContentRevisionSchema,
  /** 只能是已鉴权人类 UI（或 Manager 恢复代码的显式 principal）。 */
  principal: z.enum(["human-ui", "manager-recovery"]),
  issuedAt: z.string().datetime(),
  consumedAt: z.string().datetime().nullable(),
  inputRevisions: z.array(RevisionObservationSchema).min(1),
  /** split/merge 目标目录必须不存在的 precondition 列表。 */
  absentPreconditions: z.array(SkillDirectoryNameSchema).max(20).default([]),
});
/** 授权 grant。 */
export type StewardApprovalGrant = z.infer<typeof StewardApprovalGrantSchema>;

/** 单个 mutation 的前后状态（审计证据；beforeRevision=null 表示创建，afterRevision=null 表示删除/禁用语义见 status）。 */
export const StewardMutationRecordSchema = z.object({
  skillId: SkillIdSchema.optional(),
  relPath: RelPathSchema,
  beforeRevision: ContentRevisionSchema.nullable(),
  afterRevision: ContentRevisionSchema.nullable(),
  /** disable/enable 等启停语义也以 mutation 记录。 */
  semantic: z.enum(["content", "enablement", "resource"]).default("content"),
});
/** mutation 记录。 */
export type StewardMutationRecord = z.infer<typeof StewardMutationRecordSchema>;

/** 终态审计记录：apply / rollback / recovery 的逐项事实（不随 transcript 淘汰）。 */
export const StewardAuditRecordSchema = z.object({
  id: StewardAuditIdSchema,
  runId: StewardRunIdSchema,
  proposalId: StewardProposalIdSchema,
  action: StewardPatchKindSchema,
  principal: SkillToolPrincipalSchema,
  appliedAt: z.string().datetime(),
  status: z.enum(["applied", "rolled-back", "recovery-required"]),
  mutations: z.array(StewardMutationRecordSchema).min(1).max(500),
  /** Manager 保存的 inverse manifest 引用（回滚方案的输入；非 Agent 提供）。 */
  inverseManifestRef: z.string().min(1).optional(),
});
/** 审计记录。 */
export type StewardAuditRecord = z.infer<typeof StewardAuditRecordSchema>;

// ---------------------------------------------------------------------------
// bind 层：proposal ↔ snapshot 的确定性校验（纯函数）
// ---------------------------------------------------------------------------

/** bind 失败的类型化结果（闭合原因；不产生任何 mutation）。 */
export type ProposalBindFailure =
  | { code: "SNAPSHOT_MISMATCH"; message: string }
  | { code: "UNKNOWN_SKILL"; message: string }
  | { code: "STALE_REVISION"; message: string }
  | { code: "UNSUPPORTED_WRITE_SCOPE"; message: string }
  | { code: "CONTRACT_VERSION"; message: string };

/**
 * 把 proposal 绑定到不可变快照：
 * - snapshotId 一致；contractVersion 与本模块版本一致；
 * - 全部受影响身份属于快照；expectedRevision 必须等于快照 revision；
 * - Global scope 只允许 disable（edit/split/merge → unsupported-write-scope）。
 */
export function bindProposalToSnapshot(
  proposal: SkillProposal,
  snapshot: SkillStewardContextSnapshot,
): { ok: true } | { ok: false; failure: ProposalBindFailure } {
  if (proposal.contractVersion !== SKILL_STEWARD_CONTRACT_VERSION) {
    return {
      ok: false,
      failure: {
        code: "CONTRACT_VERSION",
        message: `Proposal contract version ${proposal.contractVersion} != ${SKILL_STEWARD_CONTRACT_VERSION}.`,
      },
    };
  }
  if (proposal.patch.snapshotId !== snapshot.id) {
    return {
      ok: false,
      failure: {
        code: "SNAPSHOT_MISMATCH",
        message: "Proposal references a different context snapshot.",
      },
    };
  }
  if (snapshot.scopeKind === "global" && proposal.patch.kind !== "disable") {
    return {
      ok: false,
      failure: {
        code: "UNSUPPORTED_WRITE_SCOPE",
        message: `Global workspace supports analysis and approved disable only; ${proposal.patch.kind} is rejected.`,
      },
    };
  }
  const byId = new Map(snapshot.skills.map((skill) => [skill.skillId, skill]));
  const expected = expectedRevisionsOfPatch(proposal.patch);
  for (const [skillId, revision] of expected) {
    const entry = byId.get(skillId);
    if (!entry) {
      return {
        ok: false,
        failure: {
          code: "UNKNOWN_SKILL",
          message: `Skill ${skillId} is not part of the snapshot.`,
        },
      };
    }
    if (entry.revision !== revision) {
      return {
        ok: false,
        failure: {
          code: "STALE_REVISION",
          message: `Skill ${skillId} expected ${revision} but snapshot holds ${entry.revision}.`,
        },
      };
    }
  }
  return { ok: true };
}

/** patch 内全部 (skillId, expectedRevision) 对。 */
export function expectedRevisionsOfPatch(patch: SkillPatch): Map<SkillId, string> {
  const pairs = new Map<SkillId, string>();
  const put = (skillId: SkillId, revision: string): void => {
    pairs.set(skillId, revision);
  };
  switch (patch.kind) {
    case "edit":
      for (const edit of patch.edits) put(edit.skillId, edit.expectedRevision);
      break;
    case "disable":
      for (const selection of patch.selections) put(selection.skillId, selection.expectedRevision);
      break;
    case "split":
      put(patch.source.skillId, patch.source.expectedRevision);
      break;
    case "merge":
      for (const source of patch.sources) put(source.skillId, source.expectedRevision);
      break;
  }
  return pairs;
}
