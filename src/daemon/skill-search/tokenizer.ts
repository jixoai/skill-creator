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
 *
 * 2026-09-21 平移过渡（jixoai-search-core 1.5）：实现源已迁至
 * packages/search/src/tokenizer.ts（@jixoai/search 包内，行为零改动）；本文件
 * 仅 re-export，Phase 2 迁移完成前保证现有引用不破。
 */
export * from "../../../packages/search/src/tokenizer.js";
