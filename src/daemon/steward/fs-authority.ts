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
import { BackupManifestLineSchema, BackupRefSchema, type JournalEntry } from "./journal-schema.js";
import { assertCanonicalDirectory, verifyDirIdentity, type DirIdentity } from "./dir-identity.js";
import { anchorManagerDirectory } from "./store-anchor.js";
import { assertPathInside } from "../path-safety.js";

export { assertCanonicalDirectory, verifyDirIdentity };
export type { DirIdentity };

/** alias：Provider root 校验（与 Manager 事实目录同规则）。 */
export const assertRealRoot = assertCanonicalDirectory;

const O_NOFOLLOW = (fs.constants as { O_NOFOLLOW?: number }).O_NOFOLLOW ?? 0;

export function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
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

/**
 * Windows 目录 fsync 平台上限：libuv 的 O_DIRECTORY 句柄只读打开，而
 * FlushFileBuffers 要求 GENERIC_WRITE 句柄——win32 上目录 fsync 恒 EPERM，
 * 且无 libuv 可达的替代入口。NTFS 自带元数据日志，POSIX dir-fsync 的持久化
 * 语义在 Windows 无系统等价物；该 EPERM 是平台天花板，不是 I/O 故障。
 */
export function isDirSyncPlatformCeiling(error: unknown): boolean {
  return process.platform === "win32" && (error as NodeJS.ErrnoException)?.code === "EPERM";
}

/**
 * 目录 fsync（崩溃持久化栅栏；失败 = typed UNAVAILABLE，不静默放行）。
 * Windows 平台上限（isDirSyncPlatformCeiling）在此唯一边界归一化：栅栏取平台
 * 可达的最强形式（文件 fsync 仍逐字节强制），不逐调用点写平台分支。
 */
export async function syncDir(dir: string): Promise<void> {
  const handle = await fs
    .open(dir, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY)
    .catch((error) => {
      throw new DomainError(
        "UNAVAILABLE",
        `durability sync failed for ${dir} (${error instanceof Error ? error.message : String(error)}); recovery required`,
      );
    });
  try {
    await handle.sync();
  } catch (error) {
    if (isDirSyncPlatformCeiling(error)) return;
    throw new DomainError(
      "UNAVAILABLE",
      `durability sync failed for ${dir} (${error instanceof Error ? error.message : String(error)}); recovery required`,
    );
  } finally {
    await handle.close().catch(() => undefined);
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
 * Windows O_NOFOLLOW 缺口封堵（2026-09-25 Windows 测试债）：libuv 在 win32 不把
 * O_NOFOLLOW 映射为 OPEN_REPARSE_POINT——open 直接穿透 symlink，open 时拒绝的
 * 防线在该平台缺席。fd 锚定补位：lstat 在 win 上查询 reparse tag（S_IFLNK
 * 可靠），预置 symlink/目录在 open 前即拒绝；open 后由调用方以 fstat 身份
 * 全等复验换体。锚不存在（leaf 尚未创建）返回 null，交由 open 旗标与后续
 * 复验把关。
 */
async function anchorLeafForNoFollow(leaf: string, label: string): Promise<LeafIdentity | null> {
  const stat = await fs.lstat(leaf).catch(() => null);
  if (stat === null) return null;
  if (!stat.isFile()) {
    throw new Error(`${label} exists but is not a regular file (symlink or directory): ${leaf}`);
  }
  return { dev: stat.dev, ino: stat.ino, nlink: stat.nlink, size: stat.size };
}

/** fd ↔ 锚 身份全等复验（anchor 为 null 时只校验 regular file）。 */
async function assertFdMatchesAnchor(
  handle: import("node:fs/promises").FileHandle,
  anchor: LeafIdentity | null,
  label: string,
): Promise<import("node:fs").Stats> {
  const stat = await handle.stat();
  if (!stat.isFile()) {
    throw new Error(`${label} opened as a non-regular file; recovery required`);
  }
  if (anchor !== null && (stat.dev !== anchor.dev || stat.ino !== anchor.ino)) {
    throw new Error(
      `${label} identity drifted between validation and open (path race); recovery required`,
    );
  }
  return stat;
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
  assertPathInside(root, from);
  const rootIdentity = await assertRealRoot(root);
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
  await verifyDirIdentity(root, rootIdentity);
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
  assertPathInside(root, to);
  const rootIdentity = await assertRealRoot(root);
  const realRoot = await fs.realpath(root);
  const lexicalPosition = path.join(realRoot, path.relative(root, to));
  await assertNoSymlinkAncestors(to, root);
  // Codex R11 P1-1：nested parent 身份捕获（open 边界的真实目录换体防护——fd 锚定
  // inode，open 后复验身份通过即证明 fd 指向捕获时的目录树）。
  const parentIdentity = await assertCanonicalDirectory(path.dirname(to));
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
    // Codex R10/R11 P1-1：写前复验 root + nested parent 身份——fd 锚定 inode，
    // open→复验通过即证明后续 fd 写入只会落进捕获时验证过的目录树。
    await verifyDirIdentity(root, rootIdentity);
    await verifyDirIdentity(path.dirname(to), parentIdentity);
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
  await verifyDirIdentity(root, rootIdentity);
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
  // Codex R9 P1-2 / R10 P1-5：restore 全入口 root canonical + root 内 containment。
  assertPathInside(root, to);
  const rootIdentity = await assertRealRoot(root);
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
    await verifyDirIdentity(root, rootIdentity);
    return;
  }
  await writeFileExclusiveVerified(to, root, bytes, label);
  await verifyDirIdentity(root, rootIdentity);
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
  assertPathInside(root, leaf);
  const rootIdentity = await assertRealRoot(root);
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
    const quarantineIdentity = await assertCanonicalDirectory(quarantineRoot);
    const tombstone = path.join(
      quarantineRoot,
      `removed-${randomBytes(8).toString("hex")}-${path.basename(leaf)}`,
    );
    try {
      // Codex R11 P1-5：rename 前复验 provider root 身份——换体后的「外部源被成功
      // 隔离」不是 accepted，是 recovery。
      await verifyDirIdentity(root, rootIdentity);
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
    // Codex R10 P1-6：隔离 rename 的 durability barrier 失败必须中断（不吞）——
    // 未持久化的 rename 不得推进 journal/commit。
    await syncDir(quarantineRoot);
    await verifyDirIdentity(quarantineRoot, quarantineIdentity);
    await verifyDirIdentity(root, rootIdentity);
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
  // Codex R9 P1-1 / R13 P2-1：父目录（journal 所在目录）先 canonical + 首见锚定——
  // 预置 symlink 父目录拒绝；跨调用换体（进程内锚失配）同样 recovery。
  await fs.mkdir(path.dirname(journalPath), 0o700).catch(() => undefined);
  await anchorManagerDirectory(path.dirname(journalPath)).catch(() => {
    throw new DomainError(
      "UNAVAILABLE",
      `journal directory is not canonical (or was replaced during this daemon lifetime); recovery required: ${path.dirname(journalPath)}`,
    );
  });
  await fs.mkdir(backupDir, 0o700).catch(() => undefined);
  await anchorManagerDirectory(backupDir).catch(() => {
    throw new DomainError(
      "UNAVAILABLE",
      `move backup root is not a canonical manager directory (or was replaced); recovery required: ${backupDir}`,
    );
  });
  return backupDir;
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
  const rootIdentity = await assertCanonicalDirectory(root);
  await writeFileExclusiveVerified(path.join(root, parsedRef), root, bytes, `backup:${parsedRef}`);
  await syncDir(root);
  await verifyDirIdentity(root, rootIdentity);
  // Codex R8 独立探针整改：manifest leaf 用 O_NOFOLLOW 追加——预置 symlink 直连
  // 外部文件时 open 失败（ELOOP），manager 字节不越界落地。
  // Codex R10/R11 P1-1：manifest fd 打开（fd 锚定 inode），打开后、追加前复验
  // backup root 身份——open 边界的目录换体在字节落盘前拦截。
  // Windows O_NOFOLLOW 缺口：win32 不映射该旗标（open 穿透 symlink）——open 前
  // lstat 锚定 + open 后 fd 身份全等，预置/换体 symlink 同样 typed 拒绝。
  const manifestAnchor = await anchorLeafForNoFollow(
    path.join(root, "manifest.jsonl"),
    "backup manifest",
  );
  const manifestHandle = await fs.open(
    path.join(root, "manifest.jsonl"),
    fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT | O_NOFOLLOW,
    0o600,
  );
  await verifyDirIdentity(root, rootIdentity);
  try {
    // Codex R8 P1-2：打开后立即确认 leaf 是 regular file（预置 FIFO/socket 等
    // 非常规 leaf 一律拒绝，append 字节只落 Manager-owned regular 文件）；
    // fd ↔ 锚 身份全等复验（win32 O_NOFOLLOW 缺口的换体防线）。
    const manifestStat = await assertFdMatchesAnchor(
      manifestHandle,
      manifestAnchor,
      "backup manifest",
    );
    // Codex R9 P1-1：manifest 首次创建语义 + 独占 inode——hardlink 到外部文件的
    // manifest（nlink > 1）在打开即拒绝，追加字节不可能落进外部 inode。
    if (manifestStat.nlink !== 1) {
      throw new Error(
        `backup manifest is hardlinked (nlink=${manifestStat.nlink}); manager refuses to append: ${path.join(root, "manifest.jsonl")}`,
      );
    }
    const line = `${JSON.stringify({
      ref: parsedRef,
      seq,
      from,
      sha256: sha256Hex(bytes),
      byteSize: bytes.byteLength,
    })}\n`;
    await manifestHandle.write(line, null, "utf8");
    await manifestHandle.sync();
    // 写后复验：期间被 hardlink 出去（nlink 增长）同样拒绝。
    if ((await manifestHandle.stat()).nlink !== 1) {
      throw new Error(
        `backup manifest gained a hardlink during append; recovery required: ${path.join(root, "manifest.jsonl")}`,
      );
    }
  } finally {
    await manifestHandle.close().catch(() => undefined);
  }
  await syncDir(root);
  await verifyDirIdentity(root, rootIdentity);
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
    // Windows O_NOFOLLOW 缺口（2026-09-25）：win32 open 穿透 symlink——读取侧同样
    // lstat 锚定 + fd 身份全等 + 读后复验（对齐 readJournal 的漂移防线）。
    const anchor = await anchorLeafForNoFollow(manifestPath, "backup manifest");
    const handle = await fs.open(manifestPath, fs.constants.O_RDONLY | O_NOFOLLOW);
    try {
      await assertFdMatchesAnchor(handle, anchor, "backup manifest");
      raw = await handle.readFile("utf8");
      const after = await fs.lstat(manifestPath).catch(() => null);
      if (
        after === null ||
        !after.isFile() ||
        (anchor !== null && (after.dev !== anchor.dev || after.ino !== anchor.ino))
      ) {
        throw new Error(
          `backup manifest identity drifted after read (path race or symlink); recovery required: ${manifestPath}`,
        );
      }
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
    // Codex R13 P2-3：strict Zod 解析——未知字段、穿越 from、坏 hash/byteSize 拒绝。
    const checked = BackupManifestLineSchema.safeParse(parsed);
    if (!checked.success) {
      const reason = checked.error.issues
        .slice(0, 3)
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ");
      throw new Error(
        `backup manifest line ${index + 1} failed validation (${reason}); recovery required`,
      );
    }
    const { ref, seq, from, sha256, byteSize } = checked.data;
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
