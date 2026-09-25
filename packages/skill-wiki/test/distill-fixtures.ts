/**
 * 用户原始需求 [2026-09-25]（切片③ skill-wiki-maintainer）：蒸馏 SDK（tasks
 * 1.1/1.2）测试共用 fixture 构造器。
 * 正交意图：[1] 纯构造辅助：corpus/ledger record/hooks 记录器——无 IO、无断言。
 */
import type {
  DistillCorpus,
  DistillCreateProposal,
  DistillLedgerRecord,
  DistillLedgerStatus,
  DistillPlanItem,
} from "../src/index.js";
import { distillCorpusDigest } from "../src/index.js";

export const RUN_A = "wd_0000000000000000000000aa";
export const RUN_B = "wd_0000000000000000000000bb";
export const SCOPE_A = "/ws/alpha";
export const SCOPE_B = "/ws/beta";

export function candidateFixture(name: string, score: number) {
  return {
    name,
    title: name,
    body: `body of ${name}`,
    contentHash: "a".repeat(64),
    sourceScope: SCOPE_A,
    score,
  };
}

/** 语料 fixture（corpusDigest 自动按 canonical 投影回填——与真实构建方同口径）。 */
export function corpusFixture(
  options?: Partial<{
    clusters: DistillCorpus["clusters"];
    candidates: DistillCorpus["candidates"];
    evidenceThreshold: number;
  }>,
): DistillCorpus {
  const base = {
    clusters: options?.clusters ?? [{ members: ["frag-one", "frag-two"], score: 5 }],
    candidates: options?.candidates ?? [candidateFixture("global-x", 0.9)],
    retrieval: { query: "distill", limit: 5 },
    evidenceThreshold: options?.evidenceThreshold ?? 0.3,
    budgets: { patternsIncluded: 2, totalBodyChars: 64 },
    scoreVersion: "segmenter-bigram-v1/bm25-frozen",
    corpusDigest: "0".repeat(64),
  };
  return { ...base, corpusDigest: distillCorpusDigest(base) };
}

export function createProposalFixture(
  overrides?: Partial<DistillCreateProposal>,
): DistillCreateProposal {
  return {
    action: "create",
    title: "Pin exit codes",
    body: "Gate commands on exit codes, not on piped stdout.",
    sourcePatternIds: ["frag-one"],
    ...overrides,
  };
}

type AbsorbPlanItem = Extract<DistillPlanItem, { action: "absorb" }>;
type CreatePlanItem = Extract<DistillPlanItem, { action: "create" }>;

export function absorbRecord(
  item: AbsorbPlanItem,
  status: DistillLedgerStatus,
  attempts = 0,
  appliedHash?: string,
): DistillLedgerRecord {
  return {
    kind: "absorb",
    ordinal: item.ordinal,
    status,
    beforeHash: item.proposal.expectedBeforeBodyHash,
    afterHash: item.afterBodyHash,
    attempts,
    ...(appliedHash === undefined ? {} : { appliedHash }),
  };
}

export function createRecord(
  item: CreatePlanItem,
  status: DistillLedgerStatus,
  attempts = 0,
  appliedHash?: string,
): DistillLedgerRecord {
  return {
    kind: "create",
    ordinal: item.ordinal,
    status,
    targetPatternName: item.targetPatternName,
    afterHash: item.afterBodyHash,
    attempts,
    ...(appliedHash === undefined ? {} : { appliedHash }),
  };
}

export interface HookEvent {
  phase: "intent" | "commit";
  record: DistillLedgerRecord;
}

/** hooks 记录器（断言 SDK 驱动顺序契约 onIntent → 写 → rebuild → onCommit）。 */
export function hookRecorder() {
  const events: HookEvent[] = [];
  return {
    events,
    hooks: {
      onIntent: (record: DistillLedgerRecord): void => {
        events.push({ phase: "intent", record });
      },
      onCommit: (record: DistillLedgerRecord): void => {
        events.push({ phase: "commit", record });
      },
    },
  };
}
