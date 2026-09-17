/**
 * 用户原始需求 [2026-09-18]：「skill 索引应该是文件夹里的 md 文件（中间档）……
 * 一些特殊的文件夹名称不该索引（node_modules/.git/build/dist 等），由专门配置
 * 文件处理。」
 * 正交意图：
 * 1. 单一意图收集器：skill canonical 目录内的额外 *.md（身份/结构仍属 SKILL.md）。
 * 2. 冻结收集边界：真实目录递归深度 ≤4、dot 目录与排除目录不进、文档级 symlink
 *    一律拒绝（lstat regular file）、≤32 文件、路径排序确定性。
 */
import fs from "node:fs";
import path from "node:path";

/**
 * 内置排除目录名（代码冻结；收集器在调用方追加项之上并集生效——配置只能加
 * 不能减）。dot 目录全跳是收集器的独立规则（不在此列，不可配置关闭）。
 */
export const BUILTIN_EXCLUDED_DIRS: readonly string[] = [
  "node_modules",
  "build",
  "dist",
  "target",
  "__pycache__",
  "tmp",
  "logs",
];

/** 额外 md 递归深度上限（canonical 目录自身为 0 层）。 */
const MAX_DEPTH = 4;
/** 每技能额外 md 文件数上限。 */
const MAX_FILES = 32;

/** 收集产物：无内容读取的文件身份（四元组；正文在读取阶段才进）。 */
export interface SkillContentFile {
  path: string;
  mtimeMs: number;
  size: number;
  ino: number;
  ctimeMs: number;
}

/** 身份源文件名（大小写不敏感排除，避免 Guide/SKILL.MD 类变体重复进正文）。 */
const IDENTITY_FILE_NAMES = new Set(["skill.md", ".skill.md"]);

/**
 * 收集 canonical skill 目录内的额外 markdown 文件（不含身份源）。排除集 =
 * 内置清单 ∪ excludedDirs（追加语义）；输出按路径排序确定性；目录读取失败
 * 静默返回已收集部分（canonical 目录的瞬时状态是合法环境状态，freshen 的
 * 身份校验兜底）。
 */
export function collectExtraMarkdownFiles(
  canonicalPath: string,
  excludedDirs: ReadonlySet<string> = new Set(),
): SkillContentFile[] {
  const effective = new Set<string>([...BUILTIN_EXCLUDED_DIRS, ...excludedDirs]);
  const files: SkillContentFile[] = [];
  collectDirectory(canonicalPath, 0, effective, files);
  files.sort((left, right) => compareString(left.path, right.path));
  return files.slice(0, MAX_FILES);
}

function collectDirectory(
  directory: string,
  depth: number,
  excludedDirs: ReadonlySet<string>,
  files: SkillContentFile[],
): void {
  if (depth > MAX_DEPTH || files.length >= MAX_FILES) return;
  let dirents: fs.Dirent[];
  try {
    dirents = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }
  dirents.sort((left, right) => compareString(left.name, right.name));
  for (const dirent of dirents) {
    if (files.length >= MAX_FILES) return;
    if (dirent.name.startsWith(".") || excludedDirs.has(dirent.name)) {
      // dot 目录/文件全跳（.git/.SKILL.md 等不在收集面）；排除目录按名匹配。
      continue;
    }
    const entryPath = path.join(directory, dirent.name);
    if (dirent.isDirectory()) {
      // 递归只走真实目录：symlink 目录不进（防环、防逃逸，与 scanner 同纪律）。
      collectDirectory(entryPath, depth + 1, excludedDirs, files);
      continue;
    }
    if (!dirent.isFile()) continue;
    if (!dirent.name.toLowerCase().endsWith(".md")) continue;
    if (IDENTITY_FILE_NAMES.has(dirent.name.toLowerCase())) continue;
    // 文档级 symlink 一律拒绝：lstat（不跟进）确认 regular file。
    if (!isRegularFile(entryPath)) continue;
    let stat: fs.Stats;
    try {
      stat = fs.statSync(entryPath);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    files.push({
      path: entryPath,
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      ino: stat.ino,
      ctimeMs: stat.ctimeMs,
    });
  }
}

function isRegularFile(file: string): boolean {
  try {
    return fs.lstatSync(file).isFile();
  } catch {
    return false;
  }
}

function compareString(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
