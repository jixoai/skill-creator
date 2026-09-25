/**
 * 用户原始需求 [2026-09-25]（切片③）：「promotedFrom 存 canonical JSON 字符串；
 * 键排序、无空白」「digest 输入 = 全 Corpus 对象的 canonical JSON（递归字典序
 * 键、无空白）sha256」（design L/W 冻结）。
 * 正交意图：
 *   [1] canonical 序单一实现：递归字典序键 + 无空白 JSON 序列化，及建立在其
 *       上的 corpusDigest / 提案 digest——同输入（含打乱数组序）恒同字节。
 */
import { createHash } from "node:crypto";
import type { DistillCorpus, DistillProposal } from "./schema.js";

/** 递归字典序键排序（数组保序；JSON.stringify 默认无空白）。 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

/** canonical JSON 字符串（递归字典序键、无空白；promotedFrom 信封与 digest 共用）。 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

/** canonical JSON 的 sha256 hex。 */
export function canonicalSha256(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

/** 提案 canonical digest（ledger 行与 capability 输入反查校验共用同一口径）。 */
export function distillProposalDigest(proposal: DistillProposal): string {
  return canonicalSha256(proposal);
}

/** 字符串向量字典序比较（前缀短者小）。 */
function compareStringVectors(left: readonly string[], right: readonly string[]): number {
  const bound = Math.min(left.length, right.length);
  for (let index = 0; index < bound; index += 1) {
    const l = left[index] as string;
    const r = right[index] as string;
    if (l < r) return -1;
    if (l > r) return 1;
  }
  return left.length - right.length;
}

function uniqueSortedNames(names: readonly string[]): string[] {
  return [...new Set(names)].sort((l, r) => (l < r ? -1 : l > r ? 1 : 0));
}

/**
 * 语料 canonical 投影（digest 输入；r12/r14 冻结排序键）：
 * - clusters：score 降序 → members 全向量字典序升序（并列 cluster 唯一可序）；
 *   members 组内升序去重；
 * - candidates：name 升序；
 * - retrieval / evidenceThreshold / budgets / scoreVersion 原样纳入；
 * - **排除 corpusDigest 自身**（自引用无意义）。
 * 输入数组序不影响投影 → 同语料两次构建（打乱序）digest 恒一致。
 */
export function canonicalCorpusProjection(corpus: DistillCorpus): unknown {
  return {
    clusters: [...corpus.clusters]
      .map((cluster) => ({ members: uniqueSortedNames(cluster.members), score: cluster.score }))
      .sort((left, right) => {
        if (right.score !== left.score) return right.score - left.score;
        return compareStringVectors(left.members, right.members);
      }),
    candidates: [...corpus.candidates].sort((l, r) =>
      l.name < r.name ? -1 : l.name > r.name ? 1 : 0,
    ),
    retrieval: corpus.retrieval,
    evidenceThreshold: corpus.evidenceThreshold,
    budgets: corpus.budgets,
    scoreVersion: corpus.scoreVersion,
  };
}

/** corpusDigest = canonical 投影（除 corpusDigest 自身）的 canonical JSON sha256。 */
export function distillCorpusDigest(corpus: DistillCorpus): string {
  return createHash("sha256")
    .update(canonicalJson(canonicalCorpusProjection(corpus)), "utf8")
    .digest("hex");
}
