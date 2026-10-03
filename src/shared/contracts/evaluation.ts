/**
 * 技能评估语料与跑分契约（evaluation-corpus；工作计划 Ch3）。
 *
 * 用户原始需求 [2026-09-30]：「webui 里面还有一些残留的未完成的工作，比如 skill
 * 测试与评估」——评估语料 = workspace-private、server-owned 的 case 存储 +
 * 五态结果协议（codex r2-r5 复核冻结）。
 * 修订 [2026-10-03]（evaluating-dashboard design §1 r2 定稿）：补
 * `evaluation.overview` 聚合 io（targets 字典序 cursor 分页 + recentRuns 固定
 * 窗口 20 + staleRatio 零分母缺席 + 单 target typed error 行）。
 *
 * 正交意图：
 *   [1] case schema（B2/B′5）：五类断言（min(1)）+ 双 hash 域（boundRevision
 *       技能文档域 / corpusDigest 语料域）。
 *   [2] result schema（B3/B′1）：五态判别联合；outcome↔failure 互斥 refine；
 *       unavailable/stale 断言恒空。
 *   [3] overview 聚合 io：per-target 评估状态摘要（Evaluating 区块总览屏）。
 */
import { z } from "zod";
import { SkillIdSchema } from "./skills.js";
import { ProviderIdSchema, WorkspaceIdSchema } from "./workspaces.js";

/** 评估作用域目标（与 WorkspaceProviderTarget 同构；显式声明避免循环依赖）。 */
export const EvaluationTargetSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  providerId: ProviderIdSchema,
  skillId: SkillIdSchema,
});
/** 评估作用域目标。 */
export type EvaluationTarget = z.infer<typeof EvaluationTargetSchema>;

/** 断言种类（B2/B′5：finding-triggered 为布尔——fixture 的 expectTrigger 域）。 */
export const EvaluationAssertionSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("contains"),
    value: z.string().min(1),
    description: z.string().optional(),
  }),
  z.strictObject({
    kind: z.literal("not-contains"),
    value: z.string().min(1),
    description: z.string().optional(),
  }),
  z.strictObject({
    kind: z.literal("finding-kind"),
    value: z.string().min(1),
    description: z.string().optional(),
  }),
  z.strictObject({
    kind: z.literal("finding-triggered"),
    value: z.boolean(),
    description: z.string().optional(),
  }),
  z.strictObject({
    kind: z.literal("finding-severity"),
    value: z.enum(["info", "warning", "error"]),
    description: z.string().optional(),
  }),
]);
/** 评估断言。 */
export type EvaluationAssertion = z.infer<typeof EvaluationAssertionSchema>;

/** case 正文（B2；assertions min(1)——空断言集在 CRUD 即拒绝）。 */
export const EvaluationCaseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  caseId: z.string().regex(/^ev_[a-f0-9]{24}$/),
  enabled: z.boolean(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  source: z.enum(["user", "builtin-fixture"]),
  /** 技能文档 revision 域（sha256:…；stale 判定基准）。 */
  boundRevision: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  /** 语料域 digest（仅 builtin-fixture 导入样本；相对路径排序 + 内容字节序拼接的 sha256）。 */
  corpusDigest: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  input: z.strictObject({
    prompt: z.string().min(1),
    assertions: z.array(EvaluationAssertionSchema).min(1),
  }),
});
/** 评估 case。 */
export type EvaluationCase = z.infer<typeof EvaluationCaseSchema>;

/** case 存储信封（cases.json；不兼容 → 空信封重建）。 */
export const EvaluationCaseEnvelopeSchema = z.strictObject({
  schemaVersion: z.literal(1),
  cases: z.array(EvaluationCaseSchema),
});

/** 结果失败码全枚举（B3 r5：执行族与依赖族；与 outcome 的配对由 refine 强制）。 */
export const EvaluationFailureCodeSchema = z.enum([
  "RUNNER_ERROR",
  "ASSERTION_ERROR",
  "MODEL_UNAVAILABLE",
  "DSH_UNAVAILABLE",
  "PROVIDER_ROUTE_MISSING",
]);
/** 评估失败码。 */
export type EvaluationFailureCode = z.infer<typeof EvaluationFailureCodeSchema>;

const EXECUTION_CODES = new Set(["RUNNER_ERROR", "ASSERTION_ERROR"]);
const DEPENDENCY_CODES = new Set([
  "MODEL_UNAVAILABLE",
  "DSH_UNAVAILABLE",
  "PROVIDER_ROUTE_MISSING",
]);

/** runner 版本三元组（B3 r5：结构化，不拍平；analyzer 路径 dshVersion="n/a"）。 */
export const EvaluationRunnerSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("analyzer"),
    version: z.strictObject({
      promptVersion: z.string().min(1),
      toolVersion: z.string().min(1),
      dshVersion: z.literal("n/a"),
    }),
  }),
  z.strictObject({
    kind: z.literal("provider-model"),
    version: z.strictObject({
      promptVersion: z.string().min(1),
      toolVersion: z.string().min(1),
      dshVersion: z.string().min(1),
    }),
  }),
]);
/** 评估 runner 描述。 */
export type EvaluationRunner = z.infer<typeof EvaluationRunnerSchema>;

/** 单条断言的裁决（unavailable/stale 结果的数组恒空）。 */
const AssertionOutcomeSchema = z.strictObject({
  ref: z.number().int().nonnegative(),
  outcome: z.enum(["passed", "failed", "error"]),
});

const ResultBase = {
  schemaVersion: z.literal(1),
  resultId: z.string().regex(/^evr_[a-f0-9]{24}$/),
  runId: z.string().regex(/^run_[a-f0-9]{24}$/),
  caseId: z.string().regex(/^ev_[a-f0-9]{24}$/),
  target: EvaluationTargetSchema,
  expectedRevision: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  observedStartRevision: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  observedEndRevision: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  runner: EvaluationRunnerSchema,
  startedAt: z.string().min(1),
  endedAt: z.string().min(1),
};

/** 五态判别联合（B3/B′1）：failure 配对互斥 + 空 assertions 语义由判别支固化。 */
export const EvaluationResultSchema = z.discriminatedUnion("outcome", [
  z.strictObject({
    ...ResultBase,
    outcome: z.literal("passed"),
    assertions: z.array(AssertionOutcomeSchema).min(1),
  }),
  z.strictObject({
    ...ResultBase,
    outcome: z.literal("failed"),
    assertions: z.array(AssertionOutcomeSchema).min(1),
  }),
  z
    .strictObject({
      ...ResultBase,
      outcome: z.literal("error"),
      assertions: z.array(AssertionOutcomeSchema),
      failure: z.strictObject({ code: EvaluationFailureCodeSchema, detail: z.string().min(1) }),
    })
    .refine((entry) => EXECUTION_CODES.has(entry.failure.code), {
      message: "outcome=error requires an execution-family failure code",
    }),
  z
    .strictObject({
      ...ResultBase,
      outcome: z.literal("unavailable"),
      assertions: z.array(AssertionOutcomeSchema).max(0),
      failure: z.strictObject({ code: EvaluationFailureCodeSchema, detail: z.string().min(1) }),
    })
    .refine((entry) => DEPENDENCY_CODES.has(entry.failure.code), {
      message: "outcome=unavailable requires a dependency-family failure code",
    }),
  z.strictObject({
    ...ResultBase,
    outcome: z.literal("stale"),
    assertions: z.array(AssertionOutcomeSchema).max(0),
  }),
]);
/** 评估结果。 */
export type EvaluationResult = z.infer<typeof EvaluationResultSchema>;

/** 结果存储信封（results.json；每 case 有界保留最新 20 条）。 */
export const EvaluationResultEnvelopeSchema = z.strictObject({
  schemaVersion: z.literal(1),
  results: z.array(EvaluationResultSchema),
});

/** run 生命周期状态（B′4）。 */
export const EvaluationRunStatusSchema = z.enum(["queued", "running", "completed", "cancelled"]);
/** run 状态。 */
export type EvaluationRunStatus = z.infer<typeof EvaluationRunStatusSchema>;

/** ---- RPC io（B5 八过程；evaluation-corpus）---- */

export const EvaluationCaseCreateInputSchema = z.strictObject({
  target: EvaluationTargetSchema,
  input: z.strictObject({
    prompt: z.string().min(1),
    assertions: z.array(EvaluationAssertionSchema).min(1),
  }),
  boundRevision: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  enabled: z.boolean().optional(),
});
export type EvaluationCaseCreateInput = z.infer<typeof EvaluationCaseCreateInputSchema>;

export const EvaluationCaseUpdateInputSchema = EvaluationCaseCreateInputSchema.extend({
  caseId: z.string().regex(/^ev_[a-f0-9]{24}$/),
});
export type EvaluationCaseUpdateInput = z.infer<typeof EvaluationCaseUpdateInputSchema>;

export const EvaluationCaseRemoveInputSchema = z.strictObject({
  target: EvaluationTargetSchema,
  caseId: z.string().regex(/^ev_[a-f0-9]{24}$/),
});

export const EvaluationCaseListInputSchema = z.strictObject({
  target: EvaluationTargetSchema,
});

export const EvaluationRunStartInputSchema = z.strictObject({
  target: EvaluationTargetSchema,
  caseIds: z.array(z.string().regex(/^ev_[a-f0-9]{24}$/)).min(1),
  runner: z.enum(["analyzer", "provider-model"]),
});

export const EvaluationRunRefInputSchema = z.strictObject({
  runId: z.string().regex(/^run_[a-f0-9]{24}$/),
});

export const EvaluationResultsListInputSchema = z.strictObject({
  target: EvaluationTargetSchema,
  caseId: z
    .string()
    .regex(/^ev_[a-f0-9]{24}$/)
    .optional(),
});

/** 结果列表项（展示层 stale 投影；结果本体不可变）。 */
export const EvaluationResultViewSchema = z.intersection(
  EvaluationResultSchema,
  z.strictObject({ stale: z.boolean() }),
);
export type EvaluationResultView = z.infer<typeof EvaluationResultViewSchema>;

/** ---- overview 聚合 io（evaluating-dashboard design §1 r2 定稿）---- */

/**
 * overview 游标 codec：opaque 起始键（providerId, skillId；含起始行）。
 * 纯字符串往返（base64），输入 schema 与 daemon 共用同一判定源。
 */
export function encodeEvaluationOverviewCursor(key: {
  providerId: string;
  skillId: string;
}): string {
  return btoa(`${key.providerId}:${key.skillId}`);
}

/** 解码 overview 游标；非法形状返回 null（schema refine 据此拒绝 typed 校验错误）。 */
export function decodeEvaluationOverviewCursor(value: string): {
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

const EvaluationOverviewCursorSchema = z
  .string()
  .min(1)
  .refine((value) => decodeEvaluationOverviewCursor(value) !== null, {
    message: "malformed evaluation overview cursor",
  });

/** overview 输入：targets 分页 limit 默认 50、上限 200（design §1 r2 定稿）。 */
export const EvaluationOverviewInputSchema = z.strictObject({
  wsId: WorkspaceIdSchema,
  cursor: EvaluationOverviewCursorSchema.optional(),
  limit: z.number().int().min(1).max(200).default(50),
});
export type EvaluationOverviewInput = z.infer<typeof EvaluationOverviewInputSchema>;

/** 单 target 的 IO 失败投影（typed code 闭集；摘要字段缺席，整页不失败）。 */
export const EvaluationOverviewTargetErrorSchema = z.strictObject({
  target: EvaluationTargetSchema,
  error: z.strictObject({
    code: z.enum(["unavailable", "io-error"]),
    message: z.string(),
  }),
});

/** overview 正常 target 摘要行（lastRun/staleRatio 可选缺席）。 */
export const EvaluationOverviewTargetOkSchema = z.strictObject({
  target: EvaluationTargetSchema,
  skillName: z.string(),
  caseCount: z.number().int().nonnegative(),
  /** 最新一条已落盘 run 的摘要（endedAt = 该 run 结果行最大 endedAt）。 */
  lastRun: z
    .strictObject({
      endedAt: z.string().min(1),
      status: EvaluationRunStatusSchema,
      passedCount: z.number().int().nonnegative(),
      failedCount: z.number().int().nonnegative(),
      errorCount: z.number().int().nonnegative(),
      unavailableCount: z.number().int().nonnegative(),
    })
    .optional(),
  /** 每 case 最新一条结果中 observedEndRevision ≠ 当前 revision 的占比；零分母缺席。 */
  staleRatio: z.number().min(0).max(1).optional(),
});

/** overview target 行：正常摘要或 typed error 行（error 行摘要字段缺席）。 */
export const EvaluationOverviewTargetSchema = z.union([
  EvaluationOverviewTargetOkSchema,
  EvaluationOverviewTargetErrorSchema,
]);
export type EvaluationOverviewTarget = z.infer<typeof EvaluationOverviewTargetSchema>;

/** recentRuns 行（固定窗口 20；startedAt 降序 + runId 字典序 tie-break，不分页）。 */
export const EvaluationOverviewRecentRunSchema = z.strictObject({
  runId: z.string().regex(/^run_[a-f0-9]{24}$/),
  target: EvaluationTargetSchema,
  status: EvaluationRunStatusSchema,
  startedAt: z.string().min(1),
  endedAt: z.string().min(1).optional(),
  resultIds: z.array(z.string().regex(/^evr_[a-f0-9]{24}$/)),
});
export type EvaluationOverviewRecentRun = z.infer<typeof EvaluationOverviewRecentRunSchema>;

/** overview 输出（targets 按 target 三元组字典序唯一排序；nextCursor 缺席即末段）。 */
export const EvaluationOverviewOutputSchema = z.strictObject({
  targets: z.array(EvaluationOverviewTargetSchema),
  recentRuns: z.array(EvaluationOverviewRecentRunSchema),
  nextCursor: z.string().optional(),
});
export type EvaluationOverviewOutput = z.infer<typeof EvaluationOverviewOutputSchema>;
