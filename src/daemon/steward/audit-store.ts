/**
 * Skill Steward 持久 audit/journal store（openspec skill-steward-runtime task 2.3a/2.3c）。
 *
 * 用户原始需求 [2026-09-06]（spec）：「Manager MUST persist immutable bounded snapshots,
 * findings, grants, patch manifests and operation outcomes. Restart MUST not replay
 * consumed grants or automatically resume writes.」
 *
 * 正交意图：
 *   [1] append-only JSONL 持久化：audit 记录、run 终态投影、grant 事实；
 *       run/audit 落盘前过 redactDshPayload（task 3.3 凭据不变量，grant 除外）。
 *   [2] 重启读取：terminal run / audit 可回读；行级 safeParse 丢坏行，I/O 故障 hard error
 *       （不兼容 ≠ 故障，AGENTS 持久化载入法则）。
 *   [3] 消费事实幂等：grant 消费记录让重启后不能重放已消费授权。
 * 妥协声明：JSONL 追加在单机崩溃窗口内可能丢最后一行；apply-transaction 在每步
 *   mutation 前先记账，恢复逻辑以「有记账无终态」为未完成信号，不以最后一行为准。
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  StewardApprovalGrantSchema,
  StewardAuditRecordSchema,
  type StewardApprovalGrant,
  type StewardAuditRecord,
} from "../../shared/contracts/skill-steward.js";
import { redactDshPayload } from "../../shared/contracts/dsh-runtime.js";
import { DomainError } from "../domain-error.js";
import { stewardStoreDir } from "./context-snapshot.js";

/** run 终态投影（重启后可读的 terminal run 记录）。 */
export interface PersistedRunRecord {
  runId: string;
  snapshotId: string;
  terminal: string;
  endedAt: string;
}

/** 打开的 store（目录布局：steward-store/{runs,audits,grants}.jsonl）。 */
export interface StewardAuditStore {
  appendRun(record: PersistedRunRecord): Promise<void>;
  appendAudit(record: StewardAuditRecord): Promise<void>;
  appendGrant(grant: StewardApprovalGrant): Promise<void>;
  /** 重启读取：坏行丢弃；I/O 故障抛 typed UNAVAILABLE。 */
  listRuns(): Promise<PersistedRunRecord[]>;
  listAudits(): Promise<StewardAuditRecord[]>;
  listGrants(): Promise<StewardApprovalGrant[]>;
}

function storeFile(name: "runs" | "audits" | "grants"): string {
  return path.join(stewardStoreDir(), `${name}.jsonl`);
}

async function appendLine(file: string, value: unknown): Promise<void> {
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.appendFile(file, `${JSON.stringify(value)}\n`, "utf8");
  } catch (error) {
    throw new DomainError(
      "UNAVAILABLE",
      `Steward store append failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function readLines<T>(file: string, parse: (value: unknown) => T | null): Promise<T[]> {
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new DomainError(
      "UNAVAILABLE",
      `Steward store read failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const records: T[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let value: unknown;
    try {
      value = JSON.parse(trimmed);
    } catch {
      continue; // 集合读取丢弃坏行。
    }
    const parsed = parse(value);
    if (parsed !== null) records.push(parsed);
  }
  return records;
}

/** 创建持久 store（home 目录由 setHomeOverride 隔离测试）。 */
export function createStewardAuditStore(): StewardAuditStore {
  // task 3.3 不变量：run/audit 载荷落盘前强制脱敏（凭据形状键 → "[redacted]"）。
  // grant 不做脱敏——它是幂等回放协议，且字段全部为受控 ID/哈希，无自由文本。
  return {
    appendRun: (record) => appendLine(storeFile("runs"), redactDshPayload(record)),
    appendAudit: (record) => appendLine(storeFile("audits"), redactDshPayload(record)),
    appendGrant: (grant) => appendLine(storeFile("grants"), grant),
    listRuns: () =>
      readLines<PersistedRunRecord>(storeFile("runs"), (value) => {
        if (typeof value !== "object" || value === null) return null;
        const record = value as Record<string, unknown>;
        if (
          typeof record.runId === "string" &&
          typeof record.snapshotId === "string" &&
          typeof record.terminal === "string" &&
          typeof record.endedAt === "string"
        ) {
          return {
            runId: record.runId,
            snapshotId: record.snapshotId,
            terminal: record.terminal,
            endedAt: record.endedAt,
          };
        }
        return null;
      }),
    listAudits: () =>
      readLines<StewardAuditRecord>(storeFile("audits"), (value) => {
        const parsed = StewardAuditRecordSchema.safeParse(value);
        return parsed.success ? parsed.data : null;
      }),
    listGrants: () =>
      readLines<StewardApprovalGrant>(storeFile("grants"), (value) => {
        const parsed = StewardApprovalGrantSchema.safeParse(value);
        return parsed.success ? parsed.data : null;
      }),
  };
}
