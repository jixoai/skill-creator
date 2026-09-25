/**
 * 蒸馏 Job 编排服务（skill-wiki-maintainer tasks 1.3/1.4；design §4/§5/H/I/J/M/N/Q/R/S/W）。
 *
 * 用户原始需求 [2026-09-25]（design §1）：「DistillJobService（daemon 专用服务，
 * 非 agentSessions）：run registry + agent kernel 一次性 job + skill-wiki SDK 两段式。
 * 模型只产提案；所有写路径收敛到 applyDistillation 且必经 proposal 审批。」
 * 用户原始需求 [2026-09-25]（design H r16/r17）：「attempts 预留制：写页尝试前
 * 原子 +1，剩余 = 3-attempts；rebuild-only 队列内 ≤2 独立上限；io-failed 永久
 * 终态，重启恢复仅限 applying 行。」
 *
 * 正交意图：
 *   [1] run registry 持久化：`<appDir>/wiki-distill/<runId>/`（0700/0600、同目录
 *       temp+rename 原子写；run.json = ledger 派生缓存——启动按 S 优先级纯函数
 *       重算回写（r12，时间戳保留、字节幂等）；proposals.jsonl = 机器真相 ledger；
 *       LRU ≤20（引用真相 = 持久 ledger：非终态 run 或 pending/applying 行 pin；
 *       先 C expired 收敛再淘汰；损坏 run 目录 typed DISTILL_IO + pin fail-closed）。
 *   [2] per-run 串行队列（J）：apply 执行、approve/reject 决定、cancel、重启扫描、
 *       LRU 淘汰全经同一队列——取消与审批执行不可能交错写入；kernel prompt 在
 *       队列外驱动，其状态迁移经队列任务收敛。
 *   [3] 蒸馏生命周期：start（同 source 活跃 run ≤1 → DISTILL_ACTIVE_RUN；corpus
 *       落盘成功才进 kernel；只读面三工具 + 120s 有界）→ plan → admitBatch 原子
 *       admission（整批拒绝 → 全行 not-proposed + failed(capacity) + typed
 *       DISTILL_LIMIT）；cancel（kernel-running → dispose+cancelled；
 *       awaiting-approval → C 失效语义：pending→expired + store 主动 reject
 *       cause=cancelled）；重启扫描（awaiting-approval → cancelled(restarted)、
 *       ledger pending→expired、applying 行矩阵重放恢复）；daemon stop → dispose +
 *       failed(cancelled-by-shutdown)。
 *   [4] 审批执行桥（N）：wiki.distill_apply 的 approved 入口 = enqueue 并等待队列
 *       终态；写序 ledger-first ①ledger → ②store 直投（异常不回滚①不阻塞③）→
 *       ③run.json S 收敛；onRejected 接线（human → ledger rejected；cancelled →
 *       no-op）；决定竞争按 R 胜者表收敛。
 * 妥协声明：run.json 的 createdAt/updatedAt 在纯重算路径逐字节保留（只有真实
 *   状态迁移才更新 updatedAt）——「重启重算字节级一致」fixture 依赖该不变式；
 *   kernel prompt 的真实 LLM 驱动不在单测面（工厂 seam 注入 fake，端到端 1.5）。
 */
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import {
  DISTILL_BUDGETS,
  DISTILL_EVIDENCE_THRESHOLD,
  DISTILL_SCORE_VERSION,
  DistillInvalidDiagnosticSchema,
  DistillProposalSchema,
  PatternNameSchema,
  SkillWikiError,
  applyDistillation,
  distillCorpusDigest,
  distillProposalDigest,
  findSimilarPatterns,
  globalWikiDirectory,
  listWikiPatternsReadOnly,
  openWikiSearchIndex,
  openWikiWorkspace,
  parsePatternPage,
  planDistillation,
  stripFrontmatter,
  workspaceWikiDirectory,
  type DistillCorpus,
  type DistillInvalidDiagnostic,
  type DistillItemResult,
  type DistillLedgerRecord,
  type DistillPlanItem,
  type DistillProvenance,
} from "skill-wiki";
import {
  DistillApplyInputSchema,
  DistillCountersSchema,
  DistillItemStatusSchema,
  DistillLedgerStatusSchema,
  DistillRunIdSchema,
  RunStateSchema,
  type CapabilityCallResult,
  type CapabilityFailureDetail,
  type DistillCancelOutput,
  type DistillErrorCode,
  type DistillFailReason,
  type DistillLedgerStatus,
  type DistillStatusOutput,
  type ProposalRejectCause,
  type RunState,
} from "../shared/contracts/wiki-distill.js";
import { WorkspaceIdSchema, type WorkspaceId } from "../shared/contracts/workspaces.js";
import { appDir } from "../shared/paths.js";
import { DomainError } from "./domain-error.js";
import type { WorkspaceRegistry } from "./workspace-registry/index.js";
import type { McpProposalStore, McpProposalView } from "./mcp/proposals.js";
import type { EphemeralSession } from "./kernel/ephemeral-session.js";
import { DISTILL_READONLY_TOOL_NAMES, EphemeralSessionError } from "./kernel/ephemeral-session.js";
import type { DshKernelHandle } from "./kernel/dsh-kernel.js";

/* ------------------------------------------------------------------ */
/* 持久化形状（frozen）                                                 */
/* ------------------------------------------------------------------ */

const Sha256HexPattern = /^[a-f0-9]{64}$/;

/** run.json（ledger 派生缓存；对象键序冻结 = 序列化字节稳定性）。 */
const RunFileSchema = z.strictObject({
  schemaVersion: z.literal(1),
  runId: DistillRunIdSchema,
  source: WorkspaceIdSchema,
  /** 足迹 sourceScope（start 时持久化的 workspace 目录绝对路径；重放不依赖 registry）。 */
  sourceScope: z.string().min(1),
  state: RunStateSchema,
  reason: z
    .enum([
      "no-valid-proposals",
      "capacity",
      "io",
      "timeout",
      "kernel-unavailable",
      "restarted",
      "cancelled-by-shutdown",
    ])
    .nullable(),
  counters: DistillCountersSchema,
  corpusDigest: z.string().regex(Sha256HexPattern),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});
type RunFile = z.infer<typeof RunFileSchema>;

/**
 * proposals.jsonl 单行（§5 的 proposal+digest+status 与 E 的 DistillLedgerRecord
 * 合并形状；整文件原子重写保证行只有旧/新两态，无半行）。
 */
const LedgerLineSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("absorb"),
    ordinal: z.number().int().nonnegative(),
    digest: z.string().regex(Sha256HexPattern),
    proposal: DistillProposalSchema,
    status: DistillLedgerStatusSchema,
    beforeHash: z.string().regex(Sha256HexPattern),
    afterHash: z.string().regex(Sha256HexPattern),
    appliedHash: z.string().regex(Sha256HexPattern).optional(),
    attempts: z.number().int().nonnegative(),
    proposalId: z.string().nullable(),
    detail: z.string().optional(),
    createdAt: z.string().min(1),
    decidedAt: z.string().min(1).optional(),
  }),
  z.strictObject({
    kind: z.literal("create"),
    ordinal: z.number().int().nonnegative(),
    digest: z.string().regex(Sha256HexPattern),
    proposal: DistillProposalSchema,
    status: DistillLedgerStatusSchema,
    targetPatternName: PatternNameSchema,
    afterHash: z.string().regex(Sha256HexPattern),
    appliedHash: z.string().regex(Sha256HexPattern).optional(),
    attempts: z.number().int().nonnegative(),
    proposalId: z.string().nullable(),
    detail: z.string().optional(),
    createdAt: z.string().min(1),
    decidedAt: z.string().min(1).optional(),
  }),
]);
type LedgerLine = z.infer<typeof LedgerLineSchema>;

/** diagnostics.json（model-invalid 诊断；无 ledger 行，仅入 counters）。 */
const DiagnosticsFileSchema = z.array(DistillInvalidDiagnosticSchema);

/** LRU 上限（§6：最多 20 个 run）。 */
export const MAX_DISTILL_RUNS = 20;
/** kernel prompt 有界（§4：默认 120s）。 */
export const DEFAULT_DISTILL_PROMPT_DEADLINE_MS = 120_000;
/** rebuild-only 队列内重试上限（H r16：≤2，独立于 attempts 预算）。 */
const REBUILD_RETRY_LIMIT = 2;

const TERMINAL_LINE_STATUSES: ReadonlySet<DistillLedgerStatus> = new Set([
  "applied",
  "idempotent",
  "stale",
  "patch-failed",
  "expired",
  "rejected",
  "not-proposed",
  "io-failed",
]);

const TERMINAL_RUN_STATES: ReadonlySet<RunState> = new Set(["completed", "failed", "cancelled"]);

function isTerminalLine(status: DistillLedgerStatus): boolean {
  return TERMINAL_LINE_STATUSES.has(status);
}

function isTerminalRun(state: RunState): boolean {
  return TERMINAL_RUN_STATES.has(state);
}

/**
 * S 终态优先级（唯一顺序，自上而下首个命中）：零合法 → no-valid-proposals；
 * expired 在场 → cancelled(restarted)（C/R：取消与重启竞争的 ledger 终态）；
 * 全 not-proposed → capacity；全 io-failed → io；全终态 → completed（mixed
 * 含 io-failed 亦 completed，失败计数在 counters）；其余 → null（尚有
 * pending/applying，保持现状态——收敛由末项终态写入的队列任务执行）。
 */
function deriveTerminal(
  lines: readonly LedgerLine[],
): { state: RunState; reason: DistillFailReason | null } | null {
  if (lines.length === 0) return { state: "failed", reason: "no-valid-proposals" };
  if (lines.some((line) => line.status === "expired")) {
    return { state: "cancelled", reason: "restarted" };
  }
  if (lines.every((line) => line.status === "not-proposed")) {
    return { state: "failed", reason: "capacity" };
  }
  if (lines.every((line) => line.status === "io-failed")) {
    return { state: "failed", reason: "io" };
  }
  if (lines.every((line) => isTerminalLine(line.status))) {
    return { state: "completed", reason: null };
  }
  return null;
}

/** counters 全键派生（DistillItemStatus 枚举序 = 序列化键序冻结；pending/applying 不是 item 结果不计数）。 */
function deriveCounters(
  lines: readonly LedgerLine[],
  diagnostics: readonly DistillInvalidDiagnostic[],
): RunFile["counters"] {
  const counters = {} as Record<(typeof DistillItemStatusSchema)["options"][number], number>;
  for (const status of DistillItemStatusSchema.options) counters[status] = 0;
  for (const line of lines) {
    const key = line.status as keyof typeof counters;
    if (key in counters) counters[key] += 1;
  }
  counters["model-invalid"] = diagnostics.length;
  return counters;
}

/** 行 → E 的 DistillLedgerRecord（apply 判定输入；判别联合同构）。 */
function ledgerRecordOf(line: LedgerLine): DistillLedgerRecord {
  return line.kind === "absorb"
    ? {
        kind: "absorb",
        ordinal: line.ordinal,
        status: line.status,
        beforeHash: line.beforeHash,
        afterHash: line.afterHash,
        ...(line.appliedHash === undefined ? {} : { appliedHash: line.appliedHash }),
        attempts: line.attempts,
      }
    : {
        kind: "create",
        ordinal: line.ordinal,
        status: line.status,
        targetPatternName: line.targetPatternName,
        afterHash: line.afterHash,
        ...(line.appliedHash === undefined ? {} : { appliedHash: line.appliedHash }),
        attempts: line.attempts,
      };
}

/** 行 → plan item（apply 重放输入；digest 一致性由 applyCore 反查）。 */
function planItemOfLine(line: LedgerLine): DistillPlanItem {
  if (line.kind === "absorb" && line.proposal.action === "absorb") {
    return {
      action: "absorb",
      ordinal: line.ordinal,
      digest: line.digest,
      proposal: line.proposal,
      afterBodyHash: line.afterHash,
    };
  }
  if (line.kind === "create" && line.proposal.action === "create") {
    return {
      action: "create",
      ordinal: line.ordinal,
      digest: line.digest,
      proposal: line.proposal,
      targetPatternName: line.targetPatternName,
      afterBodyHash: line.afterHash,
    };
  }
  throw new DomainError(
    "DISTILL_IO",
    `ledger line #${line.ordinal} kind/proposal mismatch (damaged run)`,
  );
}

/* ------------------------------------------------------------------ */
/* 原子写 + 模型输出解析 + corpus 构建                                  */
/* ------------------------------------------------------------------ */

let atomicCounter = 0;

function atomicWrite(file: string, data: string): void {
  const temp = path.join(
    path.dirname(file),
    `.${path.basename(file)}.tmp-${process.pid}-${Date.now()}-${(atomicCounter += 1)}`,
  );
  fs.writeFileSync(temp, data, { mode: 0o600 });
  fs.renameSync(temp, file);
}

function appendLogFileLine(directory: string, message: string): void {
  try {
    fs.appendFileSync(
      path.join(directory, "logs.md"),
      `- ${new Date().toISOString()} ${message}\n`,
    );
  } catch {
    // 人读日志不是 machine truth（§5）；写失败不阻塞状态机。
  }
}

/** 剥 ``` 代码围栏（模型常见包裹；确定性前后处理）。 */
function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  const fence = /^```[a-zA-Z0-9_-]*\s*\n([\s\S]*?)\n?```$/.exec(trimmed);
  return fence === null ? trimmed : (fence[1] ?? "").trim();
}

/** 模型原始输出 → rawProposals（unknown 逐项交 planDistillation 收窄）。 */
function parseRawProposals(text: string): unknown[] {
  const stripped = stripCodeFences(text);
  let payload: unknown;
  try {
    payload = JSON.parse(stripped);
  } catch {
    const start = stripped.indexOf("[");
    const end = stripped.lastIndexOf("]");
    if (start < 0 || end <= start) return [];
    try {
      payload = JSON.parse(stripped.slice(start, end + 1));
    } catch {
      return [];
    }
  }
  if (Array.isArray(payload)) return payload;
  if (
    typeof payload === "object" &&
    payload !== null &&
    Array.isArray((payload as { proposals?: unknown }).proposals)
  ) {
    return (payload as { proposals: unknown[] }).proposals;
  }
  return [];
}

interface PatternSnapshot {
  name: string;
  title: string;
  body: string;
  contentHash: string;
}

/** wiki 目录的只读快照（listWikiPatternsReadOnly 不触发 mkdir；正文截断入预算）。 */
function readPatternSnapshots(wikiDirectory: string, bodyCap: number): PatternSnapshot[] {
  const listed = listWikiPatternsReadOnly(wikiDirectory);
  const reader = openWikiWorkspace(wikiDirectory);
  const snapshots: PatternSnapshot[] = [];
  for (const item of listed) {
    let raw: string;
    try {
      raw = reader.readPatternRaw(item.name);
    } catch {
      continue; // 畸形页由只读列举丢弃；正文缺失跳过（确定性：name 序不变）
    }
    const page = parsePatternPage(raw);
    snapshots.push({
      name: item.name,
      title: item.title,
      body: (page === null ? stripFrontmatter(raw) : page.body).slice(0, bodyCap),
      contentHash: item.contentHash,
    });
  }
  return snapshots;
}

/**
 * 默认 corpus 构建（W 形状；v1 检索 = skill-wiki 查重索引的冻结 BM25 原始分）：
 * - clusters：source workspace 内相似簇（findSimilarPatterns 相对分 ≥ 0.35）；
 * - candidates：global wiki 对 source 语料 query 的 top-5（raw BM25 score，阈值
 *   判定在 planDistillation）；
 * - 同语料两次构建 canonical 序与 digest 一致（distillCorpusDigest 保证）。
 */
async function buildCorpus(
  sourceWikiDirectory: string,
  globalWikiDirectoryPath: string,
): Promise<DistillCorpus> {
  const sources = readPatternSnapshots(sourceWikiDirectory, DISTILL_BUDGETS.patternBodyChars).slice(
    0,
    DISTILL_BUDGETS.corpusPatternDefault,
  );
  const globals = readPatternSnapshots(globalWikiDirectoryPath, DISTILL_BUDGETS.patternBodyChars);

  const clusters: DistillCorpus["clusters"] = [];
  if (sources.length > 1) {
    const index = await openWikiSearchIndex(sourceWikiDirectory, () => sources);
    for (const source of sources) {
      const similar = await findSimilarPatterns(index, source);
      if (similar.length === 0) continue;
      clusters.push({
        members: [source.name, ...similar.map((hit) => hit.name)]
          .sort()
          .filter((name, position, all) => all.indexOf(name) === position),
        score: similar[0]?.score ?? 0,
      });
    }
  }

  let query = "";
  let totalBodyChars = 0;
  for (const source of sources) {
    const chunk = `${source.title}\n${source.body}`;
    if (query.length + chunk.length > DISTILL_BUDGETS.corpusTotalChars) {
      query =
        `${query}\n\n${chunk.slice(0, DISTILL_BUDGETS.corpusTotalChars - query.length)}`.trimEnd();
      break;
    }
    query = query.length === 0 ? chunk : `${query}\n\n${chunk}`;
    totalBodyChars += source.body.length;
  }

  const candidates: DistillCorpus["candidates"] = [];
  if (globals.length > 0 && query.trim().length > 0) {
    const index = await openWikiSearchIndex(globalWikiDirectoryPath, () => globals);
    const result = await index.search(query, { limit: 5 });
    for (const hit of result.hits) {
      const pattern = globals.find((item) => item.name === hit.id);
      if (!pattern) continue;
      candidates.push({
        name: pattern.name,
        title: pattern.title,
        body: pattern.body,
        contentHash: pattern.contentHash,
        sourceScope: globalWikiDirectoryPath,
        score: hit.score,
      });
    }
  }

  const corpus = {
    clusters,
    candidates,
    retrieval: { query, limit: 5 },
    evidenceThreshold: DISTILL_EVIDENCE_THRESHOLD,
    budgets: { patternsIncluded: sources.length, totalBodyChars },
    scoreVersion: DISTILL_SCORE_VERSION,
    // corpusDigest 由下方补齐（schema 要求 64hex；占位后覆写）。
    corpusDigest: "0".repeat(64),
  } satisfies DistillCorpus;
  return { ...corpus, corpusDigest: distillCorpusDigest(corpus) };
}

const DISTILL_SYSTEM_PROMPT = [
  "You are the skill-wiki distiller.",
  "You read a corpus of wiki pattern fragments and propose generalizations into the GLOBAL wiki.",
  "Reply with ONLY a JSON array of proposal objects - no prose, no code fences.",
  "Each proposal is one of:",
  '- {"action":"create","title":string(1..120),"body":string(1..20000),"sourcePatternIds":string[]}',
  '- {"action":"absorb","targetPatternId":string,"edits":WikiEdit[](1..10),"expectedBeforeBodyHash":string,"sourcePatternIds":string[]}',
  'WikiEdit primitives: {"op":"replace","anchor":string,"text":string} | {"op":"insert_after","anchor":string,"text":string} | {"op":"append","text":string}.',
  "Absorb targets MUST be corpus candidates whose own score >= evidenceThreshold (their contentHash pins expectedBeforeBodyHash).",
  "Create titles must be sluggable (lowercase ascii words); generalization footprints are tracked automatically.",
].join("\n");

/* ------------------------------------------------------------------ */
/* 服务                                                                */
/* ------------------------------------------------------------------ */

export interface DistillJobDeps {
  workspaces: Pick<WorkspaceRegistry, "lookup">;
  /** global wiki 目录（按请求解析；测试 env 注入）。缺省 skill-wiki globalWikiDirectory。 */
  globalWikiDirectory?: () => string;
  /** run registry 根目录；缺省 `<appDir()>/wiki-distill`。 */
  baseDir?: string;
  /** kernel 句柄访问子（daemon index boot 后注入；null → failed(kernel-unavailable)）。 */
  kernel?: () => DshKernelHandle | null;
  /** proposal store 访问子（domain 装配晚绑定——解 capability ↔ store 环）。 */
  proposals: () => McpProposalStore | null;
  /** ephemeral 会话工厂 seam（测试注入 fake；缺省经 kernel handle 创建只读面会话）。 */
  createSession?: (options: { systemPrompt: string }) => Promise<EphemeralSession>;
  /** applyDistillation seam（测试注入故障剧本；同步/异步皆可）。 */
  apply?: DistillApplyFn;
  /** corpus 构建 seam（测试注入确定性语料；缺省真实检索构建）。 */
  buildCorpus?: typeof buildCorpus;
  /** daemon 日志（缺省 console.warn；测试注入收集器断言 fail-closed/projection 分支）。 */
  log?: (message: string) => void;
  /** kernel prompt deadline（缺省 120s）。 */
  promptDeadlineMs?: number;
}

/** applyDistillation 的宿主调用面（seam 允许异步剧本；SDK 本体同步）。 */
export type DistillApplyFn = (
  globalWikiDir: string,
  item: DistillPlanItem,
  provenance: DistillProvenance,
  options?: {
    ledgerRecord?: unknown;
    hooks?: {
      onIntent?: (record: DistillLedgerRecord) => void;
      onCommit?: (record: DistillLedgerRecord) => void;
    };
  },
) => DistillItemResult | Promise<DistillItemResult>;

export interface DistillJobService {
  /** 同 source 活跃 run ≤1；corpus 落盘 → kernel（有界）→ plan → 原子 admission。 */
  start(source: WorkspaceId): Promise<{ runId: string }>;
  /** 终态幂等可轮询；损坏 run → typed DISTILL_IO。 */
  status(runId: string): Promise<DistillStatusOutput>;
  /** kernel-running → dispose+cancelled；awaiting-approval → C 失效语义；终态幂等。 */
  cancel(runId: string): Promise<DistillCancelOutput>;
  /** wiki.distill_apply 的 approved 执行入口（N）：投递 per-run 队列并等待终态。 */
  apply(input: unknown): Promise<CapabilityCallResult>;
  /** store onRejected 接线（N）：human → ledger rejected；cancelled → no-op。 */
  onProposalRejected(view: McpProposalView, cause: ProposalRejectCause): Promise<void>;
  /** 启动扫描（memoized；一切公共面先 await）。 */
  recover(): Promise<void>;
  /** daemon stop：dispose kernel 会话 + 活动 kernel run → failed(cancelled-by-shutdown)。 */
  dispose(): Promise<void>;
}

/** per-run 运行期状态（队列尾 + kernel 句柄 + 内存镜像；持久真相在磁盘）。 */
interface RunEntry {
  runId: string;
  directory: string;
  file: RunFile;
  lines: LedgerLine[];
  diagnostics: DistillInvalidDiagnostic[];
  damaged: boolean;
  damagedReason?: string;
  queue: Promise<unknown>;
  kernel?: { session: EphemeralSession; controller: AbortController };
}

type KernelOutcome =
  | { kind: "ok"; text: string }
  | { kind: "failed"; reason: "timeout" | "kernel-unavailable" }
  | { kind: "cancelled" };

export function createWikiDistillService(deps: DistillJobDeps): DistillJobService {
  const registryBase = deps.baseDir ?? path.join(appDir(), "wiki-distill");
  const log = deps.log ?? ((message: string) => console.warn(`[wiki-distill] ${message}`));
  const promptDeadlineMs = deps.promptDeadlineMs ?? DEFAULT_DISTILL_PROMPT_DEADLINE_MS;
  const applyFn = deps.apply ?? applyDistillation;
  const buildCorpusFn = deps.buildCorpus ?? buildCorpus;
  const globalDirOf = deps.globalWikiDirectory ?? globalWikiDirectory;
  const runs = new Map<string, RunEntry>();
  let recoverPromise: Promise<void> | undefined;
  /** 启动扫描（memoized）：一切公共面先 await。 */
  const recover = (): Promise<void> => (recoverPromise ??= doRecover());

  const runDirectory = (runId: string): string => path.join(registryBase, runId);

  // J：per-run 串行队列——所有状态迁移（apply/决定/cancel/重启扫描/淘汰）串行化。
  function enqueue<T>(runId: string, task: () => Promise<T> | T): Promise<T> {
    let entry = runs.get(runId);
    if (!entry) {
      throw distillError("DISTILL_RUN_NOT_FOUND", `distill run not found: ${runId}`, { runId });
    }
    const chained = entry.queue.then(task, task);
    entry.queue = chained.then(
      () => undefined,
      () => undefined,
    );
    return chained;
  }

  function persistLedger(entry: RunEntry): void {
    const body = entry.lines.map((line) => JSON.stringify(line)).join("\n");
    try {
      atomicWrite(
        path.join(entry.directory, "proposals.jsonl"),
        entry.lines.length > 0 ? `${body}\n` : "",
      );
    } catch (error) {
      throw ioErrorOf(error, `persist ledger for ${entry.runId}`);
    }
  }

  /**
   * run.json 原子写。updatedAt 从 ledger 确定（max(createdAt, 末次行 decidedAt)）——
   * 派生缓存哲学：同一 ledger 状态无论何时写都产出逐字节相同的 run.json
   * （r12 三崩溃点 fixture 的字节级一致依赖该不变式）。
   */
  function persistRun(entry: RunEntry): void {
    let updatedAt = entry.file.createdAt;
    for (const line of entry.lines) {
      const decided = line.decidedAt ?? line.createdAt;
      if (decided > updatedAt) updatedAt = decided;
    }
    entry.file = {
      schemaVersion: 1,
      runId: entry.file.runId,
      source: entry.file.source,
      sourceScope: entry.file.sourceScope,
      state: entry.file.state,
      reason: entry.file.reason,
      counters: deriveCounters(entry.lines, entry.diagnostics),
      corpusDigest: entry.file.corpusDigest,
      createdAt: entry.file.createdAt,
      updatedAt,
    };
    try {
      atomicWrite(
        path.join(entry.directory, "run.json"),
        `${JSON.stringify(entry.file, null, 2)}\n`,
      );
    } catch (error) {
      throw ioErrorOf(error, `persist run state for ${entry.runId}`);
    }
  }

  /** S 收敛（队列任务内）：派生终态与当前不同才迁移（时间戳保留 = 字节幂等）。 */
  function converge(entry: RunEntry): void {
    if (entry.damaged) return;
    const derived = deriveTerminal(entry.lines);
    if (derived === null || derived.state === entry.file.state) return;
    entry.file.state = derived.state;
    entry.file.reason = derived.reason;
    persistRun(entry);
    appendLogFileLine(
      entry.directory,
      `run converged: state=${derived.state} reason=${derived.reason ?? "-"}`,
    );
  }

  function failureDetailOf(
    code: Exclude<DistillErrorCode, "PROPOSAL_STALE">,
    message: string,
    runId?: string,
    ordinal?: number,
  ): CapabilityFailureDetail {
    return {
      code,
      message,
      ...(runId === undefined ? {} : { runId }),
      ...(ordinal === undefined ? {} : { ordinal }),
    };
  }

  /** ② store 直投（Q token 语义由 store.settle 保证；异常不阻塞③）。 */
  function settleProjection(
    entry: RunEntry,
    line: LedgerLine,
    outcome:
      | { ok: true; value: DistillItemResult }
      | { ok: false; result: CapabilityCallResult; failureDetail: CapabilityFailureDetail },
  ): void {
    if (line.proposalId === null) return;
    const store = deps.proposals();
    if (!store) return;
    try {
      store.settle(
        line.proposalId,
        outcome.ok
          ? { result: { kind: "ok", value: outcome.value } }
          : { result: outcome.result, failureDetail: outcome.failureDetail },
      );
    } catch (error) {
      // r13-P1.2：store 投影异常 → daemon 日志，不回滚①、不阻塞③（内存态非真相）。
      log(
        `store projection failed for ${line.proposalId} (proposal face stays stale until next write): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * 单项 apply 核心（H 双预算 + ①②③ 写序）。mode.recovery = 重启 applying 行
   * 矩阵重放（无状态门、无 store 直投——store 已空）；否则经 C 二次校验。
   */
  async function applyCore(
    entry: RunEntry,
    ordinal: number,
    mode: { recovery: boolean },
  ): Promise<CapabilityCallResult> {
    const line = entry.lines.find((item) => item.ordinal === ordinal);
    if (!line) {
      return {
        kind: "failed",
        code: "NOT_FOUND",
        message: `distill item not found: ${entry.runId}#${ordinal}`,
        detail: failureDetailOf(
          "DISTILL_RUN_NOT_FOUND",
          `run ${entry.runId} has no plan item ${ordinal}`,
          entry.runId,
          ordinal,
        ),
      };
    }
    if (distillProposalDigest(line.proposal) !== line.digest) {
      // digest 反查（§5）：ledger 行与提案体不一致 = 损坏 → typed DISTILL_IO fail-closed。
      entry.damaged = true;
      entry.damagedReason = "ledger digest mismatch";
      log(
        `run damaged: ledger digest mismatch at ${entry.runId}#${ordinal} (pinned, awaiting manual purge)`,
      );
      return {
        kind: "failed",
        code: "UNAVAILABLE",
        message: `distill ledger digest mismatch for ${entry.runId}#${ordinal}`,
        detail: failureDetailOf(
          "DISTILL_IO",
          "ledger digest mismatch; run pinned for manual purge",
          entry.runId,
          ordinal,
        ),
      };
    }
    if (!mode.recovery && isTerminalLine(line.status)) {
      // 幂等重放：报告原终态零写。
      return {
        kind: "ok",
        value: {
          ordinal: line.ordinal,
          status: line.status,
          ...(line.detail === undefined ? {} : { detail: line.detail }),
          ...(line.appliedHash === undefined ? {} : { appliedHash: line.appliedHash }),
        },
      };
    }
    if (!mode.recovery) {
      const state = entry.file.state;
      if (state !== "awaiting-approval" && state !== "completed") {
        // C 二次校验（取消/重启后不可再执行）：零 wiki 写；ledger → expired（R/N 映射）。
        line.status = "expired";
        line.detail = "run-stale";
        line.decidedAt = new Date().toISOString();
        persistLedger(entry);
        const detail = failureDetailOf(
          "DISTILL_STALE",
          `run ${entry.runId} is ${state}; the approval is no longer executable`,
          entry.runId,
          ordinal,
        );
        const failedResult: CapabilityCallResult = {
          kind: "failed",
          code: "STALE",
          message: `run ${entry.runId} is ${state}; apply refused (zero wiki write)`,
          detail,
        };
        settleProjection(entry, line, { ok: false, result: failedResult, failureDetail: detail });
        converge(entry);
        return failedResult;
      }
    }

    const provenance: DistillProvenance = {
      runId: entry.runId,
      sourceScope: entry.file.sourceScope,
    };
    const item = planItemOfLine(line);
    let rebuildRetries = 0;
    for (;;) {
      // 审批红线（H pending 优先分支）：pending 行 = 首放——宿主在 approve 驱动下
      // 不传 record（SDK 的 pending 拒绝守卫直连调用；approved 事实由本服务持有）；
      // applying/applied/终态行按矩阵传 typed record。
      const record = line.status === "pending" ? undefined : ledgerRecordOf(line);
      let intentReserved = false;
      try {
        // await 支撑异步 seam（测试挂起剧本）；同步 SDK 值同样成立。
        const result = await applyFn(globalDirOf(), item, provenance, {
          ledgerRecord: record,
          hooks: {
            // attempts 预留制（H r16）：写页尝试前原子 +1（首放 0→1）——onIntent
            // 落盘的行即预留凭证，崩溃窗口吃预算不超限。
            onIntent: (intent) => {
              line.status = "applying";
              line.attempts = intent.attempts + 1;
              line.appliedHash = undefined;
              line.decidedAt = undefined;
              intentReserved = true;
              persistLedger(entry);
            },
            onCommit: (commit) => {
              line.status = commit.status;
              line.appliedHash = commit.appliedHash;
              line.decidedAt = new Date().toISOString();
              persistLedger(entry);
            },
          },
        });
        // ① ledger 行 → 终态（applied/idempotent/stale/patch-failed/io-failed）。
        if (
          result.status === "model-invalid" ||
          result.status === "rejected" ||
          result.status === "expired" ||
          result.status === "not-proposed"
        ) {
          // SDK 不产出这些 apply 结果（plan/审批期状态）；防御性 fail-closed。
          return {
            kind: "failed",
            code: "INVALID_OPERATION",
            message: `applyDistillation returned a plan-phase status ${result.status} for ${entry.runId}#${ordinal}`,
          };
        }
        line.status = result.status;
        if (result.detail !== undefined) line.detail = result.detail;
        else delete line.detail;
        if (result.appliedHash !== undefined) line.appliedHash = result.appliedHash;
        line.decidedAt = new Date().toISOString();
        persistLedger(entry);
        if (result.status === "io-failed") {
          const detail = failureDetailOf(
            "DISTILL_IO",
            `apply exhausted its IO budgets for ${entry.runId}#${ordinal} (${line.detail ?? "io"})`,
            entry.runId,
            ordinal,
          );
          const failedResult: CapabilityCallResult = {
            kind: "failed",
            code: "UNAVAILABLE",
            message: detail.message,
            detail,
          };
          settleProjection(entry, line, { ok: false, result: failedResult, failureDetail: detail });
          converge(entry); // ③
          return failedResult;
        }
        const value: DistillItemResult = {
          ordinal,
          status: result.status,
          ...(result.detail === undefined ? {} : { detail: result.detail }),
          ...(result.appliedHash === undefined ? {} : { appliedHash: result.appliedHash }),
        };
        settleProjection(entry, line, { ok: true, value });
        converge(entry); // ③
        return { kind: "ok", value };
      } catch (error) {
        if (error instanceof SkillWikiError && error.code === "WIKI_IO") {
          if (intentReserved) {
            // 写页尝试失败：预留已 +1；矩阵以 attempts ≥ 3 返回 io-failed 结果
            // 自限（本循环只重试，不重复预留）。
            continue;
          }
          // 非写页 IO（preflight 读 / rebuild-only / 纯恢复 rebuild）：独立预算
          // （H r16/r17：不占 attempts；队列内 ≤2 次重试）。
          rebuildRetries += 1;
          if (rebuildRetries > REBUILD_RETRY_LIMIT) {
            line.status = "io-failed";
            line.detail = "rebuild-io";
            line.decidedAt = new Date().toISOString();
            persistLedger(entry);
            const detail = failureDetailOf(
              "DISTILL_IO",
              `rebuild-only IO retried ${REBUILD_RETRY_LIMIT} times in queue for ${entry.runId}#${ordinal}`,
              entry.runId,
              ordinal,
            );
            const failedResult: CapabilityCallResult = {
              kind: "failed",
              code: "UNAVAILABLE",
              message: detail.message,
              detail,
            };
            settleProjection(entry, line, {
              ok: false,
              result: failedResult,
              failureDetail: detail,
            });
            converge(entry);
            return failedResult;
          }
          continue;
        }
        if (error instanceof SkillWikiError && error.code === "WIKI_PATCH_FAILED") {
          line.status = "patch-failed";
          line.decidedAt = new Date().toISOString();
          persistLedger(entry);
          const value: DistillItemResult = { ordinal, status: "patch-failed" };
          settleProjection(entry, line, { ok: true, value });
          converge(entry);
          return { kind: "ok", value };
        }
        if (error instanceof DomainError) {
          // 宿主持久化 IO（ledger/run.json 原子写失败）：typed detail 上抛面保真。
          return {
            kind: "failed",
            code: error.code === "NOT_FOUND" ? "NOT_FOUND" : "UNAVAILABLE",
            message: error.message,
            ...(error.detail === undefined ? {} : { detail: error.detail }),
          };
        }
        // 未知异常：不吞——项保持非终态（可恢复），typed failed 返回。
        return {
          kind: "failed",
          code: "UNAVAILABLE",
          message: `distill apply crashed outside its contract for ${entry.runId}#${ordinal}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        };
      }
    }
  }

  /** 磁盘产物三态加载（外部输入：unknown 进 safeParse 出；损坏 → damaged pin）。 */
  function loadRunArtifacts(runId: string):
    | { exists: false }
    | { exists: true; damaged: true; reason: string }
    | {
        exists: true;
        damaged: false;
        file: RunFile;
        lines: LedgerLine[];
        diagnostics: DistillInvalidDiagnostic[];
      } {
    const directory = runDirectory(runId);
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(directory);
    } catch {
      return { exists: false };
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      return {
        exists: true,
        damaged: true,
        reason: "run directory is not a real directory (symlink rejected)",
      };
    }
    try {
      const file = RunFileSchema.parse(
        JSON.parse(fs.readFileSync(path.join(directory, "run.json"), "utf8")),
      );
      const lines: LedgerLine[] = [];
      const ledgerFile = path.join(directory, "proposals.jsonl");
      if (fs.existsSync(ledgerFile)) {
        const ledgerRaw = fs.readFileSync(ledgerFile, "utf8");
        for (const row of ledgerRaw.split("\n")) {
          if (row.trim().length === 0) continue;
          lines.push(LedgerLineSchema.parse(JSON.parse(row)));
        }
      }
      const diagnosticsFile = path.join(directory, "diagnostics.json");
      const diagnostics = fs.existsSync(diagnosticsFile)
        ? DiagnosticsFileSchema.parse(JSON.parse(fs.readFileSync(diagnosticsFile, "utf8")))
        : [];
      return { exists: true, damaged: false, file, lines, diagnostics };
    } catch (error) {
      return {
        exists: true,
        damaged: true,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  function damagedEntry(runId: string, reason: string): RunEntry {
    return {
      runId,
      directory: runDirectory(runId),
      file: RunFileSchema.parse({
        schemaVersion: 1,
        runId,
        source: "~",
        sourceScope: "~",
        state: "failed",
        reason: "io",
        counters: deriveCounters([], []),
        corpusDigest: "0".repeat(64),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
      lines: [],
      diagnostics: [],
      damaged: true,
      damagedReason: reason,
      queue: Promise.resolve(),
    };
  }

  /** LRU 淘汰（M：先 expired 收敛再判淘汰；损坏 pin；队列串行确认后删除）。 */
  async function evictOverflow(): Promise<void> {
    const all = [...runs.values()];
    if (all.length <= MAX_DISTILL_RUNS) return;
    const candidates = all
      .filter(
        (entry) =>
          !entry.damaged &&
          isTerminalRun(entry.file.state) &&
          entry.lines.every((line) => line.status !== "pending" && line.status !== "applying"),
      )
      .sort((left, right) =>
        left.file.updatedAt < right.file.updatedAt
          ? -1
          : left.file.updatedAt > right.file.updatedAt
            ? 1
            : 0,
      );
    const overflow = all.length - MAX_DISTILL_RUNS;
    for (const victim of candidates.slice(0, overflow)) {
      await enqueue(victim.runId, () => {
        const entry = runs.get(victim.runId);
        if (!entry || entry.damaged) return;
        if (
          !isTerminalRun(entry.file.state) ||
          entry.lines.some((line) => line.status === "pending" || line.status === "applying")
        ) {
          return; // 队列串行复查（M）：淘汰前引用状态可能已变化
        }
        fs.rmSync(entry.directory, { recursive: true, force: true });
        runs.delete(entry.runId);
        log(`LRU evicted distill run ${entry.runId} (source=${entry.file.source})`);
      });
    }
  }

  /** kernel prompt（队列外驱动；cancel/dispose 经 controller + dispose 介入）。 */
  async function runKernel(entry: RunEntry, corpus: DistillCorpus): Promise<KernelOutcome> {
    const controller = new AbortController();
    const createSession =
      deps.createSession ??
      ((options: { systemPrompt: string }) => {
        const handle = deps.kernel?.();
        if (!handle) {
          return Promise.reject(
            new EphemeralSessionError(
              "DISTILL_KERNEL_CREATE_FAILED",
              "distill kernel host unavailable (daemon booted without a kernel)",
            ),
          );
        }
        return handle.createEphemeralSession({
          systemPrompt: options.systemPrompt,
          toolAllowlist: DISTILL_READONLY_TOOL_NAMES,
        });
      });
    let session: EphemeralSession;
    try {
      session = await createSession({ systemPrompt: DISTILL_SYSTEM_PROMPT });
    } catch (error) {
      // 创建即失败（bridge/注册名/内核面缺失）→ kernel-unavailable（U：kernel-local 码不跨面）。
      log(
        `ephemeral session creation failed for ${entry.runId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return { kind: "failed", reason: "kernel-unavailable" };
    }
    entry.kernel = { session, controller };
    try {
      const { text } = await session.prompt(JSON.stringify(corpus, null, 2), {
        signal: controller.signal,
        deadlineMs: promptDeadlineMs,
      });
      const capped = text.slice(0, DISTILL_BUDGETS.modelOutputChars);
      try {
        atomicWrite(path.join(entry.directory, "model-output.txt"), capped);
      } catch {
        // 原始输出是诊断辅助；写失败不改变状态机。
      }
      return { kind: "ok", text: capped };
    } catch (error) {
      if (error instanceof EphemeralSessionError) {
        if (error.code === "DISTILL_TIMEOUT") return { kind: "failed", reason: "timeout" };
        if (error.code === "DISTILL_CANCELLED") return { kind: "cancelled" };
        return { kind: "failed", reason: "kernel-unavailable" };
      }
      return { kind: "failed", reason: "kernel-unavailable" };
    } finally {
      entry.kernel = undefined;
      await session.dispose().catch(() => undefined);
    }
  }

  /** post-kernel 队列任务：解析 → plan → ledger-first 落盘 → 原子 admission。 */
  async function finishKernelPhase(
    entry: RunEntry,
    corpus: DistillCorpus,
    outcome: KernelOutcome,
  ): Promise<boolean> {
    if (isTerminalRun(entry.file.state)) return false; // cancel/dispose 已胜出
    if (outcome.kind === "cancelled") return false; // 取消路径由 cancel 任务收敛
    if (outcome.kind === "failed") {
      entry.file.state = "failed";
      entry.file.reason = outcome.reason;
      persistRun(entry);
      appendLogFileLine(entry.directory, `kernel phase failed: ${outcome.reason}`);
      return false;
    }
    let plan: ReturnType<typeof planDistillation>;
    try {
      plan = planDistillation(globalDirOf(), corpus, parseRawProposals(outcome.text));
    } catch (error) {
      entry.file.state = "failed";
      entry.file.reason =
        error instanceof SkillWikiError && error.code === "WIKI_IO" ? "io" : "kernel-unavailable";
      persistRun(entry);
      appendLogFileLine(entry.directory, `plan phase failed: ${entry.file.reason}`);
      log(
        `plan phase failed for ${entry.runId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
    entry.diagnostics = [...plan.diagnostics];
    try {
      atomicWrite(
        path.join(entry.directory, "diagnostics.json"),
        `${JSON.stringify(plan.diagnostics, null, 2)}\n`,
      );
    } catch (error) {
      entry.file.state = "failed";
      entry.file.reason = "io";
      persistRun(entry);
      throw ioErrorOf(error, `write diagnostics for ${entry.runId}`);
    }
    const now = new Date().toISOString();
    entry.lines = plan.items.map((item): LedgerLine =>
      item.action === "absorb"
        ? {
            kind: "absorb",
            ordinal: item.ordinal,
            digest: item.digest,
            proposal: item.proposal,
            status: "pending",
            beforeHash: item.proposal.expectedBeforeBodyHash,
            afterHash: item.afterBodyHash,
            attempts: 0,
            proposalId: null,
            createdAt: now,
          }
        : {
            kind: "create",
            ordinal: item.ordinal,
            digest: item.digest,
            proposal: item.proposal,
            status: "pending",
            targetPatternName: item.targetPatternName,
            afterHash: item.afterBodyHash,
            attempts: 0,
            proposalId: null,
            createdAt: now,
          },
    );
    try {
      persistLedger(entry); // ledger-first：admission 前落盘（崩溃恢复锚点）
    } catch (error) {
      entry.file.state = "failed";
      entry.file.reason = "io";
      persistRun(entry);
      throw ioErrorOf(error, `write ledger for ${entry.runId}`);
    }
    if (plan.items.length === 0) {
      converge(entry); // S 规则 1：failed(no-valid-proposals)
      return false;
    }
    const store = deps.proposals();
    if (!store) {
      entry.file.state = "failed";
      entry.file.reason = "kernel-unavailable";
      persistRun(entry);
      log(`proposal store unavailable for ${entry.runId}; run failed(kernel-unavailable)`);
      return false;
    }
    const admission = store.admitBatch(
      plan.items.map((item) => ({
        capability: "wiki.distill_apply",
        input: { runId: entry.runId, ordinal: item.ordinal },
      })),
    );
    if (admission.refused > 0) {
      // I 整批拒绝：全行 not-proposed（绝不部分创建）；S 规则 2 → failed(capacity)。
      const refusedAt = new Date().toISOString();
      for (const line of entry.lines) {
        line.status = "not-proposed";
        line.decidedAt = refusedAt;
      }
      persistLedger(entry);
      converge(entry);
      appendLogFileLine(entry.directory, "admission refused: proposal store at capacity");
      return true; // capacity refused（start 出口抛 typed DISTILL_LIMIT）
    }
    const decidedAt = new Date().toISOString();
    for (let index = 0; index < entry.lines.length; index += 1) {
      const line = entry.lines[index];
      if (line) line.proposalId = admission.created[index]?.proposalId ?? null;
      if (line) line.decidedAt = decidedAt;
    }
    persistLedger(entry);
    entry.file.state = "awaiting-approval";
    persistRun(entry);
    appendLogFileLine(entry.directory, `awaiting approval: ${entry.lines.length} proposals`);
    return false;
  }

  function ioErrorOf(cause: unknown, operation: string): DomainError {
    return new DomainError(
      "DISTILL_IO",
      `wiki-distill ${operation} failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause: cause instanceof Error ? cause : undefined },
    );
  }

  /** 蒸馏六码 DomainError（携带 CapabilityFailureDetail——四面同码投影，U）。 */
  function distillError(
    code:
      | "DISTILL_RUN_NOT_FOUND"
      | "DISTILL_STALE"
      | "DISTILL_ACTIVE_RUN"
      | "DISTILL_LIMIT"
      | "DISTILL_IO",
    message: string,
    payload?: { runId?: string; ordinal?: number },
  ): DomainError {
    return new DomainError(code, message, {
      detail: {
        code,
        message,
        ...(payload?.runId === undefined ? {} : { runId: payload.runId }),
        ...(payload?.ordinal === undefined ? {} : { ordinal: payload.ordinal }),
      },
    });
  }

  /* ---------------- 公共面 ---------------- */

  async function start(source: WorkspaceId): Promise<{ runId: string }> {
    await recover();
    if (source === "~") {
      throw new DomainError(
        "INVALID_OPERATION",
        "distill source must be an imported workspace (the global scope has no source patterns)",
      );
    }
    const workspace = deps.workspaces.lookup(source);
    if (!workspace) {
      throw new DomainError("NOT_FOUND", `Workspace not found: ${source}`);
    }
    for (const entry of runs.values()) {
      if (!entry.damaged && entry.file.source === source && !isTerminalRun(entry.file.state)) {
        throw distillError(
          "DISTILL_ACTIVE_RUN",
          `an active distill run ${entry.runId} exists for ${source}; cancel or await it first`,
        );
      }
    }
    const runId = `wd_${randomBytes(12).toString("hex")}`;
    const directory = runDirectory(runId);
    const now = new Date().toISOString();
    try {
      fs.mkdirSync(registryBase, { recursive: true, mode: 0o700 });
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    } catch (error) {
      throw ioErrorOf(error, `create run directory for ${runId}`);
    }
    const entry: RunEntry = {
      runId,
      directory,
      file: {
        schemaVersion: 1,
        runId,
        source,
        sourceScope: workspace.path,
        state: "collecting",
        reason: null,
        counters: deriveCounters([], []),
        corpusDigest: "0".repeat(64),
        createdAt: now,
        updatedAt: now,
      },
      lines: [],
      diagnostics: [],
      damaged: false,
      queue: Promise.resolve(),
    };
    runs.set(runId, entry);
    let corpus: DistillCorpus;
    try {
      persistRun(entry);
      appendLogFileLine(directory, `run started: source=${source}`);
      corpus = await buildCorpusFn(workspaceWikiDirectory(workspace.path), globalDirOf());
      atomicWrite(path.join(directory, "corpus.json"), `${JSON.stringify(corpus, null, 2)}\n`);
      entry.file.corpusDigest = corpus.corpusDigest;
    } catch (error) {
      entry.file.state = "failed";
      entry.file.reason = "io";
      try {
        persistRun(entry);
      } catch {
        // run.json 写失败时保留磁盘原状；typed 错误仍然上抛。
      }
      throw ioErrorOf(error, `persist corpus for ${runId}`);
    }
    await enqueue(runId, () => {
      if (isTerminalRun(entry.file.state)) return;
      entry.file.state = "kernel-running";
      persistRun(entry);
    });
    const outcome = await runKernel(entry, corpus);
    const capacityRefused = await enqueue(runId, () => finishKernelPhase(entry, corpus, outcome));
    await evictOverflow();
    if (capacityRefused) {
      throw distillError(
        "DISTILL_LIMIT",
        `proposal store at capacity: all ${entry.lines.length} proposals refused (run ${runId} recorded not-proposed); retry with a smaller --limit after clearing decided proposals`,
      );
    }
    return { runId };
  }

  async function status(runId: string): Promise<DistillStatusOutput> {
    await recover();
    if (!DistillRunIdSchema.safeParse(runId).success) {
      throw distillError("DISTILL_RUN_NOT_FOUND", `distill run not found: ${runId}`, { runId });
    }
    const loaded = loadRunArtifacts(runId);
    if (!loaded.exists) {
      throw distillError("DISTILL_RUN_NOT_FOUND", `distill run not found: ${runId}`, { runId });
    }
    if (loaded.damaged) {
      log(`run ${runId} damaged (${loaded.reason}); pinned fail-closed awaiting manual purge`);
      throw distillError(
        "DISTILL_IO",
        `distill run ${runId} is damaged and pinned: ${loaded.reason}`,
        { runId },
      );
    }
    return {
      runId: loaded.file.runId,
      state: loaded.file.state,
      reason: loaded.file.reason,
      counters: deriveCounters(loaded.lines, loaded.diagnostics),
      proposalRefs: loaded.lines.map((line) => ({
        ordinal: line.ordinal,
        proposalId: line.proposalId,
        status: line.status,
      })),
    };
  }

  async function cancel(runId: string): Promise<DistillCancelOutput> {
    await recover();
    if (!runs.has(runId)) {
      throw distillError("DISTILL_RUN_NOT_FOUND", `distill run not found: ${runId}`, { runId });
    }
    return enqueue(runId, async () => {
      const entry = runs.get(runId);
      if (!entry) {
        throw distillError("DISTILL_RUN_NOT_FOUND", `distill run not found: ${runId}`, { runId });
      }
      if (entry.damaged) {
        throw distillError(
          "DISTILL_IO",
          `distill run ${runId} is damaged and pinned: ${entry.damagedReason ?? "unreadable"}`,
          { runId },
        );
      }
      if (isTerminalRun(entry.file.state)) {
        return { runId, state: entry.file.state }; // S：终态幂等返回既有终态
      }
      if (entry.kernel) {
        // kernel-running：dispose agent + 取消 in-flight prompt。
        entry.kernel.controller.abort();
        await entry.kernel.session.dispose().catch(() => undefined);
        entry.kernel = undefined;
      }
      // C 失效语义：pending → expired；store 未决 proposal 以 cause=cancelled 主动
      // reject（proposal 面 rejected；ledger 侧保持 expired——R 二分）。
      const now = new Date().toISOString();
      let mutated = false;
      for (const line of entry.lines) {
        if (line.status === "pending") {
          line.status = "expired";
          line.decidedAt = now;
          mutated = true;
        }
      }
      if (mutated) persistLedger(entry);
      const store = deps.proposals();
      if (store) {
        for (const line of entry.lines) {
          if (line.proposalId === null) continue;
          const view = store.get(line.proposalId);
          if (view && view.status === "pending") {
            await store.reject(line.proposalId, "cancelled"); // onRejected: cancelled → no-op
          }
        }
      }
      entry.file.state = "cancelled";
      entry.file.reason = null;
      persistRun(entry);
      appendLogFileLine(entry.directory, "run cancelled by user");
      return { runId, state: "cancelled" as const };
    });
  }

  async function apply(input: unknown): Promise<CapabilityCallResult> {
    await recover();
    const parsed = DistillApplyInputSchema.safeParse(input);
    if (!parsed.success) {
      return {
        kind: "failed",
        code: "NOT_FOUND",
        message: "distill apply input rejected (expected {runId, ordinal})",
        detail: failureDetailOf(
          "DISTILL_RUN_NOT_FOUND",
          "distill apply input rejected (expected {runId, ordinal})",
        ),
      };
    }
    const { runId, ordinal } = parsed.data;
    if (!runs.has(runId)) {
      return {
        kind: "failed",
        code: "NOT_FOUND",
        message: `distill run not found: ${runId}`,
        detail: failureDetailOf(
          "DISTILL_RUN_NOT_FOUND",
          `distill run not found: ${runId}`,
          runId,
          ordinal,
        ),
      };
    }
    // N：enqueue 并等待队列任务终态（入队受理 ≠ executed；本 Promise 即终态）。
    return enqueue(runId, () =>
      applyCore(runs.get(runId) as RunEntry, ordinal, { recovery: false }),
    );
  }

  async function onProposalRejected(
    view: McpProposalView,
    cause: ProposalRejectCause,
  ): Promise<void> {
    await recover();
    if (cause === "cancelled") return; // N：cancel 队列任务自身迁移 expired，回调 no-op
    if (view.capability !== "wiki.distill_apply") return; // 非监听 capability 行为不变
    const parsed = DistillApplyInputSchema.safeParse(view.input);
    if (!parsed.success) {
      log(`rejected proposal carries an unparseable distill input: ${view.proposalId}`);
      return;
    }
    const { runId, ordinal } = parsed.data;
    if (!runs.has(runId)) {
      log(`rejected proposal references unknown run ${runId}; ledger untouched (fail-closed)`);
      return;
    }
    await enqueue(runId, () => {
      const entry = runs.get(runId);
      if (!entry || entry.damaged) {
        log(`reject ledger migration skipped (run missing/damaged): ${runId}`);
        return;
      }
      const line = entry.lines.find((item) => item.ordinal === ordinal);
      if (!line || line.status !== "pending") return; // 已被 cancel/执行路径迁移
      line.status = "rejected";
      line.decidedAt = new Date().toISOString();
      persistLedger(entry); // IO 失败 → typed DISTILL_IO 上抛（proposal 决定不可逆；行保持 pending fail-closed）
      converge(entry);
    });
  }

  /** 启动扫描（C + r12）：损坏登记 → 非终态 run expired 收敛/applying 恢复 → LRU。 */
  async function doRecover(): Promise<void> {
    fs.mkdirSync(registryBase, { recursive: true, mode: 0o700 });
    let names: string[] = [];
    try {
      names = fs
        .readdirSync(registryBase)
        .filter((name) => DistillRunIdSchema.safeParse(name).success)
        .sort();
    } catch (error) {
      throw ioErrorOf(error, "scan wiki-distill registry");
    }
    for (const runId of names) {
      const loaded = loadRunArtifacts(runId);
      if (!loaded.exists) continue;
      if (loaded.damaged) {
        log(
          `run ${runId} damaged on load (${loaded.reason}); pinned fail-closed awaiting manual purge`,
        );
        runs.set(runId, damagedEntry(runId, loaded.reason));
        continue;
      }
      runs.set(runId, {
        runId,
        directory: runDirectory(runId),
        file: loaded.file,
        lines: loaded.lines,
        diagnostics: loaded.diagnostics,
        damaged: false,
        queue: Promise.resolve(),
      });
    }
    for (const runId of names) {
      const scanned = runs.get(runId);
      if (!scanned || scanned.damaged) continue;
      const entry = scanned;
      await enqueue(runId, async () => {
        if (isTerminalRun(entry.file.state)) {
          // r12：无条件以 ledger 全行纯函数重算（幂等；时间戳保留）。
          convergeFromLedger(entry);
          return;
        }
        if (entry.file.state === "collecting" || entry.file.state === "kernel-running") {
          // §4：重启后不自动续跑（corpus 快照在，人工重跑）。
          entry.file.state = "cancelled";
          entry.file.reason = "restarted";
          persistRun(entry);
          appendLogFileLine(entry.directory, "run cancelled by restart (kernel not resumed)");
          return;
        }
        // awaiting-approval：C——store 内存态已丢，未决项 expired；applying 行恢复。
        let mutated = false;
        const now = new Date().toISOString();
        for (const line of entry.lines) {
          if (line.status === "pending") {
            line.status = "expired";
            line.decidedAt = now;
            mutated = true;
          }
        }
        if (mutated) persistLedger(entry);
      });
      // applying 行恢复（r17：重启恢复仅限 applying；io-failed 零写不复活）。
      if (!entry.damaged) {
        for (const line of entry.lines) {
          if (line.status === "applying") {
            await enqueue(runId, () => applyCore(entry, line.ordinal, { recovery: true }));
          }
        }
        await enqueue(runId, () => {
          convergeFromLedger(entry);
        });
      }
    }
    await evictOverflow();
  }

  /**
   * r12 纯函数重算：
   * - 终态 run：state/reason 冻结（timeout/kernel-unavailable 等无 ledger 行的终态
   *   不被 S 规则 1 改写），仅按 ledger 派生刷新 counters（不同才写；时间戳保留
   *   → 字节幂等）；
   * - 非终态 run：S 优先级派生（crash 窗口 ①②③ 的收敛路径；expired 在场 →
   *   cancelled(restarted)；全终态 → completed/failed(io)）。
   */
  function convergeFromLedger(entry: RunEntry): void {
    if (entry.damaged) return;
    if (isTerminalRun(entry.file.state)) {
      const counters = deriveCounters(entry.lines, entry.diagnostics);
      if (JSON.stringify(counters) === JSON.stringify(entry.file.counters)) return;
      entry.file.counters = counters;
      persistRun(entry); // updatedAt 由 ledger 确定——重算幂等（字节稳定）
      return;
    }
    const derived = deriveTerminal(entry.lines);
    if (derived === null) return; // 仍有 pending/applying（不应到达；保持现状态）
    entry.file.state = derived.state;
    entry.file.reason = derived.reason;
    persistRun(entry);
  }

  async function dispose(): Promise<void> {
    const targets = [...runs.values()].filter(
      (entry) =>
        !entry.damaged &&
        (entry.kernel !== undefined ||
          entry.file.state === "collecting" ||
          entry.file.state === "kernel-running"),
    );
    for (const entry of targets) {
      await enqueue(entry.runId, async () => {
        if (entry.kernel) {
          entry.kernel.controller.abort();
          await entry.kernel.session.dispose({ deadlineMs: 5_000 }).catch(() => undefined);
          entry.kernel = undefined;
        }
        if (
          !isTerminalRun(entry.file.state) &&
          (entry.file.state === "collecting" || entry.file.state === "kernel-running")
        ) {
          entry.file.state = "failed";
          entry.file.reason = "cancelled-by-shutdown";
          persistRun(entry);
          appendLogFileLine(entry.directory, "run failed: cancelled-by-shutdown");
        }
      });
    }
  }

  return {
    start,
    status,
    cancel,
    apply,
    onProposalRejected,
    recover,
    dispose,
  };
}
