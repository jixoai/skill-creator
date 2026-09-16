/**
 * 用户原始需求 [2026-09-17]：「扫描器枚举 Global Workspace 的全部 catalog provider roots
 * 与每个 Imported Workspace 的 provider roots；broken symlink 静默跳过；真实子目录递归
 * 深度 ≤2 且递归不跟进 symlink；`.` 开头目录与 node_modules 跳过。」
 * 正交意图：
 * 1. 以 server 侧 SkillRoot（rootPath + workspaceId + providerId）枚举候选入口。
 * 2. 冻结扫描边界：入口层 symlink 跟进、递归层只走真实目录、深度 ≤2、跳过 dot/node_modules。
 *
 * 妥协声明：不复用 ccski discovery——其 `entry.isDirectory()` 不跟进 symlink，与本任务
 * 的 symlink 多安装场景冲突；scanner 只产出候选路径，frontmatter 解析复用 gray-matter。
 */
import fs from "node:fs";
import path from "node:path";
import type { ProviderId, WorkspaceId } from "../../shared/contracts/workspaces.js";

/** 一个 server 侧 provider root（生产装配来自 catalog + workspace 持久态；测试可注入沙箱）。 */
export interface SkillRoot {
  rootPath: string;
  workspaceId: WorkspaceId;
  providerId: ProviderId;
}

/** 一个候选技能入口（尚未 realpath 去重；含所属 root 作用域）。 */
export interface SkillCandidateEntry {
  /** 入口原始绝对路径（可能是指向 canonical 目录的 symlink）。 */
  path: string;
  workspaceId: WorkspaceId;
  providerId: ProviderId;
}

/** 真实子目录递归深度上限（root 直接子入口为第 1 层，覆盖 plugin/nested 布局）。 */
const MAX_DEPTH = 2;

const SKILL_FILE_NAMES = ["SKILL.md", ".SKILL.md"] as const;

/**
 * 枚举全部 roots 的候选入口。目录读取失败的 root 静默跳过（不存在/无权限的
 * provider root 是合法环境状态）；输出按路径排序保证确定性。
 */
export function scanSkillRoots(roots: readonly SkillRoot[]): SkillCandidateEntry[] {
  const entries: SkillCandidateEntry[] = [];
  for (const root of roots) {
    scanDirectory(root, root.rootPath, 1, entries);
  }
  entries.sort((left, right) =>
    left.path === right.path
      ? compareString(left.workspaceId, right.workspaceId) ||
        compareString(left.providerId, right.providerId)
      : compareString(left.path, right.path),
  );
  return entries;
}

function compareString(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** 扫描一层目录：depth 1 的目录/symlink 入口 statSync 跟进；depth 2 只访问真实子目录。 */
function scanDirectory(
  root: SkillRoot,
  directory: string,
  depth: number,
  entries: SkillCandidateEntry[],
): void {
  let dirents: fs.Dirent[];
  try {
    dirents = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    // root 不存在 / 不可读是合法环境状态；不可用 root 静默跳过。
    return;
  }
  dirents.sort((left, right) => compareString(left.name, right.name));
  for (const dirent of dirents) {
    if (dirent.name.startsWith(".") || dirent.name === "node_modules") continue;
    if (!dirent.isDirectory() && !dirent.isSymbolicLink()) continue;
    // 递归层不跟进 symlink（防环、防逃逸）：symlink 只在入口层（depth 1）解析。
    if (depth > 1 && !dirent.isDirectory()) continue;
    const entryPath = path.join(directory, dirent.name);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(entryPath);
    } catch {
      // broken symlink 静默跳过。
      continue;
    }
    if (!stat.isDirectory()) continue;
    if (hasSkillFile(entryPath)) {
      entries.push({ path: entryPath, workspaceId: root.workspaceId, providerId: root.providerId });
    }
    if (dirent.isDirectory() && depth < MAX_DEPTH) {
      scanDirectory(root, entryPath, depth + 1, entries);
    }
  }
}

function hasSkillFile(entryPath: string): boolean {
  return SKILL_FILE_NAMES.some((name) => fs.existsSync(path.join(entryPath, name)));
}
