/**
 * 用户原始需求 [2026-10-06]（skills-tabs-redesign 批 3，design.md Δ2 定稿）：
 * 「语言标签 = 客户端扩展名映射，不进契约」——detail 内容查看器的 filebar
 * 语言 tag 由前端按扩展名推导（服务端零语义，未知扩展名投影为 Text 兜底）。
 * 正交意图：
 *   [1] 扩展名 → 语言标签的封闭映射（显示语义，非解析语义）。
 */

/** 扩展名（小写）→ 显示标签；未命中走 Text 兜底。 */
const EXTENSION_LABELS: Readonly<Record<string, string>> = {
  md: "Markdown",
  markdown: "Markdown",
  mdx: "MDX",
  txt: "Text",
  json: "JSON",
  jsonc: "JSONC",
  toml: "TOML",
  yaml: "YAML",
  yml: "YAML",
  ts: "TypeScript",
  tsx: "TSX",
  js: "JavaScript",
  jsx: "JSX",
  mjs: "JavaScript",
  cjs: "JavaScript",
  py: "Python",
  sh: "Shell",
  bash: "Shell",
  zsh: "Shell",
  fish: "Shell",
  rs: "Rust",
  go: "Go",
  rb: "Ruby",
  php: "PHP",
  java: "Java",
  kt: "Kotlin",
  kts: "Kotlin",
  swift: "Swift",
  c: "C",
  h: "C Header",
  cpp: "C++",
  cc: "C++",
  hpp: "C++ Header",
  cs: "C#",
  sql: "SQL",
  html: "HTML",
  htm: "HTML",
  css: "CSS",
  scss: "SCSS",
  vue: "Vue",
  svelte: "Svelte",
  csv: "CSV",
  xml: "XML",
  ini: "INI",
  env: "Env",
};

/** 身份文档（SKILL.md/.SKILL.md）在查看器中的语言标签。 */
export const IDENTITY_FILE_NAMES = new Set(["skill.md", ".skill.md"]);

/** 文件相对路径 → 语言标签（大小写不敏感；无扩展名 = Text）。 */
export function languageLabelFor(filePath: string): string {
  const base = filePath.split("/").pop() ?? filePath;
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "Text";
  return EXTENSION_LABELS[base.slice(dot + 1).toLowerCase()] ?? "Text";
}

/** 是否身份文档（frontmatter 独立身份源块仅对身份文档标注）。 */
export function isIdentityDocument(filePath: string): boolean {
  const base = filePath.split("/").pop() ?? filePath;
  return IDENTITY_FILE_NAMES.has(base.toLowerCase());
}

/** 是否 markdown 文档（查看器按渲染正文而非代码行号呈现）。 */
export function isMarkdownDocument(filePath: string): boolean {
  const base = filePath.split("/").pop() ?? filePath;
  const dot = base.lastIndexOf(".");
  return dot > 0 && ["md", "markdown", "mdx"].includes(base.slice(dot + 1).toLowerCase());
}
