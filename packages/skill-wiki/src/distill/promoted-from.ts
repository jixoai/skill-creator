/**
 * 用户原始需求 [2026-09-25]（切片③）：「promotedFrom 精确信封：存储值恒 JSON
 * 数组（单条也是 [{...}]）、递归字典序键、无空白、坏值读投影 null、merge
 * typed 拒绝且原值逐字节保留、同 run union 后 runId 升序」（design L 冻结）。
 * 正交意图：
 *   [1] promotedFrom 信封单一实现：读投影（坏值/无足迹 → null）、精确判定
 *       （absent/present/invalid 三分）、追加合并（runId 去重 union、恒不覆盖
 *       既有足迹）、canonical 序列化（frontmatter 单行标量约束不变）。
 */
import { PromotedFromEntrySchema, type PromotedFromEntry } from "./schema.js";
import { canonicalJson } from "./canonical.js";
import { SkillWikiError } from "../schema.js";

/** 精确信封判定（merge/apply 面）：区分无足迹、合法足迹与坏值。 */
export type PromotedFromEnvelope =
  | { kind: "absent" }
  | { kind: "present"; entries: readonly PromotedFromEntry[] }
  | { kind: "invalid" };

/** raw 标量归一（frontmatter 读取侧 null/空串 = 无足迹）。 */
function normalizeRaw(raw: string | null | undefined): string | null {
  if (raw === undefined || raw === null) return null;
  return raw === "" ? null : raw;
}

/** 严格解析：合法 → entries；坏 JSON / 非数组 / 任一条目不合法 → null。 */
function tryParseEntries(raw: string): readonly PromotedFromEntry[] | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(json)) return null;
  const entries: PromotedFromEntry[] = [];
  for (const item of json) {
    const parsed = PromotedFromEntrySchema.safeParse(item);
    if (!parsed.success) return null;
    entries.push(parsed.data);
  }
  return entries;
}

/**
 * 精确信封判定：无足迹（null/空串）→ absent；可解析且全条目合法 → present；
 * 其余（历史/手改坏值：非法 JSON、缺必需键、unknown 键、非数组）→ invalid。
 */
export function inspectPromotedFrom(raw: string | null | undefined): PromotedFromEnvelope {
  const normalized = normalizeRaw(raw);
  if (normalized === null) return { kind: "absent" };
  const entries = tryParseEntries(normalized);
  return entries === null ? { kind: "invalid" } : { kind: "present", entries };
}

/**
 * 读投影（外部读面）：无足迹与坏值都投影 null——不伪装空足迹、不覆盖原文；
 * 调用方对坏值的处置是提示人工修复，不是清洗。
 */
export function parsePromotedFrom(
  raw: string | null | undefined,
): readonly PromotedFromEntry[] | null {
  const envelope = inspectPromotedFrom(raw);
  return envelope.kind === "present" ? envelope.entries : null;
}

/** 条目按 runId 升序（canonical 落盘序；sourcePatternIds 同步组内升序去重）。 */
function canonicalOrder(entries: readonly PromotedFromEntry[]): PromotedFromEntry[] {
  return entries
    .map((entry) => ({ ...entry, sourcePatternIds: [...new Set(entry.sourcePatternIds)].sort() }))
    .sort((left, right) => (left.runId < right.runId ? -1 : left.runId > right.runId ? 1 : 0));
}

/** canonical 序列化（恒 JSON 数组、递归字典序键、无空白；单条也是 [{...}]）。 */
export function formatPromotedFrom(entries: readonly PromotedFromEntry[]): string {
  return canonicalJson(canonicalOrder(entries));
}

/**
 * 追加合并（多次泛化足迹；P1-1）：
 * - existingRaw 坏值 → typed WIKI_INVALID_PATTERN（提示人工修复，**不覆盖**——
 *   调用方零写，原值逐字节保留）；
 * - entry 经 safeParse 收窄（unknown 输入边界）；
 * - 同 runId → union sourcePatternIds（既有足迹的 sourceScope 保留，绝不覆盖）；
 * - 结果按 runId 升序重排，canonical 字符串可直接写 frontmatter 单行标量。
 */
export function mergePromotedFromEntry(
  existingRaw: string | null | undefined,
  entry: unknown,
): { canonical: string; entries: readonly PromotedFromEntry[] } {
  const envelope = inspectPromotedFrom(existingRaw);
  if (envelope.kind === "invalid") {
    throw new SkillWikiError(
      "WIKI_INVALID_PATTERN",
      `promotedFrom carries an unparseable value; fix it manually before distilling: ${JSON.stringify(
        String(existingRaw).slice(0, 80),
      )}`,
    );
  }
  const narrowed = PromotedFromEntrySchema.safeParse(entry);
  if (!narrowed.success) {
    throw new SkillWikiError(
      "WIKI_INVALID_PATTERN",
      `Invalid promotedFrom entry: ${JSON.stringify(narrowed.error.issues[0]?.message ?? "schema rejection")}`,
    );
  }
  const incoming = narrowed.data;
  const existing = envelope.kind === "present" ? envelope.entries : [];
  const sameRun = existing.find((candidate) => candidate.runId === incoming.runId);
  let merged: readonly PromotedFromEntry[];
  if (sameRun) {
    merged = existing.map((candidate) =>
      candidate.runId === incoming.runId
        ? {
            ...candidate,
            sourcePatternIds: [...candidate.sourcePatternIds, ...incoming.sourcePatternIds],
          }
        : candidate,
    );
  } else {
    merged = [...existing, incoming];
  }
  const ordered = canonicalOrder(merged);
  return { canonical: canonicalJson(ordered), entries: ordered };
}
