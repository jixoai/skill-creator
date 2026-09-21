/**
 * 用户原始需求 [2026-09-21]：「信封版本化：索引目录携带 backend + tokenizerVersion
 * + schema 指纹，不匹配自动重建（沿 skill-search v3 信封哲学）。」
 * （jixoai-search-core proposal §A。）
 * 正交意图：
 *   [1] 信封 schema 与读取收窄：外部 JSON 一律 unknown → zod safeParse；
 *       失败/缺失按「不匹配」处理，不迁移、不修复。
 *   [2] 指纹计算：fieldsDigest（字段声明）与信封落盘（临时文件 + rename 原子写）。
 * 妥协声明：目录由索引独占拥有——信封不匹配时整目录删除重建空索引（不抛错），
 * 调用方不得把无关内容放进索引目录。
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { SearchBackend, SearchFieldSpec } from "./api.js";

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

/** 读取信封：缺失/不可读/解析失败一律返回 invalid（外部输入收窄，不抛错）。 */
export function readEnvelope(directory: string): {
  status: "absent" | "invalid" | "ok";
  envelope?: IndexEnvelope;
} {
  const envelopePath = path.join(directory, ENVELOPE_FILE_NAME);
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(envelopePath, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { status: "absent" };
    return { status: "invalid" };
  }
  const parsed = EnvelopeSchema.safeParse(raw);
  if (!parsed.success) return { status: "invalid" };
  return { status: "ok", envelope: parsed.data };
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
