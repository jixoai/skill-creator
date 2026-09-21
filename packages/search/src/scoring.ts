/**
 * 用户原始需求 [2026-09-21]：「BM25 变体打分在 JS 共享层——两后端仅召回实现不同，
 * 命中与分数逐位一致。打分常量冻结自 MiniSearch 实测算术。」
 * （jixoai-search-core 定型决策；常量来源 docs/search-design.md §15，
 * 实现来源 /tmp/tantivy-smoke/benchmark-run.mjs jsRescore + calibrate.mjs 逆向实证。）
 * 正交意图：
 *   [1] 冻结打分算术：BM25 变体（k1/b/底分 d）+ fuzzy/prefix 变体折扣 + 多 token 乘数。
 *   [2] 变体展开：exact ∪ prefix 前缀扩展 ∪ fuzzy 编辑距离扩展（CJK 词跳过 fuzzy），
 *       供打分与后端召回共用，保证两后端候选口径一致。
 *   [3] 打分配置指纹：scoringDigest 进索引信封，任何打分口径变化强制全量重建。
 * 妥协声明：长词 fuzzy 距离以 MiniSearch 实测为 canonical（2026-09-21 对照实验
 * /tmp/jixoai-fuzzy-canonical.mjs：MiniSearch 7.2 对 len≥15 的 query 词真实接受
 * 编辑距离 3-6，且不按长度差钳 2——len16→len13 删除距离 3 命中）；D1 冒烟脚本
 * 的 |m−n|>2 早退是其自身简化，非 MiniSearch 行为。levenshtein 早退阈值取
 * maxDistance = min(6, round(len×fuzzy))，与实测一致。
 */
import { createHash } from "node:crypto";

/**
 * 冻结打分常量（MiniSearch 实测逆向，docs/search-design.md §15）：
 * - idf = log(1 + (N − df + 0.5)/(df + 0.5))，df/N 均为 per-field 口径。
 * - tfNorm = d + tf(k1+1)/(tf + k1(1 − b + b·fieldLength/avgFieldLength))。
 * - 变体折扣：fuzzy 0.45、prefix 0.375；prefix 变体 w = 0.375×L/(L+0.3×(L−qLen))，
 *   fuzzy 变体 w = 0.45×L/(L+dist)，L = 词表词长（码点）；同词 prefix 优先于 fuzzy。
 * - fuzzy 距离 = min(6, round(len×0.2))。
 * - 多 token OR 乘数：score(doc) = 命中 query token 数 × Σ 单 token 贡献
 *   （calibrate.mjs 最小语料实证：2 token ×2.0000、3 token ×3.0000）。
 */
export const SCORING_CONSTANTS = {
  k1: 1.2,
  b: 0.7,
  d: 0.5,
  fuzzyWeight: 0.45,
  prefixWeight: 0.375,
  maxFuzzyDistance: 6,
} as const;

/** 打分配置（进信封指纹）：fuzzy 编辑距离比例（0 = 关闭）、prefix 前缀扩展开关。 */
export interface ScoringOptions {
  fuzzy: number;
  prefix: boolean;
}

/** 计算打分配置指纹（含冻结常量；口径变化 → 指纹变化 → 索引重建）。 */
export function scoringOptionsDigest(options: ScoringOptions): string {
  const canonical = JSON.stringify({
    constants: SCORING_CONSTANTS,
    fuzzy: options.fuzzy,
    prefix: options.prefix,
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/** per-field 语料统计（后端从持久化状态提供；avgFieldLength 含空字段文档）。 */
export interface FieldTermStats {
  avgFieldLength: number;
  /** term → 含该 term 的 doc 数（per-field df）。 */
  df: Map<string, number>;
}

/** 打分语料快照：召回候选的 token 流 + 全语料统计。 */
export interface ScoringCorpus {
  /** 全语料 doc 数（含所有字段为空的文档；MiniSearch avgFieldLength 口径）。 */
  docCount: number;
  /** 字段声明顺序（浮点求和次序的一部分，逐位可重放）。 */
  fields: string[];
  weights: Record<string, number>;
  fieldStats: Map<string, FieldTermStats>;
  /** 召回候选：docId → field → token 流（tokenizer 输出，含重复词）。 */
  docFieldTokens: Map<string, Map<string, string[]>>;
}

const CJK_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/** 码点切分（长度与编辑距离一律按码点计，与冒烟实证一致）。 */
function codePoints(text: string): string[] {
  return [...text];
}

/**
 * 码点 Levenshtein 距离；|m−n| 超过 maxDistance 直接早退
 * （返回 maxDistance+1 表示「必不命中」）。
 */
function levenshtein(a: string, b: string, maxDistance: number): number {
  const left = codePoints(a);
  const right = codePoints(b);
  const m = left.length;
  const n = right.length;
  if (Math.abs(m - n) > maxDistance) return maxDistance + 1;
  let previous = Array.from({ length: n + 1 }, (_, index) => index);
  for (let i = 1; i <= m; i += 1) {
    const current = [i];
    for (let j = 1; j <= n; j += 1) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[n];
}

/** fuzzy 编辑距离上限：min(6, round(len × fuzzy 比例))；比例 0 → 0（关闭）。 */
export function maxFuzzyDistance(token: string, fuzzy: number): number {
  return Math.min(SCORING_CONSTANTS.maxFuzzyDistance, Math.round(codePoints(token).length * fuzzy));
}

/**
 * 展开 query token 的 fuzzy 变体（per-field 词表口径）：
 * w = 0.45×L/(L+dist)；prefix 开启时同词 prefix 优先（fuzzy 跳过已被 prefix 命中的词）。
 * CJK token 跳过 fuzzy（冒烟实证口径；docs/search-design.md §15 已知偏差声明）。
 * 后端召回复用同一函数，保证召回候选与打分变体口径一致。
 */
export function expandFuzzyTerms(
  token: string,
  vocabulary: Iterable<string>,
  options: { prefix: boolean; maxDistance: number },
): Map<string, number> {
  const fuzzyTerms = new Map<string, number>();
  if (options.maxDistance >= 1 && !CJK_RE.test(token)) {
    for (const term of vocabulary) {
      if (term === token) continue;
      if (options.prefix && term.startsWith(token)) continue;
      const distance = levenshtein(token, term, options.maxDistance);
      if (distance <= options.maxDistance) {
        const termLength = codePoints(term).length;
        fuzzyTerms.set(
          term,
          SCORING_CONSTANTS.fuzzyWeight * (termLength / (termLength + distance)),
        );
      }
    }
  }
  return fuzzyTerms;
}

/**
 * 展开 query token 的完整变体集（per-field 词表口径）：
 * exact(w=1) ∪ prefix 扩展(w=0.375×L/(L+0.3d)) ∪ fuzzy 扩展(w=0.45×L/(L+dist))。
 * 词表遍历次序决定 Map 插入序（= 浮点求和次序），调用方须传确定性有序词表。
 */
export function expandQueryToken(
  token: string,
  vocabulary: Iterable<string>,
  options: { prefix: boolean; maxDistance: number },
): Map<string, number> {
  const tokenLength = codePoints(token).length;
  const prefixTerms = new Map<string, number>();
  if (options.prefix) {
    for (const term of vocabulary) {
      if (term === token || !term.startsWith(token)) continue;
      const termLength = codePoints(term).length;
      prefixTerms.set(
        term,
        SCORING_CONSTANTS.prefixWeight *
          (termLength / (termLength + 0.3 * (termLength - tokenLength))),
      );
    }
  }
  const derived = new Map<string, number>([[token, 1]]);
  for (const [term, weight] of prefixTerms) derived.set(term, weight);
  for (const [term, weight] of expandFuzzyTerms(token, vocabulary, options)) {
    derived.set(term, weight);
  }
  return derived;
}

/**
 * 冻结口径打分（/tmp/tantivy-smoke/benchmark-run.mjs jsRescore 移植；长词
 * fuzzy 早退细节以 MiniSearch 实测 canonical 实验 /tmp/jixoai-fuzzy-canonical.mjs
 * 修正——冒烟 |m−n|>2 早退为其自身简化，实测 MiniSearch 不按长度差钳 2）：
 * 对召回候选按 query token × field × 变体词累加贡献，再乘以命中 token 数。
 * 返回 docId → score（score > 0 即命中；total 口径 = 返回条数）。
 */
export function scoreCorpus(
  corpus: ScoringCorpus,
  queryTokens: string[],
  options: ScoringOptions,
): Map<string, number> {
  const docIds = [...corpus.docFieldTokens.keys()];
  const scores = new Map<string, number>(docIds.map((id) => [id, 0]));
  const hitTokens = new Map<string, number>(docIds.map((id) => [id, 0]));
  // 预建候选 doc 的 per-field 词频与长度（tf/fieldLength 口径 = tokenize 后含重复词）。
  const docTermCounts = new Map<string, Map<string, Map<string, number>>>();
  const docFieldLengths = new Map<string, Map<string, number>>();
  for (const [docId, fieldTokens] of corpus.docFieldTokens) {
    const perField = new Map<string, Map<string, number>>();
    const lengths = new Map<string, number>();
    for (const [field, tokens] of fieldTokens) {
      const counts = new Map<string, number>();
      for (const term of tokens) counts.set(term, (counts.get(term) ?? 0) + 1);
      perField.set(field, counts);
      lengths.set(field, tokens.length);
    }
    docTermCounts.set(docId, perField);
    docFieldLengths.set(docId, lengths);
  }

  for (const token of queryTokens) {
    let anyHit = false;
    const hitThisToken = new Set<string>();
    const maxDistance = maxFuzzyDistance(token, options.fuzzy);
    for (const field of corpus.fields) {
      const stats = corpus.fieldStats.get(field);
      if (!stats) continue;
      const fieldWeight = corpus.weights[field] ?? 0;
      if (fieldWeight <= 0) continue;
      const vocabulary = [...stats.df.keys()];
      const derived = expandQueryToken(token, vocabulary, {
        prefix: options.prefix,
        maxDistance,
      });
      for (const [term, termWeight] of derived) {
        const df = stats.df.get(term) ?? 0;
        if (df === 0) continue;
        const idf = Math.log(1 + (corpus.docCount - df + 0.5) / (df + 0.5));
        for (const docId of docIds) {
          const tf = docTermCounts.get(docId)?.get(field)?.get(term) ?? 0;
          if (tf === 0) continue;
          const fieldLength = docFieldLengths.get(docId)?.get(field) ?? 0;
          const tfNorm =
            SCORING_CONSTANTS.d +
            (tf * (SCORING_CONSTANTS.k1 + 1)) /
              (tf +
                SCORING_CONSTANTS.k1 *
                  (1 -
                    SCORING_CONSTANTS.b +
                    SCORING_CONSTANTS.b * (fieldLength / stats.avgFieldLength)));
          scores.set(docId, (scores.get(docId) ?? 0) + termWeight * fieldWeight * idf * tfNorm);
          hitThisToken.add(docId);
          anyHit = true;
        }
      }
    }
    if (anyHit) {
      for (const docId of hitThisToken) {
        hitTokens.set(docId, (hitTokens.get(docId) ?? 0) + 1);
      }
    }
  }

  const result = new Map<string, number>();
  for (const docId of docIds) {
    const score = (scores.get(docId) ?? 0) * (hitTokens.get(docId) || 1);
    if (score > 0) result.set(docId, score);
  }
  return result;
}
