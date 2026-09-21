/**
 * 用户原始需求 [2026-09-21]：「通用 API 提供索引/搜索能力……检索是 jixoai 通用能力
 * （skill 检索与 wiki 查重只是前两个消费方），包名 @jixoai/search。」
 * （jixoai-search-core proposal §A；2026-09-21 codex P1-1/P1-3 处置。）
 * 正交意图：
 *   [1] 公共面出口：契约类型 + typed 错误 + openIndex（含 zod 参数收窄）。
 *   [2] 信封编排：目录存在且信封匹配 → 复用；缺失/invalid/不匹配 → 目录内容
 *       审计（仅信封 + backend 已知产物）通过才删除重建空索引，未知内容
 *       SEARCH_IO 拒删；信封读取的 IO 异常在 envelope 层 hard error（三态）。
 *   [3] 后端分派：tantivy 默认（native binding 动态 import，缺失/平台不支持
 *       typed SEARCH_BACKEND_UNAVAILABLE）；sqlite 回落（Node 24 内置 FTS5）。
 * 妥协声明：目录由索引独占拥有（重建仅删除 backend 已知产物 + 信封 + OS 元数据
 * 噪音；backend 名进信封，切换 backend = 信封不匹配 = 重建）；字段名限于
 * [A-Za-z0-9_]{1,64}（sqlite 列名安全性），消费者用语义化短名声明字段。
 */
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { SearchError, type OpenIndexOptions, type SearchBackend, type SearchIndex } from "./api.js";
import {
  ENVELOPE_FILE_NAME,
  ENVELOPE_SCHEMA_VERSION,
  computeFieldsDigest,
  envelopeMatches,
  readEnvelope,
  writeEnvelopeAtomic,
} from "./envelope.js";
import { scoringOptionsDigest, type ScoringOptions } from "./scoring.js";
import { TOKENIZER_VERSION } from "./tokenizer.js";
import { isSqliteArtifactName, openSqliteIndex } from "./backends/sqlite.js";
import {
  assertTantivyBackendAvailable,
  isTantivyArtifactName,
  openTantivyIndex,
} from "./backends/tantivy.js";

export * from "./api.js";
export { TOKENIZER_VERSION, createSkillTokenizer, type SkillTokenizer } from "./tokenizer.js";
export { SCORING_CONSTANTS, scoringOptionsDigest, type ScoringOptions } from "./scoring.js";

/** 字段名安全约束：sqlite 列名（f_<field>）不转义直接拼 SQL。 */
const FIELD_NAME_PATTERN = /^[A-Za-z0-9_]{1,64}$/;

const FieldsSchema = z
  .record(z.string(), z.object({ weight: z.number().finite().positive() }))
  .refine((fields) => Object.keys(fields).length > 0, {
    message: "at least one field is required",
  })
  .refine((fields) => Object.keys(fields).every((name) => FIELD_NAME_PATTERN.test(name)), {
    message: `field names must match ${FIELD_NAME_PATTERN.source}`,
  });

const OpenOptionsSchema = z.object({
  directory: z.string().min(1),
  fields: FieldsSchema,
  backend: z.enum(["tantivy", "sqlite"]).default("tantivy"),
  fuzzy: z.number().min(0).max(1).default(0.2),
  prefix: z.boolean().default(true),
});

const DocumentSchema = z.object({
  id: z.string().min(1).max(512),
  fields: z.record(z.string(), z.string()),
  stored: z.record(z.string(), z.unknown()).optional(),
});

const QueryOptionsSchema = z.object({
  limit: z.number().int().min(1).max(100).default(10),
  offset: z.number().int().min(0).default(0),
});

/** 校验并补全打开参数；非法输入 typed 拒绝。 */
function parseOpenOptions(options: OpenIndexOptions): z.infer<typeof OpenOptionsSchema> {
  const parsed = OpenOptionsSchema.safeParse(options);
  if (!parsed.success) {
    throw new SearchError(
      "SEARCH_INVALID_ARGUMENT",
      `invalid openIndex options: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`,
    );
  }
  return parsed.data;
}

/** doc 校验：字段键必须 ⊆ 声明字段；stored 必须可 JSON 序列化。 */
function parseDocument(
  doc: unknown,
  fieldNames: ReadonlySet<string>,
): z.infer<typeof DocumentSchema> {
  const parsed = DocumentSchema.safeParse(doc);
  if (!parsed.success) {
    throw new SearchError(
      "SEARCH_INVALID_ARGUMENT",
      `invalid document: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`,
    );
  }
  const unknownField = Object.keys(parsed.data.fields).find((key) => !fieldNames.has(key));
  if (unknownField !== undefined) {
    throw new SearchError(
      "SEARCH_INVALID_ARGUMENT",
      `document field "${unknownField}" is not declared in the index fields`,
    );
  }
  if (parsed.data.stored !== undefined) {
    try {
      JSON.stringify(parsed.data.stored);
    } catch (error) {
      throw new SearchError("SEARCH_INVALID_ARGUMENT", "document stored is not JSON-serializable", {
        cause: error,
      });
    }
  }
  return parsed.data;
}

/** 打包校验：整批先验后写（部分失败零写入）。 */
function parseDocuments(
  docs: unknown[],
  fieldNames: ReadonlySet<string>,
): z.infer<typeof DocumentSchema>[] {
  return docs.map((doc) => parseDocument(doc, fieldNames));
}

function parseQueryOptions(options: unknown): z.infer<typeof QueryOptionsSchema> {
  const parsed = QueryOptionsSchema.safeParse(options ?? {});
  if (!parsed.success) {
    throw new SearchError(
      "SEARCH_INVALID_ARGUMENT",
      `invalid search options: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`,
    );
  }
  return parsed.data;
}

/** 信封与原子写自身的产物（重建 allowlist 的公共部分）。 */
const ENVELOPE_ARTIFACT_NAMES: ReadonlySet<string> = new Set([
  ENVELOPE_FILE_NAME,
  `${ENVELOPE_FILE_NAME}.tmp`,
]);
/** 与索引无关但可安全随重建丢弃的 OS 元数据（macOS Finder / Windows 缩略图缓存）。 */
const IGNORABLE_OS_METADATA_NAMES: ReadonlySet<string> = new Set([".DS_Store", "Thumbs.db"]);

const BACKEND_ARTIFACT_TESTS: Record<SearchBackend, (name: string) => boolean> = {
  sqlite: isSqliteArtifactName,
  tantivy: isTantivyArtifactName,
};

/**
 * 重建前目录内容审计（P1-1 数据安全）：每个条目必须是信封产物或给定 backend
 * 集的已知产物；发现未知内容 → SEARCH_IO（消息列出未知文件），不删任何东西。
 * 信封读取层的 EACCES/EIO 已先行 hard error，此处拦截的是「目录里混有非索引
 * 文件」的误删（如 sentinel/用户数据）。
 */
function assertDirectoryOwnedByIndex(directory: string, backends: readonly SearchBackend[]): void {
  const unknown = fs
    .readdirSync(directory, { withFileTypes: true })
    .filter(
      (entry) =>
        !ENVELOPE_ARTIFACT_NAMES.has(entry.name) &&
        !IGNORABLE_OS_METADATA_NAMES.has(entry.name) &&
        !backends.some((backend) => BACKEND_ARTIFACT_TESTS[backend](entry.name)),
    )
    .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name));
  if (unknown.length > 0) {
    throw new SearchError(
      "SEARCH_IO",
      `index directory ${directory} contains unknown non-index content ` +
        `(${unknown.join(", ")}); refusing to rebuild — remove it manually or ` +
        `open the index in a dedicated empty directory`,
    );
  }
}

/** 打开（必要时创建）索引；信封缺失/invalid/不匹配 → 目录审计通过后删除重建。 */
export async function openIndex(options: OpenIndexOptions): Promise<SearchIndex> {
  const parsed = parseOpenOptions(options);
  const scoring: ScoringOptions = { fuzzy: parsed.fuzzy, prefix: parsed.prefix };
  const fieldsDigest = computeFieldsDigest(parsed.fields);
  const scoringDigest = scoringOptionsDigest(scoring);
  const expected = {
    backend: parsed.backend,
    tokenizerVersion: TOKENIZER_VERSION,
    scoringDigest,
    fieldsDigest,
  };

  // tantivy 可用性预检：在触碰目录之前 typed 拒绝（不可用后端不得产生重建副作用）。
  if (parsed.backend === "tantivy") {
    await assertTantivyBackendAvailable();
  }

  let fresh = true;
  try {
    if (fs.existsSync(parsed.directory)) {
      const stat = fs.statSync(parsed.directory);
      if (!stat.isDirectory()) {
        throw new SearchError("SEARCH_IO", `index path is not a directory: ${parsed.directory}`);
      }
      const envelope = readEnvelope(parsed.directory);
      if (
        envelope.status === "ok" &&
        envelope.envelope &&
        envelopeMatches(envelope.envelope, expected)
      ) {
        fresh = false;
      } else {
        // 信封缺失/invalid/不匹配：目录内容审计（合法信封按其声明 backend 定产物
        // 归属；缺失/invalid 按两后端并集）通过才删除重建，未知内容 SEARCH_IO 拒删。
        const owners: readonly SearchBackend[] =
          envelope.status === "ok" && envelope.envelope
            ? [envelope.envelope.backend]
            : ["sqlite", "tantivy"];
        assertDirectoryOwnedByIndex(parsed.directory, owners);
        fs.rmSync(parsed.directory, { recursive: true, force: true });
        fs.mkdirSync(parsed.directory, { recursive: true });
      }
    } else {
      fs.mkdirSync(parsed.directory, { recursive: true });
    }
  } catch (error) {
    if (error instanceof SearchError) throw error;
    throw new SearchError("SEARCH_IO", "failed to prepare index directory", { cause: error });
  }

  const index: SearchIndex =
    parsed.backend === "tantivy"
      ? await openTantivyIndex({
          directory: parsed.directory,
          fields: parsed.fields,
          scoring,
        })
      : openSqliteIndex({
          directory: parsed.directory,
          fields: parsed.fields,
          scoring,
        });

  if (fresh) {
    try {
      writeEnvelopeAtomic(parsed.directory, {
        schemaVersion: ENVELOPE_SCHEMA_VERSION,
        ...expected,
      });
    } catch (error) {
      void index.close();
      throw new SearchError("SEARCH_IO", "failed to write index envelope", { cause: error });
    }
  }

  return wrapIndex(index, parsed.fields);
}

/** 校验装饰：mutation/查询参数在分派后端前统一 typed 拒绝（含容器收窄，P1-3）。 */
function wrapIndex(index: SearchIndex, fields: Record<string, { weight: number }>): SearchIndex {
  const fieldNames = new Set(Object.keys(fields));
  return {
    upsert: async (docs) => {
      // 容器先收窄：null/undefined/非数组 → typed 拒绝（不得裸 TypeError）。
      const container = z.array(z.unknown()).safeParse(docs);
      if (!container.success) {
        throw new SearchError("SEARCH_INVALID_ARGUMENT", "upsert requires an array of documents");
      }
      await index.upsert(parseDocuments(container.data, fieldNames));
    },
    remove: async (ids) => {
      const parsed = z.array(z.string().min(1)).safeParse(ids);
      if (!parsed.success) {
        throw new SearchError(
          "SEARCH_INVALID_ARGUMENT",
          "remove requires an array of non-empty ids",
        );
      }
      await index.remove(parsed.data);
    },
    search: async (query, options) => {
      const queryType = z.string().safeParse(query);
      if (!queryType.success) {
        throw new SearchError("SEARCH_INVALID_ARGUMENT", "search query must be a string");
      }
      return index.search(queryType.data, parseQueryOptions(options));
    },
    close: () => index.close(),
  };
}
