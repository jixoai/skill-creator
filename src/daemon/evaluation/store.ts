/**
 * 评估语料存储（evaluation-corpus B1/B′6；工作计划 Ch3）。
 *
 * 用户原始需求 [2026-09-30]：「webui 里面还有一些残留的未完成的工作，比如 skill
 * 测试与评估」。
 *
 * 正交意图：
 *   [1] server-owned 文件布局：appDir()/evaluation/<ws>/<p>/<skill>/{cases,results}.json
 *       ——原子写；不兼容 → 空信封重建；权限/磁盘/原子写失败 → typed hard error。
 *   [2] Imported-only 写门：Global（"~"）只读（安全不变量：写绑定 Imported）。
 *   [3] 结果有界保留：每 case 最新 20 条（写入时裁剪，结果本体不可变）。
 * 妥协声明：全部 fs 同步操作——单 daemon 进程内天然串行，无需额外互斥；
 * 无跨进程写者假设。
 */
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { appDir } from "../../shared/paths.js";
import {
  EvaluationCaseEnvelopeSchema,
  EvaluationResultEnvelopeSchema,
  type EvaluationCase,
  type EvaluationResult,
  type EvaluationTarget,
} from "../../shared/contracts/evaluation.js";
import { GLOBAL_WORKSPACE_ID } from "../../shared/contracts/workspaces.js";

/** IO hard error（权限/磁盘/原子写失败——绝不静默空值；B′6）。 */
export class EvaluationStoreError extends Error {
  constructor(
    readonly stage: "read" | "write" | "mkdir",
    readonly targetPath: string,
    readonly cause: unknown,
  ) {
    super(
      `evaluation store ${stage} failed at ${targetPath}: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
  }
}

const RESULTS_PER_CASE = 20;

interface CaseEnvelope {
  schemaVersion: 1;
  cases: EvaluationCase[];
}
interface ResultEnvelope {
  schemaVersion: 1;
  results: EvaluationResult[];
}

const EMPTY_CASES: CaseEnvelope = { schemaVersion: 1, cases: [] };
const EMPTY_RESULTS: ResultEnvelope = { schemaVersion: 1, results: [] };

/** 集合读取法则：解析不兼容/损坏 → 空信封（不迁移不写回）；IO 故障 → hard error。 */
function readEnvelope<T>(
  file: string,
  schema: { safeParse: (input: unknown) => { success: boolean } },
  empty: T,
): T {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (error) {
    const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
    if (code === "ENOENT") return empty;
    throw new EvaluationStoreError("read", file, error);
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return schema.safeParse(parsed).success ? (parsed as T) : empty;
  } catch {
    return empty;
  }
}

/** 原子写：同目录 tmp + rename；失败抛 hard error（写失败不产生半状态）。 */
function writeEnvelope(file: string, value: unknown): void {
  const dir = path.dirname(file);
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  } catch (error) {
    throw new EvaluationStoreError("mkdir", dir, error);
  }
  const tmp = `${file}.tmp`;
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(value)}\n`, { mode: 0o600 });
    fs.renameSync(tmp, file);
  } catch (error) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // tmp 清理失败不掩盖主因。
    }
    throw new EvaluationStoreError("write", file, error);
  }
}

export interface EvaluationStore {
  listCases(target: EvaluationTarget): EvaluationCase[];
  /** Global 目标抛 EvaluationStoreError（调用方转 typed RPC 拒绝；B′1 只读门）。 */
  saveCase(target: EvaluationTarget, next: EvaluationCase): void;
  removeCase(target: EvaluationTarget, caseId: string): boolean;
  /** 追加结果（每 case 有界保留；同 resultId 幂等跳过；结果不可变）。 */
  appendResult(target: EvaluationTarget, result: EvaluationResult): void;
  listResults(target: EvaluationTarget): EvaluationResult[];
}

/** 目录布局（B1）：恒由 appDir() 派生（setHomeOverride/SKILL_CREATOR_HOME 兼容测试）。 */
export function evaluationDir(target: EvaluationTarget, home?: string): string {
  return path.join(
    home ?? appDir(),
    "evaluation",
    target.workspaceId,
    target.providerId,
    target.skillId,
  );
}

/** caseId/runId/resultId 生成（ev_/run_/evr_ + 24 hex）。 */
export function newEvaluationId(prefix: "ev_" | "run_" | "evr_"): string {
  return `${prefix}${randomUUID().replaceAll("-", "").slice(0, 24)}`;
}

/** 语料 digest（B4：相对路径排序 + 内容字节序拼接的 sha256）。 */
export function corpusDigestOf(files: Array<{ relativePath: string; content: Buffer }>): string {
  const hash = createHash("sha256");
  for (const file of [...files].sort((a, b) => (a.relativePath < b.relativePath ? -1 : 1))) {
    hash.update(file.relativePath);
    hash.update(file.content);
  }
  return hash.digest("hex");
}

export function createEvaluationStore(home?: string): EvaluationStore {
  const assertWritable = (target: EvaluationTarget): void => {
    if (target.workspaceId === GLOBAL_WORKSPACE_ID) {
      throw new EvaluationStoreError(
        "write",
        evaluationDir(target, home),
        new Error(`global workspace ${GLOBAL_WORKSPACE_ID} is read-only for evaluation cases`),
      );
    }
  };
  const casesFile = (target: EvaluationTarget): string =>
    path.join(evaluationDir(target, home), "cases.json");
  const resultsFile = (target: EvaluationTarget): string =>
    path.join(evaluationDir(target, home), "results.json");

  return {
    listCases(target) {
      return readEnvelope(casesFile(target), EvaluationCaseEnvelopeSchema, EMPTY_CASES).cases;
    },
    saveCase(target, next) {
      assertWritable(target);
      const envelope = readEnvelope(casesFile(target), EvaluationCaseEnvelopeSchema, EMPTY_CASES);
      const rest = envelope.cases.filter((entry) => entry.caseId !== next.caseId);
      writeEnvelope(casesFile(target), {
        schemaVersion: 1,
        cases: [...rest, next].sort((a, b) => (a.caseId < b.caseId ? -1 : 1)),
      });
    },
    removeCase(target, caseId) {
      assertWritable(target);
      const envelope = readEnvelope(casesFile(target), EvaluationCaseEnvelopeSchema, EMPTY_CASES);
      const next = envelope.cases.filter((entry) => entry.caseId !== caseId);
      if (next.length === envelope.cases.length) return false;
      writeEnvelope(casesFile(target), { schemaVersion: 1, cases: next });
      return true;
    },
    appendResult(target, result) {
      // r6 P1-3：结果写入与 case 写入同一 Imported-only 写门——Global 运行只读
      // （codex 实证 "~" 曾可创建 results.json）。
      assertWritable(target);
      const envelope = readEnvelope(
        resultsFile(target),
        EvaluationResultEnvelopeSchema,
        EMPTY_RESULTS,
      );
      if (envelope.results.some((entry) => entry.resultId === result.resultId)) return;
      const byCase = new Map<string, EvaluationResult[]>();
      for (const entry of [...envelope.results, result]) {
        const bucket = byCase.get(entry.caseId) ?? [];
        bucket.push(entry);
        byCase.set(entry.caseId, bucket);
      }
      const bounded: EvaluationResult[] = [];
      for (const bucket of byCase.values()) {
        bounded.push(...bucket.slice(-RESULTS_PER_CASE));
      }
      writeEnvelope(resultsFile(target), {
        schemaVersion: 1,
        results: bounded.sort((a, b) => (a.resultId < b.resultId ? -1 : 1)),
      });
    },
    listResults(target) {
      return readEnvelope(resultsFile(target), EvaluationResultEnvelopeSchema, EMPTY_RESULTS)
        .results;
    },
  };
}
