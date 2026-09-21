/**
 * 用户原始需求 [2026-09-21]：「workspace 很重要，但我们仍然需要有一个 global 的
 * 概念，global 能承载 workspace 泛化出来的 skill」——双级作用域（global `~` +
 * per-workspace 侧车目录）。
 * 正交意图：
 *   [1] WikiWorkspace：wiki/ 目录契约（patterns 为真相源；index 为派生投影；
 *       logs 追加式；skill-impact 程序化追加）。
 *   [2] 碎片认知追加通道（P1 升格）：contentHash 去重幂等 + index 同步重建。
 *   [3] 磁盘边界：畸形 pattern 读取丢弃、mutation typed 拒绝；全部写入走
 *       同目录临时文件 + rename 原子替换。
 * 妥协声明：gray-matter 不引入（依赖最小化）——frontmatter 用受限 YAML 子集
 * 逐行解析（title/created/updated/origin/promotedFrom 均为单行标量）。
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  PatternFrontmatterSchema,
  PatternListItemSchema,
  PatternNameSchema,
  SkillImpactEntrySchema,
  SkillWikiError,
  type PatternFrontmatter,
  type PatternListItem,
  type SkillImpactEntry,
} from "./schema.js";

/** wiki 作用域：global `~` 或 Imported WorkspaceId（`ws_` 前缀）。 */
export type WikiScope = "~" | (string & { readonly __wikiScope: unique symbol });

/** 校验并收窄 scope（外部输入边界）。 */
export function parseWikiScope(value: string): WikiScope {
  if (value === "~") return "~";
  if (/^ws_[a-f0-9]{24}$/.test(value)) return value as WikiScope;
  throw new SkillWikiError("WIKI_INVALID_SCOPE", `Invalid wiki scope: ${value}`);
}

/** 双级侧车目录：<appDir>/wiki/<scope>/（不写入用户技能资产目录）。 */
export function wikiScopeDirectory(appDir: string, scope: WikiScope): string {
  return path.join(appDir, "wiki", scope === "~" ? "~" : scope);
}

/**
 * 去重判据：正文的规范化 SHA-256——行尾统一 + 去尾部空白后哈希。写路径保证
 * 文件以换行结尾（md 卫生），规范化让该卫生字节不参与判据，追加侧输入与
 * 读取侧落盘回读产生同一 hash。
 */
export function patternContentHash(body: string): string {
  return createHash("sha256").update(body.replace(/\r\n/g, "\n").replace(/\s+$/, "")).digest("hex");
}

/**
 * 受限 frontmatter 解析（单行标量子集）。字段集直接过 strict schema：未知 key、
 * 缺字段或类型不符都判为不兼容页（null 交由调用方丢弃），不做字段清洗——strict
 * 语义即「当前版本无法接受就整页丢弃」（codex 复核 P2 修复）。
 */
function parseFrontmatter(raw: string): PatternFrontmatter | null {
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(raw);
  if (!match) return null;
  const fields: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const pair = /^([a-zA-Z]+):\s*(.*)$/.exec(line);
    if (pair) fields[pair[1]] = pair[2].replace(/^"|"$/g, "");
  }
  // 写入格式里 promotedFrom 为空串（本 scope 原生 null 的往返形态）；schema
  // 侧 nullable 接受空串前先归一为 null，其余字段原样交给 strict 收窄。
  if (fields.promotedFrom === "") {
    const normalized = { ...fields, promotedFrom: null } as unknown as Record<string, unknown>;
    const parsed = PatternFrontmatterSchema.safeParse(normalized);
    return parsed.success ? parsed.data : null;
  }
  const parsed = PatternFrontmatterSchema.safeParse(fields);
  return parsed.success ? parsed.data : null;
}

function formatPattern(frontmatter: PatternFrontmatter, body: string): string {
  const fm = [
    "---",
    `title: ${frontmatter.title.replace(/\n/g, " ")}`,
    `created: ${frontmatter.created}`,
    `updated: ${frontmatter.updated}`,
    `origin: ${frontmatter.origin}`,
    `promotedFrom: ${frontmatter.promotedFrom ?? ""}`,
    "---",
    "",
  ].join("\n");
  return `${fm}${body}`;
}

function atomicWriteUtf8(file: string, content: string): void {
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temp, content.endsWith("\n") ? content : `${content}\n`, "utf8");
  fs.renameSync(temp, file);
}

/** 一个 scope 的 wiki workspace（stateless 门面；目录惰性创建）。 */
export interface WikiWorkspace {
  /** 列表投影（patterns 目录为真相源；畸形条目静默丢弃）。 */
  listPatterns(): PatternListItem[];
  /** 单 pattern 全文（name 收窄；缺失/畸形 typed 失败）。 */
  readPattern(name: string): { frontmatter: PatternFrontmatter; body: string };
  /**
   * 碎片认知追加（P1 通道）：同 scope 内正文 contentHash 相同 → 幂等返回
   * 既有条目；否则新建 pattern 页（name 冲突时追加 `-2` 序号）并重建 index.md。
   */
  appendPattern(input: { title: string; body: string; origin?: string }): {
    item: PatternListItem;
    deduplicated: boolean;
  };
  /** 追加人类可读日志行（logs.md，append-only）。 */
  appendLog(line: string): void;
  /** 程序化追加 skill-impact 条目（文件尾 JSON 行；解析失败 typed 失败）。 */
  appendImpact(entry: SkillImpactEntry): void;
  /** 读取全部 skill-impact 条目（畸形行丢弃）。 */
  listImpact(): SkillImpactEntry[];
  /** 重建 index.md（patterns 目录投影；标准兼容的派生物）。 */
  rebuildIndex(): void;
}

export function openWikiWorkspace(directory: string): WikiWorkspace {
  const patternsDir = path.join(directory, "patterns");
  const indexFile = path.join(directory, "index.md");
  const logsFile = path.join(directory, "logs.md");
  const impactFile = path.join(directory, "skill-impact.md");

  const ensureDirectories = (): void => {
    fs.mkdirSync(patternsDir, { recursive: true });
  };

  const patternFiles = (): string[] => {
    ensureDirectories();
    return fs
      .readdirSync(patternsDir)
      .filter((name) => name.endsWith(".md"))
      .sort();
  };

  const readRaw = (name: string): string => {
    const file = path.join(patternsDir, `${name}.md`);
    if (!fs.existsSync(file)) {
      throw new SkillWikiError("WIKI_INVALID_PATTERN", `Pattern not found: ${name}`);
    }
    return fs.readFileSync(file, "utf8");
  };

  return {
    listPatterns() {
      const items: PatternListItem[] = [];
      for (const file of patternFiles()) {
        const raw = fs.readFileSync(path.join(patternsDir, file), "utf8");
        const frontmatter = parseFrontmatter(raw);
        if (!frontmatter) continue;
        const body = raw.replace(/^---\n[\s\S]*?\n---\n?/, "");
        const projected = PatternListItemSchema.safeParse({
          name: file.replace(/\.md$/, ""),
          title: frontmatter.title,
          origin: frontmatter.origin,
          promotedFrom: frontmatter.promotedFrom,
          updated: frontmatter.updated,
          contentHash: patternContentHash(body),
        });
        if (projected.success) items.push(projected.data);
      }
      return items;
    },

    readPattern(name) {
      const parsed = PatternNameSchema.safeParse(name);
      if (!parsed.success) {
        throw new SkillWikiError("WIKI_INVALID_PATTERN", `Invalid pattern name: ${name}`);
      }
      const raw = readRaw(parsed.data);
      const frontmatter = parseFrontmatter(raw);
      if (!frontmatter) {
        throw new SkillWikiError(
          "WIKI_INVALID_PATTERN",
          `Pattern frontmatter is incompatible: ${parsed.data}`,
        );
      }
      return { frontmatter, body: raw.replace(/^---\n[\s\S]*?\n---\n?/, "") };
    },

    appendPattern(input) {
      // title 先收窄（与 frontmatter schema 同口径）：空/超长标题会写出
      // listPatterns 永远丢弃的畸形页，必须在写入前拒绝。
      if (input.title.trim().length === 0 || input.title.length > 120) {
        throw new SkillWikiError(
          "WIKI_INVALID_PATTERN",
          `Pattern title must be 1-120 chars: ${JSON.stringify(input.title.slice(0, 60))}`,
        );
      }
      ensureDirectories();
      const hash = patternContentHash(input.body);
      const existing = this.listPatterns();
      const duplicate = existing.find((item) => item.contentHash === hash);
      if (duplicate) {
        return {
          item: duplicate,
          deduplicated: true,
        };
      }
      const base = slugify(input.title);
      const taken = new Set(existing.map((item) => item.name));
      let name = base;
      for (let suffix = 2; taken.has(name); suffix += 1) name = `${base}-${suffix}`;
      const now = new Date().toISOString();
      const frontmatter: PatternFrontmatter = {
        title: input.title,
        created: now,
        updated: now,
        origin: input.origin ?? "~",
        promotedFrom: null,
      };
      atomicWriteUtf8(path.join(patternsDir, `${name}.md`), formatPattern(frontmatter, input.body));
      this.rebuildIndex();
      return {
        item: {
          name,
          title: frontmatter.title,
          origin: frontmatter.origin,
          promotedFrom: null,
          updated: now,
          contentHash: hash,
        },
        deduplicated: false,
      };
    },

    appendLog(line) {
      ensureDirectories();
      fs.appendFileSync(logsFile, `- ${new Date().toISOString()} ${line}\n`, "utf8");
    },

    appendImpact(entry) {
      const parsed = SkillImpactEntrySchema.safeParse(entry);
      if (!parsed.success) {
        throw new SkillWikiError("WIKI_INVALID_PATTERN", "Invalid skill-impact entry.");
      }
      ensureDirectories();
      fs.appendFileSync(impactFile, `${JSON.stringify(parsed.data)}\n`, "utf8");
    },

    listImpact() {
      if (!fs.existsSync(impactFile)) return [];
      const entries: SkillImpactEntry[] = [];
      for (const line of fs.readFileSync(impactFile, "utf8").split("\n")) {
        if (line.trim() === "") continue;
        try {
          const parsed = SkillImpactEntrySchema.safeParse(JSON.parse(line));
          if (parsed.success) entries.push(parsed.data);
        } catch {
          // 畸形行丢弃（磁盘输入边界）。
        }
      }
      return entries;
    },

    rebuildIndex() {
      const items = this.listPatterns();
      const lines = items.map((item) => `- ${item.name} — ${item.title}`);
      atomicWriteUtf8(indexFile, ["# Wiki Index", "", ...lines].join("\n"));
    },
  };
}

/** 标题 → pattern 文件名（kebab 收窄；空结果回退 "pattern"）。 */
function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug === "" ? "pattern" : slug;
}
