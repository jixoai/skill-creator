/**
 * 用户原始需求 [2026-09-21]：「workspace 很重要，但我们仍然需要有一个 global 的
 * 概念，global 能承载 workspace 泛化出来的 skill」。
 * 用户原始需求 [2026-09-22]（wiki-directory-standard Owner 裁决）：「wiki 从中央根
 * 按名字分目录改为目录自身的属性——wiki 目录 = <dir>/.agents/skill-wiki/；
 * global 是 `~` 特例（SKILL_WIKI_HOME 覆盖，默认 ~/.agents/skill-wiki）；
 * slug 登记表与中央根退役，scope 由路径客观决定」。
 * 修订 [2026-09-25]（切片③ skill-wiki-maintainer）：私有 slugify 提升为导出
 * slugifyPatternTitle（raw 语义，空串原样返回；appendPattern 以 || "pattern"
 * 保留既有回退）；页面序列化/解析/原子写原语（formatPatternPage /
 * parsePatternPage / atomicWritePatternFile）与只读列举 listWikiPatternsReadOnly
 * 导出给蒸馏 SDK 共用——蒸馏写路径与 WikiWorkspace 逐字节同源。
 * 正交意图：
 *   [1] WikiWorkspace：wiki/ 目录契约（patterns 为真相源；index 为派生投影；
 *       logs 追加式；skill-impact 程序化追加）+ 目录映射标准
 *       （workspaceWikiDirectory / globalWikiDirectory / resolveWikiDirectory）。
 *   [2] 碎片认知追加通道（P1 升格）：contentHash 去重幂等 + index 同步重建。
 *   [3] 磁盘边界：畸形 pattern 读取丢弃、mutation typed 拒绝；全部写入走
 *       同目录临时文件 + rename 原子替换。
 * 妥协声明：gray-matter 不引入（依赖最小化）——frontmatter 用受限 YAML 子集
 * 逐行解析（title/created/updated/origin/promotedFrom 均为单行标量）。
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
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
import { applyEdits, type WikiEdit } from "./patch.js";

/**
 * 目录映射标准（2026-09-22 Owner 裁决）：wiki 目录是目录自身的属性（`.git/` 式
 * 约定），不存在中央根与名字空间分配——
 * - workspace 目录 `<dir>` → `<dir>/.agents/skill-wiki/`；
 * - global（`~` 特例）→ `SKILL_WIKI_HOME` env > `~/.agents/skill-wiki/`；
 * - registry workspace 的 wiki 与 workspace 目录同居。
 */

/** wiki 目录在 workspace 目录内的相对位置（`.git/` 式目录属性约定）。 */
export const WIKI_DIRECTORY_SEGMENTS = [".agents", "skill-wiki"] as const;

/** workspace 目录 → wiki 目录（`<dir>/.agents/skill-wiki`）。 */
export function workspaceWikiDirectory(dir: string): string {
  return path.join(dir, ...WIKI_DIRECTORY_SEGMENTS);
}

/** global wiki 目录：`SKILL_WIKI_HOME` env > `~/.agents/skill-wiki`（os.homedir）。 */
export function globalWikiDirectory(): string {
  const override = process.env.SKILL_WIKI_HOME;
  return override && override.length > 0
    ? override
    : path.join(os.homedir(), ".agents", "skill-wiki");
}

/**
 * workspace 引用（`"~"` 或目录路径）→ wiki 目录。外部输入边界：空串/纯空白/
 * 含 NUL 的非法形状 → typed `WIKI_INVALID_SCOPE`（slug 规则已随登记表退役，
 * 但非法 workspace 输入仍被拒绝）；相对路径按当前工作目录解析为绝对路径。
 */
export function resolveWikiDirectory(workspace: string): string {
  const trimmed = workspace.trim();
  if (trimmed.length === 0 || trimmed.includes("\0")) {
    throw new SkillWikiError(
      "WIKI_INVALID_SCOPE",
      `Invalid wiki workspace: ${JSON.stringify(workspace)}`,
    );
  }
  if (trimmed === "~") return globalWikiDirectory();
  return workspaceWikiDirectory(path.resolve(trimmed));
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
  // 写入格式里 promotedFrom 为空串（本 scope 原生 null 的往返形态）；手写
  // YAML 的 null 字面量（"null"——逐行解析器不产 JS null）同归一。schema
  // 侧 nullable 接受前先归一为 null，其余字段原样交给 strict 收窄
  // （走查实证：手写 `promotedFrom: null` 曾被读成真值串 → 幽灵 promoted 徽章）。
  if (fields.promotedFrom === "" || fields.promotedFrom === "null") {
    const normalized = { ...fields, promotedFrom: null } as unknown as Record<string, unknown>;
    const parsed = PatternFrontmatterSchema.safeParse(normalized);
    return parsed.success ? parsed.data : null;
  }
  const parsed = PatternFrontmatterSchema.safeParse(fields);
  return parsed.success ? parsed.data : null;
}

/** 页面正文剥离 frontmatter 后的剩余字节（与 listPatterns/readPattern 同口径）。 */
export function stripFrontmatter(raw: string): string {
  return raw.replace(/^---\n[\s\S]*?\n---\n?/, "");
}

/**
 * 解析 pattern 页原文 → frontmatter + body（畸形/不兼容页 → null；不清洗）。
 * 蒸馏执行层（distill/apply）与 WikiWorkspace 读写共用同一解析口径。
 */
export function parsePatternPage(
  raw: string,
): { frontmatter: PatternFrontmatter; body: string } | null {
  const frontmatter = parseFrontmatter(raw);
  return frontmatter ? { frontmatter, body: stripFrontmatter(raw) } : null;
}

/**
 * pattern 页序列化（frontmatter 单行标量子集 + body；与库内写路径逐字节同源）。
 * promotedFrom 恒为单行标量：null → 空串，足迹 → canonical JSON 字符串。
 */
export function formatPatternPage(frontmatter: PatternFrontmatter, body: string): string {
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

/** 同目录临时文件 + rename 的原子写（md 卫生：保证以换行结尾）。 */
export function atomicWritePatternFile(file: string, content: string): void {
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temp, content.endsWith("\n") ? content : `${content}\n`, "utf8");
  fs.renameSync(temp, file);
}

/** 一个 wiki 目录的 workspace（stateless 门面；目录惰性创建）。 */
export interface WikiWorkspace {
  /** 列表投影（patterns 目录为真相源；畸形条目静默丢弃）。 */
  listPatterns(): PatternListItem[];
  /** 单 pattern 全文（name 收窄；缺失/畸形 typed 失败）。 */
  readPattern(name: string): { frontmatter: PatternFrontmatter; body: string };
  /** 单 pattern 原文落盘字节（frontmatter + body；缺失/非法 name typed 失败）。 */
  readPatternRaw(name: string): string;
  /**
   * 碎片认知追加（P1 通道）：同 wiki 内正文 contentHash 相同 → 幂等返回
   * 既有条目；否则新建 pattern 页（name 冲突时追加 `-2` 序号）并重建 index.md。
   * origin 足迹约定（显示足迹 + 可机器解析）：global 写入传 `"~"`，workspace
   * 写入传 workspace 目录绝对路径。
   */
  appendPattern(input: { title: string; body: string; origin?: string }): {
    item: PatternListItem;
    deduplicated: boolean;
  };
  /**
   * 结构化编辑（patch 词汇表锚定 body；frontmatter 由库管理，`updated` 自动
   * bump）：任一锚点未命中 → WIKI_PATCH_FAILED 且零写入（applyEdits 纯函数 +
   * 写侧原子 rename 双保险）。
   */
  editPattern(name: string, edits: readonly WikiEdit[]): { item: PatternListItem };
  /** 删除 pattern 页并重建 index（未知/非法 name typed 失败）。 */
  removePattern(name: string): void;
  /** 追加人类可读日志行（logs.md，append-only）。 */
  appendLog(line: string): void;
  /** logs.md 全部非空行（追加序；文件缺失 = 空）。 */
  readLogLines(): string[];
  /** 程序化追加 skill-impact 条目（文件尾 JSON 行；解析失败 typed 失败）。 */
  appendImpact(entry: SkillImpactEntry): void;
  /** 读取全部 skill-impact 条目（畸形行丢弃）。 */
  listImpact(): SkillImpactEntry[];
  /** 重建 index.md（patterns 目录投影；标准兼容的派生物）。 */
  rebuildIndex(): void;
}

/** 只读 scope 摘要：pattern 计数 + 最近 updated（单次遍历，零目录副作用）。 */
export interface WikiPatternSummary {
  patternCount: number;
  /** 该 scope 全部成员 pattern 的 frontmatter `updated` 最大值；无成员 = null。 */
  lastUpdated: string | null;
}

/**
 * 只读 pattern 摘要（codex r1 P1 / r2 P2 语义）：与 listPatterns 同成员
 * 判定（文件名过 PatternNameSchema + frontmatter 可解析，两处同弃），但
 * 绝不创建任何目录——openWikiWorkspace 的 patterns/ 惰性 mkdir 不适用于
 * 读面（wiki.scopes / CLI scopes 索引）。目录未初始化（ENOENT/ENOTDIR）
 * 计 0 / null；其它读取故障（EACCES/EIO）typed 上抛，不伪装成空。单页
 * 读取失败按集合语义丢弃该页。
 */
export function wikiPatternSummary(wikiDirectory: string): WikiPatternSummary {
  const patternsDir = path.join(wikiDirectory, "patterns");
  let entries: string[];
  try {
    entries = fs.readdirSync(patternsDir);
  } catch (error) {
    const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
    if (code === "ENOENT" || code === "ENOTDIR") return { patternCount: 0, lastUpdated: null };
    throw new SkillWikiError(
      "WIKI_IO",
      `Cannot read the wiki patterns directory ${patternsDir}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  let count = 0;
  let lastUpdated: string | null = null;
  for (const entry of entries.filter((name) => name.endsWith(".md")).sort()) {
    // 成员判定与 listPatterns 全等（codex r2 P2）：文件名去掉 .md 后须过
    // PatternNameSchema，frontmatter 须可解析——「frontmatter 合法但文件名
    // 非法」的页面两处同弃，计数与列表永不漂移。
    if (!PatternNameSchema.safeParse(entry.replace(/\.md$/, "")).success) continue;
    try {
      const raw = fs.readFileSync(path.join(patternsDir, entry), "utf8");
      const frontmatter = parseFrontmatter(raw);
      if (frontmatter) {
        count += 1;
        if (frontmatter.updated > (lastUpdated ?? "")) lastUpdated = frontmatter.updated;
      }
    } catch {
      // 单页读取失败：按集合语义丢弃（计数的成员级降级，不影响其余页）。
    }
  }
  return { patternCount: count, lastUpdated };
}

/**
 * 只读列出全部合法 pattern 条目（与 listPatterns 同成员判定：文件名过
 * PatternNameSchema + frontmatter 可解析，两处同弃）——但**绝不创建任何目录**
 * （目录缺失/非目录 = 空列表；其它读取故障 typed WIKI_IO 上抛，不伪装成空）。
 * 供 planDistillation 等纯读路径使用（openWikiWorkspace 的 patterns/ 惰性
 * mkdir 不适用于「不改盘」的调用方）。
 */
export function listWikiPatternsReadOnly(wikiDirectory: string): PatternListItem[] {
  const patternsDir = path.join(wikiDirectory, "patterns");
  let entries: string[];
  try {
    entries = fs.readdirSync(patternsDir);
  } catch (error) {
    const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
    if (code === "ENOENT" || code === "ENOTDIR") return [];
    throw new SkillWikiError(
      "WIKI_IO",
      `Cannot read the wiki patterns directory ${patternsDir}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const items: PatternListItem[] = [];
  for (const entry of entries.filter((name) => name.endsWith(".md")).sort()) {
    const name = entry.replace(/\.md$/, "");
    if (!PatternNameSchema.safeParse(name).success) continue;
    try {
      const raw = fs.readFileSync(path.join(patternsDir, entry), "utf8");
      const frontmatter = parseFrontmatter(raw);
      if (!frontmatter) continue;
      const projected = PatternListItemSchema.safeParse({
        name,
        title: frontmatter.title,
        origin: frontmatter.origin,
        promotedFrom: frontmatter.promotedFrom,
        updated: frontmatter.updated,
        contentHash: patternContentHash(stripFrontmatter(raw)),
      });
      if (projected.success) items.push(projected.data);
    } catch {
      // 单页读取失败：按集合语义丢弃（与 wikiPatternSummary 同款成员级降级）。
    }
  }
  return items;
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

  /** name 收窄（外部输入边界：目录段安全）。 */
  const narrowName = (name: string): string => {
    const parsed = PatternNameSchema.safeParse(name);
    if (!parsed.success) {
      throw new SkillWikiError("WIKI_INVALID_PATTERN", `Invalid pattern name: ${name}`);
    }
    return parsed.data;
  };

  return {
    listPatterns() {
      const items: PatternListItem[] = [];
      for (const file of patternFiles()) {
        const raw = fs.readFileSync(path.join(patternsDir, file), "utf8");
        const frontmatter = parseFrontmatter(raw);
        if (!frontmatter) continue;
        const body = stripFrontmatter(raw);
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
      const narrowed = narrowName(name);
      const raw = readRaw(narrowed);
      const frontmatter = parseFrontmatter(raw);
      if (!frontmatter) {
        throw new SkillWikiError(
          "WIKI_INVALID_PATTERN",
          `Pattern frontmatter is incompatible: ${narrowed}`,
        );
      }
      return { frontmatter, body: stripFrontmatter(raw) };
    },

    readPatternRaw(name) {
      return readRaw(narrowName(name));
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
      const base = slugifyPatternTitle(input.title) || "pattern";
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
      atomicWritePatternFile(
        path.join(patternsDir, `${name}.md`),
        formatPatternPage(frontmatter, input.body),
      );
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

    editPattern(name, edits) {
      const narrowed = narrowName(name);
      const raw = readRaw(narrowed);
      const frontmatter = parseFrontmatter(raw);
      if (!frontmatter) {
        throw new SkillWikiError(
          "WIKI_INVALID_PATTERN",
          `Pattern frontmatter is incompatible: ${narrowed}`,
        );
      }
      const body = stripFrontmatter(raw);
      // 纯函数先行：任一锚点未命中在写入前失败（WIKI_PATCH_FAILED，零改动）。
      const nextBody = applyEdits(body, edits);
      const updated: PatternFrontmatter = {
        ...frontmatter,
        updated: new Date().toISOString(),
      };
      atomicWritePatternFile(
        path.join(patternsDir, `${narrowed}.md`),
        formatPatternPage(updated, nextBody),
      );
      this.rebuildIndex();
      return {
        item: {
          name: narrowed,
          title: updated.title,
          origin: updated.origin,
          promotedFrom: updated.promotedFrom,
          updated: updated.updated,
          contentHash: patternContentHash(nextBody),
        },
      };
    },

    removePattern(name) {
      const narrowed = narrowName(name);
      const file = path.join(patternsDir, `${narrowed}.md`);
      if (!fs.existsSync(file)) {
        throw new SkillWikiError("WIKI_INVALID_PATTERN", `Pattern not found: ${narrowed}`);
      }
      fs.unlinkSync(file);
      this.rebuildIndex();
    },

    appendLog(line) {
      ensureDirectories();
      fs.appendFileSync(logsFile, `- ${new Date().toISOString()} ${line}\n`, "utf8");
    },

    readLogLines() {
      if (!fs.existsSync(logsFile)) return [];
      return fs
        .readFileSync(logsFile, "utf8")
        .split("\n")
        .filter((line) => line.trim() !== "");
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
      atomicWritePatternFile(indexFile, ["# Wiki Index", "", ...lines].join("\n"));
    },
  };
}

/**
 * 标题 → pattern 文件名 slug 的 raw 变换（设计 W/r12 冻结：v1 = 提升为导出的
 * 现实现行为快照，逐字节不变——小写化 + 连续 [a-z0-9] 之外字符折叠为分隔符 +
 * 首尾分隔符剥离 + 截断至 48）。**raw 语义**：纯非 ASCII（含汉字）标题折叠后
 * 为空串，原样返回空串、不内建 fallback；空串策略归属调用方——appendPattern
 * 以 `|| "pattern"` 保留既有回退，蒸馏 plan 以空串判 model-invalid(empty-slug)。
 */
export function slugifyPatternTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}
