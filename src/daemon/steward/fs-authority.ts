/**
 * Skill Steward 文件系统 mutation 权威层（Codex R7 P1-1/P1-2/P1-5/P2-1）。
 *
 * 用户原始需求 [2026-09-06]（transaction-contract.md）：「普通失败补偿到原状态；补偿
 * 遇到外部修改或 I/O 错误时进入 recovery-required」。
 * Codex R7 复核（/tmp/stage1-contracts-review-round7.md）：「源删除和目标/备份写入
 * 仍有检查后换体窗口」「backupRef 只有名称白名单，没有 operation/source 完整性绑定」
 * 「journal 仍 appendFile……fd sync 失败被吞」。
 *
 * 正交意图：
 *   [1] fd 身份锚定的 leaf 读/写/删原语：exclusive open 后、写任何字节之前先锚定
 *       canonical 位置与 inode（换体 → 0 字节即止损）；删除以 fstat.nlink===0 证明
 *       删掉的是已验证 inode，而不是「路径消失」；fd sync 失败一律 typed 失败。
 *   [2] Manager-owned move 备份事实：备份根 containment + manifest.jsonl
 *       （ref/seq/from/sha256/byteSize）与 journal 记账一一绑定；回放缺行、重复、
 *       hash/来源不符一律拒绝，杜绝「同根任意字节恢复进 Provider」。
 * 妥协声明：Node 无 unlinkat/openat，无法做平台级原子 leaf unlink。Linux 用
 *   /proc/self/fd 的已验证父目录锚定 unlink；macOS（/dev/fd 不支持子路径遍历）只能
 *   「复验父链 → unlink → inode/存在性证明」——竞态残余最多误删外部文件并立即转为
 *   typed recovery-required（事实进 journal/审计），绝不谎称成功。
 */
import { createHash, randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { DomainError } from "../domain-error.js";
import { BackupRefSchema, type JournalEntry } from "./journal-schema.js";

const O_NOFOLLOW = (fs.constants as { O_NOFOLLOW?: number }).O_NOFOLLOW ?? 0;

export function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Codex R8 P1-3 整改：root 必须是 Manager 持有的 canonical 目录。
 * 要求：lstat 为真实目录（非 symlink），且 realpath(root) 与 root 全等——任何一级
 * 被换成 symlink 都会破坏全等（symlink root 的 canonical 目标不再是调用方声称的
 * root，全部下游防线随之失效）。唯一豁免：darwin 的 /var ↔ /private/var 前缀
 * （系统级 alias，mkdtemp 沙箱天然携带；非攻击面）。
 */
export async function assertRealRoot(root: string): Promise<void> {
  const stat = await fs.lstat(root).catch(() => null);
  if (stat === null || !stat.isDirectory() || stat.isSymbolicLink()) {
    throw new DomainError(
      "INVALID_OPERATION",
      `manager root is not a real directory (symlinked or missing): ${root}`,
    );
  }
  const real = await fs.realpath(root);
  const darwinAlias =
    process.platform === "darwin" && root.startsWith("/var/") ? `/private${root}` : null;
  if (real !== root && real !== darwinAlias) {
    throw new DomainError(
      "INVALID_OPERATION",
      `manager root is not canonical (realpath ${real} differs from the given root): ${root}`,
    );
  }
}

/**
 * 目录父链无 symlink：canonical realpath 必须与 lexical 位置一致（任一祖先被换成
 * symlink 都会不等 → 拒绝）。写入/删除前的静态防线。
 */
export async function assertNoSymlinkAncestors(to: string, root: string): Promise<void> {
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

/** 目录 fsync（崩溃持久化栅栏；失败 = typed UNAVAILABLE，不静默放行）。 */
export async function syncDir(dir: string): Promise<void> {
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

interface LeafIdentity {
  dev: number;
  ino: number;
  nlink: number;
  size: number;
}

async function captureLeafIdentity(
  leaf: string,
  label: string,
  expectedByteSize?: number,
): Promise<LeafIdentity> {
  let stat: import("node:fs").Stats;
  try {
    stat = await fs.lstat(leaf);
  } catch {
    throw new DomainError("NOT_FOUND", `Resource source missing on disk: ${label}`);
  }
  if (!stat.isFile()) {
    throw new DomainError("INVALID_OPERATION", `Resource source is not a regular file: ${label}`);
  }
  if (expectedByteSize !== undefined && stat.size !== expectedByteSize) {
    throw new DomainError(
      "CONFLICT",
      `Resource ${label} live size ${stat.size} differs from the expected byteSize ${expectedByteSize}.`,
    );
  }
  return { dev: stat.dev, ino: stat.ino, nlink: stat.nlink, size: stat.size };
}

/**
 * Codex R4/R5 P1-1（读取侧，维持）：canonical 一致 + lstat 身份捕获 + O_NOFOLLOW
 * fd + fstat 身份一致 + fd 读 + 读后稳定。
 */
export async function readResourceBytesStrict(
  from: string,
  root: string,
  expectedByteSize: number,
  label: string,
): Promise<Buffer> {
  await assertRealRoot(root);
  const realRoot = await fs.realpath(root);
  const lexicalPosition = path.join(realRoot, path.relative(root, from));
  const realFrom = await realpathOrNotFound(from, label);
  if (realFrom !== lexicalPosition) {
    throw new DomainError(
      "INVALID_OPERATION",
      `Resource source path contains a symlink ancestor (escapes the provider root): ${label}`,
    );
  }
  const identity = await captureLeafIdentity(from, label, expectedByteSize);
  let handle: import("node:fs/promises").FileHandle;
  try {
    handle = await fs.open(from, fs.constants.O_RDONLY | O_NOFOLLOW);
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

/**
 * Codex R7 P1-2/P2-1：fd 锚定的 exclusive 写。
 * open("wx") 成功后、写任何字节之前：realpath 必须等于 canonical lexical 位置，且
 * 该位置 inode === fd inode——父目录/备份根在检查与 open 之间换体时，字节不会
 * 越界落地（外部最多残留一个 0 字节占位文件，记录路径后交给人工恢复）。
 * 写入走 fd + fsync（失败 = UNAVAILABLE，绝不吞）；写后再次复验位置与身份。
 */
export async function writeFileExclusiveVerified(
  to: string,
  root: string,
  bytes: Buffer,
  label: string,
): Promise<void> {
  await assertRealRoot(root);
  const realRoot = await fs.realpath(root);
  const lexicalPosition = path.join(realRoot, path.relative(root, to));
  await assertNoSymlinkAncestors(to, root);
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
    // 写前锚定：fd 指向的 inode 必须就是 canonical 位置上的那个（换体即止损）。
    const realTo = await fs.realpath(to);
    if (realTo !== lexicalPosition) {
      throw new DomainError(
        "UNAVAILABLE",
        `Resource target escaped the root before any bytes were written (path race; at most an empty placeholder remains at ${realTo}); recovery required: ${label}`,
      );
    }
    const atPosition = await fs.lstat(to);
    if (atPosition.dev !== identity.dev || atPosition.ino !== identity.ino) {
      throw new DomainError(
        "UNAVAILABLE",
        `Resource target identity drifted before write (path race); recovery required: ${label}`,
      );
    }
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close().catch(() => undefined);
  }
  const realToAfter = await fs.realpath(to);
  if (realToAfter !== lexicalPosition) {
    throw new DomainError(
      "UNAVAILABLE",
      `Resource target escaped the provider root after write (path race); external path untouched, recovery required: ${label}`,
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

/**
 * Codex R5/R6 P1-1（恢复侧写入）：move 补偿/rollback 的源字节还原——父链 canonical
 * 校验 + exclusive 写（已存在则要求字节一致），杜绝恢复路径经换体 symlink 写到
 * Provider 外部。
 */
export async function restoreResourceBytesStrict(
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
    // Codex R6 P1-2 / R8 P1-7：现存 leaf 必须是 regular file，且读取走 O_NOFOLLOW
    // fd——lstat 与按路径 readFile 之间的换体窗口关闭（symlink 即便字节相同也不算
    // 恢复成功）；读后复验 inode 未漂移。
    if (!stat.isFile()) {
      throw new Error(`move restore target exists but is not a regular file: ${label}`);
    }
    const handle = await fs.open(to, fs.constants.O_RDONLY | O_NOFOLLOW).catch(() => null);
    if (handle === null) {
      throw new Error(`move restore target cannot be opened without following symlinks: ${label}`);
    }
    let current: Buffer;
    try {
      const opened = await handle.stat();
      if (!opened.isFile() || opened.dev !== stat.dev || opened.ino !== stat.ino) {
        throw new Error(
          `move restore target identity drifted between validation and open: ${label}`,
        );
      }
      current = await handle.readFile();
    } finally {
      await handle.close().catch(() => undefined);
    }
    const after = await fs.lstat(to);
    if (after.dev !== stat.dev || after.ino !== stat.ino) {
      throw new Error(`move restore target identity drifted after read: ${label}`);
    }
    if (!current.equals(bytes)) {
      throw new Error(`move restore target exists with different bytes (external drift): ${label}`);
    }
    return;
  }
  await writeFileExclusiveVerified(to, root, bytes, label);
}

/**
 * Codex R7 P1-1 / R8 P1-6：身份绑定的隔离改名删除（全平台统一）。
 *   [1] nlink 必须为 1（独占 inode 策略，hardlink 源拒绝）；
 *   [2] O_NOFOLLOW fd 打开 leaf，fstat 命中捕获身份（fd ↔ inode 绑定）；
 *   [3] rename 到 Manager 隔离区（backup root 内不可预测名）：源从原路径消失即达成
 *       move 语义；竞态残余的最坏结果是「外部文件被移入隔离区（字节保全、可审计、
 *       可人工恢复）」，绝不是外部字节被删除；跨卷 rename（EXDEV）fail-closed；
 *   [4] rename 后证明：原路径 ENOENT + 隔离 inode === 捕获身份 + fd nlink===1——
 *       移动的就是已验证 inode；任何漂移 → UNAVAILABLE/recovery-required。
 */
export async function unlinkFileVerified(
  leaf: string,
  root: string,
  label: string,
  quarantineJournalPath: string,
): Promise<void> {
  await assertRealRoot(root);
  await assertNoSymlinkAncestors(leaf, root);
  const identity = await captureLeafIdentity(leaf, label);
  if (identity.nlink !== 1) {
    throw new DomainError(
      "INVALID_OPERATION",
      `Resource source is hardlinked (nlink=${identity.nlink}); exclusive-inode policy refuses to move it: ${label}`,
    );
  }
  const handle = await fs.open(leaf, fs.constants.O_RDONLY | O_NOFOLLOW).catch(() => null);
  if (handle === null) {
    throw new DomainError("NOT_FOUND", `Resource source missing on disk: ${label}`);
  }
  try {
    const stat = await handle.stat();
    if (stat.dev !== identity.dev || stat.ino !== identity.ino) {
      throw new DomainError(
        "UNAVAILABLE",
        `Resource source identity changed before quarantine (path race); recovery required: ${label}`,
      );
    }
    const quarantineRoot = await prepareBackupRoot(quarantineJournalPath);
    const tombstone = path.join(
      quarantineRoot,
      `removed-${randomBytes(8).toString("hex")}-${path.basename(leaf)}`,
    );
    try {
      await fs.rename(leaf, tombstone);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EXDEV") {
        throw new DomainError(
          "UNAVAILABLE",
          `cross-volume move source cannot be quarantined in the manager store; recovery required: ${label}`,
        );
      }
      throw error;
    }
    const stillExists = await fs.lstat(leaf).then(
      () => true,
      () => false,
    );
    if (stillExists) {
      throw new DomainError(
        "UNAVAILABLE",
        `Resource source path survived quarantine rename (path race); recovery required: ${label}`,
      );
    }
    const tomb = await fs.lstat(tombstone).catch(() => null);
    if (tomb === null || !tomb.isFile() || tomb.dev !== identity.dev || tomb.ino !== identity.ino) {
      throw new DomainError(
        "UNAVAILABLE",
        `Resource source race: quarantined inode does not match the captured identity (moved bytes preserved at ${tombstone} for manual recovery); recovery required: ${label}`,
      );
    }
    const after = await handle.stat();
    if (after.nlink !== 1) {
      throw new DomainError(
        "UNAVAILABLE",
        `Resource source nlink drifted during quarantine (${after.nlink}); recovery required: ${label}`,
      );
    }
    await syncDir(quarantineRoot).catch(() => undefined);
  } finally {
    await handle.close().catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// [2] Manager-owned move 备份事实（Codex R7 P1-5）
// ---------------------------------------------------------------------------

/** backup manifest 行：ref 与 seq、来源路径、hash、字节量一一绑定。 */
export interface BackupManifestEntry {
  ref: string;
  seq: number;
  from: string;
  sha256: string;
  byteSize: number;
}

/**
 * Codex R6 P1-2：backup 根目录——由 canonical journalPath 派生（`<journal>.backups`），
 * 每次使用前校验 canonical containment（预置/换体 symlink 直接拒绝）。
 */
export async function prepareBackupRoot(journalPath: string): Promise<string> {
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

/**
 * 写一份 move 备份并登记 manifest：先备份字节（exclusive fd + fsync）+ 目录 fsync，
 * 再追加 manifest 行 + fsync。manifest 未落盘的备份不可能被 journal 引用成功——
 * journal 记账发生在两者之后。
 */
export async function writeBackupWithManifest(options: {
  journalPath: string;
  ref: string;
  seq: number;
  from: string;
  bytes: Buffer;
}): Promise<void> {
  const { ref, seq, from, bytes } = options;
  const parsedRef = BackupRefSchema.parse(ref);
  const root = await prepareBackupRoot(options.journalPath);
  await writeFileExclusiveVerified(path.join(root, parsedRef), root, bytes, `backup:${parsedRef}`);
  await syncDir(root);
  // Codex R8 独立探针整改：manifest leaf 用 O_NOFOLLOW 追加——预置 symlink 直连
  // 外部文件时 open 失败（ELOOP），manager 字节不越界落地。
  const manifestHandle = await fs.open(
    path.join(root, "manifest.jsonl"),
    fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT | O_NOFOLLOW,
    0o600,
  );
  // Codex R8 P1-2：打开后立即确认 leaf 是 regular file（预置 FIFO/socket 等
  // 非常规 leaf 一律拒绝，append 字节只落 Manager-owned regular 文件）。
  if (!(await manifestHandle.stat()).isFile()) {
    await manifestHandle.close().catch(() => undefined);
    throw new Error(`backup manifest is not a regular file: ${path.join(root, "manifest.jsonl")}`);
  }
  try {
    const line = `${JSON.stringify({
      ref: parsedRef,
      seq,
      from,
      sha256: sha256Hex(bytes),
      byteSize: bytes.byteLength,
    })}\n`;
    await manifestHandle.write(line, null, "utf8");
    await manifestHandle.sync();
  } finally {
    await manifestHandle.close().catch(() => undefined);
  }
  await syncDir(root);
}

/**
 * 读取备份 manifest（严格）：坏行/字段不符 → Error（调用方转 recovery-required）；
 * 重复 ref → Error。备份根换体由 prepareBackupRoot 拒绝。
 */
export async function readBackupManifest(journalPath: string): Promise<BackupManifestEntry[]> {
  const root = await prepareBackupRoot(journalPath);
  const manifestPath = path.join(root, "manifest.jsonl");
  let raw: string;
  try {
    // Codex R8 P1-2：读取同样走 O_NOFOLLOW fd——symlink leaf（即便指向同根文件）
    // 不是 Manager 持有的事实文件；非常规 leaf 直接拒绝。
    const handle = await fs.open(manifestPath, fs.constants.O_RDONLY | O_NOFOLLOW);
    try {
      if (!(await handle.stat()).isFile()) {
        throw new Error(`backup manifest is not a regular file: ${manifestPath}`);
      }
      raw = await handle.readFile("utf8");
    } finally {
      await handle.close().catch(() => undefined);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error instanceof Error
      ? error
      : new Error(`backup manifest unreadable: ${manifestPath} (${String(error)})`);
  }
  const entries: BackupManifestEntry[] = [];
  const seenRefs = new Set<string>();
  const lines = raw.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index]!.trim();
    if (!trimmed) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new Error(`backup manifest line ${index + 1} is corrupt`);
    }
    const ref =
      typeof (parsed as { ref?: unknown }).ref === "string" ? (parsed as { ref: string }).ref : "";
    const seq = (parsed as { seq?: unknown }).seq;
    const from = (parsed as { from?: unknown }).from;
    const sha256 = (parsed as { sha256?: unknown }).sha256;
    const byteSize = (parsed as { byteSize?: unknown }).byteSize;
    const refOk = BackupRefSchema.safeParse(ref).success;
    if (
      !refOk ||
      typeof seq !== "number" ||
      !Number.isInteger(seq) ||
      seq <= 0 ||
      typeof from !== "string" ||
      from.length === 0 ||
      typeof sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(sha256) ||
      typeof byteSize !== "number" ||
      !Number.isInteger(byteSize) ||
      byteSize < 0
    ) {
      throw new Error(`backup manifest line ${index + 1} failed validation`);
    }
    if (seenRefs.has(ref)) {
      throw new Error(`backup manifest contains duplicate ref: ${ref}`);
    }
    seenRefs.add(ref);
    entries.push({ ref, seq, from, sha256, byteSize });
  }
  return entries;
}

/**
 * 按 journal 事实（ref + seq + from + sha256）精确定位 manifest 条目；缺失、重复、
 * 归属不符一律 Error——回放数据不能把任意同根字节恢复进 Provider。
 */
export function findBackupEntry(
  manifest: BackupManifestEntry[],
  expected: { ref: string; seq: number; from: string; sha256: string },
): BackupManifestEntry {
  const matches = manifest.filter((entry) => entry.ref === expected.ref);
  if (matches.length === 0) {
    throw new Error(
      `backup manifest has no entry for ref ${expected.ref} (step ${expected.seq}); recovery required`,
    );
  }
  const entry = matches[0]!;
  if (
    entry.seq !== expected.seq ||
    entry.from !== expected.from ||
    entry.sha256 !== expected.sha256
  ) {
    throw new Error(
      `backup manifest entry ${expected.ref} does not match journal facts (seq/from/sha); recovery required`,
    );
  }
  return entry;
}

/**
 * Codex R8 独立探针整改：journal ↔ manifest 双射校验。
 * seq 连续性挡不住「删除 resource 行后整体重编号」的部分 journal——move 备份的
 * manifest（ref/seq/from）是 Manager 在写入时持久化的独立事实，回放前要求：
 * 每条 manifest 记录恰好对应一条 journal move 步骤（ref+seq+from 全等），反之亦然。
 * 任何一侧缺失、多余或重复 = journal 被篡改/截断 → typed 拒绝（recovery-required）。
 */
export function assertJournalManifestBijection(
  entries: JournalEntry[],
  manifest: BackupManifestEntry[],
): void {
  const moveSteps = entries.filter(
    (entry): entry is JournalEntry & { step: "resource" } =>
      entry.step === "resource" && entry.detail.strategy === "move",
  );
  const bySeq = new Map(manifest.map((entry) => [entry.seq, entry]));
  if (bySeq.size !== manifest.length) {
    throw new Error("backup manifest contains duplicate seq records; recovery required");
  }
  const seenRefs = new Set<string>();
  for (const step of moveSteps) {
    const bound = bySeq.get(step.seq);
    if (
      bound === undefined ||
      bound.ref !== step.detail.backupRef ||
      bound.from !== step.detail.from
    ) {
      throw new Error(
        `journal move step ${step.seq} has no exact manifest record; recovery required`,
      );
    }
    if (seenRefs.has(bound.ref)) {
      throw new Error(`journal references backup ref twice: ${bound.ref}; recovery required`);
    }
    seenRefs.add(bound.ref);
  }
  if (seenRefs.size !== manifest.length) {
    throw new Error(
      `journal has ${seenRefs.size} move steps but manifest records ${manifest.length} backups (renumbered or deleted journal lines); recovery required`,
    );
  }
}
