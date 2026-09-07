/**
 * Manager 目录身份原语（Codex R10 P1-1/P1-4）。
 *
 * 用户原始需求 [2026-09-06]（transaction-contract.md）：「每步记账并持久化，再推进
 * 下一步」「外部修改或 I/O 错误进入 recovery-required」。
 * Codex R10 复核：root/parent 的 inode 身份必须跨操作持有并在 IO 前后复验——
 * 同 lexical 路径的目录换体不能只在写后「检测到」，更不能在读取侧免检。
 *
 * 正交意图：
 *   [1] canonical 目录断言：lstat 真实目录 + realpath 全等（darwin /var 系统豁免）。
 *   [2] {dev,ino} 身份捕获与复验：检测同路径目录换体。
 * 独立成模块的原因：journal-schema 与 fs-authority 都需要，互相 import 会成环。
 */
import { promises as fs } from "node:fs";
import { DomainError } from "../domain-error.js";

/** 目录身份（dev/ino 绑定，检测同 lexical 路径的目录换体）。 */
export interface DirIdentity {
  dev: number;
  ino: number;
}

/** darwin 系统级 symlink 根：给定路径在这些根下时返回 /private 归一形式。 */
function darwinSystemAlias(dir: string): string | null {
  if (process.platform !== "darwin") return null;
  for (const root of ["/var", "/tmp", "/etc"]) {
    if (dir === root || dir.startsWith(`${root}/`)) return `/private${dir}`;
  }
  return null;
}

/**
 * root 必须是 Manager 持有的 canonical 目录：lstat 为真实目录（非 symlink），
 * 且 realpath(root) 与 root 全等。豁免：darwin 的系统级 symlink 根前缀
 * （/var → /private/var、/tmp → /private/tmp、/etc → /private/etc；
 * mkdtemp 沙箱与 /tmp 短路径 sandbox（IPC sun_path 限制）天然携带；非攻击面
 * ——realpath 归一后的 inode 身份仍是后续 anchor/verify 的事实源）。
 * 返回 {dev,ino} 身份。
 */
export async function assertCanonicalDirectory(dir: string): Promise<DirIdentity> {
  const stat = await fs.lstat(dir).catch(() => null);
  if (stat === null || !stat.isDirectory() || stat.isSymbolicLink()) {
    throw new DomainError(
      "INVALID_OPERATION",
      `manager root is not a real directory (symlinked or missing): ${dir}`,
    );
  }
  const real = await fs.realpath(dir);
  const darwinAlias = darwinSystemAlias(dir);
  if (real !== dir && real !== darwinAlias) {
    throw new DomainError(
      "INVALID_OPERATION",
      `manager root is not canonical (realpath ${real} differs from the given root): ${dir}`,
    );
  }
  return { dev: stat.dev, ino: stat.ino };
}

/** 复验目录身份：同 lexical 路径上的任何换体（rename 顶替）都会使 inode 失配。 */
export async function verifyDirIdentity(dir: string, identity: DirIdentity): Promise<void> {
  const stat = await fs.lstat(dir).catch(() => null);
  if (
    stat === null ||
    !stat.isDirectory() ||
    stat.dev !== identity.dev ||
    stat.ino !== identity.ino
  ) {
    throw new DomainError(
      "UNAVAILABLE",
      `manager directory identity drifted (path race or replacement); recovery required: ${dir}`,
    );
  }
}
