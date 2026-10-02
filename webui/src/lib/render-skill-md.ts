/**
 * 用户原始需求 [2026-07-27]：「看不到技能正文是当前最大的产品缺口」。
 * 修订 [2026-10-02]（ux-polish-walkthrough-residue #1）：走查发现详情把
 * `description: >-` 折叠标量显示为原文「>-」——解析器补块标量（`>`/`|` ×
 * clip/strip/keep chomping），与列表行（ccski 服务端口径）一致。
 * 修订 [2026-10-02]（codex 复核 P2）：折叠标量连续空行产出错误——两空行只
 * 折出一个换行。统一为标准语义：任意位置连续 K 个空行 → K 个真实换行（此前
 * 块首空行被丢弃，一并修正；yaml 包实证对齐）。
 * 正交意图：
 *   [1] splitSkillContent：把 SKILL.md 原文切分为 frontmatter 元数据与 markdown 正文。
 *   [2] renderSkillBody：把 markdown 正文渲染为受信任 HTML（关闭原始 HTML 透传）。
 * 妥协声明：frontmatter 解析只覆盖 SkillFrontmatterSchema 实际承载的标量字段（与
 *   creator.save 一致）；不引入完整 YAML/gray-matter 链，保持浏览器 bundle 最小。
 *   块标量实现为最小手写子集：缩进指示符（`>-2`）与多层嵌套不支持（SKILL.md
 *   frontmatter 均为扁平结构）。
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
 * 解析最小 YAML 子集：扁平 `key: value` 行、`#` 整行注释，以及块标量
 * （`>` 折叠 / `|` 字面 × clip(默认)/strip(`-`)/keep(`+`) chomping）。
 * 值可带可选的单/双引号；未闭合的引号按原样保留。列表/嵌套对象不支持（保持与
 * SkillFrontmatterSchema 的标量字段一致）。块标量吸收后续缩进块：空行是段落
 * 分隔，缩进浅于首个内容行的行终止块（下一个键从那里继续解析）。
 */
function parseFrontmatterBlock(block: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = block.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const rawLine = lines[i]!;
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      i += 1;
      continue;
    }
    const colon = line.indexOf(":");
    if (colon <= 0) {
      i += 1;
      continue;
    }
    const key = line.slice(0, colon).trim();
    if (!key) {
      i += 1;
      continue;
    }
    const rawValue = line.slice(colon + 1).trim();
    const blockHeader = /^([>|])([+-]?$)/.exec(rawValue);
    if (blockHeader) {
      const style = blockHeader[1] === "|" ? "|" : ">";
      const { value, next } = parseBlockScalar(lines, i + 1, rawLine, style, blockHeader[2] ?? "");
      result[key] = value;
      i = next;
      continue;
    }
    result[key] = parseScalar(rawValue);
    i += 1;
  }
  return result;
}

/**
 * 从 `start` 行吸收一个块标量的缩进内容块，返回 (标量值, 下一个待解析行号)。
 * 块缩进 = 首个非空内容行的缩进；空行视为段落分隔保留；出现缩进浅于块缩进的
 * 非空行即终止（该行交还外层继续按 `key: value` 解析）。keep chomping 保留
 * 全部尾部空行，clip/strip 先裁掉尾部空行再分别补/不补单个换行。
 */
function parseBlockScalar(
  lines: string[],
  start: number,
  keyLine: string,
  style: ">" | "|",
  chomp: string,
): { value: string; next: number } {
  const keyIndent = keyLine.length - keyLine.trimStart().length;
  const content: string[] = [];
  let blockIndent: number | null = null;
  let j = start;
  while (j < lines.length) {
    const candidate = lines[j]!;
    if (candidate.trim() === "") {
      content.push("");
      j += 1;
      continue;
    }
    const indent = candidate.length - candidate.trimStart().length;
    if (blockIndent === null) {
      // 首个内容行决定块缩进：必须比键更深，否则视为空块。
      if (indent <= keyIndent) break;
      blockIndent = indent;
    }
    if (indent < blockIndent) break;
    content.push(candidate.slice(blockIndent));
    j += 1;
  }
  // 裁尾部空行（keep 除外）并统计保留数。
  let keptTrailing = 0;
  if (chomp !== "+") {
    while (content.length > 0 && content[content.length - 1] === "") content.pop();
  } else {
    while (content.length > 0 && content[content.length - 1] === "") {
      content.pop();
      keptTrailing += 1;
    }
  }
  let text: string;
  if (style === "|") {
    text = content.join("\n");
  } else {
    // folded：段内换行折叠为空格；空行为段落分隔——连续 K 个空行 → K 个换行。
    const paragraphs: string[] = [];
    let current: string[] = [];
    for (const line of content) {
      if (line === "") {
        paragraphs.push(current.join(" "));
        current = [];
      } else {
        current.push(line);
      }
    }
    paragraphs.push(current.join(" "));
    // 折叠语义（与标准 YAML 一致，yaml 包实证 2026-10-02）：任意位置连续 K 个
    // 空行 → K 个真实换行。paragraphs 中空段数 = 空行数 - 1（首个空行终止前
    // 段并消耗一次换行），故换行数 = pendingBreaks + 1；块首无前段时补 0。
    const parts: string[] = [];
    let pendingBreaks = 0;
    for (let p = 0; p < paragraphs.length; p += 1) {
      const paragraph = paragraphs[p]!;
      if (paragraph === "") {
        pendingBreaks += 1;
        continue;
      }
      parts.push("\n".repeat(pendingBreaks + (parts.length > 0 ? 1 : 0)));
      pendingBreaks = 0;
      parts.push(paragraph);
    }
    text = parts.join("");
  }
  if (text === "" && keptTrailing === 0) return { value: "", next: j };
  if (chomp === "-") return { value: text, next: j };
  if (chomp === "+") return { value: `${text}${"\n".repeat(keptTrailing + 1)}`, next: j };
  return { value: `${text}\n`, next: j };
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
