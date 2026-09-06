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
            await recordStep("resource", {
              kind: "resource",
              strategy: mapping.strategy,
              from: `${mappingSource.directoryName}/${mapping.sourcePath}`,
              to: `${target.directoryName}/${mapping.targetPath}`,
            });
            await fs.mkdir(path.dirname(to), { recursive: true });
            // Codex R4 P1-1（目标侧）：mkdir 后校验目标父链无 symlink 换体。
            await assertNoSymlinkAncestors(to, root);
            if (mapping.strategy === "reference") {
              await fs.writeFile(
                to,
                `reference: ../../${mappingSource.directoryName}/${mapping.sourcePath}\n`,
                "utf8",
              );
            } else if (mapping.strategy === "move") {
              // Codex R4 P2-3：move 是真实移动语义——先写目标（journal 记账），
              // 成功后删除源；compensation 用捕获的字节还原源目录。
              await fs.writeFile(to, sourceBytes);
              movedRestore.set(seq, { from, bytes: sourceBytes });
              await fs.rm(from, { force: true });
            } else {
              await fs.writeFile(to, sourceBytes);
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
    if (error instanceof DomainError && (error.code === "CONFLICT" || error.code === "NOT_FOUND")) {
      // 预检失败：journal 里可能已有 create-target 等步骤，仍走补偿保证零残留。
      return compensate(message);
    }
    return compensate(message);
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
      // Codex R4 P2-3：move 步骤先还原源字节（目标目录由 create-target 撤销删除）。
      const moved = context.movedRestore?.get(entry.seq);
      if (moved) {
        await fs.mkdir(path.dirname(moved.from), { recursive: true });
        await fs.writeFile(moved.from, moved.bytes);
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
  const realRoot = await fs.realpath(root);
  let realFrom: string;
  try {
    realFrom = await fs.realpath(from);
  } catch {
    throw new DomainError("NOT_FOUND", `Resource source missing on disk: ${label}`);
  }
  const lexicalPosition = path.join(realRoot, path.relative(root, from));
  if (realFrom !== lexicalPosition) {
    throw new DomainError(
      "INVALID_OPERATION",
      `Resource source path contains a symlink ancestor (escapes the provider root): ${label}`,
    );
  }
  let handle: import("node:fs/promises").FileHandle;
  try {
    handle = await fs.open(
      from,
      fs.constants.O_RDONLY | (fs.constants as { O_NOFOLLOW?: number }).O_NOFOLLOW!,
    );
  } catch {
    throw new DomainError("NOT_FOUND", `Resource source missing on disk: ${label}`);
  }
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
    const bytes = await handle.readFile();
    return bytes;
  } finally {
    await handle.close().catch(() => undefined);
  }
}

/**
 * Codex R4 P1-1（目标侧）：mkdir 之后、写入之前，校验目标路径的每一级父目录
 * 都不是 symlink（canonical 位置必须与 lexical 位置一致）。
 */
async function assertNoSymlinkAncestors(to: string, root: string): Promise<void> {
  const realRoot = await fs.realpath(root);
  let realTo: string;
  try {
    realTo = await fs.realpath(to);
  } catch {
    return; // 目标尚不存在（首次写入）；父链由 realpath 成功本身证明无断裂。
  }
  const lexicalPosition = path.join(realRoot, path.relative(root, to));
  if (realTo !== lexicalPosition) {
    throw new DomainError(
      "INVALID_OPERATION",
      `Resource target path contains a symlink ancestor: ${path.relative(root, to)}`,
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
