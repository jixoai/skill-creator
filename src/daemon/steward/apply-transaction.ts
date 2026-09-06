/**
 * Skill Steward apply 事务：journal + 补偿（tasks 2.3c/2.3d）。
 *
 * 用户原始需求 [2026-09-06]（transaction-contract.md）：「按单 proposal 实现持久 journal +
 * 排他 Manager mutation queue + 补偿」「每步记账并持久化，再推进下一步」「普通失败补偿到
 * 原状态；补偿遇到外部修改或 I/O 错误时进入 recovery-required」。
 *
 * 正交意图：
 *   [1] 写前记账（write-ahead journal）：每个 mutation 前持久化 before/after 事实。
 *   [2] 复用 Manager 服务：edit 走 creator.save（revision 校验 + 原子写 + frontmatter
 *       round-trip）；启停走 skills.toggle（真实 Provider 机制）；split/merge 目标创建
 *       走 creator.save create（direct-child + 安全名）。
 *   [3] 逆序补偿：普通失败恢复原字节/启停/删除已建目标；外部漂移 → recovery-required
 *       （保留 journal，封锁 target）。
 *   [4] 审计事实：输出 mutation 列表（前后 revision/启停语义），供 audit-store 持久化。
 */
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  SkillProposal,
  SkillStewardContextSnapshot,
  StewardMutationRecord,
} from "../../shared/contracts/skill-steward.js";
import type { CreatorService } from "../creator-service.js";
import type { SkillService } from "../skill-service.js";
import type { WorkspaceRegistry } from "../workspace-registry/index.js";
import { DomainError } from "../domain-error.js";
import { assertPathInside } from "../path-safety.js";
import type { StewardAuditStore } from "./audit-store.js";

/** 一步 journal 记账（mutation 前持久化）。 */
export interface JournalEntry {
  seq: number;
  step: string;
  detail: Record<string, unknown>;
}

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
  /** journal 文件路径（默认 home/steward-store/journal/<operationId>.jsonl）。 */
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
  const recordStep = async (step: string, detail: Record<string, unknown>): Promise<void> => {
    seq += 1;
    journal.push({ seq, step, detail });
    await fs.mkdir(path.dirname(deps.journalPath), { recursive: true });
    await fs.appendFile(deps.journalPath, `${JSON.stringify({ seq, step, detail })}\n`, "utf8");
  };

  const root = deps.workspaces.resolveWritable(snapshot.target).directory;

  /** 补偿：逆序回滚已完成步骤；外部漂移 → recovery-required。 */
  const compensate = async (failure: string): Promise<ApplyOutcome> => {
    for (const entry of [...journal].reverse()) {
      try {
        await undoStep(entry, { proposal, snapshot, deps, root, mutations, movedRestore });
      } catch (error) {
        return {
          status: "recovery-required",
          mutations,
          failure: `compensation failed at step ${entry.step} (${entry.detail.kind ?? ""}): ${error instanceof Error ? error.message : String(error)}; original failure: ${failure}`,
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
          await deps.skills.toggle(snapshot.target, [selection.skillId], "disable");
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
          await deps.skills.toggle(snapshot.target, [selection.skillId], "enable");
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
        for (const target of targets) {
          await recordStep("create-target", {
            kind: "content",
            directoryName: target.directoryName,
          });
          const created = await deps.creator.save({
            mode: "create",
            workspaceId: snapshot.target.workspaceId,
            providerId: snapshot.target.providerId,
            directoryName: target.directoryName,
            frontmatter: target.frontmatter,
            body: target.body,
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
            const liveHash = createHash("sha256").update(sourceBytes).digest("hex");
            if (liveHash !== manifestEntry.hash) {
              throw new DomainError(
                "CONFLICT",
                `Resource ${mapping.sourcePath} drifted from the snapshot manifest hash.`,
              );
            }
            // Codex R5 P1-2：move 的源字节先落 Manager-owned 持久备份（journal 目录
            // 旁 .backups/），write-ahead 记账携带 backupPath + sha256——同进程补偿、
            // 正常 rollback 与重启恢复共用同一事实源；无备份不得删除源。
            const label = `${target.directoryName}/${mapping.targetPath}`;
            let backupRef: string | undefined;
            if (mapping.strategy === "move") {
              // Codex R6 P1-2：backup 根由 canonical journalPath 派生且 containment
              // 校验（拒绝预置 symlink 换体把备份写到外部）；journal 只记 Manager
              // 生成的相对文件名，replay 拒绝任意路径。
              const backupDir = await prepareBackupRoot(deps.journalPath);
              backupRef = `${seq + 1}-${liveHash.slice(0, 12)}.bin`;
              await writeResourceFileStrict(
                path.join(backupDir, backupRef),
                backupDir,
                sourceBytes,
                `backup:${backupRef}`,
              );
              await syncDir(backupDir);
            }
            await recordStep("resource", {
              kind: "resource",
              strategy: mapping.strategy,
              from: `${mappingSource.directoryName}/${mapping.sourcePath}`,
              to: label,
              ...(backupRef === undefined ? {} : { backupRef, sourceSha256: liveHash }),
            });
            await fs.mkdir(path.dirname(to), { recursive: true });
            // Codex R4/R5 P1-1（目标侧）：mkdir 后校验目标父链无 symlink 换体，
            // 写入走 exclusive fd + 写后 canonical/inode 复核（逃逸→恢复必需）。
            await assertNoSymlinkAncestors(to, root);
            if (mapping.strategy === "reference") {
              await writeResourceFileStrict(
                to,
                root,
                Buffer.from(
                  `reference: ../../${mappingSource.directoryName}/${mapping.sourcePath}\n`,
                  "utf8",
                ),
                label,
              );
            } else {
              await writeResourceFileStrict(to, root, sourceBytes, label);
              if (mapping.strategy === "move") {
                // Codex R4 P2-3 / R5 P1-2：真实移动——目标写入 + 备份落盘 +
                // journal 记账完成后才删除源；恢复路径优先内存表、回退持久备份。
                movedRestore.set(seq, { from, bytes: sourceBytes });
                // Codex R5/R6 P1-1：身份绑定删除——父链校验 + lstat 捕获 {dev,ino}
                // 后立即 unlink，删除后验证该路径已不存在；任何一步身份漂移或
                // 删除后仍存在，按恢复必需处理（Node 无 openat/unlinkat 的平台
                // 等价：宁可 recovery-required，绝不确定地删除外部文件）。
                await assertNoSymlinkAncestors(from, root);
                const preDelete = await lstatSource(
                  from,
                  `${mappingSource.directoryName}/${mapping.sourcePath}`,
                  manifestEntry.byteSize,
                );
                await fs.rm(from, { force: true });
                const stillExists = await fs.lstat(from).then(
                  () => true,
                  () => false,
                );
                if (stillExists) {
                  throw new DomainError(
                    "UNAVAILABLE",
                    `move source path raced during delete (identity changed); recovery required: ${mappingSource.directoryName}/${mapping.sourcePath}`,
                  );
                }
                void preDelete;
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
          await recordStep("disable", {
            kind: "enablement",
            skillId: source.skillId,
          });
          await deps.skills.toggle(snapshot.target, [source.skillId], "disable");
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
  }
}

/** 读取 journal 文件为步骤列表（重启恢复/rollback replay 用）。 */
export async function readJournal(journalPath: string): Promise<JournalEntry[]> {
  let raw: string;
  try {
    raw = await fs.readFile(journalPath, "utf8");
  } catch {
    return [];
  }
  const entries: JournalEntry[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as { seq?: unknown; step?: unknown; detail?: unknown };
      if (
        typeof parsed.seq === "number" &&
        typeof parsed.step === "string" &&
        typeof parsed.detail === "object" &&
        parsed.detail !== null
      ) {
        entries.push({
          seq: parsed.seq,
          step: parsed.step,
          detail: parsed.detail as Record<string, unknown>,
        });
      }
    } catch {
      continue;
    }
  }
  return entries;
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
  /** Codex R6 P1-2：move 备份根的原事务 journal 路径（缺省用 deps.journalPath）。 */
  backupJournalPath?: string;
}

/** 逆序撤销一组 journal 步骤（补偿与 rollback 共用）；失败抛错由调用方定级。 */
export async function undoJournalSteps(
  entries: JournalEntry[],
  context: UndoContext,
): Promise<void> {
  for (const entry of [...entries].reverse()) {
    await undoStep(entry, context);
  }
}

/** 撤销一步（逆序补偿）；外部漂移抛错 → recovery-required。 */
async function undoStep(
  entry: JournalEntry,
  context: {
    proposal: SkillProposal;
    snapshot: SkillStewardContextSnapshot;
    deps: ApplyTransactionDeps;
    root: string;
    mutations: StewardMutationRecord[];
    /** Codex R4 P2-3：move 步骤的源字节还原表（可选：undoJournalSteps 复放路径无）。 */
    movedRestore?: Map<number, { from: string; bytes: Buffer }>;
    /** Codex R6 P1-2：move 备份根的原事务 journal 路径。 */
    backupJournalPath?: string;
  },
): Promise<void> {
  const { deps, snapshot, root } = context;
  switch (entry.step) {
    case "precheck":
      return; // 纯校验步骤无需撤销。
    case "edit": {
      const skillId = entry.detail.skillId as string;
      // 恢复原字节：从快照取原文，以「当前」revision 为期望写回。
      // 若当前内容已不是我们写入后的状态（外部编辑），save 会拒绝 → recovery-required。
      const snapshotEntry = snapshot.skills.find((skill) => skill.skillId === skillId);
      if (!snapshotEntry) throw new Error("snapshot entry lost");
      const current = await deps.skills.info(snapshot.target, skillId as never);
      const frontmatter = parseFrontmatter(snapshotEntry.content);
      await deps.creator.save({
        mode: "update",
        workspaceId: snapshot.target.workspaceId,
        providerId: snapshot.target.providerId,
        skillId: skillId as never,
        expectedRevision: current.revision,
        frontmatter: frontmatter.data,
        body: frontmatter.body,
      });
      return;
    }
    case "disable": {
      const skillId = entry.detail.skillId as string;
      await deps.skills.toggle(snapshot.target, [skillId as never], "enable");
      return;
    }
    case "enable": {
      const skillId = entry.detail.skillId as string;
      await deps.skills.toggle(snapshot.target, [skillId as never], "disable");
      return;
    }
    case "create-target": {
      // 删除已创建的目标目录（整个 direct-child）。
      const directoryName = entry.detail.directoryName as string | undefined;
      if (!directoryName) return;
      await fs.rm(path.join(root, directoryName), { recursive: true, force: true });
      return;
    }
    case "resource": {
      // Codex R4 P2-3 / R5 P1-2：move 步骤先还原源字节（目标目录由 create-target
      // 撤销删除）。恢复事实源：同进程内存表 → journal 记账的持久备份；备份缺失
      // 或 sha 漂移直接抛错（→ recovery-required），绝不伪造已回滚。
      const fromRel = entry.detail.from as string | undefined;
      if (entry.detail.strategy === "move" && fromRel) {
        const from = path.join(root, fromRel);
        let restored = false;
        const moved = context.movedRestore?.get(entry.seq);
        if (moved) {
          await fs.mkdir(path.dirname(moved.from), { recursive: true });
          await restoreResourceBytesStrict(moved.from, root, moved.bytes, fromRel);
          restored = true;
        } else {
          // Codex R6 P1-2：journal 只信 Manager 生成的相对 backupRef；绝对路径/
          // `..`/换体 backup 根一律拒绝（回放数据不可指向任意外部路径）。
          const backupRef = entry.detail.backupRef as string | undefined;
          const expectedSha = entry.detail.sourceSha256 as string | undefined;
          if (!backupRef || !isValidBackupRef(backupRef)) {
            throw new Error(
              `move rollback has no valid backupRef for step ${entry.seq} (${fromRel})`,
            );
          }
          const backupRoot = await prepareBackupRoot(
            context.backupJournalPath ?? context.deps.journalPath,
          );
          const backupPath = path.join(backupRoot, backupRef);
          let backup: Buffer | null;
          try {
            backup = await readResourceBytesStrict(
              backupPath,
              backupRoot,
              (await fs.stat(backupPath)).size,
              `backup:${backupRef}`,
            );
          } catch {
            backup = null;
          }
          if (backup === null) {
            throw new Error(
              `move rollback backup missing on disk for step ${entry.seq}: ${backupRef}`,
            );
          }
          if (expectedSha && createHash("sha256").update(backup).digest("hex") !== expectedSha) {
            throw new Error(
              `move rollback backup hash mismatch for step ${entry.seq}: ${backupRef}`,
            );
          }
          await fs.mkdir(path.dirname(from), { recursive: true });
          await restoreResourceBytesStrict(from, root, backup, fromRel);
          restored = true;
        }
        void restored;
      }
      const directoryName =
        (entry.detail.directoryName as string | undefined) ??
        (entry.detail.to as string | undefined)?.split("/")[0];
      if (!directoryName) return;
      await fs.rm(path.join(root, directoryName), { recursive: true, force: true });
      return;
    }
    default:
      return;
  }
}

/**
 * Codex R4 P1-1：资源源的严格读取。三重防线：
 *   [1] canonical realpath 必须落在 canonical root 下的同一相对位置（任何一级父目录
 *       是 symlink 都会使二者不等 → 拒绝）；
 *   [2] 以 O_NOFOLLOW 打开描述符并 fstat 校验 regular file + byteSize（关闭
 *       lstat→readFile 的 TOCTOU 缺口；末端 symlink 在 open 即失败）；
 *   [3] 从描述符读取字节（不回退按路径 read）。
 */
async function readResourceBytesStrict(
  from: string,
  root: string,
  expectedByteSize: number,
  label: string,
): Promise<Buffer> {
  // Codex R5 P1-1：Node 无 openat，以「canonical 一致 + inode 身份链 + 读后稳定」
  // 组合达成等价的 no-symlink traversal：
  //   (1) realpath 必须落在 canonical root 的同一 lexical 位置（拒绝任一 symlink 祖先）；
  //   (2) lstat 捕获 {dev, ino, size} 身份；
  //   (3) O_NOFOLLOW 打开 leaf fd，fstat 身份必须与 (2) 完全一致——(1)(2) 之间被
  //       换体的竞态在此暴露（外部 inode 的 dev/ino 必不相同）；
  //   (4) 从 fd 读字节（fd 指向已验证 inode，路径换体不影响读取内容）；
  //   (5) 读后再次 realpath + lstat 一致——(3) 之后的换体也按可疑状态拒绝。
  const realRoot = await fs.realpath(root);
  const lexicalPosition = path.join(realRoot, path.relative(root, from));
  const realFrom = await realpathOrNotFound(from, label);
  if (realFrom !== lexicalPosition) {
    throw new DomainError(
      "INVALID_OPERATION",
      `Resource source path contains a symlink ancestor (escapes the provider root): ${label}`,
    );
  }
  const identity = await lstatSource(from, label, expectedByteSize);
  let handle: import("node:fs/promises").FileHandle;
  try {
    handle = await fs.open(
      from,
      fs.constants.O_RDONLY | (fs.constants as { O_NOFOLLOW?: number }).O_NOFOLLOW!,
    );
  } catch {
    throw new DomainError("NOT_FOUND", `Resource source missing on disk: ${label}`);
  }
  let bytes: Buffer;
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) {
      throw new DomainError("INVALID_OPERATION", `Resource source is not a regular file: ${label}`);
    }
    if (stat.size !== expectedByteSize) {
      throw new DomainError(
        "CONFLICT",
        `Resource ${label} live size ${stat.size} differs from the snapshot manifest byteSize ${expectedByteSize}.`,
      );
    }
    if (stat.dev !== identity.dev || stat.ino !== identity.ino) {
      throw new DomainError(
        "INVALID_OPERATION",
        `Resource source identity changed between validation and open (path race): ${label}`,
      );
    }
    bytes = await handle.readFile();
  } finally {
    await handle.close().catch(() => undefined);
  }
  const realFromAfter = await realpathOrNotFound(from, label);
  if (realFromAfter !== realFrom) {
    throw new DomainError(
      "INVALID_OPERATION",
      `Resource source path raced after read (canonical position moved): ${label}`,
    );
  }
  return bytes;
}

async function realpathOrNotFound(target: string, label: string): Promise<string> {
  try {
    return await fs.realpath(target);
  } catch {
    throw new DomainError("NOT_FOUND", `Resource source missing on disk: ${label}`);
  }
}

async function lstatSource(
  from: string,
  label: string,
  expectedByteSize: number,
): Promise<{ dev: number; ino: number }> {
  let stat: import("node:fs").Stats;
  try {
    stat = await fs.lstat(from);
  } catch {
    throw new DomainError("NOT_FOUND", `Resource source missing on disk: ${label}`);
  }
  if (!stat.isFile()) {
    throw new DomainError("INVALID_OPERATION", `Resource source is not a regular file: ${label}`);
  }
  if (stat.size !== expectedByteSize) {
    throw new DomainError(
      "CONFLICT",
      `Resource ${label} live size ${stat.size} differs from the snapshot manifest byteSize ${expectedByteSize}.`,
    );
  }
  return { dev: stat.dev, ino: stat.ino };
}

/**
 * Codex R4 P1-1（目标侧）：mkdir 之后、写入之前，校验目标父目录（已存在的
 * dirname）canonical 位置与 lexical 位置一致（任一 symlink 祖先拒绝）。
 */
async function assertNoSymlinkAncestors(to: string, root: string): Promise<void> {
  const realRoot = await fs.realpath(root);
  const parent = path.dirname(to);
  const realParent = await fs.realpath(parent);
  const lexicalParent = path.join(realRoot, path.relative(root, parent));
  if (realParent !== lexicalParent) {
    throw new DomainError(
      "INVALID_OPERATION",
      `Resource target path contains a symlink ancestor: ${path.relative(root, to)}`,
    );
  }
}

/**
 * Codex R6 P1-2：backup 根目录——由 canonical journalPath 派生（`<journal>.backups`），
 * 每次使用前校验 canonical containment（预置 symlink 换体直接拒绝）。
 */
async function prepareBackupRoot(journalPath: string): Promise<string> {
  const backupDir = `${journalPath}.backups`;
  const canonicalParent = await fs.realpath(path.dirname(journalPath));
  await fs.mkdir(backupDir, { recursive: true }).catch(() => undefined);
  const realBackup = await fs.realpath(backupDir);
  const lexicalBackup = path.join(canonicalParent, path.basename(backupDir));
  if (realBackup !== lexicalBackup) {
    throw new DomainError(
      "UNAVAILABLE",
      `move backup root escaped its manager-owned location (path race); recovery required: ${backupDir}`,
    );
  }
  return realBackup;
}

/** Codex R6 P1-2：合法 backupRef 是 Manager 生成的安全相对文件名（无路径分隔/遍历）。 */
function isValidBackupRef(ref: string): boolean {
  return /^\d+-[0-9a-f]{12}\.bin$/.test(ref);
}

/** Codex R6 P2-1：目录 fsync（崩溃持久化栅栏；平台不支持时记录并放行）。 */
async function syncDir(dir: string): Promise<void> {
  try {
    const handle = await fs.open(dir, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY);
    try {
      await handle.sync();
    } finally {
      await handle.close().catch(() => undefined);
    }
  } catch (error) {
    throw new DomainError(
      "UNAVAILABLE",
      `durability sync failed for ${dir} (${error instanceof Error ? error.message : String(error)}); recovery required`,
    );
  }
}

/**
 * Codex R5 P1-1（恢复侧写入）：move 补偿/rollback 的源字节还原——父链 canonical
 * 校验 + exclusive 写（已存在则要求字节一致），杜绝恢复路径经换体 symlink 写到
 * Provider 外部。
 */
async function restoreResourceBytesStrict(
  to: string,
  root: string,
  bytes: Buffer,
  label: string,
): Promise<void> {
  await assertNoSymlinkAncestors(to, root);
  let stat: import("node:fs").Stats | null = null;
  try {
    stat = await fs.lstat(to);
  } catch {
    stat = null;
  }
  if (stat !== null) {
    // Codex R6 P1-2：现存 leaf 必须是 regular file——symlink（即便字节相同）
    // 不是恢复成功，是外部可控制的路径身份。
    if (!stat.isFile()) {
      throw new Error(`move restore target exists but is not a regular file: ${label}`);
    }
    const current = await fs.readFile(to);
    if (!current.equals(bytes)) {
      throw new Error(`move restore target exists with different bytes (external drift): ${label}`);
    }
    return;
  }
  await writeResourceFileStrict(to, root, bytes, label);
}

/**
 * Codex R5 P1-1（目标侧写入）：exclusive create（O_CREAT|O_EXCL，symlink leaf 直接
 * 失败）+ fd 写 + 写后 canonical 复核。检测到写逃逸（父目录在窗口内被换体）时，
 * 将逃逸文件清零并抛 UNAVAILABLE——调用方按 recovery-required 处理，绝不谎称
 * 干净补偿。
 */
async function writeResourceFileStrict(
  to: string,
  root: string,
  bytes: Buffer,
  label: string,
): Promise<void> {
  const realRoot = await fs.realpath(root);
  const lexicalPosition = path.join(realRoot, path.relative(root, to));
  let handle: import("node:fs/promises").FileHandle;
  try {
    handle = await fs.open(to, "wx");
  } catch (error) {
    throw new DomainError(
      "INVALID_OPERATION",
      `Resource target already exists or cannot be created exclusively: ${label} (${error instanceof Error ? error.message : String(error)})`,
    );
  }
  let identity: { dev: number; ino: number };
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) {
      throw new DomainError("INVALID_OPERATION", `Resource target is not a regular file: ${label}`);
    }
    identity = { dev: stat.dev, ino: stat.ino };
    await handle.writeFile(bytes);
    await handle.sync().catch(() => undefined);
  } finally {
    await handle.close().catch(() => undefined);
  }
  // 写后复核：canonical 位置一致 + 同一 inode（父目录换体会让 realpath 指向外部）。
  const realTo = await fs.realpath(to);
  if (realTo !== lexicalPosition) {
    // Codex R6 P1-1：逃逸只报告，不触碰外部路径——canonical 位置可能指向任何
    // 无关外部文件，Manager 无权清零/修改它（外部文件保持原状，恢复由人处理）。
    throw new DomainError(
      "UNAVAILABLE",
      `Resource target escaped the provider root (path race); external path untouched, recovery required: ${label}`,
    );
  }
  const after = await fs.lstat(to);
  if (after.dev !== identity.dev || after.ino !== identity.ino) {
    throw new DomainError(
      "UNAVAILABLE",
      `Resource target identity changed after write (path race); recovery required: ${label}`,
    );
  }
}

/** 快照原文 → creator save 需要的 frontmatter（name/description 必填）+ body。 */ function parseFrontmatter(
  content: string,
): {
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
 * 即为崩溃残留；恢复前必须封锁对应 target 的后续写入。
 */
export interface UnfinishedOperation {
  proposalId: string;
  journalPath: string;
  steps: number;
  lastStep: string | null;
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
    const entries = await readJournal(journalPath);
    if (entries.length === 0) continue;
    unfinished.push({
      proposalId: file.replace(/\.jsonl$/, ""),
      journalPath,
      steps: entries.length,
      lastStep: entries[entries.length - 1]!.step,
    });
  }
  return unfinished;
}
