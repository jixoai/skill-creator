/**
 * 用户原始需求 [2026-09-25]（切片③）：「SDK 侧新增（两段式）：蒸馏提案 Zod
 * 契约 + planDistillation（纯校验/哈希计算）+ applyDistillation（单项原子落盘
 * + promotedFrom 合并 + 崩溃可恢复的 intent/commit 判定）」（proposal.md）。
 * 正交意图：
 *   [1] 蒸馏模块公共出口（孵化期全量再导出；与包根 index.ts 的收窄策略一致）。
 */
export * from "./schema.js";
export * from "./canonical.js";
export * from "./promoted-from.js";
export * from "./plan.js";
export * from "./apply.js";
