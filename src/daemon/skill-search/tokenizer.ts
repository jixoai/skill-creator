/**
 * 用户原始需求 [2026-09-17]：「SkillTokenizer 以同一条管线处理 query 与 document 文本，
 * 行为由 TOKENIZER_VERSION 版本化，并以 docs/search-design.md §6 的冻结期望表为逐字契约。」
 * 正交意图：
 * 1. CJK 管线：script-run 切分 + Intl.Segmenter(zh) 词典分词 + 连续单字滑窗 bigram 兜底。
 * 2. Latin 管线：保持原大小写做 camel/Pascal/snake/kebab 切分，保留 joined/@scope/owner-repo 形态。
 * 3. 版本化与 small-ICU 探针：Segmenter 不可用时逐字退化 + 滑窗（pure-bigram），不抛错。
 *
 * 参考实现：/tmp/skill-search-poc/tokenizer-final.mjs（实测输出即 §6 冻结期望表）；
 * 改动必须先改表、再改代码、再跑基准。
 */

/** 分词行为版本；任何输出变化必须递增并触发索引全量重建。 */
export const TOKENIZER_VERSION = "segmenter-bigram-v1";

/** Skill 分词器：query 与 document 共用同一条管线，保证切分一致性。 */
export interface SkillTokenizer {
  tokenize(text: string): string[];
}

const CJK_SCRIPTS_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const CJK_RUN_SOURCE =
  "[\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Hangul}]+";
const LATIN_RUN_SOURCE = "[@A-Za-z0-9:/._-]+";
// script-run 切分：CJK 连续段 | Latin 标识符段（URL 冒号必须在字符集内）| 其它（分隔符）。
const RUN_RE = new RegExp(`${CJK_RUN_SOURCE}|${LATIN_RUN_SOURCE}|.`, "gu");
const CJK_RUN_START_RE = new RegExp(`^${CJK_RUN_SOURCE}`, "u");
// camel/Pascal 切分：连续大写 + lookahead 分支必须在前，否则 "H" 会抢先吞掉 "HTTP" 的首字母。
const CAMEL_RE = /\p{Lu}+(?=\p{Lu}[\p{Ll}\d])|\p{Lu}[\p{Ll}\d]*|\p{Lu}+|\p{Ll}+|\d+/gu;

/**
 * 构造词级 Intl.Segmenter 并以中文探针自检：small-ICU/system-ICU 构建会把中文
 * 断词静默退化为逐字（nodejs/node#51752）——探针（「组件设计」切成单字序列）失败
 * 视为不可用，返回 null。
 */
function probeSegmenter(): Intl.Segmenter | null {
  if (typeof Intl.Segmenter === "undefined") return null;
  let segmenter: Intl.Segmenter;
  try {
    segmenter = new Intl.Segmenter("zh", { granularity: "word" });
  } catch {
    return null;
  }
  const words = [...segmenter.segment("组件设计")]
    .filter((segment) => segment.isWordLike)
    .map((segment) => segment.segment);
  if (words.length === 0) return null;
  if (words.every((word) => [...word].length === 1)) return null;
  return segmenter;
}

/** 创建版本化 SkillTokenizer；Segmenter 不可用时自动降级为 pure-bigram。 */
export function createSkillTokenizer(): SkillTokenizer {
  const segmenter = probeSegmenter();

  /** 词典分词；降级时逐字（配合滑窗 bigram 规则行为仍正确）。 */
  function segmentCjk(text: string): string[] {
    if (!segmenter) return [...text];
    return [...segmenter.segment(text)]
      .filter((segment) => segment.isWordLike)
      .map((segment) => segment.segment);
  }

  return { tokenize };

  /**
   * 分词管线：NFKC → script-run → CJK 段（§5 规则）/ Latin 段（标识符切分）→
   * lowercase 去重（保序）→ 长度过滤（Latin ≥2 或含数字；CJK 豁免）。
   */
  function tokenize(text: string): string[] {
    const normalized = text.normalize("NFKC");
    const out: string[] = [];
    for (const match of normalized.matchAll(RUN_RE)) {
      const run = match[0];
      if (CJK_RUN_START_RE.test(run)) {
        emitCjkRun(segmentCjk(run), out);
      } else if (/^[@A-Za-z0-9]/.test(run)) {
        splitLatinIdent(run, out);
      }
    }
    const seen = new Set<string>();
    const tokens: string[] = [];
    for (const token of out) {
      const lowered = token.toLowerCase();
      if (seen.has(lowered)) continue;
      seen.add(lowered);
      tokens.push(lowered);
    }
    return tokens.filter((token) =>
      CJK_SCRIPTS_RE.test(token) ? [...token].length >= 1 : token.length >= 2 || /\d/.test(token),
    );
  }
}

/** CJK 词序列发射：多字词原样；连续单字段（≥2 相邻单字）滑窗 bigram（单字不发射）；孤立单字 unigram。 */
function emitCjkRun(words: string[], out: string[]): void {
  let i = 0;
  while (i < words.length) {
    const word = words[i];
    if ([...word].length >= 2) {
      out.push(word);
      i += 1;
      continue;
    }
    let j = i;
    while (j < words.length && [...words[j]].length === 1) j += 1;
    const singles = words.slice(i, j);
    if (singles.length === 1) {
      out.push(singles[0]);
    } else {
      for (let k = 0; k + 1 < singles.length; k++) {
        out.push(singles[k] + singles[k + 1]);
      }
    }
    i = j;
  }
}

/** kebab/snake/域名段切分：原子 camel 切分 + joined 形态 + 多原子 kebab 整词。 */
function emitKebab(chunk: string, out: string[]): void {
  const atoms = chunk.split(/[^A-Za-z0-9]+/).filter((atom) => atom.length > 0);
  for (const atom of atoms) {
    const words = atom.match(CAMEL_RE) ?? [atom];
    out.push(...words);
    if (words.length > 1) out.push(atom.toLowerCase());
  }
  if (atoms.length > 1) out.push(atoms.join("-").toLowerCase());
}

/** Latin 标识符段：URL/scope 尾段 owner/repo 整词发射，再逐段 kebab 切分。 */
function splitLatinIdent(run: string, out: string[]): void {
  const parts = run.split("/");
  if (parts.length >= 2) {
    const last = parts[parts.length - 1];
    const owner = parts[parts.length - 2];
    if (/^@?[a-z0-9][a-z0-9._-]*$/i.test(owner) && /^[a-z0-9][a-z0-9._-]*$/i.test(last)) {
      const scope = owner.replace(/^@/, "");
      out.push(scope, last, `${scope}/${last}`);
    }
    for (const part of parts) emitKebab(part, out);
    return;
  }
  emitKebab(run, out);
}
