/**
 * 用户原始需求 [2026-09-17]：「SKILL.md → SearchDocument：gray-matter；frontmatter
 * name/description min-1；无效回退 directoryName/空描述 + invalidFrontmatter=true，
 * 文档不弃；keywords/triggers 收窄 string|string[]；headings 截 30 条；body 截 12k chars。」
 * 修订 [2026-09-18]（search-robustness）：「skill 文件夹内的全部 md 文件」进入正文
 * ——额外 *.md 作为 body 补充文本；contentHash 升级为「实际被索引文件集字节」。
 * 正交意图：
 * 1. frontmatter 容错解析（schema 失败不弃文档，回退目录名/空描述）。
 * 2. markdown-to-search-text 正文抽提（剥 fence 围栏行、保留代码内标识符文本、12k 截断）。
 * 3. 文件集正文合并与 contentHash（身份源 + 额外 md，路径序确定性）。
 */
import { createHash } from "node:crypto";
import matter from "gray-matter";
import { z } from "zod";
import { safeParseExternal } from "../../shared/external-input.js";

/** 解析规则版本；任何抽提规则变化必须递增并触发索引全量重建。 */
export const PARSER_VERSION = "matter-mdset-v2";

/** headings 收集上限（条）。 */
const HEADINGS_LIMIT = 30;
/** 身份源（SKILL.md）body 截断上限（chars）。 */
const BODY_LIMIT = 12_000;
/** 额外 md 单文件文本截断上限（chars）。 */
const EXTRA_FILE_LIMIT = 6_000;
/** 额外 md 合计文本截断上限（chars）。 */
const EXTRA_TOTAL_LIMIT = 12_000;
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
  return finalizeDocument(splitFrontmatter(raw), raw, [], directoryName);
}

/** 额外 md 文件的正文抽提参数（收集顺序由调用方保证路径序确定性）。 */
export interface ExtraMarkdownFile {
  path: string;
  raw: Buffer;
}

/**
 * 解析技能文件集：SKILL.md 是唯一身份/结构源（frontmatter/headings/body 首段）；
 * 额外 *.md 只贡献 body 补充文本（fence 剥离 + 单文件 6k + 合计 12k 截断）。
 * contentHash 覆盖「实际被索引文件集字节」：身份源在前、额外文件按给定顺序拼接。
 */
export function parseSkillDocumentSet(
  sourceRaw: Buffer,
  extras: readonly ExtraMarkdownFile[],
  directoryName: string,
): ParsedSkillDocument {
  return finalizeDocument(splitFrontmatter(sourceRaw), sourceRaw, extras, directoryName);
}

function finalizeDocument(
  split: { frontmatter: unknown; content: string },
  sourceRaw: Buffer,
  extras: readonly ExtraMarkdownFile[],
  directoryName: string,
): ParsedSkillDocument {
  const hash = createHash("sha256").update(sourceRaw);
  for (const extra of extras) hash.update(extra.raw);

  // fence 状态机：围栏行整行移除；代码内容进正文（标识符可检索），但 fence 内
  // 的 ATX 文本不是标题——headings 只从非 fence 行提取。
  const headingLines: string[] = [];
  const bodyLines: string[] = [];
  let inFence = false;
  for (const line of split.content.split("\n")) {
    if (FENCE_MARKER_RE.test(line)) {
      inFence = !inFence;
      continue;
    }
    bodyLines.push(line);
    if (!inFence) headingLines.push(line);
  }
  const headings = collectHeadings(headingLines.join("\n"));
  const skillBody = bodyLines.join("\n").slice(0, BODY_LIMIT);

  let extraBudget = EXTRA_TOTAL_LIMIT;
  const extraParts: string[] = [];
  for (const extra of extras) {
    if (extraBudget <= 0) break;
    const text = stripFences(extra.raw.toString("utf8")).trim().slice(0, EXTRA_FILE_LIMIT);
    if (!text) continue;
    const bounded = text.slice(0, extraBudget);
    extraBudget -= bounded.length;
    extraParts.push(bounded);
  }
  const body = extraParts.length > 0 ? `${skillBody}\n${extraParts.join("\n")}` : skillBody;

  const valid = safeParseExternal(FrontmatterShapeSchema, split.frontmatter);
  const frontmatterRecord =
    split.frontmatter !== null && typeof split.frontmatter === "object"
      ? (split.frontmatter as Record<string, unknown>)
      : {};
  return {
    name: valid ? valid.name : directoryName,
    description: valid ? valid.description : "",
    keywords: narrowStringList(frontmatterRecord.keywords),
    triggers: narrowStringList(frontmatterRecord.triggers),
    headings,
    body,
    contentHash: hash.digest("hex"),
    invalidFrontmatter: valid === null,
  };
}

/** gray-matter 容错拆分：失败按无 frontmatter 处理（全文进 content）。 */
function splitFrontmatter(raw: Buffer): { frontmatter: unknown; content: string } {
  const text = raw.toString("utf8");
  try {
    const parsed = matter(text);
    return { frontmatter: parsed.data ?? {}, content: parsed.content ?? "" };
  } catch {
    return { frontmatter: {}, content: text };
  }
}

/** fence 剥离（额外 md 复用同一状态机；无标题抽提——headings 语义只属身份源）。 */
function stripFences(text: string): string {
  const lines: string[] = [];
  let inFence = false;
  for (const line of text.split("\n")) {
    if (FENCE_MARKER_RE.test(line)) {
      inFence = !inFence;
      continue;
    }
    lines.push(line);
  }
  return lines.join("\n");
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
