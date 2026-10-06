/**
 * 用户原始需求 [2026-10-06]（skills-tabs-redesign 批 3，design.md Δ2 定稿）：
 * 「skills.files / skills.fileRead——每次调用重新解析（不信任先前 files 列表）；
 * lstat 拒文档级 symlink + O_NOFOLLOW fd + fstat 身份校验（防 enumerate↔read
 * 间 TOCTOU 换体）；相对路径拒绝绝对/`..`/NUL/反斜杠；预算 4 深/300 项/树
 * 64KB/单文件 256KiB 超限截断；二进制 typed 拒读（检测在有界读取内完成）；
 * conflict 双文件都列、非激活份标 disabled；symlink 三层策略」。
 *
 * 正交意图：
 *   [1] skills.files：有界文件树枚举（前序 DFS、目录优先组内字典序、预算截断
 *       带内 typed 原因、conflict 双身份文件标记、symlink/broken 省略）。
 *   [2] skills.fileRead：TOCTOU 防线文件读（lstat 逐级验证捕获身份 → O_NOFOLLOW
 *       fd → fstat 身份全等复验 → 有界读取内二进制检测 → 256KiB 截断）。
 *   [3] 路径闭包校验：`/` 分隔相对路径的规范化歧义拒绝（typed INVALID_PATH）。
 *
 * 安全基线对齐（AGENTS §5）：不弱于搜索面 SKILL.md 读取的 lstat + O_NOFOLLOW +
 * fstat 身份校验；顶层技能目录 symlink 允许（入口层跟进一次，与
 * ccski-symlink-entries 先例一致——本模块收到的 root 已是发现层 realpath 产物），
 * 子目录/文件 symlink 拒绝，broken link 同为可解释省略/拒绝。
 */
import fs from "node:fs";
import path from "node:path";
import type { SkillFileEntry, SkillFilesResult } from "../shared/contracts/skill-files.js";
import type { SkillFileReadResult } from "../shared/contracts/skill-files.js";
import { DomainError } from "./domain-error.js";

/** 目录遍历深度上限（root 直接子项为第 1 层；深度 4 的目录列出但不下降）。 */
const MAX_TREE_DEPTH = 4;
/** 文件树条目数上限。 */
const MAX_TREE_ENTRIES = 300;
/** 文件树响应字节预算（entries JSON 序列化后）。 */
const MAX_TREE_BYTES = 64 * 1024;
/** 单文件读取字节预算（超限返回前 256KiB + truncated）。 */
const MAX_FILE_BYTES = 256 * 1024;

/** Windows 无 O_NOFOLLOW 时退化为 0（身份复验仍由 fstat 全等承担）。 */
const O_NOFOLLOW = (fs.constants as { O_NOFOLLOW?: number }).O_NOFOLLOW ?? 0;

/** 树枚举产物（含截断事实；truncationReason 由调用方按截断标志给出）。 */
interface TreeWalk {
  entries: SkillFileEntry[];
  truncated: boolean;
}

/**
 * skills.files：有界文件树。root 必须是已解析技能目录（发现层 realpath 产物，
 * 顶层 symlink 已跟进一次）；每次调用现场枚举，不消费任何先前列表。
 */
export function listSkillFiles(root: string, options: { disabled: boolean }): SkillFilesResult {
  const realRoot = resolveRoot(root);
  const walk = walkTree(realRoot, options.disabled);
  // 响应字节预算：条目数预算内仍可能超 64KB——按序弹出尾部条目（最深/最后）
  // 直到入限；弹出即截断（typed TOO_LARGE，不静默丢）。
  let truncated = walk.truncated;
  const output = { entries: walk.entries };
  while (JSON.stringify(output).length > MAX_TREE_BYTES && output.entries.length > 0) {
    output.entries.pop();
    truncated = true;
  }
  return {
    entries: output.entries,
    ...(truncated ? { truncationReason: "TOO_LARGE" as const } : {}),
  };
}

/**
 * 根目录解析：入口层 realpath 跟进一次（顶层技能目录 symlink 允许的先例语义），
 * 随后 lstat 必须是真实目录。不可达 = typed UNAVAILABLE（技能已在发现面注册，
 * 目录随后消失/不可读是环境态，不是调用方路径错误）。
 */
function resolveRoot(root: string): string {
  let real: string;
  try {
    real = fs.realpathSync(root);
  } catch {
    throw new DomainError("UNAVAILABLE", `Skill directory is unavailable: ${root}`);
  }
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(real);
  } catch {
    throw new DomainError("UNAVAILABLE", `Skill directory is unavailable: ${root}`);
  }
  if (!stat.isDirectory()) {
    throw new DomainError("UNAVAILABLE", `Skill directory is not a directory: ${root}`);
  }
  return real;
}

/**
 * 前序 DFS 枚举：每层子项先 lstat 分类（symlink/特殊文件省略），目录优先、
 * 组内字典序排序后输出并递归。readdir 失败静默返回已收集部分（canonical 目录
 * 的瞬时状态是合法环境态；读取侧身份校验兜底）。
 */
function walkTree(root: string, disabled: boolean): TreeWalk {
  const entries: SkillFileEntry[] = [];
  let truncated = false;
  const identityNames = ["SKILL.md", ".SKILL.md"] as const;
  // conflict 双身份文件：两份都展示，非激活份标 disabled（激活份由启停态决定）。
  const conflicting = identityNames.every((name) => isRealRegularFile(path.join(root, name)));
  const activeIdentity = disabled ? ".SKILL.md" : "SKILL.md";

  const visit = (directory: string, relative: string, depth: number): void => {
    if (truncated) return;
    let dirents: fs.Dirent[];
    try {
      dirents = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    // 先 lstat 分类再排序：目录优先、组内字典序；symlink（含 broken）与
    // 特殊文件在分类阶段省略（三层策略的省略语义）。
    const children: Array<{ name: string; isDir: boolean; size: number }> = [];
    for (const dirent of dirents) {
      const entryPath = path.join(directory, dirent.name);
      let stat: fs.Stats;
      try {
        stat = fs.lstatSync(entryPath);
      } catch {
        continue;
      }
      // Windows reparse point 归入 symlink 类处理（lstat 报 S_IFLNK）。
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        children.push({ name: dirent.name, isDir: true, size: 0 });
      } else if (stat.isFile()) {
        children.push({ name: dirent.name, isDir: false, size: stat.size });
      }
    }
    children.sort((left, right) =>
      left.isDir === right.isDir ? compareString(left.name, right.name) : left.isDir ? -1 : 1,
    );
    for (const child of children) {
      if (truncated) return;
      if (entries.length >= MAX_TREE_ENTRIES) {
        truncated = true;
        return;
      }
      const childPath = relative === "" ? child.name : `${relative}/${child.name}`;
      const conflictDisabled =
        conflicting &&
        depth === 1 &&
        identityNames.includes(child.name as (typeof identityNames)[number]) &&
        child.name !== activeIdentity;
      entries.push({
        path: childPath,
        kind: child.isDir ? "dir" : "file",
        size: child.size,
        ...(conflictDisabled ? { disabled: true as const } : {}),
      });
      if (child.isDir && depth < MAX_TREE_DEPTH) {
        visit(path.join(directory, child.name), childPath, depth + 1);
      }
    }
  };

  visit(root, "", 1);
  return { entries, truncated };
}

/**
 * skills.fileRead：TOCTOU 防线读。步骤（不可调换顺序）：
 * 1. 路径闭包校验（validateRelativePath——typed INVALID_PATH）；
 * 2. lstat 逐级下行：分量缺失 NOT_FOUND、symlink 分量 INVALID_PATH、
 *    中间分量必须真实目录、叶必须是真实 regular file，并捕获 (dev, ino) 身份；
 * 3. O_NOFOLLOW open（最终分量穿透 symlink 即 open 失败）；
 * 4. fstat 身份全等复验（lstat↔open 之间换体 → UNAVAILABLE）；
 * 5. 有界读取（≤256KiB）内做二进制检测（NUL 字节 → BINARY typed 拒读）。
 */
export function readSkillFile(root: string, relativePath: string): SkillFileReadResult {
  const realRoot = resolveRoot(root);
  const segments = validateRelativePath(relativePath);
  let current = realRoot;
  for (const segment of segments) {
    current = path.join(current, segment);
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(current);
    } catch {
      throw new DomainError("NOT_FOUND", `File not found in skill: ${relativePath}`);
    }
    if (stat.isSymbolicLink()) {
      throw new DomainError(
        "INVALID_PATH",
        `Path component is a symlink, which is refused: ${relativePath}`,
      );
    }
  }
  const leaf = current;
  const leafStat = fs.lstatSync(leaf);
  if (!leafStat.isFile()) {
    throw new DomainError("INVALID_PATH", `Path does not address a regular file: ${relativePath}`);
  }
  const identity = { dev: leafStat.dev, ino: leafStat.ino };
  return readVerifiedBounded(leaf, identity, relativePath);
}

/**
 * O_NOFOLLOW open + fstat 身份全等 + 有界读取 + 有界内二进制检测。
 * 导出仅供 TOCTOU 负例测试注入陈旧身份（lstat↔open 竞态的确定性复现点）。
 */
export function readVerifiedBounded(
  leaf: string,
  identity: { dev: number; ino: number },
  label: string,
): SkillFileReadResult {
  let fd: number;
  try {
    fd = fs.openSync(leaf, fs.constants.O_RDONLY | O_NOFOLLOW);
  } catch {
    throw new DomainError("NOT_FOUND", `File vanished between validation and open: ${label}`);
  }
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) {
      throw new DomainError("INVALID_PATH", `Opened target is not a regular file: ${label}`);
    }
    if (stat.dev !== identity.dev || stat.ino !== identity.ino) {
      throw new DomainError(
        "UNAVAILABLE",
        `File identity changed between validation and open (path race): ${label}`,
      );
    }
    const budget = Math.min(stat.size, MAX_FILE_BYTES);
    const buffer = Buffer.alloc(budget);
    let read = 0;
    while (read < budget) {
      const bytes = fs.readSync(fd, buffer, read, budget - read, read);
      if (bytes <= 0) break;
      read += bytes;
    }
    // 二进制检测在有界读取内完成（NUL 字节启发式；UTF-16/含控制零的字节流
    // 同样命中）：二进制元数据永不（裁决 #9）。
    if (buffer.subarray(0, read).includes(0)) {
      throw new DomainError("BINARY", `File is binary and cannot be displayed: ${label}`);
    }
    return {
      content: buffer.toString("utf8", 0, read),
      size: stat.size,
      truncated: read < stat.size,
    };
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * 相对路径闭包：`/` 分隔、非空段、无 `.`/`..` 段、无 NUL、无反斜杠、非绝对
 * （POSIX 绝对与 Windows 盘符/UNC 同拒）。任何规范化歧义一律 typed
 * INVALID_PATH——不做归一化放行（Codex 评审 Δ2：规范化歧义不可接受）。
 */
function validateRelativePath(relativePath: string): string[] {
  if (
    relativePath.length === 0 ||
    relativePath.includes("\0") ||
    relativePath.includes("\\") ||
    relativePath.startsWith("/") ||
    /^[A-Za-z]:/.test(relativePath)
  ) {
    throw new DomainError("INVALID_PATH", `Path is not a relative POSIX path: ${relativePath}`);
  }
  const segments = relativePath.split("/");
  for (const segment of segments) {
    if (segment === "" || segment === "." || segment === "..") {
      throw new DomainError(
        "INVALID_PATH",
        `Path must be slash-separated relative segments without dot components: ${relativePath}`,
      );
    }
  }
  return segments;
}

/** lstat 确认为真实 regular file（不跟进最终分量 symlink）。 */
function isRealRegularFile(candidate: string): boolean {
  try {
    return fs.lstatSync(candidate).isFile();
  } catch {
    return false;
  }
}

function compareString(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
