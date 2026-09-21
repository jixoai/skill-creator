/**
 * 用户原始需求 [2026-09-21]（jixoai-search-core 3.2）：「root 统一 ~/.skill-wiki/…
 * 存量 ~/.skill-creator/wiki/ 实体目录一次性 mv 过去并在原位建 symlink；若目标
 * 已存在且源非空 → typed 冲突拒绝（不覆盖，提示人工处理）」。
 * 修订 [2026-09-21]（终审 P2-1 收紧）：仅 ENOENT 视为缺失，其余 lstat/readdir
 * 异常 typed UNAVAILABLE；已有 symlink 必须 realpath 校验指向 rootDir（broken/
 * 错误目标 → typed CONFLICT，不静默 no-op）；EEXIST 时校验而非放过。
 * 正交意图：
 *   [1] 存量根迁移三态：legacy 实体目录 + 新根缺失 → mv + 原位 symlink；
 *       新根已存在 + legacy 非空 → DomainError CONFLICT；新根已存在 + legacy 空 →
 *       移除空 legacy 后建 symlink。幂等（legacy 已是**指向 rootDir** 的
 *       symlink = no-op）。
 * 妥协声明：symlink 兼容层在平台不支持（Windows 未提权 EPERM/EINVAL/ENOTSUP）
 *   时静默跳过——数据迁移（rename）先行完成，新根是唯一真相，旧路径仅为兼容
 *   可达。
 */
import fs from "node:fs";
import path from "node:path";
import { DomainError } from "./domain-error.js";

/** 迁移冲突的 typed 拒绝消息前缀（提示人工处理）。 */
const CONFLICT_HINT =
  "Refusing to overwrite: resolve manually (merge one side, remove the other, then retry).";

function isENOENT(error: unknown): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** lstat 三态：ENOENT → null；其余 IO 故障 typed UNAVAILABLE（不降级为缺失）。 */
function lstatOrMissing(target: string): fs.Stats | null {
  try {
    return fs.lstatSync(target);
  } catch (error) {
    if (isENOENT(error)) return null;
    throw new DomainError(
      "UNAVAILABLE",
      `Cannot inspect the wiki migration path ${target}: ${errorMessage(error)}`,
      { cause: error },
    );
  }
}

/** 目录内容非空判定（ENOENT 视为空；权限/IO 故障 typed UNAVAILABLE）。 */
function directoryNonEmpty(directory: string): boolean {
  try {
    return fs.readdirSync(directory).length > 0;
  } catch (error) {
    if (isENOENT(error)) return false;
    throw new DomainError(
      "UNAVAILABLE",
      `Cannot list the legacy wiki directory ${directory}: ${errorMessage(error)}`,
      { cause: error },
    );
  }
}

/**
 * 已有 symlink 的目标校验：realpath(legacyDir) 必须等于 realpath(rootDir)——
 * broken（目标不可达）或指向错误目录 → typed CONFLICT（提示人工处理）。
 */
function verifyLegacySymlink(rootDir: string, legacyDir: string): void {
  let rootReal: string;
  try {
    rootReal = fs.realpathSync(rootDir);
  } catch (error) {
    throw new DomainError(
      "CONFLICT",
      `Wiki root is unreachable through the legacy symlink ${legacyDir}: ${errorMessage(error)}. ${CONFLICT_HINT}`,
      { cause: error },
    );
  }
  let legacyReal: string;
  try {
    legacyReal = fs.realpathSync(legacyDir);
  } catch (error) {
    throw new DomainError(
      "CONFLICT",
      `Legacy wiki symlink is broken: ${legacyDir}: ${errorMessage(error)}. ${CONFLICT_HINT}`,
      { cause: error },
    );
  }
  if (legacyReal !== rootReal) {
    throw new DomainError(
      "CONFLICT",
      `Legacy wiki symlink points to ${legacyReal}, expected ${rootReal}. ${CONFLICT_HINT}`,
    );
  }
}

/** 原位建兼容 symlink：<legacyDir> → <rootDir>；平台不支持时静默跳过。 */
function ensureLegacySymlink(rootDir: string, legacyDir: string): void {
  try {
    fs.mkdirSync(path.dirname(legacyDir), { recursive: true });
    fs.symlinkSync(rootDir, legacyDir, "dir");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EEXIST") {
      // 已有条目必须经校验：指向 rootDir 的 symlink = 已迁移（no-op）；其余
      // （broken/错误目标 symlink、普通文件/目录）→ typed CONFLICT。
      const existing = lstatOrMissing(legacyDir);
      if (existing !== null && existing.isSymbolicLink()) {
        verifyLegacySymlink(rootDir, legacyDir);
        return;
      }
      throw new DomainError(
        "CONFLICT",
        `Legacy wiki path exists and is not the compat symlink: ${legacyDir}. ${CONFLICT_HINT}`,
      );
    }
    if (code === "EPERM" || code === "EINVAL" || code === "ENOTSUP") return;
    throw error;
  }
}

/**
 * 一次性存量迁移（幂等，可安全重复调用）：
 * - legacy 不存在 → 仅确保 symlink（spec：宿主以 symlink 衔接两根）。
 * - legacy 已是 symlink → realpath 校验指向 rootDir（幂等 no-op；异常指向
 *   typed CONFLICT）。
 * - legacy 是实体目录且 rootDir 不存在 → rename mv + 原位 symlink。
 * - legacy 是实体目录且 rootDir 已存在：legacy 空 → 移除后建 symlink；
 *   legacy 非空 → typed CONFLICT（不覆盖，不删除任何一边）。
 * - legacy 是其他文件类型（普通文件等）→ typed CONFLICT。
 */
export function migrateLegacyWikiRoot(rootDir: string, legacyDir: string): void {
  const legacyStat = lstatOrMissing(legacyDir);
  if (legacyStat === null) {
    // 无存量可迁：确保统一根存在后仅建兼容 symlink（宿主与 CLI 同根衔接）。
    fs.mkdirSync(rootDir, { recursive: true });
    ensureLegacySymlink(rootDir, legacyDir);
    return;
  }
  if (legacyStat.isSymbolicLink()) {
    // 幂等：已迁移——但必须验证指向（broken/错误目标不静默放行）。
    verifyLegacySymlink(rootDir, legacyDir);
    return;
  }
  if (!legacyStat.isDirectory()) {
    throw new DomainError(
      "CONFLICT",
      `Legacy wiki path is not a directory: ${legacyDir}. ${CONFLICT_HINT}`,
    );
  }

  const rootStat = lstatOrMissing(rootDir);
  if (rootStat === null) {
    fs.mkdirSync(path.dirname(rootDir), { recursive: true });
    fs.renameSync(legacyDir, rootDir);
    ensureLegacySymlink(rootDir, legacyDir);
    return;
  }
  if (!rootStat.isDirectory()) {
    throw new DomainError(
      "CONFLICT",
      `Wiki root exists but is not a directory: ${rootDir}. ${CONFLICT_HINT}`,
    );
  }
  if (directoryNonEmpty(legacyDir)) {
    throw new DomainError(
      "CONFLICT",
      `Both wiki roots hold data: ${legacyDir} and ${rootDir}. ${CONFLICT_HINT}`,
    );
  }
  fs.rmdirSync(legacyDir);
  ensureLegacySymlink(rootDir, legacyDir);
}
