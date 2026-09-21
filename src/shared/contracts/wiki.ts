/**
 * 用户原始需求 [2026-09-21]：「P1 本质上是在收集一些碎片的认知，这和 skill-wiki
 * 是有一些重叠的，是 skill-wiki 输入的一部分」——wiki RPC 面承载碎片追加。
 * 正交意图：
 *   [1] wiki RPC 输入/输出契约（browser-safe；schema 单一事实源在 skill-wiki 包，
 *       本文件只做 RPC 组合，不镜像字段定义）。
 *   [2] scope 输入收窄：`~` 或已注册 ws_*（registry 校验在 daemon 侧）。
 */
import { z } from "zod";
// browser-safe 子路径：schema.ts 纯 zod 零 node 依赖；根入口含 workspace.ts
// （node:fs/path/crypto），shared 契约与 WebUI 不得引入。
import { PatternListItemSchema, PatternNameSchema } from "skill-wiki/schema";
import { WorkspaceIdSchema } from "./workspaces.js";

/** wiki.list 输入（scope = Global `~` 或 Imported ws_*）。 */
export const WikiListInputSchema = z.object({ scope: WorkspaceIdSchema }).strict();

/** wiki.read 输入。 */
export const WikiReadInputSchema = z
  .object({ scope: WorkspaceIdSchema, name: PatternNameSchema })
  .strict();

/** wiki.append 输入（title 与 skill-wiki frontmatter 同口径；body 200k 上界防大负载）。 */
export const WikiAppendInputSchema = z
  .object({
    scope: WorkspaceIdSchema,
    title: z.string().min(1).max(120),
    body: z.string().max(200_000),
  })
  .strict();

/** wiki.read 输出：列表条目字段 + 正文。 */
export const WikiReadResultSchema = PatternListItemSchema.extend({
  body: z.string(),
}).strict();
/** 单 pattern 全文投影。 */
export type WikiReadResult = z.infer<typeof WikiReadResultSchema>;

/** wiki.append 输出：幂等去重语义对调用方可见（deduplicated=true 未新建页）。 */
export const WikiAppendResultSchema = z
  .object({
    item: PatternListItemSchema,
    deduplicated: z.boolean(),
  })
  .strict();
/** 碎片追加结果。 */
export type WikiAppendResult = z.infer<typeof WikiAppendResultSchema>;
