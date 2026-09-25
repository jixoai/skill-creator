/**
 * 蒸馏编排共享契约（skill-wiki-maintainer tasks 1.3/1.4；design E/U 冻结块）。
 *
 * 用户原始需求 [2026-09-25]（openspec change skill-wiki-maintainer design E）：
 * 「新增 src/shared/contracts/wiki-distill.ts（RPC/CLI --json/GUI store 同源；
 * 单一 phase 契约——无独立 phase 字段，RunState 即阶段真相）」。
 * 用户原始需求 [2026-09-25]（design U r11）：「exact shared schemas——设计即冻结
 * 实现形状：DistillErrorCode/CapabilityFailureDetail/reject 传输联合。」
 *
 * 正交意图：
 *   [1] RPC/CLI/GUI 三面同源的蒸馏状态契约：start/status/cancel 输入输出、
 *       RunState/DistillFailReason/DistillItemStatus/DistillLedgerStatus/
 *       TerminalDistillLedgerStatus 闭合枚举（E 为唯一规范源——skill-wiki
 *       distill/schema.ts 的同名枚举与本文件同集同值，同步性由测试钉死）。
 *   [2] proposal 决定面 wire 契约（U）：DistillErrorCode 闭合 Zod enum、
 *       ProposalDecisionSnapshot（非递归快照）、CapabilityFailureDetail 判别
 *       联合（PROPOSAL_STALE 分支强制 currentView）、McpProposalView 五分支
 *       判别联合（failed 强制 failureDetail/rejected 携带 cause）、
 *       CapabilityCallResult 的 Zod 冻结（capability/core.ts 的 TS 类型自本
 *       schema 推导——单一事实源）。
 * 妥协声明：本文件必须保持 browser-safe（webui 经 rpc-contract 传递消费）——
 *   不 import skill-wiki（其 distill/schema 传递依赖 @jixoai/search 的 node:fs）；
 *   与 skill-wiki 枚举的同源性以「同集同值 + 测试断言」保证，而非 import 边。
 */
import { z } from "zod";
import { WorkspaceIdSchema } from "./workspaces.js";

/* ------------------------------------------------------------------ */
/* E：run 状态契约（唯一规范源）                                        */
/* ------------------------------------------------------------------ */

/** 蒸馏 run 标识形状（daemon 生成 wd_<24hex>；与 skill-wiki DistillRunIdSchema 同值）。 */
export const DistillRunIdSchema = z.string().regex(/^wd_[0-9a-f]{24}$/);
export type DistillRunId = z.infer<typeof DistillRunIdSchema>;

/** RunState：阶段真相（无独立 phase 字段；终态幂等可轮询）。 */
export const RunStateSchema = z.enum([
  "collecting",
  "kernel-running",
  "awaiting-approval",
  "completed",
  "failed",
  "cancelled",
]);
export type RunState = z.infer<typeof RunStateSchema>;

/** DistillFailReason：仅 failed/cancelled 终态可携带（null = 活跃/完成/用户主动取消）。 */
export const DistillFailReasonSchema = z.enum([
  "no-valid-proposals",
  "capacity",
  "io",
  "timeout",
  "kernel-unavailable",
  "restarted",
  "cancelled-by-shutdown",
]);
export type DistillFailReason = z.infer<typeof DistillFailReasonSchema>;

/** DistillItemStatus：counters 全键枚举（model-invalid 无 ledger 行，仅在 counters 呈现）。 */
export const DistillItemStatusSchema = z.enum([
  "applied",
  "idempotent",
  "stale",
  "patch-failed",
  "model-invalid",
  "rejected",
  "expired",
  "not-proposed",
  "io-failed",
]);
export type DistillItemStatus = z.infer<typeof DistillItemStatusSchema>;

/** DistillLedgerStatus：ledger 行状态（⊂ ItemStatus——model-invalid 无行）。 */
export const DistillLedgerStatusSchema = z.enum([
  "pending",
  "applying",
  "applied",
  "idempotent",
  "stale",
  "patch-failed",
  "expired",
  "rejected",
  "not-proposed",
  "io-failed",
]);
export type DistillLedgerStatus = z.infer<typeof DistillLedgerStatusSchema>;

/** TerminalDistillLedgerStatus：终态闭合集（W；重放零写、不复活）。 */
export const TerminalDistillLedgerStatusSchema = z.enum([
  "applied",
  "idempotent",
  "stale",
  "patch-failed",
  "expired",
  "rejected",
  "not-proposed",
  "io-failed",
]);
export type TerminalDistillLedgerStatus = z.infer<typeof TerminalDistillLedgerStatusSchema>;

/** counters：全键 strictObject（每个 DistillItemStatus 键必现，缺项 0 补齐）。 */
export const DistillCountersSchema = z.strictObject(
  Object.fromEntries(
    DistillItemStatusSchema.options.map((status) => [status, z.number().int().nonnegative()]),
  ) as Record<(typeof DistillItemStatusSchema)["options"][number], z.ZodNumber>,
);
export type DistillCounters = z.infer<typeof DistillCountersSchema>;

/** start 输入：同 source 活跃 run ≤1（重复 → DISTILL_ACTIVE_RUN）。 */
export const DistillStartInputSchema = z.strictObject({ source: WorkspaceIdSchema });
export type DistillStartInput = z.infer<typeof DistillStartInputSchema>;

/** start 输出。 */
export const DistillStartOutputSchema = z.strictObject({ runId: DistillRunIdSchema });
export type DistillStartOutput = z.infer<typeof DistillStartOutputSchema>;

/** status/cancel 输入。 */
export const DistillRunInputSchema = z.strictObject({ runId: DistillRunIdSchema });
export type DistillRunInput = z.infer<typeof DistillRunInputSchema>;

/** proposalRefs 行：ordinal → store 投影（未入场 = null）。 */
const DistillProposalRefSchema = z.strictObject({
  ordinal: z.number().int().nonnegative(),
  proposalId: z.string().nullable(),
  status: DistillLedgerStatusSchema,
});

/** status 输出（strictObject 全键；三面同源推导自本 schema）。 */
export const DistillStatusOutputSchema = z.strictObject({
  runId: DistillRunIdSchema,
  state: RunStateSchema,
  reason: DistillFailReasonSchema.nullable(),
  counters: DistillCountersSchema,
  proposalRefs: z.array(DistillProposalRefSchema),
});
export type DistillStatusOutput = z.infer<typeof DistillStatusOutputSchema>;

/**
 * cancel 输出。state 字段为 RunState：真实取消 → "cancelled"；终态幂等重放
 * （S：completed/cancelled/failed 上 cancel 幂等返回既有终态，不报错）→ 原终态。
 */
export const DistillCancelOutputSchema = z.strictObject({
  runId: DistillRunIdSchema,
  state: RunStateSchema,
});
export type DistillCancelOutput = z.infer<typeof DistillCancelOutputSchema>;

/** wiki.distill_apply capability 输入（路由键；提案体由 handler 从 ledger 反查）。 */
export const DistillApplyInputSchema = z.strictObject({
  runId: DistillRunIdSchema,
  ordinal: z.number().int().nonnegative(),
});
export type DistillApplyInput = z.infer<typeof DistillApplyInputSchema>;

/* ------------------------------------------------------------------ */
/* U：proposal 决定面 wire 契约（exact shared schemas）                 */
/* ------------------------------------------------------------------ */

/** 蒸馏错误码闭合集（未知串拒绝；WIKI_PATCH_FAILED 为 wiki 域码透传）。 */
export const DistillErrorCodeSchema = z.enum([
  "DISTILL_IO",
  "DISTILL_LIMIT",
  "DISTILL_RUN_NOT_FOUND",
  "DISTILL_STALE",
  "DISTILL_ACTIVE_RUN",
  "PROPOSAL_STALE",
  "WIKI_PATCH_FAILED",
]);
export type DistillErrorCode = z.infer<typeof DistillErrorCodeSchema>;

/** proposal 状态闭合集（approved = 决定 CAS 后、队列终态前的瞬态，T）。 */
export const McpProposalStatusSchema = z.enum([
  "pending",
  "approved",
  "rejected",
  "executed",
  "failed",
]);
export type McpProposalStatus = z.infer<typeof McpProposalStatusSchema>;

/** reject 的公开 cause（R：用户取消 vs 人工拒绝二分）。 */
export const ProposalRejectCauseSchema = z.enum(["human", "cancelled"]);
export type ProposalRejectCause = z.infer<typeof ProposalRejectCauseSchema>;

/** 决定时刻核心投影的非递归快照（PROPOSAL_STALE detail 的 currentView 载荷）。 */
export const ProposalDecisionSnapshotSchema = z.strictObject({
  proposalId: z.string(),
  capability: z.string(),
  input: z.unknown(),
  status: McpProposalStatusSchema,
  rejectedCause: ProposalRejectCauseSchema.optional(),
  decidedAt: z.string().optional(),
});
export type ProposalDecisionSnapshot = z.infer<typeof ProposalDecisionSnapshotSchema>;

/**
 * capability 失败详情（TS + Zod 双冻结）：failed.detail 携带该形状；PROPOSAL_STALE
 * 分支强制 currentView（discriminatedUnion 强制，非注释约束），其余码禁带。
 */
export const CapabilityFailureDetailSchema = z.discriminatedUnion("code", [
  z.strictObject({
    code: z.literal("PROPOSAL_STALE"),
    message: z.string(),
    currentView: ProposalDecisionSnapshotSchema,
    runId: z.string().optional(),
    ordinal: z.number().int().nonnegative().optional(),
  }),
  z.strictObject({
    code: DistillErrorCodeSchema.exclude(["PROPOSAL_STALE"]),
    message: z.string(),
    runId: z.string().optional(),
    ordinal: z.number().int().nonnegative().optional(),
  }),
]);
export type CapabilityFailureDetail = z.infer<typeof CapabilityFailureDetailSchema>;

/**
 * capability 调用闭合结果的 Zod 冻结（src/daemon/capability/core.ts 的 TS 类型
 * 自本 schema 推导——单一事实源；failed 分支增补 detail?: CapabilityFailureDetail）。
 */
export const CapabilityCallResultSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("ok"), value: z.unknown() }),
  z.strictObject({
    kind: z.literal("denied"),
    reason: z.enum(["unsupported-capability", "principal-forbidden"]),
    requestedOperation: z.string(),
  }),
  z.strictObject({
    kind: z.literal("failed"),
    code: z.enum(["NOT_FOUND", "CONFLICT", "INVALID_OPERATION", "UNAVAILABLE", "STALE"]),
    message: z.string(),
    detail: CapabilityFailureDetailSchema.optional(),
  }),
]);
export type CapabilityCallResult = z.infer<typeof CapabilityCallResultSchema>;

/**
 * proposal view 完整五分支判别联合（r13）：failed 分支 schema 级强制 failureDetail、
 * rejected 分支强制 cause、executed 携带 result；本 schema 是 wire 冻结形状——
 * 蒸馏面 proposal 的 store 视图必须逐分支可解析（非蒸馏 legacy 失败可无 detail，
 * 由 agent.ts 的宽松投影承载，见该文件）。
 */
export const McpProposalViewSchema = z.discriminatedUnion("status", [
  z.strictObject({
    proposalId: z.string(),
    capability: z.string(),
    input: z.unknown(),
    status: z.literal("pending"),
    createdAt: z.string(),
  }),
  z.strictObject({
    proposalId: z.string(),
    capability: z.string(),
    input: z.unknown(),
    status: z.literal("approved"),
    createdAt: z.string(),
    decidedAt: z.string(),
  }),
  z.strictObject({
    proposalId: z.string(),
    capability: z.string(),
    input: z.unknown(),
    status: z.literal("rejected"),
    createdAt: z.string(),
    decidedAt: z.string(),
    rejectedCause: ProposalRejectCauseSchema,
  }),
  z.strictObject({
    proposalId: z.string(),
    capability: z.string(),
    input: z.unknown(),
    status: z.literal("executed"),
    createdAt: z.string(),
    decidedAt: z.string(),
    result: CapabilityCallResultSchema,
  }),
  z.strictObject({
    proposalId: z.string(),
    capability: z.string(),
    input: z.unknown(),
    status: z.literal("failed"),
    createdAt: z.string(),
    decidedAt: z.string(),
    result: CapabilityCallResultSchema,
    failureDetail: CapabilityFailureDetailSchema,
  }),
]);
export type McpProposalViewWire = z.infer<typeof McpProposalViewSchema>;

/** MCP 失败结果 text envelope（U：`{ detail }` 包一层，同一 schema 四面解析）。 */
export const McpFailureEnvelopeSchema = z.strictObject({
  detail: CapabilityFailureDetailSchema,
});
export type McpFailureEnvelope = z.infer<typeof McpFailureEnvelopeSchema>;
