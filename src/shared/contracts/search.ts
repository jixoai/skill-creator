/**
 * 用户原始需求 [2026-09-17]：「跨全部本地 skills 的检索：`skill-creator search <query>`
 * 进程内完成，canonical 去重、CJK 分词、typo 容忍，结果按 contentHash 折叠」。
 * 正交意图：
 * 1. 定义搜索索引文档（canonical skill 真相 + installations 作用域绑定）。
 * 2. 定义搜索结果（rerank 后得分 + content-dup 折叠附注）。
 * 3. 定义搜索选项（limit 边界），供 CLI/RPC 复用同一契约。
 */
import { z } from "zod";
import { SkillIdSchema } from "./skills.js";
import { ProviderIdSchema, WorkspaceIdSchema } from "./workspaces.js";

/** 一个 canonical skill 在某个 Workspace.Provider 下的物理入口。 */
export const SkillInstallationSchema = z
  .object({
    /** 入口原始绝对路径（Agent 环境视角，可能是指向 canonical 目录的 symlink）。 */
    path: z.string().min(1),
    /** 该 root 所属 Workspace（Global 为 `~`，Imported 为 ws_*）。 */
    workspaceId: WorkspaceIdSchema,
    /** 该 root 的 Provider。 */
    providerId: ProviderIdSchema,
  })
  .strict();
/** 一个 canonical skill 的安装位置绑定。 */
export type SkillInstallation = z.infer<typeof SkillInstallationSchema>;

/** 搜索索引文档：以 canonical skill 为真相，installations 绑定 workspace/provider 作用域。 */
export const SkillSearchDocumentSchema = z
  .object({
    /** 与 skills.list 一致的稳定 sk_ id（canonical path digest）。 */
    id: SkillIdSchema,
    /** frontmatter name；无效时回退目录名（见 invalidFrontmatter）。 */
    name: z.string(),
    /** frontmatter description；无效时置空。 */
    description: z.string(),
    /** frontmatter keywords（string|string[] 收窄后的字符串数组）。 */
    keywords: z.array(z.string()),
    /** frontmatter triggers（同上收窄）。 */
    triggers: z.array(z.string()),
    /** body 的 #/##/###/#### 标题拼接（截 30 条）。 */
    headings: z.string(),
    /** markdown-to-search-text 正文（剥 fence 围栏行，截 12k chars）。 */
    body: z.string(),
    /** realpath 真相。 */
    canonicalPath: z.string().min(1),
    /** 同一 canonical 目录的全部入口（未来 RPC/GUI 可直接组装 WorkspaceProviderTarget）。 */
    installations: z.array(SkillInstallationSchema).min(1),
    /** 实际被索引 SKILL.md 原始字节的 SHA-256 hex（64 字符，无前缀）。 */
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    /** 仅 .SKILL.md 在场（技能被禁用）。 */
    disabled: z.boolean(),
    /** SKILL.md 与 .SKILL.md 并存（内容源取 SKILL.md）。 */
    conflict: z.boolean(),
    /** frontmatter 未过 name/description schema（文档仍入索引）。 */
    invalidFrontmatter: z.boolean(),
  })
  .strict();
/** 搜索索引文档。 */
export type SkillSearchDocument = z.infer<typeof SkillSearchDocumentSchema>;

/** content-dup 折叠后被主结果收纳的重复成员。 */
export const SkillSearchDuplicateSchema = z
  .object({
    id: SkillIdSchema,
    canonicalPath: z.string().min(1),
  })
  .strict();
/** content-dup 折叠附注成员。 */
export type SkillSearchDuplicate = z.infer<typeof SkillSearchDuplicateSchema>;

/** 搜索结果：冻结 tie-break（final desc → name asc → canonicalPath asc）后的稳定投影。 */
export const SkillSearchResultSchema = z
  .object({
    id: SkillIdSchema,
    name: z.string(),
    description: z.string(),
    canonicalPath: z.string().min(1),
    installations: z.array(SkillInstallationSchema).min(1),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    disabled: z.boolean(),
    conflict: z.boolean(),
    /** final = 0.7×(bm25/(bm25+8)) + 0.3×rerank。 */
    score: z.number(),
    /** 同 contentHash 组内被折叠的其余成员（同序）。 */
    duplicates: z.array(SkillSearchDuplicateSchema),
  })
  .strict();
/** 搜索结果项。 */
export type SkillSearchResult = z.infer<typeof SkillSearchResultSchema>;

/** 搜索选项；limit 默认 10，上限 50。 */
export const SkillSearchOptionsSchema = z
  .object({
    limit: z.number().int().min(1).max(50).default(10),
  })
  .strict();
/** 运行时校验后的搜索选项。 */
export type SkillSearchOptions = z.infer<typeof SkillSearchOptionsSchema>;
