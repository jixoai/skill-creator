/**
 * 用户原始需求 [2026-09-17]：「BM25 top-40 候选逐个计算冻结 rerank 信号；最终分 =
 * 0.7×(bm25/(bm25+8)) + 0.3×rerank；rerank 之后按 contentHash 折叠；tie-break
 * final desc → name asc → canonicalPath asc。」（docs/search-design.md §9 冻结公式）
 * 正交意图：
 * 1. 冻结 rerank 信号集（大小写不敏感 + query trim，上限 1.0）与混合归一。
 * 2. content-dup 折叠（组内 final 最高者为主，其余进 duplicates，同序不丢数据）。
 * 3. 稳定排序 tie-break（CLI JSON 可重放）。
 */
import type { SkillId } from "../../shared/contracts/skills.js";
import type { SkillSearchDuplicate, SkillSearchResult } from "../../shared/contracts/search.js";

/** 排序规则版本；任何公式/权重变化必须递增并触发索引全量重建。 */
export const RANKING_VERSION = "rerank-2026-09-17-v1";

/** BM25 原始分候选上限（折叠前的竞争池）。 */
export const TOP_CANDIDATES = 40;

/** rerank 信号权重（冻结）。 */
const RERANK_WEIGHTS = {
  exactName: 0.9,
  namePrefix: 0.5,
  queryInName: 0.4,
  keywordExact: 0.3,
  descCoverage: 0.2,
} as const;
/** rerank 上限。 */
const RERANK_CAP = 1.0;
/** final = MIX.bm25 × norm(bm25) + MIX.rerank × rerank；norm(s) = s/(s+K)。 */
const MIX = { bm25: 0.7, rerank: 0.3 } as const;
const NORM_K = 8;

/** rerank/投影所需的候选投影（MiniSearch 存储字段 + BM25 原始分）。 */
export interface RankingCandidate {
  id: SkillId;
  /** MiniSearch BM25+ 原始分（含字段 boost）。 */
  bm25: number;
  name: string;
  description: string;
  keywords: string[];
  canonicalPath: string;
  installations: SkillSearchResult["installations"];
  contentHash: string;
  disabled: boolean;
  conflict: boolean;
}

/**
 * 冻结排序管线：top40（按 BM25 降序，由调用方保证）→ 逐候选 rerank → final →
 * contentHash 折叠 → tie-break → top limit。输入次序之外的任何扫描顺序都不影响输出。
 */
export function rankResults(
  candidates: readonly RankingCandidate[],
  query: string,
  limit: number,
  tokenize: (text: string) => string[],
): SkillSearchResult[] {
  const normalizedQuery = query.trim().toLowerCase();
  const queryTokens = [...new Set(tokenize(query))];
  const rerankCache = new Map<string, Set<string>>();

  const scored = candidates.slice(0, TOP_CANDIDATES).map((candidate) => {
    const rerank = rerankScore(candidate, normalizedQuery, queryTokens, tokenize, rerankCache);
    return {
      candidate,
      final: stableFinal(
        MIX.bm25 * (candidate.bm25 / (candidate.bm25 + NORM_K)) + MIX.rerank * rerank,
      ),
    };
  });

  const groups = new Map<string, typeof scored>();
  for (const entry of scored) {
    const group = groups.get(entry.candidate.contentHash) ?? [];
    group.push(entry);
    groups.set(entry.candidate.contentHash, group);
  }

  const primaries: Array<{ entry: (typeof scored)[number]; duplicates: SkillSearchDuplicate[] }> =
    [];
  for (const group of groups.values()) {
    group.sort(byFrozenTieBreak);
    const [primary, ...rest] = group;
    primaries.push({
      entry: primary,
      duplicates: rest.map((member) => ({
        id: member.candidate.id,
        canonicalPath: member.candidate.canonicalPath,
      })),
    });
  }
  primaries.sort((left, right) => byFrozenTieBreak(left.entry, right.entry));

  return primaries.slice(0, limit).map(({ entry, duplicates }) => {
    const { candidate, final } = entry;
    return {
      id: candidate.id,
      name: candidate.name,
      description: candidate.description,
      canonicalPath: candidate.canonicalPath,
      installations: candidate.installations,
      contentHash: candidate.contentHash,
      disabled: candidate.disabled,
      conflict: candidate.conflict,
      score: final,
      duplicates,
    };
  });
}

/**
 * 输出与排序的稳定量化：final ∈ [0,1]，保留 12 位有效数字。MiniSearch 的 BM25 原始分
 * 含 Math.log 超越函数，跨 JIT 优化层级存在 1 ulp 噪声（实测 in-memory 构建 vs 磁盘加载
 * 的索引可差 1 ulp）；量化后 tie-break 与 JSON 输出跨进程/跨状态可重放，真差异（≥1e-12）
 * 的相对次序不受影响。冻结公式本身不变（final = 0.7×norm + 0.3×rerank）。
 */
function stableFinal(raw: number): number {
  return Number(raw.toPrecision(12));
}

/** 冻结 tie-break：final desc → name asc（codepoint 序）→ canonicalPath asc（codepoint 序）。 */
function byFrozenTieBreak(
  left: { candidate: RankingCandidate; final: number },
  right: { candidate: RankingCandidate; final: number },
): number {
  if (left.final !== right.final) return right.final - left.final;
  if (left.candidate.name !== right.candidate.name) {
    return left.candidate.name < right.candidate.name ? -1 : 1;
  }
  return left.candidate.canonicalPath < right.candidate.canonicalPath
    ? -1
    : left.candidate.canonicalPath > right.candidate.canonicalPath
      ? 1
      : 0;
}

/** rerank 信号（全部大小写不敏感、query trim；上限 1.0）。 */
function rerankScore(
  candidate: RankingCandidate,
  normalizedQuery: string,
  queryTokens: string[],
  tokenize: (text: string) => string[],
  descriptionTokenCache: Map<string, Set<string>>,
): number {
  if (normalizedQuery === "") return 0;
  const lowerName = candidate.name.toLowerCase();
  let score = 0;
  if (lowerName === normalizedQuery) score += RERANK_WEIGHTS.exactName;
  if (lowerName.startsWith(normalizedQuery)) score += RERANK_WEIGHTS.namePrefix;
  if (lowerName.includes(normalizedQuery)) score += RERANK_WEIGHTS.queryInName;
  if (candidate.keywords.some((keyword) => keyword.toLowerCase() === normalizedQuery)) {
    score += RERANK_WEIGHTS.keywordExact;
  }
  if (queryTokens.length > 0) {
    let tokens = descriptionTokenCache.get(candidate.description);
    if (!tokens) {
      tokens = new Set(tokenize(candidate.description));
      descriptionTokenCache.set(candidate.description, tokens);
    }
    const covered = queryTokens.filter((token) => tokens.has(token)).length;
    score += RERANK_WEIGHTS.descCoverage * (covered / queryTokens.length);
  }
  return Math.min(score, RERANK_CAP);
}
