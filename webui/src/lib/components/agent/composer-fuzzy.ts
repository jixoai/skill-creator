/**
 * `$` 技能菜单的模糊匹配器（skill-refs C1）。
 *
 * 用户原始需求 [2026-09-16]：「要支持模糊的搜索能力」——TriggerMenu 缺省是
 * startsWith 前缀匹配（命令/引用菜单够用）；技能目录跨 Workspace 规模更大且
 * 用户按印象检索，走大小写不敏感子序列 + 加权。
 *
 * 正交意图：
 *   [1] 打分：name 子序列匹配（连续段 ×2、词首边界 ×1.5 加权）+ description
 *       子串低权加成（只对 name 已命中的条目排序，不改变淘汰）。
 *   [2] 排序投影：组内按分数降序（同分保持稳定序）；不承担分组。
 * 妥协声明：无（自实现 ~40 行，避免引 fuzzy 依赖——官方 webui 同为轻量匹配）。
 */

/** 归一：小写 + 连字符/下划线统一为词边界空格（`code-review` ≈ `code review`）。 */
function normalize(text: string): string {
  return text.toLowerCase().replaceAll(/[-_]+/g, " ");
}

/** 是否为词首边界（前字符是空白/点/行首）。 */
function isWordStart(normalized: string, index: number): boolean {
  return index === 0 || normalized[index - 1] === " " || normalized[index - 1] === ".";
}

/**
 * 子序列打分：query 的字符依序在 text 中出现才命中（不命中返回 null）。
 * 加权：连续命中间段 ×2、词首命中 ×1.5——直觉上「cg」把 code-review 排在
 * config-getter 前（两者都命中时连续度定胜负）。
 */
function subsequenceScore(query: string, text: string): number | null {
  if (query.length === 0) return 0;
  let score = 0;
  let cursor = -1;
  let streak = 0;
  for (const char of query) {
    const found = text.indexOf(char, cursor + 1);
    if (found === -1) return null;
    streak = found === cursor + 1 ? streak + 1 : 0;
    score += 1 + (streak > 0 ? 1 : 0) + (isWordStart(text, found) ? 0.5 : 0);
    cursor = found;
  }
  return score;
}

/** 匹配一条候选：name 主匹配，description 子串加成（未命中 name = 淘汰）。 */
export function fuzzyMatch(
  query: string,
  name: string,
  description = "",
): { score: number } | null {
  const needle = normalize(query.trim());
  if (needle.length === 0) return { score: 0 };
  const base = subsequenceScore(needle, normalize(name));
  if (base === null) return null;
  const bonus = description.length > 0 && normalize(description).includes(needle) ? 0.5 : 0;
  return { score: base + bonus };
}

/** 组内稳定排序（分数降序，同分保持传入序）。 */
export function fuzzySort<T>(items: T[], scoreOf: (item: T) => number): T[] {
  return items
    .map((item, index) => ({ item, index, score: scoreOf(item) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((entry) => entry.item);
}
