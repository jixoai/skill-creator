/**
 * 用户原始需求 [2026-09-21]：「我后续打算引入 skill-wiki 这概念（Google 团队的
 * 一篇论文……将它移植进来，用 skill-wiki 这个包来承载，再作为内核的一部分提供
 * 给 skill-creator」。
 * 正交意图：
 *   [1] wiki 数据契约（pattern 页 / skill-impact 条目）的 Zod 单一事实源。
 *   [2] 磁盘输入收窄边界：外部 md 一律 unknown 进 schema 出。
 * 妥协声明：logs.md 是人类可读追加日志，不做结构化 schema（非真相源）；
 * index.md 是派生投影（readIndex 总是从 patterns/ 重建，文件仅为标准兼容保留）。
 */
import { z } from "zod";

/** pattern 文件名（目录段安全：小写 kebab，防路径逃逸/平台差异）。 */
export const PATTERN_NAME_REGEX = /^[a-z0-9][a-z0-9-]*$/;
export const PATTERN_NAME_MAX = 64;

/** pattern 文件名 schema。 */
export const PatternNameSchema = z.string().regex(PATTERN_NAME_REGEX).max(PATTERN_NAME_MAX);

/** pattern 页 frontmatter（gray-matter 层之外的领域收窄）。 */
export const PatternFrontmatterSchema = z
  .object({
    /** 单行标题（index 行与列表呈现用）。 */
    title: z.string().min(1).max(120),
    /** 创建时间（ISO 8601）。 */
    created: z.string().min(1),
    /** 最后更新时间（ISO 8601）。 */
    updated: z.string().min(1),
    /** 产生该 pattern 的作用域（溯源足迹；global 侧为 "~"）。 */
    origin: z.string().min(1),
    /**
     * 泛化溯源（预留）：LLM Maintainer 把 workspace 认知蒸馏进 global 页
     * （新建或经 patch 吸收）时写入触发源；append 通道恒 null，无机械升格
     * 操作，workspace 原文永不删除。
     */
    promotedFrom: z.string().nullable().default(null),
  })
  .strict();
export type PatternFrontmatter = z.infer<typeof PatternFrontmatterSchema>;

/** 列表投影中的单个 pattern 条目。 */
export const PatternListItemSchema = z
  .object({
    name: PatternNameSchema,
    title: z.string(),
    origin: z.string(),
    promotedFrom: z.string().nullable(),
    updated: z.string(),
    /** 正文内容字节的 SHA-256 hex（去重判据）。 */
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type PatternListItem = z.infer<typeof PatternListItemSchema>;

/** skill-impact 记录（论文 §3.2.4：harness 程序化追加的提案→结果对）。 */
export const SkillImpactEntrySchema = z
  .object({
    /** ISO 8601 时间戳。 */
    date: z.string().min(1),
    proposal: z
      .object({
        /** create | update | disable 等原子动作词。 */
        action: z.string().min(1),
        /** 目标技能名。 */
        skill: z.string().min(1),
        /** 一行提案摘要。 */
        summary: z.string().min(1),
      })
      .strict(),
    decision: z.enum(["accept", "reject"]),
    /** 决策理由（reject 必填语义由调用方保证）。 */
    reason: z.string().min(1),
  })
  .strict();
export type SkillImpactEntry = z.infer<typeof SkillImpactEntrySchema>;

/** 库级 typed 错误（不依赖宿主错误体系）。 */
export type SkillWikiErrorCode =
  | "WIKI_PATCH_FAILED"
  | "WIKI_INVALID_PATTERN"
  | "WIKI_INVALID_SCOPE";
export class SkillWikiError extends Error {
  readonly code: SkillWikiErrorCode;
  constructor(code: SkillWikiErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.code = code;
  }
}
