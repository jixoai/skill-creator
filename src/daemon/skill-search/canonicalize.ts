/**
 * 用户原始需求 [2026-09-17]：「候选经 realpathSync 归并为 canonicalPath；同一 canonicalPath
 * 的多个入口合并为一个索引文档；双文件冲突 SKILL.md 优先；contentHash 恒为实际被索引文件字节。」
 * 修订 [2026-09-18]（search-robustness）：实际被索引文件升级为「身份源 + 额外 md
 * 文件集」——stat 快照随之升级为逐文件四元组列表（freshen 增量按文件集判定）。
 * 正交意图：
 * 1. realpath 去重并以 opaquePathId("sk", canonical) 签发与 skills.list 一致的稳定 id。
 * 2. installations 分组（{path, workspaceId, providerId} 三元组去重）。
 * 3. 双文件规则与文件集 stat 快照（身份源 + 额外 md，无内容读取）。
 */
import fs from "node:fs";
import path from "node:path";
import { SkillIdSchema, type SkillId } from "../../shared/contracts/skills.js";
import type { SkillInstallation } from "../../shared/contracts/search.js";
import { opaquePathId } from "../path-safety.js";
import { collectExtraMarkdownFiles, type SkillContentFile } from "./content-files.js";
import type { SkillCandidateEntry } from "./scanner.js";

/** 实际被索引的技能文档文件（双文件规则产物）。 */
export type SkillSourceFile = "SKILL.md" | ".SKILL.md";

/** 一个 canonical skill 的扫描结果（去重分组 + 内容源选择 + 文件集 stat 快照）。 */
export interface CanonicalSkillScan {
  id: SkillId;
  canonicalPath: string;
  installations: SkillInstallation[];
  sourceFile: SkillSourceFile;
  /** canonicalPath 下实际被索引的身份源文件绝对路径。 */
  sourcePath: string;
  /** 仅 .SKILL.md 在场。 */
  disabled: boolean;
  /** SKILL.md 与 .SKILL.md 并存（内容源取 SKILL.md）。 */
  conflict: boolean;
  /** 实际被索引文件集（身份源在前 + 额外 md，路径序确定；无内容读取的 stat 快照）。 */
  files: SkillContentFile[];
}

/**
 * 把候选入口归并为 canonical 分组。额外 md 收集的排除集 = 内置清单 ∪
 * excludedDirs（内置并集在收集器内生效，配置只能追加）。realpath 失败或内容源
 * 消失的入口跳过；输出按 canonicalPath 排序保证确定性。
 */
export function canonicalizeCandidates(
  entries: readonly SkillCandidateEntry[],
  excludedDirs: ReadonlySet<string> = new Set(),
): CanonicalSkillScan[] {
  const groups = new Map<string, { installations: SkillInstallation[] }>();
  for (const entry of entries) {
    let canonicalPath: string;
    try {
      canonicalPath = fs.realpathSync(entry.path);
    } catch {
      continue;
    }
    const installation: SkillInstallation = {
      path: entry.path,
      workspaceId: entry.workspaceId,
      providerId: entry.providerId,
    };
    const group = groups.get(canonicalPath) ?? { installations: [] };
    const exists = group.installations.some(
      (candidate) =>
        candidate.path === installation.path &&
        candidate.workspaceId === installation.workspaceId &&
        candidate.providerId === installation.providerId,
    );
    if (!exists) group.installations.push(installation);
    groups.set(canonicalPath, group);
  }

  const scans: CanonicalSkillScan[] = [];
  for (const [canonicalPath, group] of groups) {
    const source = selectSourceFile(canonicalPath);
    if (!source) continue;
    let sourceStat: fs.Stats;
    try {
      sourceStat = fs.statSync(source.sourcePath);
    } catch {
      continue;
    }
    const extras = collectExtraMarkdownFiles(canonicalPath, excludedDirs);
    // 信封 stat 快照：全路径升序（复审 P2——source-first 是 hash 的拼接序，
    // 与 stat 快照序是两个已冻结序列；读取按 sourcePath 定位身份源）。
    const files: SkillContentFile[] = [
      {
        path: source.sourcePath,
        mtimeMs: sourceStat.mtimeMs,
        size: sourceStat.size,
        ino: sourceStat.ino,
        ctimeMs: sourceStat.ctimeMs,
      },
      ...extras,
    ].sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
    scans.push({
      id: SkillIdSchema.parse(opaquePathId("sk", canonicalPath)),
      canonicalPath,
      installations: group.installations.sort((left, right) =>
        compareString(left.path, right.path),
      ),
      sourceFile: source.sourceFile,
      sourcePath: source.sourcePath,
      disabled: source.disabled,
      conflict: source.conflict,
      files,
    });
  }
  scans.sort((left, right) => compareString(left.canonicalPath, right.canonicalPath));
  return scans;
}

/** 双文件规则（冻结）：SKILL.md 优先 + conflict；仅 .SKILL.md → disabled；两者皆无 → 非候选。 */
function selectSourceFile(canonicalPath: string): {
  sourceFile: SkillSourceFile;
  sourcePath: string;
  disabled: boolean;
  conflict: boolean;
} | null {
  const enabled = path.join(canonicalPath, "SKILL.md");
  const disabledFile = path.join(canonicalPath, ".SKILL.md");
  // regular file 检查：名为 SKILL.md 的目录不是内容源（readFileSync 会 EISDIR）。
  const hasEnabled = isRegularFile(enabled);
  const hasDisabled = isRegularFile(disabledFile);
  if (hasEnabled) {
    return { sourceFile: "SKILL.md", sourcePath: enabled, disabled: false, conflict: hasDisabled };
  }
  if (hasDisabled) {
    return { sourceFile: ".SKILL.md", sourcePath: disabledFile, disabled: true, conflict: false };
  }
  return null;
}

function compareString(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** lstatSync（不跟进文档级 symlink）确认为 regular file；入口层目录 symlink 不受影响。 */
function isRegularFile(file: string): boolean {
  try {
    return fs.lstatSync(file).isFile();
  } catch {
    return false;
  }
}
