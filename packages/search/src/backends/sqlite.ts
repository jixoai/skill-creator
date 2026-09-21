/**
 * 用户原始需求 [2026-09-21]：「冒烟不过回落 node:sqlite FTS5（Node 24 内置），
 * sqlite 后端共享同一 JS 打分层——后端只做倒排召回与持久化。」
 * （jixoai-search-core 定型决策；本阶段默认 backend。）
 * 正交意图：
 *   [1] 持久化：FTS5 倒排（预分词 token 空格 join 入库）+ 普通表存 doc 映射与
 *       per-field 词频统计（term_df/total_tokens），事务内原子维护。
 *   [2] 召回：query token 流 → exact + prefix* + fuzzy 变体展开的 OR 组 MATCH；
 *       候选 token 流回 JS 打分层（scoring.ts）计分排序分页。
 *   [3] 生命周期：close 幂等；关闭后使用返回 SEARCH_IO；sqlite 故障包装为 SEARCH_IO。
 * 妥协声明：每次 search 全量装载 term_df 词表（fuzzy/prefix 展开需要词表扫描，
 * 与 tantivy 路径同口径）；大语料的词表分桶优化留给后续，不改变语义。
 * token 字符集（[a-z0-9/-] + CJK）以 unicode61 tokenchars 扩展保持原子性，
 * FTS5 指令采用 SQLite 3.53 的括号引号语法（单引号形式实测被 directive parser 拒绝）。
 */
import { DatabaseSync, type StatementSync } from "node:sqlite";
import path from "node:path";
import { z } from "zod";
import {
  SearchError,
  type SearchDocument,
  type SearchFieldSpec,
  type SearchHit,
  type SearchIndex,
  type SearchQueryOptions,
  type SearchResult,
} from "../api.js";
import {
  expandFuzzyTerms,
  maxFuzzyDistance,
  scoreCorpus,
  type FieldTermStats,
  type ScoringOptions,
} from "../scoring.js";
import { createSkillTokenizer } from "../tokenizer.js";

/** FTS5 行 id 与 docs.rowid 一一对应（recall JOIN 依据）。 */
interface DocRow {
  rowid: number;
  id: string;
  stored: string | null;
  [column: string]: unknown;
}

/** stored 落盘 JSON 的读取收窄：不兼容（含 null）投影为无 stored。 */
const StoredSchema = z.record(z.string(), z.unknown());

/** 索引目录内 sqlite 文件名。 */
const DATABASE_FILE_NAME = "index.sqlite3";

export function openSqliteIndex(params: {
  directory: string;
  fields: Record<string, SearchFieldSpec>;
  scoring: ScoringOptions;
}): SearchIndex {
  return new SqliteSearchIndex(params.directory, params.fields, params.scoring);
}

class SqliteSearchIndex implements SearchIndex {
  private readonly db: DatabaseSync;
  private readonly fieldNames: string[];
  private readonly columns: string[];
  private readonly weights: Record<string, number>;
  private readonly scoring: ScoringOptions;
  private readonly tokenizer = createSkillTokenizer();
  private readonly statements: {
    selectDoc: StatementSync;
    insertDoc: StatementSync;
    updateDoc: StatementSync;
    deleteDoc: StatementSync;
    insertFts: StatementSync;
    deleteFts: StatementSync;
    countDocs: StatementSync;
    selectStats: StatementSync;
    upsertStats: StatementSync;
    decrementTerm: StatementSync;
    deleteDepletedTerm: StatementSync;
    incrementTerm: StatementSync;
    selectTermDf: StatementSync;
    selectRecall: StatementSync;
  };
  private closed = false;

  constructor(directory: string, fields: Record<string, SearchFieldSpec>, scoring: ScoringOptions) {
    this.fieldNames = Object.keys(fields);
    this.columns = this.fieldNames.map((field) => `f_${field}`);
    this.weights = Object.fromEntries(
      this.fieldNames.map((field) => [field, fields[field].weight]),
    );
    this.scoring = scoring;
    try {
      this.db = new DatabaseSync(path.join(directory, DATABASE_FILE_NAME));
      this.db.exec(`PRAGMA journal_mode = DELETE`);
      this.createSchema();
      this.statements = this.prepareStatements();
    } catch (error) {
      throw new SearchError("SEARCH_IO", "failed to open sqlite search index", { cause: error });
    }
  }

  private createSchema(): void {
    const columnDefinitions = this.columns
      .map((column) => `${column} TEXT NOT NULL DEFAULT ''`)
      .join(", ");
    const ftsColumns = this.columns.join(", ");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS docs (
        id TEXT PRIMARY KEY,
        stored TEXT,
        ${columnDefinitions}
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(
        ${ftsColumns},
        tokenize = "unicode61 tokenchars '/-@._:'"
      );
      CREATE TABLE IF NOT EXISTS field_stats (
        field TEXT PRIMARY KEY,
        total_tokens INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS term_df (
        field TEXT NOT NULL,
        term TEXT NOT NULL,
        df INTEGER NOT NULL,
        PRIMARY KEY (field, term)
      );
    `);
  }

  private prepareStatements() {
    const columnList = this.columns.join(", ");
    const columnPlaceholders = this.columns.map(() => "?").join(", ");
    return {
      selectDoc: this.db.prepare(`SELECT rowid, id, stored, ${columnList} FROM docs WHERE id = ?`),
      insertDoc: this.db.prepare(
        `INSERT INTO docs (id, stored, ${columnList}) VALUES (?, ?, ${columnPlaceholders})`,
      ),
      updateDoc: this.db.prepare(
        `UPDATE docs SET stored = ?, ${this.columns.map((column) => `${column} = ?`).join(", ")} WHERE id = ?`,
      ),
      deleteDoc: this.db.prepare(`DELETE FROM docs WHERE id = ?`),
      insertFts: this.db.prepare(
        `INSERT INTO search_fts (rowid, ${columnList}) VALUES (?, ${columnPlaceholders})`,
      ),
      deleteFts: this.db.prepare(`DELETE FROM search_fts WHERE rowid = ?`),
      countDocs: this.db.prepare(`SELECT COUNT(*) AS count FROM docs`),
      selectStats: this.db.prepare(`SELECT field, total_tokens FROM field_stats`),
      upsertStats: this.db.prepare(
        `INSERT INTO field_stats (field, total_tokens) VALUES (?, ?)
         ON CONFLICT (field) DO UPDATE SET total_tokens = excluded.total_tokens`,
      ),
      decrementTerm: this.db.prepare(`UPDATE term_df SET df = df - 1 WHERE field = ? AND term = ?`),
      deleteDepletedTerm: this.db.prepare(
        `DELETE FROM term_df WHERE field = ? AND term = ? AND df <= 0`,
      ),
      incrementTerm: this.db.prepare(
        `INSERT INTO term_df (field, term, df) VALUES (?, ?, 1)
         ON CONFLICT (field, term) DO UPDATE SET df = df + 1`,
      ),
      selectTermDf: this.db.prepare(`SELECT field, term, df FROM term_df ORDER BY field, term`),
      selectRecall: this.db.prepare(
        `SELECT d.rowid AS rowid, d.id AS id, d.stored AS stored, ${this.columns.map((column) => `d.${column} AS ${column}`).join(", ")}
         FROM search_fts JOIN docs AS d ON d.rowid = search_fts.rowid
         WHERE search_fts MATCH ?`,
      ),
    };
  }

  private assertOpen(): void {
    if (this.closed) throw new SearchError("SEARCH_IO", "search index is closed");
  }

  private tokenizeField(value: string | undefined): string[] {
    return this.tokenizer.tokenize(value ?? "");
  }

  private serializeStored(stored: SearchDocument["stored"]): string | null {
    if (stored === undefined) return null;
    return JSON.stringify(stored);
  }

  private parseStored(serialized: string | null): SearchDocument["stored"] {
    if (serialized === null) return undefined;
    let parsed: unknown;
    try {
      parsed = JSON.parse(serialized);
    } catch {
      return undefined;
    }
    const result = StoredSchema.safeParse(parsed);
    return result.success ? result.data : undefined;
  }

  /** 事务内执行；任何 sqlite 故障回滚并包装为 SEARCH_IO。 */
  private transaction<T>(body: () => T): T {
    this.db.exec(`BEGIN IMMEDIATE`);
    try {
      const result = body();
      this.db.exec(`COMMIT`);
      return result;
    } catch (error) {
      try {
        this.db.exec(`ROLLBACK`);
      } catch {
        // 回滚自身失败时保留原始错误（索引句柄将由调用方 close）。
      }
      if (error instanceof SearchError) throw error;
      throw new SearchError("SEARCH_IO", "sqlite index mutation failed", { cause: error });
    }
  }

  /** 撤销一条已写入 doc 的统计贡献（term_df / field_stats），并删除其 FTS 行。 */
  private retractDocument(row: DocRow): void {
    for (const [index, field] of this.fieldNames.entries()) {
      const column = this.columns[index];
      if (typeof column !== "string") continue;
      const tokens = this.splitTokens(row[column]);
      if (tokens.length === 0) continue;
      for (const term of new Set(tokens)) {
        this.statements.decrementTerm.run(field, term);
        this.statements.deleteDepletedTerm.run(field, term);
      }
    }
    this.statements.deleteFts.run(row.rowid);
  }

  private splitTokens(value: unknown): string[] {
    return typeof value === "string" && value.length > 0 ? value.split(" ") : [];
  }

  async upsert(docs: SearchDocument[]): Promise<void> {
    this.assertOpen();
    this.transaction(() => {
      // 事务内维护 total_tokens 的内存镜像（每 doc 增量读写盘面一次都不需要）。
      const totals = new Map(
        (this.statements.selectStats.all() as Array<{ field: string; total_tokens: number }>).map(
          (row) => [row.field, Number(row.total_tokens)],
        ),
      );
      for (const doc of docs) {
        const existing = this.statements.selectDoc.get(doc.id) as DocRow | undefined;
        if (existing) {
          // 幂等覆盖：先撤销旧贡献（term_df/total_tokens/FTS 行），再按新内容写入。
          this.retractDocument(existing);
          for (const [index, field] of this.fieldNames.entries()) {
            const column = this.columns[index];
            if (typeof column !== "string") continue;
            const length = this.splitTokens(existing[column]).length;
            if (length > 0) totals.set(field, Math.max(0, (totals.get(field) ?? 0) - length));
          }
        }
        const fieldTokens = this.fieldNames.map((field) => this.tokenizeField(doc.fields[field]));
        for (const [index, field] of this.fieldNames.entries()) {
          const tokens = fieldTokens[index] ?? [];
          for (const term of new Set(tokens)) {
            this.statements.incrementTerm.run(field, term);
          }
          totals.set(field, (totals.get(field) ?? 0) + tokens.length);
        }
        const serialized = this.serializeStored(doc.stored);
        const tokenStrings = fieldTokens.map((tokens) => tokens.join(" "));
        let rowid: number;
        if (existing) {
          this.statements.updateDoc.run(serialized, ...tokenStrings, doc.id);
          rowid = existing.rowid;
        } else {
          const result = this.statements.insertDoc.run(doc.id, serialized, ...tokenStrings);
          rowid = Number(result.lastInsertRowid);
        }
        this.statements.insertFts.run(rowid, ...tokenStrings);
      }
      for (const [field, total] of totals) {
        this.statements.upsertStats.run(field, total);
      }
    });
  }

  async remove(ids: string[]): Promise<void> {
    this.assertOpen();
    this.transaction(() => {
      const totals = new Map(
        (this.statements.selectStats.all() as Array<{ field: string; total_tokens: number }>).map(
          (row) => [row.field, Number(row.total_tokens)],
        ),
      );
      for (const id of ids) {
        const existing = this.statements.selectDoc.get(id) as DocRow | undefined;
        if (!existing) continue;
        this.retractDocument(existing);
        for (const [index, field] of this.fieldNames.entries()) {
          const column = this.columns[index];
          if (typeof column !== "string") continue;
          const length = this.splitTokens(existing[column]).length;
          if (length > 0) totals.set(field, Math.max(0, (totals.get(field) ?? 0) - length));
        }
        this.statements.deleteDoc.run(id);
      }
      for (const [field, total] of totals) {
        this.statements.upsertStats.run(field, total);
      }
    });
  }

  async search(query: string, options: SearchQueryOptions = {}): Promise<SearchResult> {
    this.assertOpen();
    const limit = options.limit ?? 10;
    const offset = options.offset ?? 0;
    const tokens = this.tokenizer.tokenize(query);
    if (tokens.length === 0) return { hits: [], total: 0 };

    // 全语料统计（词表有序装载 → 打分浮点次序确定）。
    const docCount = Number((this.statements.countDocs.get() as { count: number }).count);
    const totals = new Map(
      (this.statements.selectStats.all() as Array<{ field: string; total_tokens: number }>).map(
        (row) => [row.field, Number(row.total_tokens)],
      ),
    );
    const fieldStats = new Map<string, FieldTermStats>();
    for (const field of this.fieldNames) {
      fieldStats.set(field, {
        avgFieldLength: docCount > 0 ? (totals.get(field) ?? 0) / docCount : 0,
        df: new Map<string, number>(),
      });
    }
    for (const row of this.statements.selectTermDf.all() as Array<{
      field: string;
      term: string;
      df: number;
    }>) {
      fieldStats.get(row.field)?.df.set(row.term, Number(row.df));
    }

    // 召回：per-token OR 组 = exact ∪ prefix* ∪ fuzzy 变体（与打分层同口径展开）。
    const matchGroups: string[] = [];
    for (const token of tokens) {
      const maxDistance = maxFuzzyDistance(token, this.scoring.fuzzy);
      const parts = [quoteFtsTerm(token)];
      if (this.scoring.prefix) parts.push(`${quoteFtsTerm(token)}*`);
      for (const term of expandFuzzyTerms(token, unionVocabulary(fieldStats), {
        prefix: this.scoring.prefix,
        maxDistance,
      }).keys()) {
        parts.push(quoteFtsTerm(term));
      }
      matchGroups.push(`(${parts.join(" OR ")})`);
    }
    const matchQuery = matchGroups.join(" OR ");
    const recalled = this.statements.selectRecall.all(matchQuery) as DocRow[];

    const docFieldTokens = new Map<string, Map<string, string[]>>();
    const storedById = new Map<string, SearchDocument["stored"]>();
    for (const row of recalled) {
      const perField = new Map<string, string[]>();
      for (const [index, field] of this.fieldNames.entries()) {
        const column = this.columns[index];
        if (typeof column === "string") perField.set(field, this.splitTokens(row[column]));
      }
      docFieldTokens.set(row.id, perField);
      storedById.set(row.id, this.parseStored(row.stored));
    }

    const scores = scoreCorpus(
      {
        docCount,
        fields: this.fieldNames,
        weights: this.weights,
        fieldStats,
        docFieldTokens,
      },
      tokens,
      this.scoring,
    );

    const hits: SearchHit[] = [...scores.entries()]
      .map(([id, score]) => ({ id, score, stored: storedById.get(id) }))
      .sort(
        (left, right) =>
          right.score - left.score || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
      )
      .slice(offset, offset + limit);
    return { hits, total: scores.size };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }
}

/** FTS5 词面引号包裹（内嵌双引号翻倍；token 字符集本不含引号，防御性处理）。 */
function quoteFtsTerm(term: string): string {
  return `"${term.replaceAll('"', '""')}"`;
}

/** 各字段词表的并集（fuzzy 召回展开口径；顺序随 fieldStats 装载序，确定性）。 */
function unionVocabulary(fieldStats: Map<string, FieldTermStats>): string[] {
  const union = new Set<string>();
  for (const stats of fieldStats.values()) {
    for (const term of stats.df.keys()) union.add(term);
  }
  return [...union];
}
