/**
 * 用户原始需求 [2026-09-30]（symlink 方向修正）：「~/.agents/skills/skill-creator-v2
 * 这个文件夹应该走 symlink……不论 npm 源还是 git 源码启动，这个 skill 本身存在于我们
 * 的 git 仓库内，发布 npm 的时候一起带上。安装的时候将这个 skill 通过 symlink 存放到
 * ~/.agents/skills/skill-creator-v2……如果发现已存在，检查它的来源，是不是
 * npm:skill-creator 或者 git:skill-creator，属于我们的源就安心管理；realpath 和这次
 * 启动的源对不上就删掉重建。反之源头不是 git/npm，意味着用户自己在维护，只能在 cli
 * 或 webui 启动之后提醒用户存在 skill 冲突：覆盖安装我们自己的版本（可选备份原版到
 * ~/.agents/skills-backup/skill-creator-v2-YYYY-MM-DD-hh-mm-ss）；坚持使用用户已有
 * 的版本。」
 *
 * 正交意图：
 *   [1] 源定位与来源鉴定：按 import.meta.url 自定位产品安装内的技能源目录；
 *       package.json name === "skill-creator" 作为 npm/git 安装的统一身份判据。
 *   [2] ensure 状态机（每次生产启动执行，永不抛出）：link 缺失/悬空/指向旧安装 →
 *       （重）建链；v1 legacy 拷贝 → 迁移换链；用户自维护条目 → 冲突不触碰。
 *   [3] 冲突裁决（CLI 与 WebUI 共用）：resolve（可选备份，仅真目录）与 keep
 *       （fingerprint 持久化，条目变化后重新提醒）。
 *   [4] 根目录隔离阀：SKILL_CREATOR_SELF_SKILL_ROOT / 显式参数（测试与探针绝不
 *       写真实 ~/.agents/skills）。
 * 妥协声明：来源鉴定不区分 npm/git 安装形态（两者都有同名 package.json，行为同一）；
 * 悬空链无法证明来源，但也不承载用户内容，按可替换处理。
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import { z } from "zod";
import { safeParseExternal, safeParseJson } from "../shared/external-input.js";
import { appDir } from "../shared/paths.js";
import { atomicWriteUtf8 } from "./path-safety.js";

/** 自举技能目录名（与 frontmatter name 一致，满足最严格的宿主校验）。 */
export const SELF_SKILL_DIRECTORY_NAME = "skill-creator-v2";
/** v1 拷贝式自举留下的所有权标记键（legacy 迁移判据）。 */
const LEGACY_MARKER_KEY = "x-managed-by";
const LEGACY_MARKER_VALUE = "skill-creator";
/** 产品包身份（npm 包名 = 仓库名；来源鉴定的唯一判据）。 */
const PACKAGE_NAME = "skill-creator";
/** 测试/探针隔离阀：覆盖全局技能根（缺省 ~/.agents/skills）。 */
export const SELF_SKILL_ROOT_ENV = "SKILL_CREATOR_SELF_SKILL_ROOT";
/** keep 决定持久化文件（appDir 内，server-owned）。 */
const KEEP_RECORD_FILE = "self-skill-keep.json";

/** 本次运行解析到的产品技能源（唯一事实源 = 安装内 skills/skill-creator-v2）。 */
export interface SelfSkillSource {
  /** 源技能目录绝对路径（symlink 目标）。 */
  skillDir: string;
  /** 安装包根（package.json 所在）。 */
  packageRoot: string;
  /** git checkout/开发仓（否则 npm 安装树）；仅用于状态报告。 */
  viaGit: boolean;
}

/** 冲突条目（用户自维护；ensure 不触碰，等待显式裁决）。 */
export interface SelfSkillConflict {
  kind: "user-directory" | "foreign-link" | "foreign-entry";
  /** 冲突条目自身路径（~/.agents/skills/skill-creator-v2）。 */
  entryPath: string;
  /** foreign-link 的目标绝对路径（其它 kind 缺省）。 */
  targetPath?: string;
  /** 条目 SKILL.md 内容摘要（keep 决定的指纹成分；缺失为 null）。 */
  contentDigest: string | null;
}

/** 只读检查结果（CLI status / RPC state / ensure 共用）。 */
export type SelfSkillInspect =
  | { state: "linked"; source: string }
  | { state: "stale-link"; source: string; target: string }
  | { state: "dangling" }
  | { state: "missing" }
  | { state: "legacy-copy" }
  | { state: "conflict"; conflict: SelfSkillConflict }
  | { state: "failed"; reason: string };

/** ensure（启动自举）结果；typed，永不抛出。 */
export type SelfSkillEnsureResult =
  | { kind: "current" }
  | { kind: "linked" }
  | { kind: "relinked" }
  | { kind: "migrated" }
  | { kind: "kept" }
  | { kind: "conflict"; conflict: SelfSkillConflict }
  | { kind: "failed"; reason: string };

/** 冲突裁决结果。 */
export type SelfSkillResolveResult =
  | { ok: true; backupPath?: string }
  | { ok: false; reason: string };

/** keep 决定的持久化形状（外部输入：unknown → strict Zod）。 */
const KeepRecordSchema = z
  .object({
    version: z.literal(1),
    kind: z.enum(["user-directory", "foreign-link", "foreign-entry"]),
    targetPath: z.string().optional(),
    contentDigest: z.string().nullable(),
    decidedAt: z.number().int().nonnegative(),
  })
  .strict();

type KeepRecord = z.infer<typeof KeepRecordSchema>;

/**
 * 解析本次运行的技能源：anchor（缺省 = 本模块文件所在目录）向上找
 * name === "skill-creator" 且携带 skills/skill-creator-v2 的包根。
 * bundle 态 import.meta.url 指向 dist 内文件——开发仓的 dist/ 另有同名构建
 * manifest 但不携带技能目录，命中它时继续上溯到真正携带 skills/ 的包根；
 * 源码态从 src/daemon/ 上溯两层即仓根（带 skills/）。
 */
export function resolveSelfSkillSource(anchorDir?: string): SelfSkillSource | null {
  let dir = path.resolve(anchorDir ?? path.dirname(fileURLToPath(import.meta.url)));
  for (let depth = 0; depth < 8; depth += 1) {
    const manifest = path.join(dir, "package.json");
    if (fs.existsSync(manifest)) {
      const identity = safeParseJson(manifestReader(manifest), z.object({ name: z.string() }));
      if (identity?.name === PACKAGE_NAME) {
        const skillDir = path.join(dir, "skills", SELF_SKILL_DIRECTORY_NAME);
        let hasSkillDir = false;
        try {
          hasSkillDir = fs.statSync(skillDir).isDirectory();
        } catch {
          hasSkillDir = false;
        }
        if (hasSkillDir) {
          return { skillDir, packageRoot: dir, viaGit: fs.existsSync(path.join(dir, ".git")) };
        }
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

function manifestReader(file: string): string {
  return fs.readFileSync(file, "utf8");
}

/**
 * 鉴定任意目录是否落在某个 skill-creator 安装内（npm/git 同一判据）。
 */
export function provenanceOurs(directory: string): boolean {
  let dir = path.resolve(directory);
  for (let depth = 0; depth < 4; depth += 1) {
    const manifest = path.join(dir, "package.json");
    if (fs.existsSync(manifest)) {
      const identity = safeParseJson(manifestReader(manifest), z.object({ name: z.string() }));
      if (identity?.name === PACKAGE_NAME) return true;
      return false;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
  return false;
}

/**
 * 全局技能根：显式参数 > env 隔离阀 > `~/.agents/skills`（社区标准全局根）。
 * 备份目录与根同层（缺省 ~/.agents/skills-backup，valve 沙箱同理）。
 */
export function selfSkillRoot(explicitRoot?: string): string {
  const root = explicitRoot ?? (process.env[SELF_SKILL_ROOT_ENV]?.trim() || "");
  if (root) return path.resolve(root);
  return path.join(os.homedir(), ".agents", "skills");
}

/** 冲突条目时间戳备份目录（本地时间；YYYY-MM-DD-HH-mm-ss）。 */
export function selfSkillBackupDirectory(root?: string): string {
  const now = new Date();
  const pad = (value: number): string => String(value).padStart(2, "0");
  const stamp = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join("-");
  return path.join(
    path.dirname(selfSkillRoot(root)),
    "skills-backup",
    `${SELF_SKILL_DIRECTORY_NAME}-${stamp}`,
  );
}

function linkPathOf(root: string): string {
  return path.join(root, SELF_SKILL_DIRECTORY_NAME);
}

function digestFile(file: string): string | null {
  try {
    return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  } catch {
    return null;
  }
}

/**
 * v1 legacy 拷贝判据：frontmatter 带产品标记，且文档字节与本次安装源一致。
 * marker 是随包公开的约定（用户可自行写入），仅凭它就 rmSync 会误删仿冒目录
 * （复核 P2 加固）：内容摘要不等 → 视为用户目录冲突。
 */
function legacyCopyOfOurs(directory: string, source: SelfSkillSource): boolean {
  const sourceDigest = digestFile(path.join(source.skillDir, "SKILL.md"));
  for (const name of ["SKILL.md", ".SKILL.md"]) {
    try {
      const document = matter(fs.readFileSync(path.join(directory, name), "utf8"));
      const marker = safeParseExternal(
        z.object({ [LEGACY_MARKER_KEY]: z.string().optional() }).passthrough(),
        document.data,
      );
      if (
        marker?.[LEGACY_MARKER_KEY] === LEGACY_MARKER_VALUE &&
        digestFile(path.join(directory, name)) === sourceDigest
      ) {
        return true;
      }
    } catch {
      // 缺失或不可解析 → 不是本文件的判据来源。
    }
  }
  return false;
}

function createLink(root: string, source: SelfSkillSource): void {
  fs.mkdirSync(root, { recursive: true });
  fs.symlinkSync(
    source.skillDir,
    linkPathOf(root),
    process.platform === "win32" ? "junction" : "dir",
  );
}

function conflictOf(
  kind: SelfSkillConflict["kind"],
  entryPath: string,
  target?: string,
): SelfSkillConflict {
  return {
    kind,
    entryPath,
    ...(target === undefined ? {} : { targetPath: target }),
    // foreign-entry 是文件条目：摘要条目文件本身（keep 指纹对内容变化敏感）。
    contentDigest:
      kind === "foreign-entry"
        ? digestFile(entryPath)
        : digestFile(path.join(entryPath, "SKILL.md")),
  };
}

/**
 * 只读检查全局条目状态（不做任何变更）。source 解析失败 → failed。
 */
export function inspectSelfSkill(explicitRoot?: string): SelfSkillInspect {
  const source = resolveSelfSkillSource();
  if (!source) {
    return { state: "failed", reason: "self-skill source not found in this installation" };
  }
  const root = selfSkillRoot(explicitRoot);
  const linkPath = linkPathOf(root);
  let stats: fs.Stats;
  try {
    stats = fs.lstatSync(linkPath);
  } catch (error) {
    const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
    if (code === "ENOENT") return { state: "missing" };
    return { state: "failed", reason: describeIo("stat", linkPath, error) };
  }
  if (stats.isSymbolicLink()) {
    let target: string;
    try {
      target = fs.realpathSync(linkPath);
    } catch {
      // 悬空链（目标安装被 npm 清理）：不承载用户内容，可替换。
      return { state: "dangling" };
    }
    let current: string;
    try {
      current = fs.realpathSync(source.skillDir);
    } catch {
      current = source.skillDir;
    }
    if (target === current) return { state: "linked", source: current };
    if (provenanceOurs(path.dirname(target))) {
      return { state: "stale-link", source: current, target };
    }
    return { state: "conflict", conflict: conflictOf("foreign-link", linkPath, target) };
  }
  if (stats.isDirectory()) {
    return legacyCopyOfOurs(linkPath, source)
      ? { state: "legacy-copy" }
      : { state: "conflict", conflict: conflictOf("user-directory", linkPath) };
  }
  return { state: "conflict", conflict: conflictOf("foreign-entry", linkPath) };
}

/**
 * 生产入口（main.ts）启动时调用：确保全局根下的 symlink 指向本次安装的技能源。
 * 永不抛出；冲突不触碰，交由 CLI/WebUI 裁决。
 */
export function ensureSelfSkill(explicitRoot?: string): SelfSkillEnsureResult {
  const source = resolveSelfSkillSource();
  if (!source) {
    return { kind: "failed", reason: "self-skill source not found in this installation" };
  }
  const inspect = inspectSelfSkill(explicitRoot);
  const root = selfSkillRoot(explicitRoot);
  switch (inspect.state) {
    case "linked":
      return { kind: "current" };
    case "missing":
    case "dangling":
    case "stale-link":
    case "legacy-copy": {
      try {
        if (inspect.state === "stale-link" || inspect.state === "dangling") {
          fs.unlinkSync(linkPathOf(root));
        } else if (inspect.state === "legacy-copy") {
          fs.rmSync(linkPathOf(root), { recursive: true, force: true });
        }
        createLink(root, source);
      } catch (error) {
        return { kind: "failed", reason: describeIo("link", linkPathOf(root), error) };
      }
      return inspect.state === "missing"
        ? { kind: "linked" }
        : inspect.state === "legacy-copy"
          ? { kind: "migrated" }
          : { kind: "relinked" };
    }
    case "conflict":
      return keepRecordMatches(inspect.conflict)
        ? { kind: "kept" }
        : { kind: "conflict", conflict: inspect.conflict };
    case "failed":
      return { kind: "failed", reason: inspect.reason };
  }
}

/**
 * 冲突裁决：覆盖安装产品版本。真目录可选备份（同层 skills-backup 时间戳目录，
 * rename 原子）；foreign-link/foreign-entry 只移除条目（用户内容在别处，无需备份）。
 */
export function resolveSelfSkillConflict(
  input: { backup: boolean },
  explicitRoot?: string,
): SelfSkillResolveResult {
  const inspect = inspectSelfSkill(explicitRoot);
  const root = selfSkillRoot(explicitRoot);
  const source = resolveSelfSkillSource();
  if (!source) return { ok: false, reason: "self-skill source not found in this installation" };
  if (inspect.state === "linked") return { ok: true };
  if (inspect.state !== "conflict") {
    return { ok: false, reason: `no conflict to resolve (state: ${inspect.state})` };
  }
  const entry = linkPathOf(root);
  try {
    if (inspect.conflict.kind === "user-directory") {
      if (input.backup) {
        const backupPath = selfSkillBackupDirectory(root);
        fs.mkdirSync(path.dirname(backupPath), { recursive: true });
        fs.renameSync(entry, backupPath);
        createLink(root, source);
        return { ok: true, backupPath };
      }
      // 无备份 = 用户明确放弃该目录内容：递归移除（unlink 对目录恒 EPERM）。
      fs.rmSync(entry, { recursive: true, force: true });
      createLink(root, source);
      return { ok: true };
    }
    // foreign-link / foreign-entry 都只是条目本身（链或文件）：unlink 即可，
    // 用户内容分别在目标位置/别处，不受影响。
    fs.unlinkSync(entry);
    createLink(root, source);
  } catch (error) {
    return { ok: false, reason: describeIo("resolve", entry, error) };
  }
  return { ok: true };
}

/**
 * 冲突裁决：保留用户版本。fingerprint（kind + 目标 + 内容摘要）持久化到 appDir；
 * 条目变化（指纹漂移）后 ensure 会重新提醒。
 */
export function keepSelfSkillUserVersion(explicitRoot?: string): SelfSkillResolveResult {
  const inspect = inspectSelfSkill(explicitRoot);
  if (inspect.state !== "conflict") {
    return { ok: false, reason: `no conflict to keep (state: ${inspect.state})` };
  }
  const record: KeepRecord = {
    version: 1,
    kind: inspect.conflict.kind,
    ...(inspect.conflict.targetPath === undefined
      ? {}
      : { targetPath: inspect.conflict.targetPath }),
    contentDigest: inspect.conflict.contentDigest,
    decidedAt: Date.now(),
  };
  try {
    atomicWriteUtf8(path.join(appDir(), KEEP_RECORD_FILE), JSON.stringify(record, null, 2) + "\n");
  } catch (error) {
    return { ok: false, reason: describeIo("persist", KEEP_RECORD_FILE, error) };
  }
  return { ok: true };
}

/** RPC/CLI 状态聚合：inspect 透传 + keep 决定折叠（conflict × 记录匹配 → kept）。 */
export function selfSkillStatus(
  explicitRoot?: string,
):
  | { state: "linked"; linkPath: string; sourcePath: string; viaGit: boolean }
  | { state: "missing" }
  | { state: "stale-link" }
  | { state: "dangling" }
  | { state: "legacy-copy" }
  | { state: "conflict"; conflict: SelfSkillConflict }
  | { state: "kept"; conflict: SelfSkillConflict }
  | { state: "failed"; reason: string } {
  const inspect = inspectSelfSkill(explicitRoot);
  const source = resolveSelfSkillSource();
  switch (inspect.state) {
    case "linked":
      return {
        state: "linked",
        linkPath: linkPathOf(selfSkillRoot(explicitRoot)),
        sourcePath: source?.skillDir ?? inspect.source,
        viaGit: source?.viaGit ?? false,
      };
    case "missing":
    case "dangling":
    case "legacy-copy":
      return { state: inspect.state };
    case "stale-link":
      return { state: "stale-link" };
    case "conflict":
      return keepRecordMatches(inspect.conflict)
        ? { state: "kept", conflict: inspect.conflict }
        : { state: "conflict", conflict: inspect.conflict };
    case "failed":
      return { state: "failed", reason: inspect.reason };
  }
}

function keepRecord(): KeepRecord | null {
  try {
    return safeParseJson(
      fs.readFileSync(path.join(appDir(), KEEP_RECORD_FILE), "utf8"),
      KeepRecordSchema,
    );
  } catch {
    return null;
  }
}

function keepRecordMatches(conflict: SelfSkillConflict): boolean {
  const record = keepRecord();
  if (!record) return false;
  return (
    record.kind === conflict.kind &&
    (record.targetPath ?? undefined) === conflict.targetPath &&
    record.contentDigest === conflict.contentDigest
  );
}

function describeIo(phase: string, target: string, error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return `self-skill ${phase} failed at ${target}: ${detail}`;
}
