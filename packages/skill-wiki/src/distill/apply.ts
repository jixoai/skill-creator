/**
 * 用户原始需求 [2026-09-25]（切片③）：「applyDistillation（单项原子落盘 +
 * promotedFrom 合并 + 幂等/STALE 判定）」；崩溃提交协议以 design r3 补遗 H
 * （r8 按 kind 分支重写 / r16 attempts 预留制）为唯一规范源——absorb/create
 * 双序列双矩阵逐字实现。
 * 正交意图：
 *   [1] applyDistillation 单项 IO 事务：H 双矩阵判定（pending 审批红线 →
 *       typed 拒绝；终态重放零写报告；absorb 缺页/畸形页前置分支与人工回退
 *       manual-rollback 零写；create 确切 name 占用检查禁 -N 改名）+ 页原子写
 *       + promotedFrom 足迹合并 + index 重建；IO 失败 typed WIKI_IO（不吞）。
 * 妥协声明：durable retry 的 attempts 预留（写页前原子 +1）与重试循环属宿主
 * （DistillJobService per-run 队列）；SDK 只接受 typed ledgerRecord 输入、按
 * 矩阵返回结果（attempts ≥ 3 且仍需写页 → io-failed 是矩阵行，非 SDK 重试）。
 * hooks 只承诺顺序契约 onIntent → 页原子写 → index rebuild → onCommit，不落
 * ledger、不知道 run/MCP。
 */
import fs from "node:fs";
import path from "node:path";
import { applyEdits } from "../patch.js";
import { SkillWikiError } from "../schema.js";
import {
  atomicWritePatternFile,
  formatPatternPage,
  openWikiWorkspace,
  parsePatternPage,
  patternContentHash,
  stripFrontmatter,
} from "../workspace.js";
import {
  DistillLedgerRecordSchema,
  DistillPlanItemSchema,
  PromotedFromEntrySchema,
  type DistillItemResult,
  type DistillLedgerRecord,
  type DistillLedgerStatus,
  type DistillPlanItem,
  type DistillProvenance,
  type PromotedFromEntry,
} from "./schema.js";
import { formatPromotedFrom, mergePromotedFromEntry } from "./promoted-from.js";

/**
 * H 重放矩阵的「报告原终态，零写」集合：≠ E 的 TerminalDistillLedgerStatus——
 * applied 有专属矩阵行（afterHash no-op / beforeHash manual-rollback / 其余
 * stale），idempotent/applied 的重放结果由矩阵给出而非原样回报。
 */
const REPORT_ORIGINAL_REPLAY_STATUSES: ReadonlySet<DistillLedgerStatus> = new Set([
  "stale",
  "patch-failed",
  "expired",
  "rejected",
  "not-proposed",
  "idempotent",
  "io-failed",
]);

/** 谓词（类型守卫：收窄到 ItemStatus 可报告子集）。 */
function isReportOriginalReplay(
  status: DistillLedgerStatus,
): status is Exclude<DistillLedgerStatus, "pending" | "applying"> {
  return REPORT_ORIGINAL_REPLAY_STATUSES.has(status);
}

/** ledger 驱动缝（实现属宿主；SDK 按顺序契约调用，均为同步回调）。 */
export interface DistillApplyHooks {
  /** intent 行落盘（status:"applying"；首放 attempts 恒 0，预留 +1 由宿主执行）。 */
  onIntent?: (record: DistillLedgerRecord) => void;
  /** commit 行落盘（status:"applied" | "idempotent"，携带 appliedHash）。 */
  onCommit?: (record: DistillLedgerRecord) => void;
}

export interface DistillApplyOptions {
  /**
   * 宿主读 proposals.jsonl 该 ordinal 最近行传入（外部输入：unknown 进、
   * safeParse 出；缺省 = 首放）。整文件原子重写保证行只有旧/新两态。
   */
  ledgerRecord?: unknown;
  hooks?: DistillApplyHooks;
}

/** IO 包装：非 typed 异常一律收窄为 WIKI_IO（宿主据此走 attempts 预留重试）。 */
function io<T>(operation: string, run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (error instanceof SkillWikiError) throw error;
    throw new SkillWikiError(
      "WIKI_IO",
      `distill apply ${operation} failed: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

function invalid(message: string): never {
  throw new SkillWikiError("WIKI_INVALID_PATTERN", message);
}

function result(
  ordinal: number,
  status: DistillItemResult["status"],
  extra?: { detail?: string; appliedHash?: string },
): DistillItemResult {
  return extra === undefined ? { ordinal, status } : { ordinal, status, ...extra };
}

/** 读取既有页正文 hash（畸形 frontmatter 页以剥壳后全文参与比较——恒不等于 after）。 */
function existingBodyHash(raw: string): {
  hash: string;
  page: ReturnType<typeof parsePatternPage>;
} {
  const page = parsePatternPage(raw);
  return { hash: patternContentHash(page ? page.body : stripFrontmatter(raw)), page };
}

/**
 * 两段式第二段：单项 IO 事务（H 双矩阵）。判定输入 = 当前页状态 + typed
 * ledgerRecord；产出 = ItemResult（宿主据此迁移 ledger 行 / counters）。
 * 写路径副作用严格限定：目标页原子写（temp+rename）、promotedFrom 合并（同一
 * 次原子写）、index.md 重建（派生物）——workspace patterns 永不触碰。
 */
export function applyDistillation(
  globalWikiDir: string,
  item: DistillPlanItem,
  provenance: DistillProvenance,
  options?: DistillApplyOptions,
): DistillItemResult {
  // 外部输入收窄（item 可能经宿主落盘回读；ledgerRecord 来自磁盘 jsonl）。
  const narrowedItem = DistillPlanItemSchema.safeParse(item);
  if (!narrowedItem.success) {
    invalid(
      `Invalid distill plan item: ${narrowedItem.error.issues[0]?.message ?? "schema rejection"}`,
    );
  }
  const typedItem: DistillPlanItem = narrowedItem.data;
  const entryNarrowed = PromotedFromEntrySchema.safeParse({
    runId: provenance.runId,
    sourceScope: provenance.sourceScope,
    sourcePatternIds: typedItem.proposal.sourcePatternIds,
  });
  if (!entryNarrowed.success) {
    invalid(
      `Invalid distill provenance: ${entryNarrowed.error.issues[0]?.message ?? "schema rejection"}`,
    );
  }
  const entry: PromotedFromEntry = entryNarrowed.data;

  let record: DistillLedgerRecord | undefined;
  if (options?.ledgerRecord !== undefined) {
    const narrowedRecord = DistillLedgerRecordSchema.safeParse(options.ledgerRecord);
    if (!narrowedRecord.success) {
      invalid(
        `Invalid distill ledger record: ${narrowedRecord.error.issues[0]?.message ?? "schema rejection"}`,
      );
    }
    record = narrowedRecord.data;
    if (record.kind !== typedItem.action || record.ordinal !== typedItem.ordinal) {
      invalid(
        `ledger record ${record.kind}#${record.ordinal} does not match plan item ${typedItem.action}#${typedItem.ordinal}`,
      );
    }
  }

  // 审批红线（r10-P1.3：pending 优先，先于一切页面判定）：未审批项绝不被执行
  // 路径迁移——typed 拒绝、零写、hooks 不触发。apply 只由 approve 驱动。
  if (record?.status === "pending") {
    invalid(
      `applyDistillation refuses a pending ledger record (ordinal ${typedItem.ordinal}); approve drives apply`,
    );
  }
  // 终态重放（H 集——不含 applied/idempotent 专属行）：报告原终态，零写、不复活
  // （io-failed 同零写——人工修复后重跑 distill）。
  if (record !== undefined && isReportOriginalReplay(record.status)) {
    return result(
      typedItem.ordinal,
      record.status,
      record.appliedHash === undefined ? undefined : { appliedHash: record.appliedHash },
    );
  }

  const reader = openWikiWorkspace(globalWikiDir);
  const patternsDir = path.join(globalWikiDir, "patterns");
  const now = new Date().toISOString();
  const hooks = options?.hooks;
  /** attempts 预留门（r16：写页尝试上限 3 次跨重启恒成立——矩阵行，非重试循环）。 */
  const attemptsExhausted = (): boolean => record?.status === "applying" && record.attempts >= 3;
  const intentAttempts = record?.status === "applying" ? record.attempts : 0;

  if (typedItem.action === "absorb") {
    const beforeHash = typedItem.proposal.expectedBeforeBodyHash;
    const afterHash = typedItem.afterBodyHash;
    const target = typedItem.proposal.targetPatternId;
    const targetFile = path.join(patternsDir, `${target}.md`);

    // preflight（缺页/畸形页 → stale 零写，行落终态——不可重建锚定，人工修复或
    // 重跑 distill；绝不凭空创建目标页）。
    let raw: string;
    try {
      raw = io(`read absorb target ${target}`, () => reader.readPatternRaw(target));
    } catch (error) {
      if (error instanceof SkillWikiError && error.code === "WIKI_INVALID_PATTERN") {
        return result(typedItem.ordinal, "stale", { detail: "missing-target" });
      }
      throw error;
    }
    const page = parsePatternPage(raw);
    if (page === null) {
      return result(typedItem.ordinal, "stale", { detail: "invalid-target" });
    }
    const currentHash = patternContentHash(page.body);

    if (record?.status === "applied") {
      if (currentHash === afterHash) {
        // no-op idempotent（applied 蕴含 index 已重建）。
        return result(typedItem.ordinal, "idempotent", { appliedHash: afterHash });
      }
      if (currentHash === beforeHash) {
        // 人工回退检测：绝不重放（不覆盖人工回退）；ledger 保持 applied。
        return result(typedItem.ordinal, "stale", { detail: "manual-rollback" });
      }
      return result(typedItem.ordinal, "stale", { detail: "diverged" });
    }
    if (currentHash === afterHash) {
      // 纯恢复（applying 崩溃于写后 / 无记录防御分支）：先 rebuild 再补 commit，
      // 不写页、不计数（rebuild 失败 → WIKI_IO，行保持 applying 仍可恢复）。
      io("rebuild index (absorb recovery)", () => reader.rebuildIndex());
      hooks?.onCommit?.({
        kind: "absorb",
        ordinal: typedItem.ordinal,
        status: "idempotent",
        beforeHash,
        afterHash,
        appliedHash: afterHash,
        attempts: record?.attempts ?? 0,
      });
      return result(typedItem.ordinal, "idempotent", { appliedHash: afterHash });
    }
    if (currentHash === beforeHash) {
      // 执行路径（首放 / applying 窗口人工恢复 before——重放 = 执行既定审批意图）。
      if (attemptsExhausted()) {
        return result(typedItem.ordinal, "io-failed", { detail: "attempts-exhausted" });
      }
      hooks?.onIntent?.({
        kind: "absorb",
        ordinal: typedItem.ordinal,
        status: "applying",
        beforeHash,
        afterHash,
        attempts: intentAttempts,
      });
      let nextBody: string;
      try {
        nextBody = applyEdits(page.body, typedItem.proposal.edits);
      } catch (error) {
        if (error instanceof SkillWikiError && error.code === "WIKI_PATCH_FAILED") {
          return result(typedItem.ordinal, "patch-failed");
        }
        throw error;
      }
      const merged = mergePromotedFromEntry(page.frontmatter.promotedFrom, entry);
      const updated = { ...page.frontmatter, updated: now, promotedFrom: merged.canonical };
      io(`write absorb target ${target}`, () =>
        atomicWritePatternFile(targetFile, formatPatternPage(updated, nextBody)),
      );
      io("rebuild index (absorb apply)", () => reader.rebuildIndex());
      hooks?.onCommit?.({
        kind: "absorb",
        ordinal: typedItem.ordinal,
        status: "applied",
        beforeHash,
        afterHash,
        appliedHash: afterHash,
        attempts: intentAttempts,
      });
      return result(typedItem.ordinal, "applied", { appliedHash: afterHash });
    }
    // 其余：人工编辑/竞争 → stale 零写（补偿 = 基于当前页重新生成提案）。
    return result(typedItem.ordinal, "stale", { detail: "diverged" });
  }

  // ---- create 矩阵（name = item 冻结的 targetPatternName；无 beforeHash 比较）----
  const targetName = typedItem.targetPatternName;
  const afterHash = typedItem.afterBodyHash;
  const targetFile = path.join(patternsDir, `${targetName}.md`);
  const exists = io(`stat create target ${targetName}`, () => fs.existsSync(targetFile));

  if (record?.status === "applied") {
    if (!exists) {
      // 人工删除检测：绝不重放（与 absorb 对称）。
      return result(typedItem.ordinal, "stale", { detail: "manual-rollback" });
    }
    const raw = io(`read create target ${targetName}`, () => fs.readFileSync(targetFile, "utf8"));
    return existingBodyHash(raw).hash === afterHash
      ? result(typedItem.ordinal, "idempotent", { appliedHash: afterHash })
      : result(typedItem.ordinal, "stale", { detail: "diverged" });
  }
  if (exists) {
    const raw = io(`read create target ${targetName}`, () => fs.readFileSync(targetFile, "utf8"));
    const { hash, page } = existingBodyHash(raw);
    if (hash !== afterHash) {
      // 同名人工页/人工编辑：绝不覆盖、绝不换名（禁 appendPattern 的 -N 分支）。
      return result(typedItem.ordinal, "stale", {
        detail: record?.status === "applying" ? "diverged" : "name-conflict",
      });
    }
    if (record?.status === "applying") {
      // 崩溃于写后：纯恢复（rebuild + 补 commit；页已带本 run 足迹，不写页）。
      io("rebuild index (create recovery)", () => reader.rebuildIndex());
      hooks?.onCommit?.({
        kind: "create",
        ordinal: typedItem.ordinal,
        status: "idempotent",
        targetPatternName: targetName,
        afterHash,
        appliedHash: afterHash,
        attempts: record.attempts,
      });
      return result(typedItem.ordinal, "idempotent", { appliedHash: afterHash });
    }
    // 首放命中同正文页：contentHash 去重 + mergePromotedFromEntry 回填足迹
    // （§3 P1-1；frontmatter 原子写，正文逐字节不变）。
    if (page === null) {
      return result(typedItem.ordinal, "stale", { detail: "invalid-target" });
    }
    hooks?.onIntent?.({
      kind: "create",
      ordinal: typedItem.ordinal,
      status: "applying",
      targetPatternName: targetName,
      afterHash,
      attempts: 0,
    });
    const merged = mergePromotedFromEntry(page.frontmatter.promotedFrom, entry);
    const updated = { ...page.frontmatter, updated: now, promotedFrom: merged.canonical };
    io(`write create target ${targetName} (footprint)`, () =>
      atomicWritePatternFile(targetFile, formatPatternPage(updated, page.body)),
    );
    io("rebuild index (create dedup)", () => reader.rebuildIndex());
    hooks?.onCommit?.({
      kind: "create",
      ordinal: typedItem.ordinal,
      status: "idempotent",
      targetPatternName: targetName,
      afterHash,
      appliedHash: afterHash,
      attempts: 0,
    });
    return result(typedItem.ordinal, "idempotent", { appliedHash: afterHash });
  }
  // 执行路径（首放 / applying 崩溃于写前——人工删除 = 意图未完成，重放 append
  // 是执行既定审批）：确切 name 原子写。
  if (attemptsExhausted()) {
    return result(typedItem.ordinal, "io-failed", { detail: "attempts-exhausted" });
  }
  hooks?.onIntent?.({
    kind: "create",
    ordinal: typedItem.ordinal,
    status: "applying",
    targetPatternName: targetName,
    afterHash,
    attempts: intentAttempts,
  });
  io(`mkdir patterns directory`, () => fs.mkdirSync(patternsDir, { recursive: true }));
  const frontmatter = {
    title: typedItem.proposal.title,
    created: now,
    updated: now,
    origin: "~",
    promotedFrom: formatPromotedFrom([entry]),
  };
  io(`write create target ${targetName}`, () =>
    atomicWritePatternFile(targetFile, formatPatternPage(frontmatter, typedItem.proposal.body)),
  );
  io("rebuild index (create apply)", () => reader.rebuildIndex());
  hooks?.onCommit?.({
    kind: "create",
    ordinal: typedItem.ordinal,
    status: "applied",
    targetPatternName: targetName,
    afterHash,
    appliedHash: afterHash,
    attempts: intentAttempts,
  });
  return result(typedItem.ordinal, "applied", { appliedHash: afterHash });
}
