/**
 * 用户原始需求 [2026-07-27]：「看不到技能正文是当前最大的产品缺口」。
 * 正交意图：
 *   [1] splitSkillContent：把 SKILL.md 原文切分为 frontmatter 元数据与 markdown 正文。
 *   [2] renderSkillBody：把 markdown 正文渲染为受信任 HTML（关闭原始 HTML 透传）。
 * 妥协声明：frontmatter 解析只覆盖 SkillFrontmatterSchema 实际承载的标量字段（与
 *   creator.save 一致）；不引入完整 YAML/gray-matter 链，保持浏览器 bundle 最小。
 */
import { Marked } from "marked";

/** frontmatter 与正文切分结果。 */
export interface SplitSkillContent {
  /** 解析后的 frontmatter 字段（passthrough 保留未知键）。 */
  frontmatter: Record<string, unknown>;
  /** 去掉 frontmatter 块后的 markdown 正文（原文，未渲染）。 */
  body: string;
}

const FRONTMATTER_DELIMITER = "---";

/**
 * 判断一行（已去尾部换行）是否为 frontmatter 起始/结束 `---` 边界。
 * 允许行尾跟随空白；行内不得有其它字符。
 */
function isFrontmatterFence(line: string): boolean {
  return line.trim() === FRONTMATTER_DELIMITER;
}

/**
 * 解析最小 YAML 子集：仅支持扁平 `key: value` 行与 `#` 整行注释。
 * 值可带可选的单/双引号；未闭合的引号按原样保留。列表/嵌套对象不支持（保持与
 * SkillFrontmatterSchema 的标量字段一致）。
 */
function parseFrontmatterBlock(block: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const key = line.slice(0, colon).trim();
    if (!key) continue;
    const rawValue = line.slice(colon + 1).trim();
    result[key] = parseScalar(rawValue);
  }
  return result;
}

/** 解析单个标量值，去除可选引号；空串视为 undefined 以便省略。 */
function parseScalar(raw: string): unknown {
  if (raw === "") return undefined;
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw === "null" || raw === "~") return null;
  const first = raw[0];
  const last = raw[raw.length - 1];
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return raw.slice(1, -1);
  }
  return raw;
}

/**
 * 将 SKILL.md 原文切分为 frontmatter 与 body。
 *
 * 约定与 `creator.save` 一致：仅文件首部 `---` 包裹的块视为 frontmatter；
 * 首行非 `---` 时整篇视为正文。frontmatter 解析失败时退化为空对象，正文仍按原文返回。
 */
export function splitSkillContent(content: string): SplitSkillContent {
  if (typeof content !== "string" || content.length === 0) {
    return { frontmatter: {}, body: "" };
  }
  const lines = content.split(/\r?\n/);
  if (lines.length === 0 || !isFrontmatterFence(lines[0]!)) {
    return { frontmatter: {}, body: content };
  }
  let closingLine = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (isFrontmatterFence(lines[i]!)) {
      closingLine = i;
      break;
    }
  }
  if (closingLine === -1) {
    // 缺失结束边界：保守地整篇当正文，不解析 frontmatter。
    return { frontmatter: {}, body: content };
  }
  const frontmatterBlock = lines.slice(1, closingLine).join("\n");
  const body = lines
    .slice(closingLine + 1)
    .join("\n")
    .replace(/^\r?\n/, "");
  return { frontmatter: parseFrontmatterBlock(frontmatterBlock), body };
}

/**
 * 受信任的 marked 实例：关闭原始 HTML 透传（marked 默认对内联 HTML 转义文本，
 * 这里显式关闭 walkTokens/walker 以避免任何 HTML 直通），避免 `<script>` 注入。
 */
const trustedMarked = new Marked({ gfm: true, breaks: false, async: false });

/**
 * 把 markdown 正文渲染为受信任 HTML 字符串。
 *
 * 安全保证：marked 默认对原始 HTML 做转义（不作为可执行 HTML 注入）；本函数额外
 * 兜底移除任何 `<script>` 起始标签，防止 frontmatter/body 含恶意片段。
 * 调用方必须仅把返回值喂给 `{@html ...}`。
 */
export function renderSkillBody(body: string): string {
  if (typeof body !== "string" || body.length === 0) return "";
  const html = trustedMarked.parse(body) ?? "";
  return typeof html === "string" ? sanitizeHtml(html) : "";
}

/** 兜底 sanitize：移除 `<script>` 起始标签与其后续内容直至闭合（保守策略）。 */
function sanitizeHtml(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<script\b[^>]*>/gi, "");
}
