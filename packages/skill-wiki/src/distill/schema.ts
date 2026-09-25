/**
 * 用户原始需求 [2026-09-25]（切片③ skill-wiki-maintainer）：「泛化 = LLM 蒸馏
 * 非机械 mv；workspace 原文永不删除；promotedFrom 溯源足迹；SDK 纯领域库
 * （无 LLM 依赖）」（design.md §0 裁决沉淀；契约形状以 design §2/E/W 为唯一
 * 规范源）。
 * 正交意图：
 *   [1] 蒸馏契约 Zod 单一事实源：预算常量（版本化 DISTILL_BUDGETS）、提案
 *       判别联合、plan item、ItemResult、ledger record（含 attempts）、
 *       Corpus 冻结形状——宿主与 SDK 的外部契约（unknown 键一律拒绝）。
 * 妥协声明：E 的 RPC 面契约（DistillStatusOutput 等）属
 * src/shared/contracts/wiki-distill.ts（后续任务）；本文件只冻结 SDK 两段式
 * （plan/apply）所需的形状，DistillItemStatus/DistillLedgerStatus 枚举与 E
 * 同集同值。
 */
import { z } from "zod";
import { TOKENIZER_VERSION } from "@jixoai/search";
import { PatternNameSchema } from "../schema.js";
import { WikiEditSchema } from "../patch.js";

/** sha256-hex（64 位小写十六进制）。 */
export const Sha256HexSchema = z.string().regex(/^[a-f0-9]{64}$/);

/** 蒸馏 run 标识（daemon 生成；不可预测 24 位十六进制）。 */
export const DistillRunIdSchema = z.string().regex(/^wd_[0-9a-f]{24}$/);

/**
 * 预算常量（design §2 冻结；版本化导出——调整任一数值必须 bump
 * DISTILL_BUDGETS_VERSION 并在变更说明中给出依据）。
 */
export interface DistillBudgets {
  /** 单 run 参与语料判定的 workspace pattern 上限（CLI --limit ≤ 此值）。 */
  patternsPerRun: 100;
  /** 语料 pattern 数默认值（--limit 缺省）。 */
  corpusPatternDefault: 20;
  /** 单 pattern 正文的语料侧截断上限（字符）。 */
  patternBodyChars: 8_000;
  /** 语料总字符上限。 */
  corpusTotalChars: 200_000;
  /** 模型原始输出截断上限（超限截断并置 flag，宿主侧执行）。 */
  modelOutputChars: 256_000;
  /** 单 run 提案数上限（plan 期预算：超出 ordinal 判 model-invalid(budget)）。 */
  proposalsPerRun: 32;
}

export const DISTILL_BUDGETS_VERSION = 1;

export const DISTILL_BUDGETS: Readonly<DistillBudgets> = Object.freeze({
  patternsPerRun: 100,
  corpusPatternDefault: 20,
  patternBodyChars: 8_000,
  corpusTotalChars: 200_000,
  modelOutputChars: 256_000,
  proposalsPerRun: 32,
});

/**
 * 蒸馏证据阈值（design W：v1 = 0.30，作用域 = @jixoai/search 冻结 BM25 打分的
 * 原始 score；阈值随 TOKENIZER/打分版本联动重校准时必须 bump）。
 */
export const DISTILL_EVIDENCE_THRESHOLD = 0.3;

/** 语料打分版本（格式冻结：`${TOKENIZER_VERSION}/bm25-frozen`）。 */
export const DISTILL_SCORE_VERSION = `${TOKENIZER_VERSION}/bm25-frozen`;

/** promotedFrom 足迹条目（canonical JSON 单行标量序列化，见 promoted-from.ts）。 */
export const PromotedFromEntrySchema = z.strictObject({
  runId: DistillRunIdSchema,
  sourceScope: z.string().min(1),
  sourcePatternIds: z.array(PatternNameSchema).min(1).max(50),
});
export type PromotedFromEntry = z.infer<typeof PromotedFromEntrySchema>;

/** 蒸馏提案来源（足迹构造输入；sourcePatternIds 取自 item 的提案）。 */
export interface DistillProvenance {
  runId: string;
  sourceScope: string;
}

/** create 提案：新建 global pattern 页。 */
export const DistillCreateProposalSchema = z.strictObject({
  action: z.literal("create"),
  title: z.string().min(1).max(120),
  body: z.string().min(1).max(20_000),
  sourcePatternIds: z.array(PatternNameSchema).min(1).max(50),
});
export type DistillCreateProposal = z.infer<typeof DistillCreateProposalSchema>;

/** absorb 提案：patch 词汇表吸收进既有 global pattern（钉死 before hash）。 */
export const DistillAbsorbProposalSchema = z.strictObject({
  action: z.literal("absorb"),
  targetPatternId: PatternNameSchema,
  edits: z.array(WikiEditSchema).min(1).max(10),
  /** planDistillation 回填并校验（与当前页正文 hash 全等）。 */
  expectedBeforeBodyHash: Sha256HexSchema,
  sourcePatternIds: z.array(PatternNameSchema).min(1).max(50),
});
export type DistillAbsorbProposal = z.infer<typeof DistillAbsorbProposalSchema>;

/** 蒸馏提案判别联合（模型原始输出逐项经此收窄；unknown 键拒绝）。 */
export const DistillProposalSchema = z.discriminatedUnion("action", [
  DistillCreateProposalSchema,
  DistillAbsorbProposalSchema,
]);
export type DistillProposal = z.infer<typeof DistillProposalSchema>;

/** plan 项摘要（设计 §5 proposals.jsonl 每行的 proposal+digest 投影；apply 输入）。 */
export const DistillPlanItemSchema = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("absorb"),
    ordinal: z.number().int().nonnegative(),
    /** 提案 canonical JSON 的 sha256（宿主 capability 输入反查校验用）。 */
    digest: Sha256HexSchema,
    proposal: DistillAbsorbProposalSchema,
    /** apply 后正文 hash（钉死恢复判定；= applyEdits(钉死正文) 的规范化 hash）。 */
    afterBodyHash: Sha256HexSchema,
  }),
  z.strictObject({
    action: z.literal("create"),
    ordinal: z.number().int().nonnegative(),
    digest: Sha256HexSchema,
    proposal: DistillCreateProposalSchema,
    /** plan 阶段由 SDK 同源 slugify(title) 冻结的确切写名（禁 -N 改名）。 */
    targetPatternName: PatternNameSchema,
    /** = contentHash(proposal.body)（字节级冻结，E/H 同一口径）。 */
    afterBodyHash: Sha256HexSchema,
  }),
]);
export type DistillPlanItem = z.infer<typeof DistillPlanItemSchema>;

/** apply 结果状态（E 的 DistillItemStatus 唯一集；counters 全键）。 */
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

/** plan 期 model-invalid 诊断原因（闭合枚举；plan 不产 plan item，只产诊断）。 */
export const DistillInvalidReasonSchema = z.enum([
  "invalid-proposal",
  "budget",
  "empty-slug",
  "target-collision",
  "unknown-target",
  "before-hash-mismatch",
  "anchor-missed",
  "insufficient-evidence",
]);
export type DistillInvalidReason = z.infer<typeof DistillInvalidReasonSchema>;

/** 单项 model-invalid 诊断。 */
export const DistillInvalidDiagnosticSchema = z.strictObject({
  ordinal: z.number().int().nonnegative(),
  reason: DistillInvalidReasonSchema,
  message: z.string(),
});
export type DistillInvalidDiagnostic = z.infer<typeof DistillInvalidDiagnosticSchema>;

/** apply 单项结果（ItemResult；宿主据此迁移 ledger/counters）。 */
export const DistillItemResultSchema = z.strictObject({
  ordinal: z.number().int().nonnegative(),
  status: DistillItemStatusSchema,
  detail: z.string().optional(),
  appliedHash: Sha256HexSchema.optional(),
});
export type DistillItemResult = z.infer<typeof DistillItemResultSchema>;

/** ledger 行状态（E 同集；model-invalid 无 ledger 行，故 LedgerStatus ⊂ ItemStatus）。 */
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

/** ledger 终态闭合集（W：含 not-proposed；重放零写、不复活）。 */
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

const TERMINAL_LEDGER_STATUSES: ReadonlySet<string> = new Set(
  TerminalDistillLedgerStatusSchema.options,
);

/** 行状态是否属终态闭合集（W 谓词；类型守卫——终态集 ⊂ ItemStatus）。 */
export function isTerminalDistillLedgerStatus(
  status: DistillLedgerStatus,
): status is TerminalDistillLedgerStatus & DistillItemStatus {
  return TERMINAL_LEDGER_STATUSES.has(status);
}

/**
 * ledger intent/commit 行（E 判别联合；create 目标名持久化——重启后从 record
 * 复原确切写路径；attempts = durable retry 预留计数（宿主持有，SDK 只读判定）。
 */
export const DistillLedgerRecordSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("absorb"),
    ordinal: z.number().int().nonnegative(),
    status: DistillLedgerStatusSchema,
    beforeHash: Sha256HexSchema,
    afterHash: Sha256HexSchema,
    appliedHash: Sha256HexSchema.optional(),
    attempts: z.number().int().nonnegative(),
  }),
  z.strictObject({
    kind: z.literal("create"),
    ordinal: z.number().int().nonnegative(),
    status: DistillLedgerStatusSchema,
    targetPatternName: PatternNameSchema,
    afterHash: Sha256HexSchema,
    appliedHash: Sha256HexSchema.optional(),
    attempts: z.number().int().nonnegative(),
  }),
]);
export type DistillLedgerRecord = z.infer<typeof DistillLedgerRecordSchema>;

/** 相似簇（W 冻结：members 1..50、组内升序去重为构建方约定；digest 计算侧 canonical 重排）。 */
export const SimilarClusterSchema = z.strictObject({
  members: z.array(PatternNameSchema).min(1).max(50),
  /** 聚类代表分（聚类输入序：score 降序 → members 全向量字典序升序）。 */
  score: z.number(),
});
export type SimilarCluster = z.infer<typeof SimilarClusterSchema>;

/** 语料 top-K 候选（K = 5；稳定排序：score 降序 → name 升序为构建方约定）。 */
export const DistillCandidateSchema = z.strictObject({
  name: PatternNameSchema,
  title: z.string(),
  /** top-K 全文（语料边界 = 全文，非摘要）。 */
  body: z.string(),
  contentHash: Sha256HexSchema,
  sourceScope: z.string().min(1),
  /** 检索得分（原始 score 口径；< evidenceThreshold 时禁对其 absorb）。 */
  score: z.number(),
});
export type DistillCandidate = z.infer<typeof DistillCandidateSchema>;

/** 语料构建消耗快照（v1 形状：纳入 candidates 的 pattern 数与正文总字符；digest 纳入）。 */
export const DistillCorpusBudgetsSchema = z.strictObject({
  patternsIncluded: z.number().int().nonnegative(),
  totalBodyChars: z.number().int().nonnegative(),
});
export type DistillCorpusBudgets = z.infer<typeof DistillCorpusBudgetsSchema>;

/**
 * 蒸馏语料（W 冻结；可复现性契约——同语料两次构建 canonical 序与 corpusDigest
 * 一致；digest 输入 = 除 corpusDigest 外的全对象，见 canonical.ts）。
 */
export const DistillCorpusSchema = z.strictObject({
  clusters: z.array(SimilarClusterSchema),
  candidates: z.array(DistillCandidateSchema),
  retrieval: z.strictObject({ query: z.string(), limit: z.number().int().positive() }),
  evidenceThreshold: z.number(),
  budgets: DistillCorpusBudgetsSchema,
  scoreVersion: z.string().min(1),
  corpusDigest: Sha256HexSchema,
});
export type DistillCorpus = z.infer<typeof DistillCorpusSchema>;
