/**
 * 用户原始需求 [2026-09-06]（openspec agent-steward）：「Agent 只能在隔离 execution root
 * 或 Manager-approved patch context 中工作。」「backend 缺失、版本不匹配、协议 handshake
 * 失败均显示 typed unavailable。」「Agent 建议必须映射为 ProposalDraft，apply 权力留在 Manager。」
 * 正交意图：
 *   [1] 用运行记录（含 observed revisions、findings、proposal、approval、terminal status）
 *       表达可审计的 steward run。
 *   [2] 用规范化 RunEvent 流表达 backend 无关的 agent 进度（thread/turn/item 等私有
 *       模型一律在 daemon 侧折叠为封闭枚举）。
 *   [3] 用 PermissionRequest/Decision 表达 manager 中介的一次性授权。
 *   [4] 用 BackendStatus 表达显式 backend 选择与 typed unavailable，不自动 fallback。
 * 妥协声明：run 事件是有界内存流（不落盘、不进 localStorage），与 proposal draft store
 *   同生命周期；审计快照以 StewardRun 投影为准。
 */
import { z } from "zod";
import { SkillIdSchema } from "./skills.js";
import {
  ApproveResultSchema,
  FindingIdSchema,
  ProposalIdSchema,
  ProposalPayloadSchema,
} from "./skill-intelligence.js";
import { WorkspaceProviderTargetSchema } from "./workspaces.js";

/** 显式可选的 agent backend；一次只启用一个，不自动 fallback。 */
export const StewardBackendIdSchema = z.enum(["fixture", "dsh", "codex"]);
/** backend 稳定标识。 */
export type StewardBackendId = z.infer<typeof StewardBackendIdSchema>;

/** daemon 拥有的不透明 steward run ID。 */
export const StewardRunIdSchema = z
  .string()
  .regex(/^sr_[a-f0-9]{24}$/)
  .brand<"StewardRunId">();
/** 运行时校验后的 steward run ID。 */
export type StewardRunId = z.infer<typeof StewardRunIdSchema>;

/** daemon 拥有的不透明授权请求 ID。 */
export const StewardPermissionRequestIdSchema = z
  .string()
  .regex(/^prm_[a-f0-9]{16}$/)
  .brand<"StewardPermissionRequestId">();
/** 运行时校验后的授权请求 ID。 */
export type StewardPermissionRequestId = z.infer<typeof StewardPermissionRequestIdSchema>;

/** Manager 编排管线的确定阶段；terminal 后为 null。 */
export const RunPhaseSchema = z.enum([
  "analyzing",
  "recommending",
  "drafting",
  "validating",
  "awaiting-approval",
  "applying",
]);
/** 运行阶段。 */
export type RunPhase = z.infer<typeof RunPhaseSchema>;

/**
 * 运行终态集合（spec：cancel、disconnect、process exit、shutdown 都是显式终态）。
 * running 是唯一非终态；unavailable 保留给 backend 在握手/启动期失败。
 */
export const RunStatusSchema = z.enum([
  "running",
  "completed",
  "cancelled",
  "failed",
  "disconnected",
  "unavailable",
  "stopped",
]);
/** 运行状态。 */
export type RunStatus = z.infer<typeof RunStatusSchema>;

/** 规范化 run 事件种类（backend 私有事件名不得穿透到 WebUI）。 */
export const RunEventKindSchema = z.enum([
  "run-started",
  "phase",
  "agent-message",
  "agent-item",
  "recommendation",
  "permission-request",
  "permission-decision",
  "draft-created",
  "draft-failed",
  "approval",
  "apply",
  "run-terminal",
]);
/** run 事件种类。 */
export type RunEventKind = z.infer<typeof RunEventKindSchema>;

/** 规范化 agent item 投影（codex thread item / ACP sessionUpdate 的封闭折叠）。 */
export const AgentItemKindSchema = z.enum([
  "reasoning",
  "agent-message",
  "command",
  "file-change",
  "tool-call",
  "web-search",
  "error",
  "other",
]);
/** agent item 投影。 */
export type AgentItemKind = z.infer<typeof AgentItemKindSchema>;

/** 单条规范化 run 事件（seq 在 run 内单调递增）。 */
export const RunEventSchema = z.object({
  seq: z.number().int().positive(),
  at: z.string().datetime(),
  runId: StewardRunIdSchema,
  kind: RunEventKindSchema,
  /** phase 事件携带目标阶段。 */
  phase: RunPhaseSchema.optional(),
  message: z.string().optional(),
  itemKind: AgentItemKindSchema.optional(),
  recommendationId: z.string().optional(),
  proposalId: ProposalIdSchema.optional(),
  permissionRequestId: StewardPermissionRequestIdSchema.optional(),
  /** run-terminal 事件携带终态。 */
  terminalStatus: RunStatusSchema.optional(),
});
/** 单条 run 事件。 */
export type RunEvent = z.infer<typeof RunEventSchema>;

/** backend capability handshake 的成功投影（版本与能力矩阵）。 */
export const HarnessCapabilitiesSchema = z.object({
  backendId: StewardBackendIdSchema,
  /** adapter 固定声明的协议/产品版本证据（如 initialize 响应的 userAgent）。 */
  version: z.string().min(1),
  streamingEvents: z.boolean(),
  cancellation: z.boolean(),
  permissionRequests: z.boolean(),
  /** agent 只允许在隔离根或 Manager 批准的 patch 上下文内工作。 */
  executionRoot: z.enum(["isolated", "patch-context"]),
});
/** backend 能力矩阵。 */
export type HarnessCapabilities = z.infer<typeof HarnessCapabilitiesSchema>;

/** backend 探测结果：available 携带能力，unavailable 携带 typed 原因。 */
export const BackendStatusSchema = z.discriminatedUnion("state", [
  z.object({
    state: z.literal("available"),
    capabilities: HarnessCapabilitiesSchema,
  }),
  z.object({
    state: z.literal("unavailable"),
    capabilities: z.object({ backendId: StewardBackendIdSchema }).passthrough(),
    reason: z.string().min(1),
  }),
]);
/** backend 探测结果。 */
export type BackendStatus = z.infer<typeof BackendStatusSchema>;

/** Agent 推荐：payload 复用 intelligence ProposalPayload（edit/disable/split/merge）。 */
export const RecommendationSchema = z.object({
  id: z
    .string()
    .regex(/^rcmd_[a-f0-9]{16}$/)
    .brand<"RecommendationId">(),
  kind: z.enum(["edit", "disable", "split", "merge"]),
  skillIds: z.array(SkillIdSchema).min(1),
  rationale: z.string().min(1),
  findingIds: z.array(FindingIdSchema),
  payload: ProposalPayloadSchema,
});
/** Agent 推荐。 */
export type Recommendation = z.infer<typeof RecommendationSchema>;
/** 推荐 ID。 */
export type RecommendationId = Recommendation["id"];

/** Agent 发起的授权请求（manager 中介，一次性裁决）。 */
export const PermissionRequestSchema = z.object({
  id: StewardPermissionRequestIdSchema,
  runId: StewardRunIdSchema,
  at: z.string().datetime(),
  summary: z.string().min(1),
  detail: z.string().optional(),
});
/** 授权请求。 */
export type PermissionRequest = z.infer<typeof PermissionRequestSchema>;

/** 一次性授权裁决；已裁决的请求不可再次裁决。 */
export const PermissionDecisionSchema = z.object({
  requestId: StewardPermissionRequestIdSchema,
  at: z.string().datetime(),
  decision: z.enum(["granted", "denied"]),
  note: z.string().optional(),
});
/** 授权裁决。 */
export type PermissionDecision = z.infer<typeof PermissionDecisionSchema>;

/** 一次 steward run 的审计投影。 */
export const StewardRunSchema = z.object({
  runId: StewardRunIdSchema,
  backendId: StewardBackendIdSchema,
  target: WorkspaceProviderTargetSchema,
  /** 运行输入的显式 Skill IDs（空数组在 start 时展开为 Provider 全量）。 */
  skillIds: z.array(SkillIdSchema),
  /** 分析时锁定的 revision（审计：哪些 revision 被分析过；格式同 contentRevision）。 */
  observedRevisions: z.array(
    z.object({ skillId: SkillIdSchema, revision: z.string().regex(/^sha256:[a-f0-9]{64}$/) }),
  ),
  capabilities: HarnessCapabilitiesSchema,
  executionRoot: z.string().min(1),
  objective: z.string().min(1),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().nullable(),
  status: RunStatusSchema,
  /** terminal 后为 null。 */
  phase: RunPhaseSchema.nullable(),
  error: z.string().nullable(),
  recommendations: z.array(RecommendationSchema),
  proposalIds: z.array(ProposalIdSchema),
  permissionRequests: z.array(PermissionRequestSchema),
  permissionDecisions: z.array(PermissionDecisionSchema),
});
/** 一次 steward run。 */
export type StewardRun = z.infer<typeof StewardRunSchema>;

/** ---- RPC 输入/输出 ---- */

export const StewardBackendsResultSchema = z.object({
  backends: z.array(BackendStatusSchema),
});
/** backend 列表结果。 */
export type StewardBackendsResult = z.infer<typeof StewardBackendsResultSchema>;

export const StewardListResultSchema = z.object({
  runs: z.array(StewardRunSchema),
});
/** run 列表结果（新→旧，有界）。 */
export type StewardListResult = z.infer<typeof StewardListResultSchema>;

export const StewardStartInputSchema = z.object({
  backendId: StewardBackendIdSchema,
  target: WorkspaceProviderTargetSchema,
  /** 省略时分析 Provider 下全部技能。 */
  skillIds: z.array(SkillIdSchema).optional(),
  objective: z.string().min(1).max(400).optional(),
});
/** 启动 run 的入参。 */
export type StewardStartInput = z.infer<typeof StewardStartInputSchema>;

export const StewardStartResultSchema = z.object({
  run: StewardRunSchema,
});
/** 启动结果（立即返回 analyzing 阶段的 run 投影）。 */
export type StewardStartResult = z.infer<typeof StewardStartResultSchema>;

export const StewardEventsInputSchema = z.object({
  runId: StewardRunIdSchema,
  /** 只返回 seq 大于该值的增量事件。 */
  afterSeq: z.number().int().nonnegative().optional(),
});
/** 事件轮询入参。 */
export type StewardEventsInput = z.infer<typeof StewardEventsInputSchema>;

export const StewardEventsResultSchema = z.object({
  runId: StewardRunIdSchema,
  events: z.array(RunEventSchema),
  status: RunStatusSchema,
  phase: RunPhaseSchema.nullable(),
});
/** 事件轮询结果。 */
export type StewardEventsResult = z.infer<typeof StewardEventsResultSchema>;

export const StewardCancelInputSchema = z.object({
  runId: StewardRunIdSchema,
});
/** 取消 run 的入参。 */
export type StewardCancelInput = z.infer<typeof StewardCancelInputSchema>;

export const StewardCancelResultSchema = z.object({
  run: StewardRunSchema,
});
/** 取消结果。 */
export type StewardCancelResult = z.infer<typeof StewardCancelResultSchema>;

export const StewardDecidePermissionInputSchema = z.object({
  runId: StewardRunIdSchema,
  requestId: StewardPermissionRequestIdSchema,
  decision: z.enum(["granted", "denied"]),
  note: z.string().max(400).optional(),
});
/** 授权裁决入参。 */
export type StewardDecidePermissionInput = z.infer<typeof StewardDecidePermissionInputSchema>;

export const StewardDecidePermissionResultSchema = z.object({
  run: StewardRunSchema,
});
/** 授权裁决结果。 */
export type StewardDecidePermissionResult = z.infer<typeof StewardDecidePermissionResultSchema>;

export const StewardProposalInputSchema = z.object({
  runId: StewardRunIdSchema,
  proposalId: ProposalIdSchema,
});
/** run 内审批/拒绝 proposal 的入参。 */
export type StewardProposalInput = z.infer<typeof StewardProposalInputSchema>;

/** run 内审批 proposal 的结果（携带 Manager apply 的逐项结果）。 */
export const StewardApproveResultSchema = z.object({
  run: StewardRunSchema,
  result: ApproveResultSchema,
});
/** 审批结果。 */
export type StewardApproveResult = z.infer<typeof StewardApproveResultSchema>;

/** run 内拒绝 proposal 的结果。 */
export const StewardRejectResultSchema = z.object({
  run: StewardRunSchema,
});
/** 拒绝结果。 */
export type StewardRejectResult = z.infer<typeof StewardRejectResultSchema>;
