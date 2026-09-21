/**
 * 用户原始需求 [2026-09-21]：「信封版本化：索引目录携带 backend + tokenizerVersion
 * + schema 指纹，不匹配自动重建（沿 skill-search v3 信封哲学）。」
 * （jixoai-search-core proposal §A；2026-09-21 codex P1-1 处置：读取三态化。）
 * 正交意图：
 *   [1] 信封 schema 与读取收窄（三态）：missing（ENOENT，正常新建）/
 *       invalid（文件存在但 JSON/Zod 失败 → 重建）/ ok；其余 fs 异常
 *       （EACCES/EIO/…）抛 typed SEARCH_IO、目录零改动——对齐
 *       docs/search-design.md §10 错误矩阵「IO 故障不得伪装成空索引」。
 *   [2] 指纹计算：fieldsDigest（字段声明）与信封落盘（临时文件 + rename 原子写）。
 * 妥协声明：目录由索引独占拥有——信封不匹配/invalid/缺失时由 openIndex 侧审计
 * 目录内容（仅信封 + backend 已知产物可删），未知内容 SEARCH_IO 拒删；
 * 本模块不承载删除（见 index.ts）。
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { SearchError, type SearchBackend, type SearchFieldSpec } from "./api.js";

/** 信封结构版本；兼容性变化时递增并触发全量重建。 */
export const ENVELOPE_SCHEMA_VERSION = 1;

/** 索引目录信封：backend/tokenizer/scoring/fields 四重指纹。 */
export interface IndexEnvelope {
  schemaVersion: number;
  backend: SearchBackend;
  tokenizerVersion: string;
  scoringDigest: string;
  fieldsDigest: string;
}

const EnvelopeSchema = z.object({
  schemaVersion: z.literal(ENVELOPE_SCHEMA_VERSION),
  backend: z.enum(["tantivy", "sqlite"]),
  tokenizerVersion: z.string().min(1),
  scoringDigest: z.string().min(1),
  fieldsDigest: z.string().min(1),
});

export const ENVELOPE_FILE_NAME = "envelope.json";

/** 字段声明指纹：键排序后的 canonical JSON（键集或权重变化 → 重建）。 */
export function computeFieldsDigest(fields: Record<string, SearchFieldSpec>): string {
  const entries = Object.entries(fields)
    .map(([name, spec]) => [name, spec.weight] as const)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return createHash("sha256").update(JSON.stringify(entries), "utf8").digest("hex");
}

/**
 * 读取信封（外部输入收窄，三态）：
 * - missing：ENOENT——正常新建路径；
 * - invalid：文件存在但 JSON 解析或 Zod 收窄失败——按不匹配处理（重建）；
 * - ok：合法信封。
 * 其余文件系统异常（EACCES/EIO/…）抛 typed SEARCH_IO，目录零改动
 * （P1-1：IO 故障不得被误判为 invalid 而触发重建删除）。
 */
export function readEnvelope(directory: string): {
  status: "missing" | "invalid" | "ok";
  envelope?: IndexEnvelope;
} {
  const envelopePath = path.join(directory, ENVELOPE_FILE_NAME);
  let raw: string;
  try {
    raw = fs.readFileSync(envelopePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { status: "missing" };
    throw new SearchError(
      "SEARCH_IO",
      `failed to read index envelope: ${envelopePath} ` +
        `(${(error as NodeJS.ErrnoException).code ?? "unknown fs error"})`,
      { cause: error },
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: "invalid" };
  }
  const envelope = EnvelopeSchema.safeParse(parsed);
  if (!envelope.success) return { status: "invalid" };
  return { status: "ok", envelope: envelope.data };
}

/** 信封逐字段相等判定（四重指纹全等才可复用）。 */
export function envelopeMatches(
  actual: IndexEnvelope,
  expected: {
    backend: SearchBackend;
    tokenizerVersion: string;
    scoringDigest: string;
    fieldsDigest: string;
  },
): boolean {
  return (
    actual.backend === expected.backend &&
    actual.tokenizerVersion === expected.tokenizerVersion &&
    actual.scoringDigest === expected.scoringDigest &&
    actual.fieldsDigest === expected.fieldsDigest
  );
}

/** 原子写信封：同目录临时文件 + rename。 */
export function writeEnvelopeAtomic(directory: string, envelope: IndexEnvelope): void {
  const target = path.join(directory, ENVELOPE_FILE_NAME);
  const temporary = path.join(directory, `${ENVELOPE_FILE_NAME}.tmp`);
  fs.writeFileSync(temporary, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, target);
}
