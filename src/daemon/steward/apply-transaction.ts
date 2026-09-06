/**
 * Skill Steward apply 事务：journal + 补偿（tasks 2.3c/2.3d）。
 *
 * 用户原始需求 [2026-09-06]（transaction-contract.md）：「按单 proposal 实现持久 journal +
 * 排他 Manager mutation queue + 补偿」「每步记账并持久化，再推进下一步」「普通失败补偿到
 * 原状态；补偿遇到外部修改或 I/O 错误时进入 recovery-required」。
 *
 * 正交意图：
 *   [1] 写前记账（write-ahead journal）：每个 mutation 前持久化 before/after 事实；
 *       全部成功后追加 commit 终态行（回放闸，Codex R7 P1-3）。记账走常驻 fd +
 *       逐行 fsync（Codex R7 P2-1）。
 *   [2] 复用 Manager 服务：edit 走 creator.save（revision 校验 + 原子写 + frontmatter
 *       round-trip）；启停走 skills.toggle（真实 Provider 机制）；split/merge 目标创建
 *       走 creator.save create（direct-child + 安全名）。
 *   [3] 逆序补偿：普通失败恢复原字节/启停/删除已建目标；外部漂移 → recovery-required
 *       （保留 journal，封锁 target）。回放侧所有路径事实经闭合 union + proposal
 *       目标绑定二次校验（Codex R7 P1-4）；move 备份经 manifest 一一绑定（P1-5）。
 *   [4] 审计事实：输出 mutation 列表（前后 revision/启停语义），供 audit-store 持久化。
 * 妥协声明：mutation 权威原语（fd 锚定读/写/删、备份 manifest）物理拆分在
 *   fs-authority.ts；journal 事实形状与严格读取拆分在 journal-schema.ts。
 */
import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  affectedSkillIdsOfPatch,
  type SkillProposal,
  type SkillStewardContextSnapshot,
  type StewardMutationRecord,
} from "../../shared/contracts/skill-steward.js";
import type { CreatorService } from "../creator-service.js";
import type { SkillService } from "../skill-service.js";
import type { WorkspaceRegistry } from "../workspace-registry/index.js";
import { DomainError } from "../domain-error.js";
import { assertPathInside } from "../path-safety.js";
import type { StewardAuditStore } from "./audit-store.js";
import {
  assertCommittedJournal,
  JournalEntrySchema,
  readJournal,
  type JournalEntry,
} from "./journal-schema.js";
import {
  assertCanonicalDirectory,
  assertJournalManifestBijection,
  assertNoSymlinkAncestors,
  assertRealRoot,
  findBackupEntry,
  prepareBackupRoot,
  readBackupManifest,
  readResourceBytesStrict,
  restoreResourceBytesStrict,
  sha256Hex,
  unlinkFileVerified,
  syncDir,
  verifyDirIdentity,
  writeBackupWithManifest,
  writeFileExclusiveVerified,
} from "./fs-authority.js";

export type { JournalEntry };
export { readJournal, assertCommittedJournal };

/** apply 结果终态。 */
export type ApplyOutcome =
  | { status: "applied"; mutations: StewardMutationRecord[] }
  | { status: "compensated"; mutations: StewardMutationRecord[]; failure: string }
  | { status: "recovery-required"; mutations: StewardMutationRecord[]; failure: string };

/** 事务依赖。 */
export interface ApplyTransactionDeps {
  workspaces: WorkspaceRegistry;
  skills: SkillService;
  creator: CreatorService;
  store: StewardAuditStore;
  /** journal 文件路径（`<proposalId>.jsonl`；默认 home/steward-store/journal/ 下）。 */
  journalPath: string;
}

/** 执行一次 proposal apply（含补偿）。调用方必须已消费 grant 并完成 revision 预检。 */
export async function applyProposalTransaction(
  proposal: SkillProposal,
  snapshot: SkillStewardContextSnapshot,
  deps: ApplyTransactionDeps,
): Promise<ApplyOutcome> {
  const journal: JournalEntry[] = [];
  const mutations: StewardMutationRecord[] = [];
  let seq = 0;
  /** Codex R4 P2-3：move 步骤的源字节还原表（compensation 恢复源目录用）。 */
  const movedRestore = new Map<number, { from: string; bytes: Buffer }>();
  // Codex R7 P2-1：journal 走常驻 append fd，逐行 fsync——不再按路径 appendFile。
  // 打开失败（目录不可写等）留在 try 内：走补偿路径输出 typed 终态，不裸抛。
  let journalWriter: import("node:fs/promises").FileHandle | null = null;
  const operationId = path.basename(deps.journalPath, ".jsonl");
  const recordStep = async <S extends JournalEntry["step"]>(
    step: S,
    detail: Extract<JournalEntry, { step: S }>["detail"],
  ): Promise<void> => {
    if (journalWriter === null) {
      await fs.mkdir(path.dirname(deps.journalPath), { recursive: true });
      // Codex R9 P1-1：journal 所在目录必须 canonical（预置 symlink 父目录拒绝）
      // ——独占创建只封 leaf，父目录换体仍可把事实字节写到外部。
      await assertCanonicalDirectory(path.dirname(deps.journalPath));
      // Codex R8 P1-1：journal 只允许独占创建——已有文件（崩溃残留 / 重复 apply）
      // 与预置 symlink（EEXIST/ELOOP）一律 fail-closed：新事务新文件，追加语义
      // 不存在，恢复闸门（2.3e）拥有残留文件的唯一处置权。
      journalWriter = await fs.open(
        deps.journalPath,
        fs.constants.O_WRONLY |
          fs.constants.O_CREAT |
          fs.constants.O_EXCL |
          (fs.constants as { O_NOFOLLOW?: number }).O_NOFOLLOW!,
        0o600,
      );
    }
    seq += 1;
    const entry = { seq, step, detail } as JournalEntry;
    journal.push(entry);
    await journalWriter.write(`${JSON.stringify(entry)}\n`, null, "utf8");
    await journalWriter.sync();
  };

  const root = deps.workspaces.resolveWritable(snapshot.target).directory;

  /** 补偿：逆序回滚已完成步骤；外部漂移 → recovery-required。 */
  const compensate = async (failure: string): Promise<ApplyOutcome> => {
    const targetTrees = buildTargetTrees(journal);
    for (const entry of [...journal].reverse()) {
      try {
        await undoStep(entry, {
          proposal,
          snapshot,
          deps,
          root,
          mutations,
          movedRestore,
          targetTrees,
          backupJournalPath: deps.journalPath,
        });
      } catch (error) {
        return {
          status: "recovery-required",
          mutations,
          failure: `compensation failed at step ${entry.step} (${entry.detail.kind}): ${error instanceof Error ? error.message : String(error)}; original failure: ${failure}`,
        };
      }
    }
    return { status: "compensated", mutations, failure };
  };

  try {
    switch (proposal.patch.kind) {
      case "edit": {
        for (const edit of proposal.patch.edits) {
          const entry = snapshot.skills.find((skill) => skill.skillId === edit.skillId);
          if (!entry)
            throw new DomainError("NOT_FOUND", `Skill missing from snapshot: ${edit.skillId}`);
          // Codex R4 P1-3（apply 防御）：edit 不允许改写身份——frontmatter.name 必须
          // 与快照条目物理目录一致（bind 层主校验；此处拦截手工构造值）。
          if (edit.frontmatter.name !== entry.directoryName) {
            throw new DomainError(
              "INVALID_OPERATION",
              `Edit for ${edit.skillId} must keep frontmatter.name "${entry.directoryName}" (got "${edit.frontmatter.name}").`,
            );
          }
          const info = await deps.skills.info(snapshot.target, edit.skillId);
          if (info.revision !== edit.expectedRevision) {
            throw new DomainError(
              "CONFLICT",
              `stale: skill ${entry.directoryName} drifted before apply.`,
            );
          }
          await recordStep("edit", {
            kind: "content",
            skillId: edit.skillId,
            beforeRevision: info.revision,
          });
          const saved = await deps.creator.save({
            mode: "update",
            workspaceId: snapshot.target.workspaceId,
            providerId: snapshot.target.providerId,
            skillId: edit.skillId,
            expectedRevision: edit.expectedRevision,
            frontmatter: edit.frontmatter,
            body: edit.body,
          });
          mutations.push({
            skillId: edit.skillId,
            relPath: "SKILL.md",
            beforeRevision: info.revision,
            afterRevision: saved.document.revision,
            semantic: "content",
          });
        }
        break;
      }
      case "disable": {
        for (const selection of proposal.patch.selections) {
          const entry = snapshot.skills.find((skill) => skill.skillId === selection.skillId);
          if (!entry)
            throw new DomainError("NOT_FOUND", `Skill missing from snapshot: ${selection.skillId}`);
          const info = await deps.skills.info(snapshot.target, selection.skillId);
          if (info.revision !== selection.expectedRevision) {
            throw new DomainError(
              "CONFLICT",
              `stale: skill ${entry.directoryName} drifted before apply.`,
            );
          }
          await recordStep("disable", {
            kind: "enablement",
            skillId: selection.skillId,
            wasDisabled: info.disabled,
            revision: info.revision,
          });
          await toggleWithPostcondition(deps, snapshot.target, selection.skillId, "disable");
          mutations.push({
            skillId: selection.skillId,
            relPath: "SKILL.md",
            beforeRevision: info.revision,
            afterRevision: info.revision,
            semantic: "enablement",
          });
        }
        break;
      }
      case "enable": {
        for (const selection of proposal.patch.selections) {
          const entry = snapshot.skills.find((skill) => skill.skillId === selection.skillId);
          if (!entry)
            throw new DomainError("NOT_FOUND", `Skill missing from snapshot: ${selection.skillId}`);
          const info = await deps.skills.info(snapshot.target, selection.skillId);
          if (info.revision !== selection.expectedRevision) {
            throw new DomainError(
              "CONFLICT",
              `stale: skill ${entry.directoryName} drifted before apply.`,
            );
          }
          await recordStep("enable", {
            kind: "enablement",
            skillId: selection.skillId,
            wasEnabled: !info.disabled,
            revision: info.revision,
          });
          await toggleWithPostcondition(deps, snapshot.target, selection.skillId, "enable");
          mutations.push({
            skillId: selection.skillId,
            relPath: "SKILL.md",
            beforeRevision: info.revision,
            afterRevision: info.revision,
            semantic: "enablement",
          });
        }
        break;
      }
      case "split":
      case "merge": {
        // ---- 前置校验 + 写前记账：源 revision、目标目录必须不存在。 ----
        const sources =
          proposal.patch.kind === "split" ? [proposal.patch.source] : proposal.patch.sources;
        for (const source of sources) {
          const entry = snapshot.skills.find((skill) => skill.skillId === source.skillId);
          if (!entry)
            throw new DomainError("NOT_FOUND", `Skill missing from snapshot: ${source.skillId}`);
          const info = await deps.skills.info(snapshot.target, source.skillId);
          if (info.revision !== source.expectedRevision) {
            throw new DomainError(
              "CONFLICT",
              `stale: skill ${entry.directoryName} drifted before apply.`,
            );
          }
        }
        const targets =
          proposal.patch.kind === "split" ? proposal.patch.targets : [proposal.patch.target];
        for (const target of targets) {
          const destination = path.join(root, target.directoryName);
          if (await pathExists(destination)) {
            throw new DomainError(
              "CONFLICT",
              `Target directory already exists: ${target.directoryName}`,
            );
          }
        }
        await recordStep("precheck", {
          kind: "precheck",
          targets: targets.map((t) => t.directoryName),
        });

        // ---- 创建目标（direct-child，安全名由契约保证）。 ----
        const createdRevisions = new Map<string, string>();
        for (const target of targets) {
          const created = await deps.creator.save({
            mode: "create",
            workspaceId: snapshot.target.workspaceId,
            providerId: snapshot.target.providerId,
            directoryName: target.directoryName,
            frontmatter: target.frontmatter,
            body: target.body,
          });
          // Codex R10 P1-2：创建后事实（SKILL.md revision）入 journal——回滚删除前校验。
          createdRevisions.set(target.directoryName, created.document.revision);
          await recordStep("create-target", {
            kind: "content",
            directoryName: target.directoryName,
            revision: created.document.revision,
          });
          mutations.push({
            relPath: `${target.directoryName}/SKILL.md`,
            beforeRevision: null,
            afterRevision: created.document.revision,
            semantic: "content",
          });
          // ---- 资源映射（copy/move/reference），逐条记账。 ----
          // Codex R2 P1-2：每条映射按自己的 sourceSkillId 解析源目录（不再吃 primarySourceId），
          // 复制前对源文件做存在性 + sha256 复核（对齐快照 manifest）。
          // Codex R3 P1-2：apply 侧 seen-target 防御——契约层已拒绝重复 targetPath，
          // 这里对绕过（手工构造的 journal 重放等）断然失败并交给 rollback 清残留。
          const seenTargetPaths = new Set<string>();
          for (const mapping of target.resources) {
            const mappingSource = snapshot.skills.find(
              (skill) => skill.skillId === mapping.sourceSkillId,
            );
            if (!mappingSource) {
              throw new DomainError(
                "NOT_FOUND",
                `Resource mapping source missing from snapshot: ${mapping.sourceSkillId}`,
              );
            }
            const from = path.join(root, mappingSource.directoryName, mapping.sourcePath);
            const to = path.join(root, target.directoryName, mapping.targetPath);
            assertPathInside(root, from);
            assertPathInside(root, to);
            assertPathInside(path.join(root, target.directoryName), to);
            // Codex R4 P1-2（apply 防御）：主文档由 create-target 步骤拥有，资源面
            // 不得写 SKILL.md（契约层已拒绝；手工构造值在此断然失败）。
            if (path.basename(to).toLowerCase() === "skill.md") {
              throw new DomainError(
                "INVALID_OPERATION",
                `Resource targetPath must not target the skill document: ${target.directoryName}/${mapping.targetPath}`,
              );
            }
            // Codex R4 P2-2（apply 防御）：大小写文件系统归一后判重。
            const seenKey = `${target.directoryName}/${mapping.targetPath}`.toLowerCase();
            if (seenTargetPaths.has(seenKey)) {
              throw new DomainError(
                "INVALID_OPERATION",
                `Duplicate resource targetPath in transaction: ${seenKey}`,
              );
            }
            seenTargetPaths.add(seenKey);
            const manifestEntry = snapshot.resources.find(
              (resource) =>
                resource.skillId === mapping.sourceSkillId &&
                resource.relPath === mapping.sourcePath,
            );
            if (!manifestEntry) {
              throw new DomainError(
                "INVALID_OPERATION",
                `Resource ${mapping.sourcePath} of skill ${mapping.sourceSkillId} is not in the snapshot manifest.`,
              );
            }
            if (manifestEntry.kind !== "file") {
              throw new DomainError(
                "INVALID_OPERATION",
                `Resource ${mapping.sourcePath} of skill ${mapping.sourceSkillId} is not a file-kind manifest entry.`,
              );
            }
            // Codex R4 P1-1：整条路径（含每一级父目录）不得含 symlink——canonical
            // realpath 必须落在 canonical root 下的同一相对位置；末端用
            // O_NOFOLLOW 描述符读（lstat→readFile 的 TOCTOU 缺口关闭）。
            const sourceBytes = await readResourceBytesStrict(
              from,
              root,
              manifestEntry.byteSize,
              `${mappingSource.directoryName}/${mapping.sourcePath}`,
            );
            const liveHash = sha256Hex(sourceBytes);
            if (liveHash !== manifestEntry.hash) {
              throw new DomainError(
                "CONFLICT",
                `Resource ${mapping.sourcePath} drifted from the snapshot manifest hash.`,
              );
            }
            // Codex R5 P1-2 / R7 P1-5：move 的源字节先落 Manager-owned 持久备份并登记
            // manifest（ref/seq/from/sha256/byteSize 一一绑定），write-ahead 记账携带
            // backupRef + sha256——同进程补偿、正常 rollback 与重启恢复共用同一事实源；
            // 无备份不得删除源。
            const label = `${target.directoryName}/${mapping.targetPath}`;
            const fromRel = `${mappingSource.directoryName}/${mapping.sourcePath}`;
            let backupRef: string | undefined;
            if (mapping.strategy === "move") {
              backupRef = `${seq + 1}-${liveHash.slice(0, 12)}.bin`;
              await writeBackupWithManifest({
                journalPath: deps.journalPath,
                ref: backupRef,
                seq: seq + 1,
                from: fromRel,
                bytes: sourceBytes,
              });
            }
            // Codex R10 P1-2/P1-7：落盘字节 sha256（reference 为引用行内容）始终入
            // journal——终态闸与回滚删除前校验共用同一事实。
            const writtenBytes =
              mapping.strategy === "reference"
                ? Buffer.from(`reference: ../../${fromRel}\n`, "utf8")
                : sourceBytes;
            await recordStep("resource", {
              kind: "resource",
              strategy: mapping.strategy,
              from: fromRel,
              to: label,
              sha256: sha256Hex(writtenBytes),
              ...(backupRef === undefined ? {} : { backupRef, sourceSha256: liveHash }),
            });
            await fs.mkdir(path.dirname(to), { recursive: true });
            // Codex R4/R5/R7 P1-1（目标侧）：mkdir 后校验目标父链无 symlink 换体；
            // 写入走 exclusive fd，写前/写后都做 canonical+inode 锚定（换体在写字节
            // 之前即止损；sync 失败 typed 失败）。
            await assertNoSymlinkAncestors(to, root);
            if (mapping.strategy === "reference") {
              await writeFileExclusiveVerified(
                to,
                root,
                Buffer.from(`reference: ../../${fromRel}\n`, "utf8"),
                label,
              );
            } else {
              await writeFileExclusiveVerified(to, root, sourceBytes, label);
              if (mapping.strategy === "move") {
                // Codex R4 P2-3 / R5 P1-2：真实移动——目标写入 + 备份落盘 +
                // journal 记账完成后才删除源；恢复路径优先内存表、回退持久备份。
                movedRestore.set(seq, { from, bytes: sourceBytes });
                // Codex R7 P1-1：身份绑定删除（nlink 独占 + fd inode 绑定 +
                // Linux fd 锚定 unlink / macOS 复验；删除后 nlink===0 证明）。
                await unlinkFileVerified(from, root, fromRel, deps.journalPath);
              }
            }
            mutations.push({
              relPath: `${target.directoryName}/${mapping.targetPath}`,
              beforeRevision: null,
              afterRevision: null,
              semantic: "resource",
            });
          }
        }

        // ---- 校验后禁用源技能（源目录保留）。 ----
        for (const source of sources) {
          // Codex R10 P1-3：禁用前捕获当前启停态（journal 前态 = undo 恢复目标）。
          const info = await deps.skills.info(snapshot.target, source.skillId);
          await recordStep("disable", {
            kind: "enablement",
            skillId: source.skillId,
            wasDisabled: info.disabled,
          });
          await toggleWithPostcondition(deps, snapshot.target, source.skillId, "disable");
          mutations.push({
            skillId: source.skillId,
            relPath: "SKILL.md",
            beforeRevision: null,
            afterRevision: null,
            semantic: "enablement",
          });
        }
        break;
      }
    }
    // Codex R7 P1-3：全部成功后追加 commit 终态行——回放闸（无 commit 行的 journal
    // 是崩溃/截断事实，只能 recovery，不得宣称 rolled-back）。
    await recordStep("commit", {
      kind: "commit",
      proposalId: operationId,
      status: "applied",
      mutationCount: mutations.length,
    });
    return { status: "applied", mutations };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Codex R5 P1-1：检测到写逃逸（UNAVAILABLE）时，本地残留仍补偿，但终态必须
    // 报 recovery-required——外部路径可能已被触碰，不能谎称干净补偿。
    const escapeDetected = error instanceof DomainError && error.code === "UNAVAILABLE";
    const outcome = await compensate(message);
    if (escapeDetected && outcome.status === "compensated") {
      return { ...outcome, status: "recovery-required", failure: message };
    }
    return outcome;
  } finally {
    // recordStep 闭包内赋值不参与直线流分析：以断言回到声明类型后关闭。
    const writer = journalWriter as import("node:fs/promises").FileHandle | null;
    await writer?.close().catch(() => undefined);
  }
}

/** ToggleSummary 的最小形状（skill-service 返回值）。 */
interface ToggleSummaryLike {
  results: ReadonlyArray<{ skillId: string; status: string; error?: string }>;
}

/**
 * Codex R10 P1-3：toggle 结果是强制 postcondition——只有预期终态算成功；
 * skipped（已在目标态）由调用方按捕获前态处理；conflict/failed 立即抛错
 * （compensation/recovery），绝不投影为 applied。
 */
async function toggleWithPostcondition(
  deps: ApplyTransactionDeps,
  target: SkillStewardContextSnapshot["target"],
  skillId: string,
  mode: "enable" | "disable",
): Promise<"toggled" | "skipped"> {
  const summary = (await deps.skills.toggle(target, [skillId as never], mode)) as ToggleSummaryLike;
  const result = summary.results.find((item) => item.skillId === skillId);
  if (!result) {
    throw new DomainError(
      "UNAVAILABLE",
      `toggle ${mode} returned no result for ${skillId}; recovery required`,
    );
  }
  if (result.status === "skipped") return "skipped";
  // Provider 的终态是过去式（disabled/enabled）。
  if (result.status === (mode === "disable" ? "disabled" : "enabled")) return "toggled";
  throw new DomainError(
    result.status === "conflict" ? "CONFLICT" : "UNAVAILABLE",
    `toggle ${mode} for ${skillId} ended as ${result.status}${result.error ? `: ${result.error}` : ""}`,
  );
}

/** 判定路径存在（async；precheck 专用）。 */
async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.stat(target);
    return true;
  } catch {
    return false;
  }
}

/** 撤销上下文。 */
export interface UndoContext {
  proposal: SkillProposal;
  snapshot: SkillStewardContextSnapshot;
  deps: ApplyTransactionDeps;
  root: string;
  mutations: StewardMutationRecord[];
  /** Codex R4 P2-3：move 步骤的源字节还原表（同进程补偿用；回放路径缺省）。 */
  movedRestore?: Map<number, { from: string; bytes: Buffer }>;
  /** Codex R6 P1-2：move 备份根的原事务 journal 路径（缺省用 deps.journalPath）。 */
  backupJournalPath?: string;
}

/**
 * 逆序撤销一组 journal 步骤（补偿与 rollback 共用）；失败抛错由调用方定级。
 * Codex R7 P1-3/P1-4：入口先经闭合 union 复验——篡改/未知 step/穿越路径在进入
 * 任何文件系统操作之前即被 typed 拒绝（磁盘读出的条目已校验，这里覆盖直调方）。
 * Codex R8 独立探针整改：回放前校验 journal ↔ 备份 manifest 双射——删除 resource
 * 行后整体重编号的部分 journal 在此暴露（manifest 是写入时持久化的独立事实）。
 */
export async function undoJournalSteps(
  entries: JournalEntry[],
  context: UndoContext,
): Promise<void> {
  // 第一道：闭合 union 复验全部条目（未知 step/穿越路径/伪造字段先于任何 IO 拒绝）。
  const checked: JournalEntry[] = [];
  for (const entry of entries) {
    const parsed = JournalEntrySchema.safeParse(entry);
    if (!parsed.success) {
      const reason = parsed.error.issues
        .slice(0, 3)
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ");
      throw new DomainError(
        "UNAVAILABLE",
        `journal step failed closed validation (no replay; recovery required): ${reason}`,
      );
    }
    checked.push(parsed.data);
  }
  // 第二道：终态闸（含 proposal 双射）——直调方与 applyRollback 同一标准，无 commit
  // 或与 proposal 展开不符的 journal 一律不得回放（Codex R9 P1-3）。
  assertCommittedJournal(checked, {
    proposalId: path.basename(context.backupJournalPath ?? context.deps.journalPath, ".jsonl"),
    proposal: context.proposal,
  });
  // 第三道：journal ↔ 备份 manifest 双射（部分/重编号 journal 暴露）。
  const manifest = await readBackupManifest(context.backupJournalPath ?? context.deps.journalPath);
  assertJournalManifestBijection(checked, manifest);
  const targetTrees = buildTargetTrees(checked);
  for (const entry of [...checked].reverse()) {
    await undoStep(entry, { ...context, targetTrees });
  }
}

/**
 * Codex R8 P1-5：proposal 影响的技能身份集合——journal 的 edit/disable/enable
 * mutation 只允许落在这个集合内（回放数据不能启停 proposal 未触碰的技能）。
 */
function affectedSkillIdsOf(proposal: SkillProposal): Set<string> {
  return new Set(affectedSkillIdsOfPatch(proposal.patch));
}

/** 本 proposal 显式创建的目标目录（undo 删除只能落在这个集合内，Codex R7 P1-4）。 */
function createdDirectoriesOf(proposal: SkillProposal): Set<string> {
  if (proposal.patch.kind === "split") {
    return new Set(proposal.patch.targets.map((target) => target.directoryName));
  }
  if (proposal.patch.kind === "merge") {
    return new Set([proposal.patch.target.directoryName]);
  }
  return new Set();
}

/** 本 proposal 创建目标的 apply 后事实树（回滚删除前逐项校验，Codex R10 P1-2）。 */
interface TargetTree {
  /** SKILL.md 的 revision（sha256:…）。 */
  skillRevision: string;
  /** 资源文件相对路径 → 落盘字节 sha256。 */
  files: Map<string, string>;
}

/** 从 journal 步骤构建每个 create-target 目录的期望内容树。 */
function buildTargetTrees(entries: readonly JournalEntry[]): Map<string, TargetTree> {
  const trees = new Map<string, TargetTree>();
  for (const entry of entries) {
    if (entry.step === "create-target") {
      trees.set(entry.detail.directoryName, {
        skillRevision: entry.detail.revision,
        files: new Map(),
      });
    } else if (entry.step === "resource") {
      const directoryName = entry.detail.to.split("/")[0]!;
      const tree = trees.get(directoryName);
      const rel = entry.detail.to.split("/").slice(1).join("/");
      if (tree && rel) tree.files.set(rel, entry.detail.sha256);
    }
  }
  return trees;
}

/**
 * Codex R10 P1-2：删除本 proposal 创建的目标目录。
 *   [1] 绑定（proposal 创建集合）+ containment + canonical/realpath 一致；
 *   [2] 内容校验：实际文件集合必须精确等于 journal 事实树（SKILL.md + 资源路径），
 *       且每个文件 sha256 与 apply 时记录一致——任何新增/缺失/外部编辑 → recovery；
 *   [3] 删除 = 隔离改名（整目录 rename 进 Manager backup root 墓碑 + inode 证明 +
 *       目录 fsync）——不存在递归 rm 外部树窗口，EXDEV fail-closed。
 */
async function removeCreatedDirectory(
  dir: string,
  root: string,
  directoryName: string,
  tree: TargetTree | undefined,
  quarantineJournalPath: string,
): Promise<void> {
  await assertRealRoot(root);
  assertPathInside(root, dir);
  let stat: import("node:fs").Stats;
  try {
    stat = await fs.lstat(dir);
  } catch {
    return; // 已不存在：幂等完成。
  }
  if (!stat.isDirectory()) {
    throw new DomainError(
      "INVALID_OPERATION",
      `Created target is no longer a directory (external drift): ${directoryName}`,
    );
  }
  const realDir = await fs.realpath(dir);
  const lexicalDir = path.join(await fs.realpath(root), path.relative(root, dir));
  if (realDir !== lexicalDir) {
    throw new DomainError(
      "INVALID_OPERATION",
      `Created target escaped the root (symlink race): ${directoryName}`,
    );
  }
  if (tree !== undefined) {
    // 内容校验：文件集合 + 逐文件 sha256。
    const actual = await walkFiles(dir, "");
    const expected = new Map<string, string>([["SKILL.md", tree.skillRevision], ...tree.files]);
    if (actual.size !== expected.size || [...expected.keys()].some((f) => !actual.has(f))) {
      const extra = [...actual.keys()].filter((f) => !expected.has(f));
      throw new Error(
        `Created target content drifted (files mismatch; extra: ${extra.join(",") || "none"}); recovery required: ${directoryName}`,
      );
    }
    for (const [file, expectedSha] of expected) {
      const content = await fs.readFile(path.join(dir, file));
      const actualSha = sha256Hex(content);
      const wanted = expectedSha.startsWith("sha256:")
        ? expectedSha.slice("sha256:".length)
        : expectedSha;
      if (actualSha !== wanted) {
        throw new Error(
          `Created target file ${file} drifted from the apply-time hash; recovery required: ${directoryName}`,
        );
      }
    }
  }
  // 隔离改名（与源删除同一 authority）。
  const identity = { dev: stat.dev, ino: stat.ino };
  const quarantineRoot = await prepareBackupRoot(quarantineJournalPath);
  const quarantineIdentity = await assertCanonicalDirectory(quarantineRoot);
  const tombstone = path.join(
    quarantineRoot,
    `removed-dir-${randomBytes(8).toString("hex")}-${path.basename(dir)}`,
  );
  try {
    await fs.rename(dir, tombstone);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EXDEV") {
      throw new DomainError(
        "UNAVAILABLE",
        `cross-volume target cannot be quarantined in the manager store; recovery required: ${directoryName}`,
      );
    }
    throw error;
  }
  const stillExists = await fs.lstat(dir).then(
    () => true,
    () => false,
  );
  if (stillExists) {
    throw new DomainError(
      "UNAVAILABLE",
      `Created target survived quarantine rename (path race); recovery required: ${directoryName}`,
    );
  }
  const tomb = await fs.lstat(tombstone).catch(() => null);
  if (
    tomb === null ||
    !tomb.isDirectory() ||
    tomb.dev !== identity.dev ||
    tomb.ino !== identity.ino
  ) {
    throw new DomainError(
      "UNAVAILABLE",
      `Created target race: quarantined directory does not match the captured identity; recovery required: ${directoryName}`,
    );
  }
  await syncDir(quarantineRoot);
  await verifyDirIdentity(quarantineRoot, quarantineIdentity);
}

/** 递归收集目录内全部 regular 文件的相对路径（子目录名保留）。 */
async function walkFiles(dir: string, prefix: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      for (const [f] of await walkFiles(path.join(dir, entry.name), rel)) files.set(f, "");
    } else if (entry.isFile()) {
      files.set(rel, "");
    } else {
      throw new Error(`Created target contains a non-regular entry: ${rel}`);
    }
  }
  return files;
}

/** 撤销一步（逆序补偿）；外部漂移抛错 → recovery-required。 */
async function undoStep(
  entry: JournalEntry,
  context: UndoContext & { targetTrees: Map<string, TargetTree> },
): Promise<void> {
  const { deps, snapshot, root } = context;
  const created = createdDirectoriesOf(context.proposal);
  const affected = affectedSkillIdsOf(context.proposal);
  switch (entry.step) {
    case "commit":
    case "precheck":
      return; // 终态行/纯校验步骤无需撤销。
    case "edit": {
      const skillId = entry.detail.skillId;
      if (!affected.has(skillId)) {
        throw new DomainError(
          "INVALID_OPERATION",
          `Journal edit mutation references skill outside the proposal's affected set: ${skillId}`,
        );
      }
      // 恢复原字节：从快照取原文，以「当前」revision 为期望写回。
      // 若当前内容已不是我们写入后的状态（外部编辑），save 会拒绝 → recovery-required。
      const snapshotEntry = snapshot.skills.find((skill) => skill.skillId === skillId);
      if (!snapshotEntry) throw new Error("snapshot entry lost");
      const current = await deps.skills.info(snapshot.target, skillId);
      const frontmatter = parseFrontmatter(snapshotEntry.content);
      await deps.creator.save({
        mode: "update",
        workspaceId: snapshot.target.workspaceId,
        providerId: snapshot.target.providerId,
        skillId,
        expectedRevision: current.revision,
        frontmatter: frontmatter.data,
        body: frontmatter.body,
      });
      return;
    }
    case "disable": {
      if (!affected.has(entry.detail.skillId)) {
        throw new DomainError(
          "INVALID_OPERATION",
          `Journal disable mutation references skill outside the proposal's affected set: ${entry.detail.skillId}`,
        );
      }
      // Codex R10 P1-3：undo 只恢复捕获前态——apply 前已 disabled 的技能是 no-op，
      // 不得把原状态改回 enabled。
      if (entry.detail.wasDisabled) return;
      await toggleWithPostcondition(deps, snapshot.target, entry.detail.skillId, "enable");
      return;
    }
    case "enable": {
      if (!affected.has(entry.detail.skillId)) {
        throw new DomainError(
          "INVALID_OPERATION",
          `Journal enable mutation references skill outside the proposal's affected set: ${entry.detail.skillId}`,
        );
      }
      // Codex R10 P1-3：同上——恢复捕获前态，不盲目反向。
      if (entry.detail.wasEnabled) return;
      await toggleWithPostcondition(deps, snapshot.target, entry.detail.skillId, "disable");
      return;
    }
    case "create-target": {
      // Codex R7 P1-4：删除目录必须绑定本 proposal 创建的目标——journal 任意指定
      // 目录（含穿越）在此拒绝，绝不递归删除 Provider 根外内容。
      const { directoryName } = entry.detail;
      if (!created.has(directoryName)) {
        throw new DomainError(
          "INVALID_OPERATION",
          `Journal create-target references a directory this proposal never created: ${directoryName}`,
        );
      }
      await removeCreatedDirectory(
        path.join(root, directoryName),
        root,
        directoryName,
        context.targetTrees.get(directoryName),
        context.backupJournalPath ?? context.deps.journalPath,
      );
      return;
    }
    case "resource": {
      const { from: fromRel, to, strategy } = entry.detail;
      // Codex R4 P2-3 / R5 P1-2 / R7 P1-5：move 步骤恢复源字节（目标目录随后删除）。
      // 恢复事实源：同进程内存表 → journal 记账的持久备份 + manifest 一一绑定；
      // 备份缺失、hash/归属不符直接抛错（→ recovery-required），绝不伪造已回滚。
      if (strategy === "move") {
        const from = path.join(root, fromRel);
        assertPathInside(root, from);
        const moved = context.movedRestore?.get(entry.seq);
        if (moved) {
          await fs.mkdir(path.dirname(moved.from), { recursive: true });
          await restoreResourceBytesStrict(moved.from, root, moved.bytes, fromRel);
        } else {
          const { backupRef, sourceSha256 } = entry.detail;
          if (backupRef === undefined || sourceSha256 === undefined) {
            throw new DomainError(
              "UNAVAILABLE",
              `move journal step ${entry.seq} lacks manager backup facts; recovery required`,
            );
          }
          const backupJournalPath = context.backupJournalPath ?? deps.journalPath;
          const manifest = await readBackupManifest(backupJournalPath);
          const bound = findBackupEntry(manifest, {
            ref: backupRef,
            seq: entry.seq,
            from: fromRel,
            sha256: sourceSha256,
          });
          const backupRoot = await prepareBackupRoot(backupJournalPath);
          const backupPath = path.join(backupRoot, backupRef);
          let backup: Buffer;
          try {
            backup = await readResourceBytesStrict(
              backupPath,
              backupRoot,
              bound.byteSize,
              `backup:${backupRef}`,
            );
          } catch (error) {
            throw new Error(
              `move rollback backup unreadable for step ${entry.seq}: ${backupRef} (${error instanceof Error ? error.message : String(error)})`,
            );
          }
          if (sha256Hex(backup) !== sourceSha256) {
            throw new Error(
              `move rollback backup hash mismatch for step ${entry.seq}: ${backupRef}`,
            );
          }
          await fs.mkdir(path.dirname(from), { recursive: true });
          await restoreResourceBytesStrict(from, root, backup, fromRel);
        }
      }
      // 目标目录（本 proposal 创建的 direct-child）删除；`to` 的首段必须命中绑定集合。
      const directoryName = to.split("/")[0]!;
      if (!created.has(directoryName)) {
        throw new DomainError(
          "INVALID_OPERATION",
          `Journal resource target escapes the proposal-created directories: ${to}`,
        );
      }
      await removeCreatedDirectory(
        path.join(root, directoryName),
        root,
        directoryName,
        context.targetTrees.get(directoryName),
        context.backupJournalPath ?? context.deps.journalPath,
      );
      return;
    }
  }
}

/** 快照原文 → creator save 需要的 frontmatter（name/description 必填）+ body。 */
function parseFrontmatter(content: string): {
  data: { name: string; description: string } & Record<string, unknown>;
  body: string;
} {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) throw new Error("snapshot content has no frontmatter block");
  const raw: Record<string, unknown> = {};
  for (const line of match[1]!.split("\n")) {
    const pair = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (pair) raw[pair[1]!] = coerceYamlScalar(pair[2]!.replace(/^["']|["']$/g, ""));
  }
  if (typeof raw.name !== "string" || typeof raw.description !== "string") {
    throw new Error("snapshot frontmatter lacks name/description");
  }
  const data = { ...raw, name: raw.name, description: raw.description } as {
    name: string;
    description: string;
  } & Record<string, unknown>;
  return { data, body: content.slice(match[0].length) };
}

function coerceYamlScalar(raw: string): unknown {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw !== "" && !Number.isNaN(Number(raw))) return Number(raw);
  return raw;
}

/**
 * 重启恢复扫描（task 2.3e）：journal 目录中「有记账无终态审计」的 operation
 * 即为崩溃残留；恢复前必须封锁对应 target 的后续写入。Codex R7 P1-3：读取失败
 * 的 journal 以 corrupt 上报（恢复闸门必须按 recovery-required 处理，不得跳过）。
 */
export interface UnfinishedOperation {
  proposalId: string;
  journalPath: string;
  steps: number;
  lastStep: string | null;
  /** journal 缺失/损坏/seq 断裂（回放不可能成功，只能人工恢复）。 */
  corrupt: boolean;
}

/** 扫描未完成 journal（重启第一步；只读，不自动重放写操作）。 */
export async function scanUnfinishedJournals(storeDir: string): Promise<UnfinishedOperation[]> {
  const journalDir = path.join(storeDir, "journal");
  let files: string[];
  try {
    files = await fs.readdir(journalDir);
  } catch {
    return [];
  }
  const unfinished: UnfinishedOperation[] = [];
  for (const file of files) {
    if (!file.endsWith(".jsonl") || file.endsWith("-rollback.jsonl")) continue;
    const journalPath = path.join(journalDir, file);
    const proposalId = file.replace(/\.jsonl$/, "");
    let entries: JournalEntry[];
    try {
      entries = await readJournal(journalPath);
    } catch {
      unfinished.push({ proposalId, journalPath, steps: 0, lastStep: null, corrupt: true });
      continue;
    }
    if (entries.length === 0) continue;
    unfinished.push({
      proposalId,
      journalPath,
      steps: entries.length,
      lastStep: entries[entries.length - 1]!.step,
      corrupt: false,
    });
  }
  return unfinished;
}
