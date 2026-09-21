/**
 * 用户原始需求 [2026-09-21]（jixoai-search-core 3.2）：「root 统一 ~/.skill-wiki/…
 * 存量 ~/.skill-creator/wiki/ 实体目录一次性 mv 过去并在原位建 symlink；若目标
 * 已存在且源非空 → typed 冲突拒绝（不覆盖，提示人工处理）」。
 * 正交意图：
 *   [1] 存量根迁移三态：legacy 实体目录 + 新根缺失 → mv + 原位 symlink；
 *       新根已存在 + legacy 非空 → DomainError CONFLICT；新根已存在 + legacy 空 →
 *       移除空 legacy 后建 symlink。幂等（legacy 已是 symlink = no-op）。
 * 妥协声明：symlink 兼容层在平台不支持（Windows 未提权 EPERM/EINVAL）时静默
 * 跳过——数据迁移（rename）先行完成，新根是唯一真相，旧路径仅为兼容可达。
 */
import fs from "node:fs";
import path from "node:path";
import { DomainError } from "./domain-error.js";

/** 迁移冲突的 typed 拒绝消息前缀（提示人工处理）。 */
const CONFLICT_HINT =
  "Refusing to overwrite: resolve manually (merge one side, remove the other, then retry).";

function lstatOrNull(target: string): fs.Stats | null {
  try {
    return fs.lstatSync(target);
  } catch {
    return null;
  }
}

/** 目录内容非空判定（ENOENT 视为空）。 */
function directoryNonEmpty(directory: string): boolean {
  try {
    return fs.readdirSync(directory).length > 0;
  } catch {
    return false;
  }
}

/** 原位建兼容 symlink：<legacyDir> → <rootDir>；平台不支持时静默跳过。 */
function ensureLegacySymlink(rootDir: string, legacyDir: string): void {
  try {
    fs.mkdirSync(path.dirname(legacyDir), { recursive: true });
    fs.symlinkSync(rootDir, legacyDir, "dir");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EEXIST") return;
    if (code === "EPERM" || code === "EINVAL" || code === "ENOTSUP") return;
    throw error;
  }
}

/**
 * 一次性存量迁移（幂等，可安全重复调用）：
 * - legacy 不存在 → 仅确保 symlink（spec：宿主以 symlink 衔接两根）。
 * - legacy 已是 symlink → no-op。
 * - legacy 是实体目录且 rootDir 不存在 → rename mv + 原位 symlink。
 * - legacy 是实体目录且 rootDir 已存在：legacy 空 → 移除后建 symlink；
 *   legacy 非空 → typed CONFLICT（不覆盖，不删除任何一边）。
 * - legacy 是其他文件类型（普通文件等）→ typed CONFLICT。
 */
export function migrateLegacyWikiRoot(rootDir: string, legacyDir: string): void {
  const legacyStat = lstatOrNull(legacyDir);
  if (legacyStat === null) {
    // 无存量可迁：确保统一根存在后仅建兼容 symlink（宿主与 CLI 同根衔接）。
    fs.mkdirSync(rootDir, { recursive: true });
    ensureLegacySymlink(rootDir, legacyDir);
    return;
  }
  if (legacyStat.isSymbolicLink()) return; // 幂等：已迁移。
  if (!legacyStat.isDirectory()) {
    throw new DomainError(
      "CONFLICT",
      `Legacy wiki path is not a directory: ${legacyDir}. ${CONFLICT_HINT}`,
    );
  }

  const rootStat = lstatOrNull(rootDir);
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
