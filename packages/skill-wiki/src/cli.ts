/**
 * 用户原始需求 [2026-09-21]（jixoai-search-core Phase 3）：「skill-wiki CLI——
 * list/show/add/find/edit/remove/log/impact；add 默认写入后自动相似警告；
 * 读命令结束后自动刷新 index.md，命令面无 reindex」。
 * 正交意图：
 *   [1] 命令路由与 argv 解析（零依赖手写——包依赖纪律，zod 唯一运行时依赖
 *       之外的 @jixoai/search 仅供查重管线）；用法错误 exit 2。
 *   [2] 八个命令的实现面（全部支持 --json；list 分页带 total/nextOffset 元数据）。
 *   [3] typed 错误 → exit code 映射（3 WIKI_INVALID_SCOPE / 4 WIKI_INVALID_PATTERN /
 *       5 WIKI_PATCH_FAILED）；查重（SearchError）降级为警告，不失败。
 *   [4] 派生物纪律：每个读命令结束后 rebuildIndex()（patterns/ 唯一真相，
 *       index.md 自动追上）；add/edit/remove 同步维护查重索引。
 * 妥协声明：本模块不从包根入口导出——daemon bundle 内联 skill-wiki 根入口，
 * 不得经此拉入 @jixoai/search / node:sqlite；测试与 bin 经相对路径直接导入。
 */
import fs from "node:fs";
import { z } from "zod";
import { SearchError, type SearchIndex } from "@jixoai/search";
import { SkillWikiError } from "./schema.js";
import type { WikiEdit } from "./patch.js";
import {
  defaultWikiRoot,
  openWikiWorkspace,
  parseWikiScope,
  wikiScopeDirectory,
  type WikiScope,
  type WikiWorkspace,
} from "./workspace.js";
import {
  findSimilarPatterns,
  openScopeSearchIndex,
  patternSearchDoc,
  type PatternDocSource,
  type SimilarPattern,
} from "./similarity.js";

/** CLI 退出码契约（spec ADDED：0 成功含 deduplicated；2-5 typed 映射）。 */
export const CLI_EXIT = {
  ok: 0,
  internal: 1,
  usage: 2,
  invalidScope: 3,
  invalidPattern: 4,
  patchFailed: 5,
} as const;

/** CLI 进程 IO 缝（测试注入内存流；bin 适配 process.*）。 */
export interface CliIo {
  /** 读 stdin 全文到 EOF（add 的正文通道）。 */
  readStdin(): Promise<string>;
  stdout(text: string): void;
  stderr(text: string): void;
}

/** 用法错误（内控：exit 2）。 */
class UsageError extends Error {}

/** edits.json 的外部输入收窄（WikiEdit 数组）。 */
const WikiEditSchema = z.union([
  z.object({ op: z.literal("append"), content: z.string() }).strict(),
  z.object({ op: z.literal("replace"), target: z.string().min(1), content: z.string() }).strict(),
  z
    .object({ op: z.literal("insert_after"), target: z.string().min(1), content: z.string() })
    .strict(),
]);
const WikiEditsFileSchema = z.array(WikiEditSchema).min(1);

interface ParsedCommandLine {
  positionals: string[];
  options: Map<string, string | true>;
}

/** 接受值的形式参名（规范化后，不含 -- 前缀）。 */
const VALUE_OPTIONS = new Set(["scope", "sort", "offset", "limit", "title", "file", "filter"]);
/** 布尔形式参名。 */
const BOOLEAN_OPTIONS = new Set(["json", "no-similarity", "help"]);
/** 短参别名 → 规范名。 */
const OPTION_ALIASES: Record<string, string> = { f: "file", h: "help" };

function parseCommandLine(argv: readonly string[]): ParsedCommandLine {
  const positionals: string[] = [];
  const options = new Map<string, string | true>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (typeof token !== "string") throw new UsageError(`unexpected argument: ${String(token)}`);
    if (token === "--") {
      positionals.push(...argv.slice(index + 1));
      break;
    }
    if (!token.startsWith("-") || token === "-") {
      positionals.push(token);
      continue;
    }
    const body = token.replace(/^--?/, "");
    const equals = body.indexOf("=");
    const rawName = equals >= 0 ? body.slice(0, equals) : body;
    const name = OPTION_ALIASES[rawName] ?? rawName;
    if (VALUE_OPTIONS.has(name)) {
      const inline = equals >= 0 ? body.slice(equals + 1) : undefined;
      const value = inline ?? argv[index + 1];
      if (value === undefined || value.startsWith("-")) {
        throw new UsageError(`option --${name} requires a value`);
      }
      if (inline === undefined) index += 1;
      options.set(name, value);
      continue;
    }
    if (BOOLEAN_OPTIONS.has(name)) {
      if (equals >= 0) throw new UsageError(`option --${name} does not take a value`);
      options.set(name, true);
      continue;
    }
    throw new UsageError(`unknown option: ${token}`);
  }
  return { positionals, options };
}

interface CommandContext {
  io: CliIo;
  positionals: string[];
  options: Map<string, string | true>;
}

function optionString(options: Map<string, string | true>, name: string): string | undefined {
  const value = options.get(name);
  return typeof value === "string" ? value : undefined;
}

function requireOption(options: Map<string, string | true>, name: string): string {
  const value = optionString(options, name);
  if (value === undefined || value.length === 0) {
    throw new UsageError(`missing required option --${name}`);
  }
  return value;
}

function parseUnsignedInt(
  options: Map<string, string | true>,
  name: string,
  fallback: number,
  max: number,
): number {
  const raw = optionString(options, name);
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw)) throw new UsageError(`option --${name} must be a non-negative integer`);
  const value = Number.parseInt(raw, 10);
  if (value > max) throw new UsageError(`option --${name} exceeds ${max}`);
  return value;
}

/** 打开 scope（parseWikiScope typed 失败 → exit 3 由外层映射）。 */
function openScope(scopeValue: string | undefined): {
  wiki: WikiWorkspace;
  scope: WikiScope;
  wikiRoot: string;
} {
  const wikiRoot = defaultWikiRoot();
  const scope = parseWikiScope(scopeValue ?? "~");
  return { wiki: openWikiWorkspace(wikiScopeDirectory(wikiRoot, scope)), scope, wikiRoot };
}

/** 读命令结束后的派生物刷新（失败仅警告——index.md 不是真相源）。 */
function refreshDerivedIndex(wiki: WikiWorkspace, io: CliIo): void {
  try {
    wiki.rebuildIndex();
  } catch (error) {
    io.stderr(`warning: index.md refresh failed: ${errorMessage(error)}\n`);
  }
}

/** patterns 全量 → 查重索引文档源（全量重灌 / find 语义用）。 */
function loadPatternDocSources(wiki: WikiWorkspace): PatternDocSource[] {
  return wiki.listPatterns().map((item) => ({
    name: item.name,
    title: item.title,
    body: wiki.readPattern(item.name).body,
  }));
}

/**
 * 查重索引维护会话：打开（必要时全量重灌）→ 执行 → 必 close。
 * SearchError 由调用方决定降级（add/edit/remove 警告；find 上抛）。
 */
async function withScopeIndex<T>(
  wikiRoot: string,
  scope: WikiScope,
  wiki: WikiWorkspace,
  action: (index: SearchIndex) => Promise<T>,
): Promise<T> {
  const index = await openScopeSearchIndex(wikiRoot, scope, () => loadPatternDocSources(wiki));
  try {
    return await action(index);
  } finally {
    await index.close();
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function outputJson(io: CliIo, payload: unknown): void {
  io.stdout(`${JSON.stringify(payload, null, 2)}\n`);
}

function roundScore(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function storedTitle(hit: { id: string; stored?: Record<string, unknown> }): string {
  const title = hit.stored?.title;
  return typeof title === "string" ? title : hit.id;
}

/* ------------------------------- commands ------------------------------- */

function cmdList(ctx: CommandContext): number {
  const { wiki } = openScope(optionString(ctx.options, "scope"));
  const sort = optionString(ctx.options, "sort") ?? "name";
  if (sort !== "name" && sort !== "updated") {
    throw new UsageError(`option --sort must be name or updated (got: ${sort})`);
  }
  const offset = parseUnsignedInt(ctx.options, "offset", 0, 1_000_000);
  const limit = parseUnsignedInt(ctx.options, "limit", 100, 1_000);
  const json = ctx.options.has("json");

  const items = [...wiki.listPatterns()].sort((left, right) =>
    sort === "updated"
      ? right.updated.localeCompare(left.updated) || left.name.localeCompare(right.name)
      : left.name.localeCompare(right.name),
  );
  const page = items.slice(offset, offset + limit);
  const nextOffset = offset + limit < items.length ? offset + limit : null;
  refreshDerivedIndex(wiki, ctx.io);
  if (json) {
    outputJson(ctx.io, { patterns: page, total: items.length, nextOffset });
  } else {
    for (const item of page) ctx.io.stdout(`${item.name} — ${item.title}\n`);
  }
  return CLI_EXIT.ok;
}

function cmdShow(ctx: CommandContext): number {
  const name = ctx.positionals[0];
  if (name === undefined) throw new UsageError("show requires a <name> argument");
  const { wiki } = openScope(optionString(ctx.options, "scope"));
  const json = ctx.options.has("json");
  if (json) {
    const read = wiki.readPattern(name);
    refreshDerivedIndex(wiki, ctx.io);
    outputJson(ctx.io, { name, ...read.frontmatter, body: read.body });
  } else {
    const raw = wiki.readPatternRaw(name);
    refreshDerivedIndex(wiki, ctx.io);
    ctx.io.stdout(raw.endsWith("\n") ? raw : `${raw}\n`);
  }
  return CLI_EXIT.ok;
}

/** add 的正文上界（与宿主 RPC 契约同口径）。 */
const MAX_BODY_CHARS = 200_000;

async function cmdAdd(ctx: CommandContext): Promise<number> {
  const title = requireOption(ctx.options, "title");
  const body = await ctx.io.readStdin();
  if (body.length > MAX_BODY_CHARS) {
    throw new UsageError(`body exceeds ${MAX_BODY_CHARS} chars (got ${body.length})`);
  }
  const { wiki, scope, wikiRoot } = openScope(optionString(ctx.options, "scope"));
  const json = ctx.options.has("json");
  const { item, deduplicated } = wiki.appendPattern({ title, body });

  let similar: SimilarPattern[] = [];
  if (!ctx.options.has("no-similarity")) {
    try {
      similar = await withScopeIndex(wikiRoot, scope, wiki, async (index) => {
        // 增量 upsert 该页（幂等）→ 自查询分可归一。
        await index.upsert([patternSearchDoc({ name: item.name, title: item.title, body })]);
        return findSimilarPatterns(index, { name: item.name, title: item.title, body });
      });
    } catch (error) {
      if (!(error instanceof SearchError)) throw error;
      ctx.io.stderr(`warning: similarity check unavailable: ${errorMessage(error)}\n`);
    }
  }

  if (json) {
    outputJson(ctx.io, {
      name: item.name,
      title: item.title,
      deduplicated,
      similar: similar.map((entry) => ({ name: entry.name, score: roundScore(entry.score) })),
    });
  } else {
    ctx.io.stdout(
      deduplicated
        ? `Already captured as "${item.name}"\n`
        : `Captured "${item.title}" as ${item.name}\n`,
    );
    if (similar.length > 0) {
      ctx.io.stdout(
        `similar: ${similar.map((entry) => `${entry.name} (${entry.score.toFixed(2)})`).join(", ")}\n`,
      );
    }
  }
  return CLI_EXIT.ok;
}

const FIND_HIT_LIMIT = 10;

async function cmdFind(ctx: CommandContext): Promise<number> {
  const query = ctx.positionals.join(" ").trim();
  if (query.length === 0) throw new UsageError("find requires a <query> argument");
  const { wiki, scope, wikiRoot } = openScope(optionString(ctx.options, "scope"));
  const json = ctx.options.has("json");
  const result = await withScopeIndex(wikiRoot, scope, wiki, (index) =>
    index.search(query, { limit: FIND_HIT_LIMIT }),
  );
  refreshDerivedIndex(wiki, ctx.io);
  if (json) {
    outputJson(ctx.io, {
      results: result.hits.map((hit) => ({
        name: hit.id,
        title: storedTitle(hit),
        score: roundScore(hit.score),
      })),
      total: result.total,
    });
  } else {
    for (const hit of result.hits) {
      ctx.io.stdout(`${hit.id} (${hit.score.toFixed(2)}) — ${storedTitle(hit)}\n`);
    }
  }
  return CLI_EXIT.ok;
}

async function cmdEdit(ctx: CommandContext): Promise<number> {
  const name = ctx.positionals[0];
  if (name === undefined) throw new UsageError("edit requires a <name> argument");
  const file = requireOption(ctx.options, "file");
  const { wiki, scope, wikiRoot } = openScope(optionString(ctx.options, "scope"));

  let raw: string;
  try {
    raw = await fs.promises.readFile(file, "utf8");
  } catch (error) {
    throw new UsageError(`cannot read edits file ${file}: ${errorMessage(error)}`);
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (error) {
    throw new UsageError(`edits file is not valid JSON: ${errorMessage(error)}`);
  }
  const parsedEdits = WikiEditsFileSchema.safeParse(parsedJson);
  if (!parsedEdits.success) {
    throw new UsageError(
      `edits file must be a non-empty JSON array of WikiEdit: ${parsedEdits.error.issues
        .map((issue) => issue.message)
        .join("; ")}`,
    );
  }
  const edits: WikiEdit[] = parsedEdits.data;
  // editPattern 任一锚点未命中 → WIKI_PATCH_FAILED（exit 5）且页面零改动。
  const { item } = wiki.editPattern(name, edits);

  try {
    await withScopeIndex(wikiRoot, scope, wiki, async (index) => {
      const read = wiki.readPattern(item.name);
      await index.upsert([
        patternSearchDoc({ name: item.name, title: read.frontmatter.title, body: read.body }),
      ]);
    });
  } catch (error) {
    if (!(error instanceof SearchError)) throw error;
    ctx.io.stderr(`warning: search index refresh failed: ${errorMessage(error)}\n`);
  }

  if (ctx.options.has("json")) {
    outputJson(ctx.io, { name: item.name, applied: edits.length, updated: item.updated });
  } else {
    ctx.io.stdout(
      `Edited ${item.name} (${edits.length} edit${edits.length === 1 ? "" : "s"} applied)\n`,
    );
  }
  return CLI_EXIT.ok;
}

async function cmdRemove(ctx: CommandContext): Promise<number> {
  const name = ctx.positionals[0];
  if (name === undefined) throw new UsageError("remove requires a <name> argument");
  const { wiki, scope, wikiRoot } = openScope(optionString(ctx.options, "scope"));
  const read = wiki.readPattern(name);
  wiki.removePattern(name);
  // 删除后页面上无痕，logs.md 是唯一足迹。
  wiki.appendLog(`removed pattern ${name} ("${read.frontmatter.title}")`);

  try {
    await withScopeIndex(wikiRoot, scope, wiki, (index) => index.remove([name]));
  } catch (error) {
    if (!(error instanceof SearchError)) throw error;
    ctx.io.stderr(`warning: search index refresh failed: ${errorMessage(error)}\n`);
  }

  if (ctx.options.has("json")) {
    outputJson(ctx.io, { removed: name });
  } else {
    ctx.io.stdout(`Removed ${name}\n`);
  }
  return CLI_EXIT.ok;
}

function cmdLog(ctx: CommandContext): number {
  const { wiki } = openScope(optionString(ctx.options, "scope"));
  const limit = parseUnsignedInt(ctx.options, "limit", 20, 10_000);
  const lines = wiki.readLogLines().slice(-limit);
  refreshDerivedIndex(wiki, ctx.io);
  if (ctx.options.has("json")) {
    outputJson(ctx.io, { lines });
  } else {
    for (const line of lines) ctx.io.stdout(`${line}\n`);
  }
  return CLI_EXIT.ok;
}

function cmdImpact(ctx: CommandContext): number {
  const { wiki } = openScope(optionString(ctx.options, "scope"));
  const filter = optionString(ctx.options, "filter");
  if (filter !== undefined && filter !== "accept" && filter !== "reject") {
    throw new UsageError(`option --filter must be accept or reject (got: ${filter})`);
  }
  const entries = wiki
    .listImpact()
    .filter((entry) => filter === undefined || entry.decision === filter);
  refreshDerivedIndex(wiki, ctx.io);
  if (ctx.options.has("json")) {
    outputJson(ctx.io, { entries });
  } else {
    for (const entry of entries) {
      ctx.io.stdout(
        `${entry.date} ${entry.decision} ${entry.proposal.action} ${entry.proposal.skill} — ` +
          `${entry.proposal.summary} (${entry.reason})\n`,
      );
    }
  }
  return CLI_EXIT.ok;
}

/* ------------------------------- dispatch ------------------------------- */

const USAGE = `usage: skill-wiki <command> [options]

commands:
  list    [--scope ~|slug] [--sort name|updated] [--offset 0] [--limit 100] [--json]
  show    <name> [--scope] [--json]
  add     --title <t> [--scope] [--no-similarity] [--json]   (body from stdin)
  find    <query> [--scope] [--json]
  edit    <name> -f <edits.json> [--scope] [--json]
  remove  <name> [--scope] [--json]
  log     [--scope] [--limit 20] [--json]
  impact  [--scope] [--filter accept|reject] [--json]

options:
  --scope <s>   wiki scope: global "~" (default) or npm-scope slug
  --json        machine-readable output

exit codes: 0 ok (incl. deduplicated) | 2 usage | 3 WIKI_INVALID_SCOPE
            4 WIKI_INVALID_PATTERN | 5 WIKI_PATCH_FAILED`;

interface CommandEntry {
  minPositionals: number;
  maxPositionals: number;
  run: (ctx: CommandContext) => number | Promise<number>;
}

const COMMANDS: Record<string, CommandEntry> = {
  list: { minPositionals: 0, maxPositionals: 0, run: cmdList },
  show: { minPositionals: 1, maxPositionals: 1, run: cmdShow },
  add: { minPositionals: 0, maxPositionals: 0, run: cmdAdd },
  find: { minPositionals: 1, maxPositionals: Number.POSITIVE_INFINITY, run: cmdFind },
  edit: { minPositionals: 1, maxPositionals: 1, run: cmdEdit },
  remove: { minPositionals: 1, maxPositionals: 1, run: cmdRemove },
  log: { minPositionals: 0, maxPositionals: 0, run: cmdLog },
  impact: { minPositionals: 0, maxPositionals: 0, run: cmdImpact },
};

/**
 * CLI 主入口（纯函数面）：解析 argv → 分派命令 → 返回退出码。
 * typed 错误映射：SkillWikiError → 3/4/5；UsageError → 2；其余 → 1。
 */
export async function runCli(argv: readonly string[], io: CliIo): Promise<number> {
  try {
    const parsed = parseCommandLine(argv);
    if (parsed.options.has("help") || parsed.positionals[0] === "help") {
      io.stdout(`${USAGE}\n`);
      return CLI_EXIT.ok;
    }
    const command = parsed.positionals.shift();
    if (command === undefined) {
      io.stderr(`${USAGE}\n`);
      return CLI_EXIT.usage;
    }
    const entry = COMMANDS[command];
    if (!entry) {
      throw new UsageError(`unknown command: ${command}`);
    }
    if (parsed.positionals.length < entry.minPositionals) {
      throw new UsageError(`${command} requires an argument`);
    }
    if (parsed.positionals.length > entry.maxPositionals) {
      throw new UsageError(`${command} takes at most ${entry.maxPositionals} argument(s)`);
    }
    return await entry.run({ io, positionals: parsed.positionals, options: parsed.options });
  } catch (error) {
    if (error instanceof UsageError) {
      io.stderr(`skill-wiki: ${error.message}\n\n${USAGE}\n`);
      return CLI_EXIT.usage;
    }
    if (error instanceof SkillWikiError) {
      io.stderr(`skill-wiki: ${error.code}: ${error.message}\n`);
      if (error.code === "WIKI_INVALID_SCOPE") return CLI_EXIT.invalidScope;
      if (error.code === "WIKI_INVALID_PATTERN") return CLI_EXIT.invalidPattern;
      return CLI_EXIT.patchFailed;
    }
    io.stderr(`skill-wiki: ${errorMessage(error)}\n`);
    return CLI_EXIT.internal;
  }
}
