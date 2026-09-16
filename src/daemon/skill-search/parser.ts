/**
 * 用户原始需求 [2026-09-17]：「SKILL.md → SearchDocument：gray-matter；frontmatter
 * name/description min-1；无效回退 directoryName/空描述 + invalidFrontmatter=true，
 * 文档不弃；keywords/triggers 收窄 string|string[]；headings 截 30 条；body 截 12k chars。」
 * 正交意图：
 * 1. frontmatter 容错解析（schema 失败不弃文档，回退目录名/空描述）。
 * 2. markdown-to-search-text 正文抽提（剥 fence 围栏行、保留代码内标识符文本、12k 截断）。
 * 3. 实际被索引文件字节的 SHA-256 contentHash。
 */
import { createHash } from "node:crypto";
import matter from "gray-matter";
import { z } from "zod";
import { safeParseExternal } from "../../shared/external-input.js";

/** 解析规则版本；任何抽提规则变化必须递增并触发索引全量重建。 */
export const PARSER_VERSION = "matter-headings-12k-v1";

/** headings 收集上限（条）。 */
const HEADINGS_LIMIT = 30;
/** body 截断上限（chars）。 */
const BODY_LIMIT = 12_000;
/** code fence 围栏行（含 info string）的行级判定；无 g 标志（循环 .test 不带 lastIndex 状态）。 */
const FENCE_MARKER_RE = /^[ \t]*(?:```|~~~)/;
const HEADING_RE = /^#{1,4}[ \t]+(.+)$/gm;

/** frontmatter 最小合法形状（对齐 ccski：name/description min-1；未知字段在解析层忽略）。 */
const FrontmatterShapeSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
});

/** SKILL.md 解析产物（不含 canonical 身份与 installations，由编排层组合）。 */
export interface ParsedSkillDocument {
  name: string;
  description: string;
  keywords: string[];
  triggers: string[];
  headings: string;
  body: string;
  /** 实际被索引文件原始字节的 SHA-256 hex 全长（64 字符）。 */
  contentHash: string;
  invalidFrontmatter: boolean;
}

/**
 * 解析一个 SKILL.md 原始字节。gray-matter 失败（畸形 YAML 边界）按无 frontmatter
 * 处理：全文进 body、name 回退目录名——盘上的 skill 不因元数据损坏而搜不到。
 */
export function parseSkillDocument(raw: Buffer, directoryName: string): ParsedSkillDocument {
  const contentHash = createHash("sha256").update(raw).digest("hex");
  const text = raw.toString("utf8");
  let frontmatter: unknown = {};
  let content = text;
  try {
    const parsed = matter(text);
    frontmatter = parsed.data ?? {};
    content = parsed.content ?? "";
  } catch {
    frontmatter = {};
    content = text;
  }

  const valid = safeParseExternal(FrontmatterShapeSchema, frontmatter);
  const frontmatterRecord =
    frontmatter !== null && typeof frontmatter === "object"
      ? (frontmatter as Record<string, unknown>)
      : {};

  // fence 状态机：围栏行整行移除；代码内容进 body（标识符可检索），但 fence 内
  // 的 ATX 文本不是标题——headings 只从非 fence 行提取。
  const headingLines: string[] = [];
  const bodyLines: string[] = [];
  let inFence = false;
  for (const line of content.split("\n")) {
    if (FENCE_MARKER_RE.test(line)) {
      inFence = !inFence;
      continue;
    }
    bodyLines.push(line);
    if (!inFence) headingLines.push(line);
  }
  const headings = collectHeadings(headingLines.join("\n"));
  const body = bodyLines.join("\n").slice(0, BODY_LIMIT);

  return {
    name: valid ? valid.name : directoryName,
    description: valid ? valid.description : "",
    keywords: narrowStringList(frontmatterRecord.keywords),
    triggers: narrowStringList(frontmatterRecord.triggers),
    headings,
    body,
    contentHash,
    invalidFrontmatter: valid === null,
  };
}

/** keywords/triggers 收窄：string 视为一元数组；数组保留 string 条目；其它类型条目逐项丢弃。 */
function narrowStringList(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

function collectHeadings(content: string): string {
  const headings: string[] = [];
  for (const match of content.matchAll(HEADING_RE)) {
    headings.push(match[1].trim());
    if (headings.length >= HEADINGS_LIMIT) break;
  }
  return headings.join("\n");
}
