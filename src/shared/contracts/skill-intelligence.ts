/**
 * 用户原始需求 [2026-09-06]（openspec skill-intelligence）：
 * 「先把这些问题变成可解释的证据，再让 Agent 提出修改。」
 * 正交意图：
 *   [1] 定义只读分析报告（快照 + finding + 关系边）与 observed revision 锁定。
 *   [2] 定义 edit/disable/split/merge 四类 Manager-owned proposal 草稿。
 *   [3] 约束 proposal 审批输入（显式 revision 期望 + typed 结果）。
 */
import { z } from "zod";
import { SkillDirectoryNameSchema, SkillFrontmatterSchema } from "./creator.js";
import { SkillIdSchema } from "./skills.js";
import { WorkspaceProviderTargetSchema } from "./workspaces.js";

/** 分析发现的可判别类别。 */
export const FindingKindSchema = z.enum([
  "duplicate-name",
  "duplicate-trigger",
  "overlapping-responsibility",
  "mutually-exclusive-rules",
  "shared-resource-path",
  "missing-description",
  "empty-body",
  "wide-trigger-surface",
  "validation-error",
  "validation-warning",
]);
/** 分析发现类别。 */
export type FindingKind = z.infer<typeof FindingKindSchema>;

/** finding 的严重级别；error 表示需要人决策，warning 表示建议复查，info 表示背景信息。 */
export const SeveritySchema = z.enum(["info", "warning", "error"]);
/** finding 严重级别。 */
export type Severity = z.infer<typeof SeveritySchema>;

/** 单条证据：一段可读片段与其来源说明。 */
export const FindingEvidenceSchema = z.object({
  label: z.string().min(1),
  snippet: z.string().min(1),
});
/** 单条证据。 */
export type FindingEvidence = z.infer<typeof FindingEvidenceSchema>;

/** 服务端生成的 finding 稳定 ID。 */
export const FindingIdSchema = z
  .string()
  .regex(/^fn_[a-f0-9]{16}$/)
  .brand<"FindingId">();
/** finding 稳定 ID。 */
export type FindingId = z.infer<typeof FindingIdSchema>;

/** 一条可解释的分析发现；必须绑定 skillIds 与分析时的 observed revisions。 */
export const FindingSchema = z.object({
  id: FindingIdSchema,
  kind: FindingKindSchema,
  severity: SeveritySchema,
  message: z.string().min(1),
  skillIds: z.array(SkillIdSchema).min(1),
  /** finding 观察到的各技能内容 revision（sha256:…）。 */
  observedRevisions: z.record(z.string(), z.string().regex(/^sha256:[a-f0-9]{64}$/)),
  evidence: z.array(FindingEvidenceSchema).min(1),
});
/** 一条分析发现。 */
export type Finding = z.infer<typeof FindingSchema>;

/** 分析时刻的单技能只读快照。 */
export const SkillSnapshotSchema = z.object({
  ...WorkspaceProviderTargetSchema.shape,
  skillId: SkillIdSchema,
  name: z.string(),
  directoryName: z.string(),
  revision: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  /** 快照正文长度（字节按字符数近似，仅用于展示）。 */
  bodyLength: z.number().int().nonnegative(),
  /** 从 frontmatter allowed-tools 等字段提取的触发词集合。 */
  triggers: z.array(z.string()),
  /** 正文中引用的相对路径（scripts/… assets/… 等）。 */
  referencedPaths: z.array(z.string()),
  disabled: z.boolean(),
  /** 该技能的分析器校验结论（不含文件系统检查）。 */
  validation: z.object({
    success: z.boolean(),
    errors: z.array(z.string()),
    warnings: z.array(z.string()),
  }),
});
/** 单技能分析快照。 */
export type SkillSnapshot = z.infer<typeof SkillSnapshotSchema>;

/** 技能间关系边的类别。 */
export const RelationEdgeKindSchema = z.enum(["overlap", "conflict", "shared-resource"]);
/** 技能间关系边类别。 */
export type RelationEdgeKind = z.infer<typeof RelationEdgeKindSchema>;

/** 技能关系图的一条无向边；由对应 findings 推导，携带证据 finding ID。 */
export const RelationEdgeSchema = z.object({
  kind: RelationEdgeKindSchema,
  skillIds: z.tuple([SkillIdSchema, SkillIdSchema]),
  findingIds: z.array(FindingIdSchema).min(1),
});
/** 技能关系边。 */
export type RelationEdge = z.infer<typeof RelationEdgeSchema>;

/** daemon 持有的只读分析报告。 */
export const IntelligenceReportSchema = z.object({
  createdAt: z.string().datetime(),
  snapshots: z.array(SkillSnapshotSchema),
  findings: z.array(FindingSchema),
  edges: z.array(RelationEdgeSchema),
});
/** 只读分析报告。 */
export type IntelligenceReport = z.infer<typeof IntelligenceReportSchema>;

/** 分析输入中的一个技能选择（可跨 Provider）。 */
export const SkillSelectionSchema = z.object({
  ...WorkspaceProviderTargetSchema.shape,
  skillId: SkillIdSchema,
});
/** 单个技能选择。 */
export type SkillSelection = z.infer<typeof SkillSelectionSchema>;

/** analyze 的逐技能 typed failure（无法读取/校验的选择）。 */
export const AnalyzeFailureSchema = z.object({
  ...SkillSelectionSchema.shape,
  code: z.enum(["NOT_FOUND", "UNAVAILABLE", "FAILED"]),
  message: z.string().min(1),
});
/** 逐技能分析失败。 */
export type AnalyzeFailure = z.infer<typeof AnalyzeFailureSchema>;

/** skillIntelligence.analyze 输入。 */
export const AnalyzeInputSchema = z.object({
  selections: z.array(SkillSelectionSchema).min(1),
});
/** skillIntelligence.analyze 输入。 */
export type AnalyzeInput = z.infer<typeof AnalyzeInputSchema>;
/** skillIntelligence.analyze 输出：报告 + 逐技能失败（失败项不进入报告）。 */
export const AnalyzeResultSchema = z.object({
  report: IntelligenceReportSchema,
  failures: z.array(AnalyzeFailureSchema),
});

// ---- Proposal drafts ----

/** proposal 稳定 ID。 */
export const ProposalIdSchema = z
  .string()
  .regex(/^pr_[a-f0-9]{24}$/)
  .brand<"ProposalId">();
/** proposal 稳定 ID。 */
export type ProposalId = z.infer<typeof ProposalIdSchema>;

/** edit proposal：对现有技能的 frontmatter/body 完整替换草稿（审批走 creator.save update）。 */
export const EditProposalPayloadSchema = z.object({
  kind: z.literal("edit"),
  edits: z
    .array(
      z.object({
        selection: SkillSelectionSchema,
        frontmatter: SkillFrontmatterSchema,
        body: z.string(),
      }),
    )
    .min(1),
});

/** disable proposal：建议停用；审批走 skills.toggle，不触碰文件。 */
export const DisableProposalPayloadSchema = z.object({
  kind: z.literal("disable"),
  selections: z.array(SkillSelectionSchema).min(1),
  reason: z.string().min(1),
});

/** split proposal：把源技能拆成多个新技能草稿（审批走 creator.save create）。 */
export const SplitProposalPayloadSchema = z.object({
  kind: z.literal("split"),
  source: SkillSelectionSchema,
  targets: z
    .array(
      z.object({
        directoryName: SkillDirectoryNameSchema,
        frontmatter: SkillFrontmatterSchema,
        body: z.string(),
      }),
    )
    .min(2),
});

/** merge proposal：把多个源技能合并为一个新技能草稿（审批：create 目标 + revision-safe remove 源）。 */
export const MergeProposalPayloadSchema = z.object({
  kind: z.literal("merge"),
  sources: z.array(SkillSelectionSchema).min(2),
  target: z.object({
    directoryName: SkillDirectoryNameSchema,
    frontmatter: SkillFrontmatterSchema,
    body: z.string(),
  }),
});

/** 四类 proposal payload 的可判别联合。 */
export const ProposalPayloadSchema = z.discriminatedUnion("kind", [
  EditProposalPayloadSchema,
  DisableProposalPayloadSchema,
  SplitProposalPayloadSchema,
  MergeProposalPayloadSchema,
]);
/** proposal payload。 */
export type ProposalPayload = z.infer<typeof ProposalPayloadSchema>;

/** Manager-owned proposal 草稿；只在 daemon draft store 中流转，永不直接改 Provider。 */
export const ProposalDraftSchema = z.object({
  id: ProposalIdSchema,
  payload: ProposalPayloadSchema,
  /** 提案覆盖的全部技能及其 observed revisions；审批时逐项复核。 */
  observedRevisions: z.array(
    z.object({
      ...SkillSelectionSchema.shape,
      revision: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    }),
  ),
  /** 提案依据的 finding IDs（来自最近一次 analyze 报告，仅展示用途）。 */
  findingIds: z.array(FindingIdSchema),
  rationale: z.string().min(1),
  createdAt: z.string().datetime(),
});
/** proposal 草稿。 */
export type ProposalDraft = z.infer<typeof ProposalDraftSchema>;

/** skillIntelligence.propose 输入：payload + 依据；daemon 复核技能存在性后入草稿库。 */
export const ProposeInputSchema = z.object({
  payload: ProposalPayloadSchema,
  findingIds: z.array(FindingIdSchema),
  rationale: z.string().trim().min(1),
});
/** skillIntelligence.propose 输出。 */
export const ProposeResultSchema = z.object({
  proposal: ProposalDraftSchema,
});

/** skillIntelligence.list 输出。 */
export const ListProposalsResultSchema = z.object({
  proposals: z.array(ProposalDraftSchema),
});

/** skillIntelligence.reject 输入。 */
export const RejectProposalInputSchema = z.object({
  proposalId: ProposalIdSchema,
});
/** skillIntelligence.reject 输出。 */
export const RejectProposalResultSchema = z.object({
  rejected: z.literal(true),
});

/** skillIntelligence.approve 输入：显式 proposal ID；revision 期望锁定在草稿内。 */
export const ApproveProposalInputSchema = z.object({
  proposalId: ProposalIdSchema,
});
/** 审批中单个受影响技能的结果。 */
export const ApproveEntrySchema = z.object({
  ...SkillSelectionSchema.shape,
  name: z.string(),
  status: z.enum(["applied", "conflict", "failed", "skipped"]),
  error: z.string().optional(),
});
/** skillIntelligence.approve 输出：逐项结果（与 toggle 汇总口径一致，skipped 不算成功）。 */
export const ApproveResultSchema = z.object({
  results: z.array(ApproveEntrySchema),
  applied: z.number().int().nonnegative(),
  conflicts: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
});
/** proposal 审批结果。 */
export type ApproveResult = z.infer<typeof ApproveResultSchema>;
