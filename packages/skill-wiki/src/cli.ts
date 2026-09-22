/**
 * 用户原始需求 [2026-09-21]（jixoai-search-core Phase 3）：「skill-wiki CLI——
 * list/show/add/find/edit/remove/log/impact；add 默认写入后自动相似警告；
 * 读命令结束后自动刷新 index.md，命令面无 reindex」。
 * 修订 [2026-09-22]（目录映射标准 Owner 裁决）：寻址从 `--scope ~|slug` 改为
 * `--workspace <path|~|./>`，缺省 `./`（项目级一等公民：当前目录的
 * .agents/skill-wiki/，无需 registry；global 显式 `~`）。
 * 修订 [2026-09-22]（wiki-directory-standard 2.1）：拆层为 cli-kit——命令单元
 * （语义参数 → 结构化结果 + exit 语义，IO 全注入）+ createWikiCli(host) 组装器；
 * 插槽仅 resolveScope / commandPrefix / extraCommands；默认实例与既有 bin 行为
 * 逐位一致（现有 CLI 测试守护）。
 * 正交意图：
 *   [1] argv 解析与命令路由（零依赖手写——包依赖纪律，zod 唯一运行时依赖
 *       之外的 @jixoai/search 仅供查重管线）＋ host 组装（三插槽：scope 解析、
 *       usage/错误前缀、扩展命令并入命令表）；用法错误 exit 2。
 *   [2] 八个命令单元的实现面（全部支持 --json；list 分页带 total/nextOffset
 *       元数据）；`--workspace` 原始值经 host resolveScope 解析（默认实现 =
 *       resolveWikiDirectory，缺省 `./`）。
 *   [3] typed 错误 → exit code 映射（3 WIKI_INVALID_SCOPE / 4 WIKI_INVALID_PATTERN /
 *       5 WIKI_PATCH_FAILED）；WikiUsageError → 2（宿主 resolveScope 亦可抛）；
 *       查重（SearchError）降级为警告，不失败。
 *   [4] 派生物纪律：每个读命令结束后 rebuildIndex()（patterns/ 唯一真相，
 *       index.md 自动追上）；add/edit/remove 同步维护查重索引。
 * 妥协声明：kit 自包根 index.ts 导出（skill-creator CLI 经包根组装 wiki 子命令）；
 * daemon bundle 已因 skill-search service 内联 @jixoai/search，旧「根入口不得拉入
 * 查重依赖」的隔离理由不复成立——包级依赖纪律不变（zod 之外仅查重管线用
 * @jixoai/search）。
 */
import fs from "node:fs";
import { z } from "zod";
import { SearchError, type SearchIndex } from "@jixoai/search";
import { SkillWikiError } from "./schema.js";
import type { WikiEdit } from "./patch.js";
import { openWikiWorkspace, resolveWikiDirectory, type WikiWorkspace } from "./workspace.js";
import {
  findSimilarPatterns,
  openWikiSearchIndex,
  patternSearchDoc,
  registerWikiCorpusEntries,
  unregisterWikiCorpusEntries,
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

/** 用法错误（内控与宿主共用：exit 2）。宿主 resolveScope 可抛此类型接管解析失败。 */
export class WikiUsageError extends Error {}

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
const VALUE_OPTIONS = new Set(["workspace", "sort", "offset", "limit", "title", "file", "filter"]);
/** 布尔形式参名。 */
const BOOLEAN_OPTIONS = new Set(["json", "no-similarity", "help"]);
/** 短参别名 → 规范名。 */
const OPTION_ALIASES: Record<string, string> = { f: "file", h: "help" };

function parseCommandLine(argv: readonly string[]): ParsedCommandLine {
  const positionals: string[] = [];
  const options = new Map<string, string | true>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (typeof token !== "string")
      throw new WikiUsageError(`unexpected argument: ${String(token)}`);
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
        throw new WikiUsageError(`option --${name} requires a value`);
      }
      if (inline === undefined) index += 1;
      options.set(name, value);
      continue;
    }
    if (BOOLEAN_OPTIONS.has(name)) {
      if (equals >= 0) throw new WikiUsageError(`option --${name} does not take a value`);
      options.set(name, true);
      continue;
    }
    throw new WikiUsageError(`unknown option: ${token}`);
  }
  return { positionals, options };
}

/**
 * 命令单元执行上下文：解析产物 + 注入 IO + host 绑定的 wiki 打开器。
 * `--workspace` 原始值不经命令单元自行解析——统一经 openWiki() 走 host
 * resolveScope（默认 = resolveWikiDirectory，缺省 `./`）。
 */
export interface WikiCliContext {
  io: CliIo;
  positionals: string[];
  options: Map<string, string | true>;
  /** 解析 workspace 引用并打开 wiki（typed 失败上抛，由组装器映射 exit code）。 */
  openWiki(): Promise<{ wiki: WikiWorkspace; wikiDirectory: string }>;
}

/**
 * 一个命令单元（内部命令与宿主 extraCommands 同形状）：usage 行（命令表里
 * 名称列之后的参数摘要）＋ 元数约束 ＋ 执行体（语义参数 → 结构化结果 +
 * exit 语义，IO 全注入）。
 */
export interface WikiCliCommand {
  usage: string;
  minPositionals: number;
  maxPositionals: number;
  run: (context: WikiCliContext) => number | Promise<number>;
}

/** 组装后的 wiki CLI 实例（run 为纯函数面：argv + IO → exit code）。 */
export interface WikiCli {
  run(argv: readonly string[], io: CliIo): Promise<number>;
}

/**
 * 宿主插槽（spec：仅此三个）。默认实现保证与既有 bin 行为逐位一致。
 * - resolveScope：宿主上下文 → wiki 目录（如 skill-creator 的 registry 只读
 *   label/ws_id 解析）；抛 WikiUsageError = 用法错误 exit 2，抛 SkillWikiError
 *   按 typed 域映射。
 * - commandPrefix：usage 首行与错误消息前缀（默认 "skill-wiki"）。
 * - extraCommands：宿主扩展命令（形状与内部命令单元一致，并入命令表与 usage）。
 */
export interface WikiCliHost {
  resolveScope?: (input: { requested?: string }) => string | Promise<string>;
  commandPrefix?: string;
  extraCommands?: Record<string, WikiCliCommand>;
}

function optionString(options: Map<string, string | true>, name: string): string | undefined {
  const value = options.get(name);
  return typeof value === "string" ? value : undefined;
}

function requireOption(options: Map<string, string | true>, name: string): string {
  const value = optionString(options, name);
  if (value === undefined || value.length === 0) {
    throw new WikiUsageError(`missing required option --${name}`);
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
  if (!/^\d+$/.test(raw))
    throw new WikiUsageError(`option --${name} must be a non-negative integer`);
  const value = Number.parseInt(raw, 10);
  if (value > max) throw new WikiUsageError(`option --${name} exceeds ${max}`);
  return value;
}

/**
 * 默认 scope 解析（目录映射标准）：`--workspace` 原始值 → wiki 目录；
 * 缺省 `./`——项目级一等公民，当前目录的 .agents/skill-wiki/，不依赖任何
 * registry 状态；global 显式 `~`（SKILL_WIKI_HOME 覆盖）。
 */
function defaultResolveScope({ requested }: { requested?: string }): string {
  return resolveWikiDirectory(requested ?? "./");
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
async function withWikiIndex<T>(
  wikiDirectory: string,
  wiki: WikiWorkspace,
  action: (index: SearchIndex) => Promise<T>,
): Promise<T> {
  const index = await openWikiSearchIndex(wikiDirectory, () => loadPatternDocSources(wiki));
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

async function cmdList(ctx: WikiCliContext): Promise<number> {
  const { wiki } = await ctx.openWiki();
  const sort = optionString(ctx.options, "sort") ?? "name";
  if (sort !== "name" && sort !== "updated") {
    throw new WikiUsageError(`option --sort must be name or updated (got: ${sort})`);
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

async function cmdShow(ctx: WikiCliContext): Promise<number> {
  const name = ctx.positionals[0];
  if (name === undefined) throw new WikiUsageError("show requires a <name> argument");
  const { wiki } = await ctx.openWiki();
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

async function cmdAdd(ctx: WikiCliContext): Promise<number> {
  const title = requireOption(ctx.options, "title");
  const body = await ctx.io.readStdin();
  if (body.length > MAX_BODY_CHARS) {
    throw new WikiUsageError(`body exceeds ${MAX_BODY_CHARS} chars (got: ${body.length})`);
  }
  const { wiki, wikiDirectory } = await ctx.openWiki();
  const json = ctx.options.has("json");
  const { item, deduplicated } = wiki.appendPattern({ title, body });

  let similar: SimilarPattern[] = [];
  if (!ctx.options.has("no-similarity")) {
    try {
      similar = await withWikiIndex(wikiDirectory, wiki, async (index) => {
        // 增量 upsert 该页（幂等）→ 自查询分可归一；corpus 登记随动。
        const source = { name: item.name, title: item.title, body };
        await index.upsert([patternSearchDoc(source)]);
        registerWikiCorpusEntries(wikiDirectory, [source]);
        return findSimilarPatterns(index, source);
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

async function cmdFind(ctx: WikiCliContext): Promise<number> {
  const query = ctx.positionals.join(" ").trim();
  if (query.length === 0) throw new WikiUsageError("find requires a <query> argument");
  const { wiki, wikiDirectory } = await ctx.openWiki();
  const json = ctx.options.has("json");
  const result = await withWikiIndex(wikiDirectory, wiki, (index) =>
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

async function cmdEdit(ctx: WikiCliContext): Promise<number> {
  const name = ctx.positionals[0];
  if (name === undefined) throw new WikiUsageError("edit requires a <name> argument");
  const file = requireOption(ctx.options, "file");
  const { wiki, wikiDirectory } = await ctx.openWiki();

  let raw: string;
  try {
    raw = await fs.promises.readFile(file, "utf8");
  } catch (error) {
    throw new WikiUsageError(`cannot read edits file ${file}: ${errorMessage(error)}`);
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (error) {
    throw new WikiUsageError(`edits file is not valid JSON: ${errorMessage(error)}`);
  }
  const parsedEdits = WikiEditsFileSchema.safeParse(parsedJson);
  if (!parsedEdits.success) {
    throw new WikiUsageError(
      `edits file must be a non-empty JSON array of WikiEdit: ${parsedEdits.error.issues
        .map((issue) => issue.message)
        .join("; ")}`,
    );
  }
  const edits: WikiEdit[] = parsedEdits.data;
  // editPattern 任一锚点未命中 → WIKI_PATCH_FAILED（exit 5）且页面零改动。
  const { item } = wiki.editPattern(name, edits);

  try {
    await withWikiIndex(wikiDirectory, wiki, async (index) => {
      const read = wiki.readPattern(item.name);
      const source = {
        name: item.name,
        title: read.frontmatter.title,
        body: read.body,
      };
      await index.upsert([patternSearchDoc(source)]);
      registerWikiCorpusEntries(wikiDirectory, [source]);
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

async function cmdRemove(ctx: WikiCliContext): Promise<number> {
  const name = ctx.positionals[0];
  if (name === undefined) throw new WikiUsageError("remove requires a <name> argument");
  const { wiki, wikiDirectory } = await ctx.openWiki();
  const read = wiki.readPattern(name);
  wiki.removePattern(name);
  // 删除后页面上无痕，logs.md 是唯一足迹。
  wiki.appendLog(`removed pattern ${name} ("${read.frontmatter.title}")`);

  try {
    await withWikiIndex(wikiDirectory, wiki, async (index) => {
      await index.remove([name]);
      unregisterWikiCorpusEntries(wikiDirectory, [name]);
    });
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

async function cmdLog(ctx: WikiCliContext): Promise<number> {
  const { wiki } = await ctx.openWiki();
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

async function cmdImpact(ctx: WikiCliContext): Promise<number> {
  const { wiki } = await ctx.openWiki();
  const filter = optionString(ctx.options, "filter");
  if (filter !== undefined && filter !== "accept" && filter !== "reject") {
    throw new WikiUsageError(`option --filter must be accept or reject (got: ${filter})`);
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

/** 内部命令单元（默认面；usage = 命令表里名称列之后的参数摘要）。 */
const COMMANDS: Record<string, WikiCliCommand> = {
  list: {
    usage: "[--workspace <path|~|./>] [--sort name|updated] [--offset 0] [--limit 100] [--json]",
    minPositionals: 0,
    maxPositionals: 0,
    run: cmdList,
  },
  show: {
    usage: "<name> [--workspace] [--json]",
    minPositionals: 1,
    maxPositionals: 1,
    run: cmdShow,
  },
  add: {
    usage: "--title <t> [--workspace] [--no-similarity] [--json]   (body from stdin)",
    minPositionals: 0,
    maxPositionals: 0,
    run: cmdAdd,
  },
  find: {
    usage: "<query> [--workspace] [--json]",
    minPositionals: 1,
    maxPositionals: Number.POSITIVE_INFINITY,
    run: cmdFind,
  },
  edit: {
    usage: "<name> -f <edits.json> [--workspace] [--json]",
    minPositionals: 1,
    maxPositionals: 1,
    run: cmdEdit,
  },
  remove: {
    usage: "<name> [--workspace] [--json]",
    minPositionals: 1,
    maxPositionals: 1,
    run: cmdRemove,
  },
  log: {
    usage: "[--workspace] [--limit 20] [--json]",
    minPositionals: 0,
    maxPositionals: 0,
    run: cmdLog,
  },
  impact: {
    usage: "[--workspace] [--filter accept|reject] [--json]",
    minPositionals: 0,
    maxPositionals: 0,
    run: cmdImpact,
  },
};

/** 组装 usage 文本（前缀与命令表随 host；默认实例 = 重构前字面量）。 */
function buildUsage(prefix: string, entries: Array<[string, WikiCliCommand]>): string {
  const commandLines = entries.map(([name, entry]) => `  ${name.padEnd(8)}${entry.usage}`);
  return [
    `usage: ${prefix} <command> [options]`,
    "",
    "commands:",
    ...commandLines,
    "",
    "options:",
    '  --workspace <w>   wiki workspace: "~" (global), "./" (default; the current',
    "                    directory's .agents/skill-wiki/), or any relative/absolute",
    "                    directory path (its .agents/skill-wiki/ — no registry needed)",
    "  --json            machine-readable output",
    "",
    "exit codes: 0 ok (incl. deduplicated) | 2 usage | 3 WIKI_INVALID_SCOPE",
    "            4 WIKI_INVALID_PATTERN | 5 WIKI_PATCH_FAILED",
  ].join("\n");
}

/**
 * cli-kit 组装器：host 插槽（resolveScope / commandPrefix / extraCommands）注入
 * 后产出 `{ run(argv, io) }` 纯函数面。typed 错误映射：SkillWikiError → 3/4/5；
 * WikiUsageError（含宿主 resolveScope 抛出）→ 2；其余 → 1。
 */
export function createWikiCli(host: WikiCliHost = {}): WikiCli {
  const prefix = host.commandPrefix ?? "skill-wiki";
  const resolveScope = host.resolveScope ?? defaultResolveScope;
  const commands: Record<string, WikiCliCommand> = { ...COMMANDS, ...host.extraCommands };
  const usage = buildUsage(prefix, Object.entries(commands));
  return {
    async run(argv: readonly string[], io: CliIo): Promise<number> {
      try {
        const parsed = parseCommandLine(argv);
        if (parsed.options.has("help") || parsed.positionals[0] === "help") {
          io.stdout(`${usage}\n`);
          return CLI_EXIT.ok;
        }
        const command = parsed.positionals.shift();
        if (command === undefined) {
          io.stderr(`${usage}\n`);
          return CLI_EXIT.usage;
        }
        const entry = commands[command];
        if (!entry) {
          throw new WikiUsageError(`unknown command: ${command}`);
        }
        if (parsed.positionals.length < entry.minPositionals) {
          throw new WikiUsageError(`${command} requires an argument`);
        }
        if (parsed.positionals.length > entry.maxPositionals) {
          throw new WikiUsageError(`${command} takes at most ${entry.maxPositionals} argument(s)`);
        }
        return await entry.run({
          io,
          positionals: parsed.positionals,
          options: parsed.options,
          openWiki: async () => {
            const wikiDirectory = await resolveScope({
              requested: optionString(parsed.options, "workspace"),
            });
            return { wiki: openWikiWorkspace(wikiDirectory), wikiDirectory };
          },
        });
      } catch (error) {
        if (error instanceof WikiUsageError) {
          io.stderr(`${prefix}: ${error.message}\n\n${usage}\n`);
          return CLI_EXIT.usage;
        }
        if (error instanceof SkillWikiError) {
          io.stderr(`${prefix}: ${error.code}: ${error.message}\n`);
          if (error.code === "WIKI_INVALID_SCOPE") return CLI_EXIT.invalidScope;
          if (error.code === "WIKI_INVALID_PATTERN") return CLI_EXIT.invalidPattern;
          return CLI_EXIT.patchFailed;
        }
        io.stderr(`${prefix}: ${errorMessage(error)}\n`);
        return CLI_EXIT.internal;
      }
    },
  };
}

/**
 * 默认实例入口（bin 兼容面）：等价 createWikiCli().run(argv, io)。现有测试与
 * bin 经此守门默认实例逐位一致。
 */
export async function runCli(argv: readonly string[], io: CliIo): Promise<number> {
  return createWikiCli().run(argv, io);
}
