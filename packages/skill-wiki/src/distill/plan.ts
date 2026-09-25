/**
 * 用户原始需求 [2026-09-25]（切片③）：「skill-wiki MUST 提供 planDistillation
 * （纯函数：Zod 收窄/锚点预算校验/before-after hash/相似预警附注；model-invalid
 * 项产出诊断）」（design §7 / spec 两段式执行 requirement）。
 * 正交意图：
 *   [1] planDistillation 纯函数：只读 global 页（绝不创建目录/零写盘）——逐项
 *       Zod 收窄、预算/target/锚点/证据校验、before-after hash、同 run target
 *       冲突 plan 期拒绝（后 ordinal → model-invalid(target-collision)）、
 *       slugify 同源收窄（空 → model-invalid(empty-slug)）；非法项产诊断不产
 *       plan item。
 * 妥协声明：相似预警 v1 词汇 = 确定性 content-duplicate（正文 hash 与既有页
 * 全等）/ name-exists（create slug 与既有页同名）——BM25 近邻检索属语料构建
 * （宿主，corpus.clusters），SDK plan 不重复实现打分。
 */
import { applyEdits } from "../patch.js";
import { PatternNameSchema, SkillWikiError } from "../schema.js";
import {
  listWikiPatternsReadOnly,
  openWikiWorkspace,
  patternContentHash,
  slugifyPatternTitle,
} from "../workspace.js";
import {
  DISTILL_BUDGETS,
  DistillCorpusSchema,
  DistillInvalidDiagnosticSchema,
  DistillProposalSchema,
  type DistillInvalidDiagnostic,
  type DistillPlanItem,
} from "./schema.js";
import { distillProposalDigest } from "./canonical.js";

/** 相似/冲突预警附注（advisory；不影响 item 有效性，不进 ledger）。 */
export interface DistillPlanWarning {
  ordinal: number;
  note: string;
}

/** plan 输出：合法项（ordinal 升序）+ model-invalid 诊断 + 预警附注。 */
export interface DistillPlanResult {
  items: readonly DistillPlanItem[];
  diagnostics: readonly DistillInvalidDiagnostic[];
  warnings: readonly DistillPlanWarning[];
}

function diagnostic(
  ordinal: number,
  reason: DistillInvalidDiagnostic["reason"],
  message: string,
): DistillInvalidDiagnostic {
  return DistillInvalidDiagnosticSchema.parse({ ordinal, reason, message });
}

function zodMessage(error: {
  issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>;
}): string {
  const issue = error.issues[0];
  if (!issue) return "schema rejection";
  return `${issue.path.join(".")}: ${issue.message}`;
}

/**
 * 两段式第一段（纯函数；不改盘）：
 * - corpus 为外部输入（宿主落盘后回读传入）——safeParse 收窄，坏形状 typed
 *   WIKI_INVALID_PATTERN 拒绝（宿主 bug，不是模型输出问题）；
 * - rawProposals 为模型原始输出（unknown 逐项收窄；非法项 → model-invalid
 *   诊断，不产 plan item、不占用 target 名）；
 * - absorb 的 before hash/锚点/证据阈值校验都发生在 plan 期；apply 期只重验
 *   hash（人工仍可能在 plan 与 apply 之间改页，由 H 矩阵兜底）。
 */
export function planDistillation(
  globalWikiDir: string,
  corpus: unknown,
  rawProposals: readonly unknown[],
): DistillPlanResult {
  const narrowedCorpus = DistillCorpusSchema.safeParse(corpus);
  if (!narrowedCorpus.success) {
    throw new SkillWikiError(
      "WIKI_INVALID_PATTERN",
      `Invalid distill corpus: ${zodMessage(narrowedCorpus.error)}`,
    );
  }
  const typedCorpus = narrowedCorpus.data;

  // 只读列举（目录缺失 = 空；绝不 mkdir——「纯函数不改盘」红线）。
  const existing = listWikiPatternsReadOnly(globalWikiDir);
  const existingByHash = new Map(existing.map((item) => [item.contentHash, item.name]));
  const existingNames = new Set(existing.map((item) => item.name));
  const reader = openWikiWorkspace(globalWikiDir);

  const items: DistillPlanItem[] = [];
  const diagnostics: DistillInvalidDiagnostic[] = [];
  const warnings: DistillPlanWarning[] = [];
  // 同 run target 冲突判定（ordinal 升序先到先得）：create slug 独占；absorb
  // target 允许与其他 absorb 共享（各自独立钉 beforeHash，后批 apply 期必然
  // stale——文档化，不隐式链式重基），但与 create 目标互斥。
  const createClaims = new Set<string>();
  const absorbClaims = new Set<string>();

  const evidenceFor = (name: string): number | null => {
    const candidate = typedCorpus.candidates.find((item) => item.name === name);
    return candidate === undefined ? null : candidate.score;
  };

  for (const [index, raw] of rawProposals.entries()) {
    const ordinal = index;
    if (ordinal >= DISTILL_BUDGETS.proposalsPerRun) {
      diagnostics.push(
        diagnostic(
          ordinal,
          "budget",
          `proposals-per-run budget exceeded (${DISTILL_BUDGETS.proposalsPerRun})`,
        ),
      );
      continue;
    }
    const proposalNarrowed = DistillProposalSchema.safeParse(raw);
    if (!proposalNarrowed.success) {
      diagnostics.push(diagnostic(ordinal, "invalid-proposal", zodMessage(proposalNarrowed.error)));
      continue;
    }
    const proposal = proposalNarrowed.data;

    if (proposal.action === "create") {
      // slugify 同源收窄（W：raw 非空且过 PatternNameSchema 才得 PatternName；
      // 空 → empty-slug；蒸馏不落 appendPattern 的 "pattern" 回退）。
      const rawSlug = slugifyPatternTitle(proposal.title);
      const slugNarrowed = PatternNameSchema.safeParse(rawSlug);
      if (rawSlug.length === 0 || !slugNarrowed.success) {
        diagnostics.push(
          diagnostic(
            ordinal,
            "empty-slug",
            `title collapses to an empty/invalid pattern slug: ${JSON.stringify(proposal.title.slice(0, 40))}`,
          ),
        );
        continue;
      }
      const targetPatternName = slugNarrowed.data;
      if (createClaims.has(targetPatternName) || absorbClaims.has(targetPatternName)) {
        diagnostics.push(
          diagnostic(
            ordinal,
            "target-collision",
            `create target "${targetPatternName}" already claimed earlier this run (first-come-first-served by ordinal)`,
          ),
        );
        continue;
      }
      const afterBodyHash = patternContentHash(proposal.body);
      if (existingByHash.has(afterBodyHash)) {
        warnings.push({ ordinal, note: `content-duplicate:${existingByHash.get(afterBodyHash)}` });
      }
      if (existingNames.has(targetPatternName)) {
        warnings.push({ ordinal, note: `name-exists:${targetPatternName}` });
      }
      createClaims.add(targetPatternName);
      items.push({
        action: "create",
        ordinal,
        digest: distillProposalDigest(proposal),
        proposal,
        targetPatternName,
        afterBodyHash,
      });
      continue;
    }

    // absorb：target 存在性（只读列举缺失/畸形页同弃 → unknown-target）。
    if (!existingNames.has(proposal.targetPatternId)) {
      diagnostics.push(
        diagnostic(
          ordinal,
          "unknown-target",
          `absorb target not found or incompatible in global wiki: ${proposal.targetPatternId}`,
        ),
      );
      continue;
    }
    if (createClaims.has(proposal.targetPatternId)) {
      diagnostics.push(
        diagnostic(
          ordinal,
          "target-collision",
          `absorb target "${proposal.targetPatternId}" already claimed by an earlier create this run`,
        ),
      );
      continue;
    }
    // 证据阈值（W：候选自身 score < 阈值 → 证据不足，禁对其 absorb）。
    const score = evidenceFor(proposal.targetPatternId);
    if (score === null || score < typedCorpus.evidenceThreshold) {
      diagnostics.push(
        diagnostic(
          ordinal,
          "insufficient-evidence",
          `absorb target ${proposal.targetPatternId} lacks corpus evidence (score=${score === null ? "absent" : score} < threshold=${typedCorpus.evidenceThreshold})`,
        ),
      );
      continue;
    }
    let body: string;
    try {
      body = reader.readPattern(proposal.targetPatternId).body;
    } catch (error) {
      if (error instanceof SkillWikiError) {
        diagnostics.push(
          diagnostic(
            ordinal,
            "unknown-target",
            `absorb target unreadable: ${proposal.targetPatternId} (${error.code})`,
          ),
        );
        continue;
      }
      throw error;
    }
    const currentHash = patternContentHash(body);
    if (currentHash !== proposal.expectedBeforeBodyHash) {
      diagnostics.push(
        diagnostic(
          ordinal,
          "before-hash-mismatch",
          `expectedBeforeBodyHash does not match current body of ${proposal.targetPatternId}`,
        ),
      );
      continue;
    }
    let nextBody: string;
    try {
      nextBody = applyEdits(body, proposal.edits);
    } catch (error) {
      if (error instanceof SkillWikiError && error.code === "WIKI_PATCH_FAILED") {
        diagnostics.push(diagnostic(ordinal, "anchor-missed", error.message));
        continue;
      }
      throw error;
    }
    const afterBodyHash = patternContentHash(nextBody);
    const duplicateOf = existingByHash.get(afterBodyHash);
    if (duplicateOf !== undefined && duplicateOf !== proposal.targetPatternId) {
      warnings.push({ ordinal, note: `content-duplicate:${duplicateOf}` });
    }
    absorbClaims.add(proposal.targetPatternId);
    items.push({
      action: "absorb",
      ordinal,
      digest: distillProposalDigest(proposal),
      proposal,
      afterBodyHash,
    });
  }
  return { items, diagnostics, warnings };
}
