/**
 * 用户原始需求 [2026-09-21]：「将它移植进来，用 skill-wiki 这个包来承载」
 * （WikiSkill 论文 §3.2.2 Wiki Maintainer 的编辑原语，py 参考实现移植）。
 * 正交意图：
 *   [1] 三种结构化编辑原语：append / replace / insert_after。
 *   [2] 精确子串锚定 + 原子应用：任一锚点未命中则整批失败，不落部分编辑。
 */
import { SkillWikiError } from "./schema.js";

/** 单条结构化编辑（论文 Wiki Maintainer 的 patch 词汇表）。 */
export type WikiEdit =
  | { op: "append"; content: string }
  | { op: "replace"; target: string; content: string }
  | { op: "insert_after"; target: string; content: string };

/**
 * 校验整批编辑可达：按序模拟应用，任何一步的 replace/insert_after 锚点在该步
 * 演化后的内容中未命中即失败。锚点允许指向前序编辑产生的文本。
 */
export function validateEdits(content: string, edits: readonly WikiEdit[]): void {
  applyEdits(content, edits);
}

/**
 * 按序应用一批编辑（纯函数）：append 追加到尾；replace/insert_after 对当前
 * 演化中内容的**第一处**命中生效（与论文语义一致）；任一锚点未命中即抛
 * WIKI_PATCH_FAILED——失败不产出部分结果，调用方持有的原文不受影响（落盘
 * 原子性由写入侧的同目录 rename 保证）。
 */
export function applyEdits(content: string, edits: readonly WikiEdit[]): string {
  let next = content;
  for (const edit of edits) {
    if (edit.op === "append") {
      next += edit.content;
      continue;
    }
    if (edit.target.length === 0) {
      throw new SkillWikiError("WIKI_PATCH_FAILED", `${edit.op} target is empty`);
    }
    const index = next.indexOf(edit.target);
    if (index < 0) {
      throw new SkillWikiError(
        "WIKI_PATCH_FAILED",
        `${edit.op} target not found: ${JSON.stringify(edit.target.slice(0, 60))}`,
      );
    }
    if (edit.op === "replace") {
      next = next.slice(0, index) + edit.content + next.slice(index + edit.target.length);
    } else {
      const after = index + edit.target.length;
      next = next.slice(0, after) + edit.content + next.slice(after);
    }
  }
  return next;
}
