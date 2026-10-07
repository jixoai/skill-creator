/**
 * Immutable repository scan, preview, and install sessions.
 *
 * User input [2026-07-22]: "下载到某个 Workspace.provider；另外这里应该要能多选。"
 * User input [2026-07-21]: "任何外部输入都应该遵循这个规则：各种配置文件、数据库结构、网络返回等"
 * Architecture decisions [2026-07-14]: preview/install share one pinned clone;
 * expected failures are actionable without exposing credential-bearing Git output.
 * Architecture decisions [2026-10-07]（ccski-3-host-migration 批 2.1）: install 走
 * ccski 3.0 store-link 内核两阶段（ensureEntity 实体入库 + projectEntity symlink
 * 投影）；内核 typed error 映射宿主有限词表，installedSkillId 复核链（§5.7）保留——
 * 内核防线不替代宿主防线，两层都要。
 *
 * Orthogonal intents:
 *   [1] Clone, pin, and terminally dispose daemon-owned repository sessions.
 *   [2] Discover and validate installable SKILL.md entries.
 *   [3] Install only pinned opaque IDs through the kernel two-phase flow and sign
 *       verified local Skill identities (ExpectedInstallTarget 绑定 + direct-child +
 *       实体库 containment + regular SKILL.md + frontmatter/resolve/validate)。
 */
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ensureEntity as ccskiEnsureEntity,
  projectEntity as ccskiProjectEntity,
  type EnsureEntityOptions,
  type EnsureEntityResult,
  type ProjectEntityOptions,
  type ProjectEntityResult,
} from "ccski";
import { execa } from "execa";
import matter from "gray-matter";
import { ZodError } from "zod";
import { SkillDirectoryNameSchema, SkillFrontmatterSchema } from "../shared/contracts/creator.js";
import {
  PinnedCommitSchema,
  RemoteSkillIdSchema,
  RepositorySessionIdSchema,
  type InstallResultEntry,
  type InstallPreview,
  type InstallResult,
  type InstallSummary,
  type RemoteRepoScan,
  type RemoteSkillId,
  type RemoteSkill,
  type RemoteSkillPreview,
  type RepositoryInstallInput,
  type RepositorySessionId,
} from "../shared/contracts/repository.js";
import { SkillIdSchema, type SkillId } from "../shared/contracts/skills.js";
import type { WorkspaceProviderTarget } from "../shared/contracts/workspaces.js";
import { DomainError } from "./domain-error.js";
import { assertPathInside, canonicalDirectory, opaquePathId } from "./path-safety.js";
import type { SkillService } from "./skill-service.js";
import type { WorkspaceRegistry } from "./workspace-registry/index.js";

const CLONE_TIMEOUT_MS = 60_000;
const MAX_SESSIONS = 6;

interface RepositorySession {
  scan: RemoteRepoScan;
  directory: string;
  skillsById: Map<RemoteSkillId, RemoteSkill>;
  activeLeases: number;
  retired: boolean;
}

type RepositorySessions = Map<RepositorySessionId, RepositorySession>;

/** Clone adapter; failed clones must remove any snapshot before rejecting. */
export type RepositoryCloner = (
  source: string,
  ref: string | undefined,
  cancelSignal: AbortSignal,
) => Promise<{ directory: string; commit: string }>;

/**
 * ccski store-link 内核两阶段适配 seam（ccski-3-host-migration 批 2.1）：
 * install = ensureEntity（实体入库）→ projectEntity（symlink 投影到 Provider root）。
 * 内核 typed result 不是异常流；宿主防线（§5.7 复核链）不因内核防线而撤除。
 */
export interface RepositoryKernel {
  ensureEntity: (options: EnsureEntityOptions) => Promise<EnsureEntityResult>;
  projectEntity: (options: ProjectEntityOptions) => Promise<ProjectEntityResult>;
}

/** Repository service dependencies that may be replaced at the module boundary. */
export interface RepositoryServiceOptions {
  clone?: RepositoryCloner;
  kernel?: RepositoryKernel;
}

/** Daemon-owned Repository scan, preview, install, and teardown capability. */
export interface RepositoryService {
  scan(source: string, ref?: string): Promise<RemoteRepoScan>;
  preview(sessionId: RepositorySessionId, skillId: RemoteSkillId): Promise<RemoteSkillPreview>;
  install(input: RepositoryInstallInput): Promise<InstallResult>;
  /**
   * pinned clone 租约访问（daemon 内部消费面，不入 RPC）：skills-update 的 apply
   * 重装直连 ccski 内核实体 API（批 2.2），在租约内读 scan session 的快照目录作为
   * 源——租约保证期间淘汰只 retire 不删盘，release 后才允许清理（与 install 同一
   * 生命周期法则）；会话失效与 install 同一守卫（UNAVAILABLE = 需重扫）。
   */
  withSession<T>(
    sessionId: RepositorySessionId,
    run: (directory: string) => Promise<T>,
  ): Promise<T>;
  dispose(): Promise<void>;
}

/** Bind pinned repository sessions to one daemon and Workspace Registry. */
export function createRepositoryService(
  workspaces: WorkspaceRegistry,
  skills: SkillService,
  options: RepositoryServiceOptions = {},
): RepositoryService {
  const sessions: RepositorySessions = new Map();
  const activeTasks = new Set<Promise<unknown>>();
  const scanControllers = new Set<AbortController>();
  const clone = options.clone ?? cloneRepository;
  const kernel: RepositoryKernel = options.kernel ?? {
    ensureEntity: ccskiEnsureEntity,
    projectEntity: ccskiProjectEntity,
  };
  let closing = false;
  let disposePromise: Promise<void> | null = null;

  const assertOpen = (): void => {
    if (closing) {
      throw new DomainError("UNAVAILABLE", "Repository service is shutting down.");
    }
  };

  const runTask = <T>(operation: () => Promise<T>): Promise<T> => {
    try {
      assertOpen();
      let tracked: Promise<T>;
      tracked = operation().finally(() => activeTasks.delete(tracked));
      activeTasks.add(tracked);
      return tracked;
    } catch (error) {
      return Promise.reject(error);
    }
  };

  return {
    scan: (source: string, ref?: string) =>
      runTask(async () => {
        const controller = new AbortController();
        scanControllers.add(controller);
        try {
          return await scan(sessions, clone, assertOpen, source, ref, controller.signal);
        } finally {
          scanControllers.delete(controller);
        }
      }),
    preview: (sessionId: RepositorySessionId, skillId: RemoteSkillId) =>
      runTask(() =>
        preview(
          sessions,
          RepositorySessionIdSchema.parse(sessionId),
          RemoteSkillIdSchema.parse(skillId),
        ),
      ),
    install: (input: RepositoryInstallInput) =>
      runTask(() => install(sessions, workspaces, skills, kernel, input)),
    withSession: <T>(sessionId: RepositorySessionId, run: (directory: string) => Promise<T>) =>
      runTask(async () => {
        const session = acquireSession(sessions, RepositorySessionIdSchema.parse(sessionId));
        try {
          return await run(session.directory);
        } finally {
          releaseSession(session);
        }
      }),
    dispose: (): Promise<void> => {
      if (disposePromise) return disposePromise;
      closing = true;
      for (const controller of scanControllers) controller.abort();
      disposePromise = Promise.allSettled([...activeTasks]).then(() => clearSessions(sessions));
      return disposePromise;
    },
  };
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function repoTitle(source: string): string {
  const match = source.match(/[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
  return match?.[1] ?? source;
}

async function cloneRepository(
  source: string,
  ref: string | undefined,
  cancelSignal: AbortSignal,
): Promise<{ directory: string; commit: string }> {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "skill-creator-repo-"));
  const args = ["clone", "--depth", "1"];
  if (ref) args.push("--branch", ref);
  args.push("--", source, directory);
  try {
    await execa("git", args, {
      timeout: CLONE_TIMEOUT_MS,
      cancelSignal,
      forceKillAfterDelay: 1_000,
    });
    const result = await execa("git", ["rev-parse", "HEAD"], {
      cwd: directory,
      timeout: CLONE_TIMEOUT_MS,
      cancelSignal,
      forceKillAfterDelay: 1_000,
    });
    const commit = PinnedCommitSchema.safeParse(result.stdout.trim());
    if (!commit.success) throw new Error("Git returned an invalid commit identity.");
    return { directory, commit: commit.data };
  } catch (error) {
    fs.rmSync(directory, { recursive: true, force: true });
    if (cancelSignal.aborted) {
      throw new DomainError("UNAVAILABLE", "Repository service is shutting down.", {
        cause: error,
      });
    }
    throw new DomainError(
      "UNAVAILABLE",
      "Repository could not be cloned. Verify the source and reference, then try again.",
      { cause: error },
    );
  }
}

function findSkillFiles(root: string): string[] {
  const results: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(candidate);
      else if (entry.isFile() && entry.name === "SKILL.md") results.push(candidate);
    }
  };
  visit(root);
  return results.sort();
}

/**
 * 契约相对路径归一化（Windows 测试债 2026-09-25）：path.relative 在 win32 产出
 * `\` 分隔，会泄进 RemoteSkill.relativePath 与 rsk_ 摘要；契约字段统一 `/`
 * （与 steward relPath 同一裁决），消费端 path.resolve 双分隔符兼容。digest 也
 * 取归一化形式——同一仓库内容在所有平台得到相同 opaque ID。
 */
export function toContractRelativePath(relative: string): string {
  // 双分隔符归一（不依赖宿主平台）：win32 的 path.relative 产出 `\`，POSIX 恒
  // `/`；显式 Windows 形状输入在任意平台都归一为契约 `/` 形式。
  return relative.split(/[\\/]/).join("/");
}

function inspectSkill(repositoryRoot: string, file: string): RemoteSkill {
  const relativePath = toContractRelativePath(
    path.relative(repositoryRoot, path.dirname(file)) || ".",
  );
  const issues: string[] = [];
  let name = path.basename(path.dirname(file));
  let description = "";
  try {
    const parsed = matter(fs.readFileSync(file, "utf8"));
    const frontmatter = SkillFrontmatterSchema.safeParse(parsed.data);
    if (!frontmatter.success) {
      issues.push(formatSkillIssue(frontmatter.error));
    } else {
      name = frontmatter.data.name;
      description = frontmatter.data.description;
      const safeName = SkillDirectoryNameSchema.safeParse(name);
      if (!safeName.success)
        issues.push("The frontmatter name is not a safe skill directory name.");
    }
  } catch (error) {
    issues.push(formatSkillIssue(error));
  }
  return {
    id: RemoteSkillIdSchema.parse(`rsk_${digest(relativePath)}`),
    name,
    description,
    relativePath,
    installable: issues.length === 0,
    issues,
  };
}

function formatSkillIssue(error: unknown): string {
  if (error instanceof ZodError) {
    return error.issues
      .map((issue) => `${issue.path.join(".") || "frontmatter"}: ${issue.message}`)
      .join(" ");
  }
  return error instanceof Error ? error.message : String(error);
}

function rejectDuplicateNames(skills: RemoteSkill[]): void {
  const counts = new Map<string, number>();
  for (const skill of skills) counts.set(skill.name, (counts.get(skill.name) ?? 0) + 1);
  for (const skill of skills) {
    if ((counts.get(skill.name) ?? 0) > 1) {
      skill.installable = false;
      skill.issues.push(`Duplicate skill name in repository: ${skill.name}`);
    }
  }
}

function retainSession(sessions: RepositorySessions, session: RepositorySession): void {
  sessions.set(session.scan.sessionId, session);
  while (sessions.size > MAX_SESSIONS) {
    const oldestId = sessions.keys().next().value;
    if (!oldestId) return;
    const oldest = sessions.get(oldestId);
    sessions.delete(oldestId);
    if (oldest) retireSession(oldest);
  }
}

function getSession(
  sessions: RepositorySessions,
  sessionId: RepositorySessionId,
): RepositorySession {
  const session = sessions.get(sessionId);
  if (!session || !fs.existsSync(session.directory)) {
    throw new DomainError("UNAVAILABLE", "Repository session expired. Scan the repository again.");
  }
  return session;
}

function acquireSession(
  sessions: RepositorySessions,
  sessionId: RepositorySessionId,
): RepositorySession {
  const session = getSession(sessions, sessionId);
  session.activeLeases += 1;
  return session;
}

function releaseSession(session: RepositorySession): void {
  session.activeLeases -= 1;
  if (session.activeLeases === 0 && session.retired) removeSnapshot(session);
}

function retireSession(session: RepositorySession): void {
  if (session.retired) return;
  session.retired = true;
  if (session.activeLeases === 0) removeSnapshot(session);
}

function removeSnapshot(session: RepositorySession): void {
  fs.rmSync(session.directory, { recursive: true, force: true });
}

/** Clone and pin a repository source to an immutable preview session. */
async function scan(
  sessions: RepositorySessions,
  clone: RepositoryCloner,
  assertOpen: () => void,
  source: string,
  ref: string | undefined,
  cancelSignal: AbortSignal,
): Promise<RemoteRepoScan> {
  const snapshot = await clone(source, ref, cancelSignal);
  let retained = false;
  try {
    assertOpen();
    const parsedCommit = PinnedCommitSchema.safeParse(snapshot.commit);
    if (!parsedCommit.success) {
      throw new DomainError("UNAVAILABLE", "Repository returned an invalid commit identity.");
    }
    const commit = parsedCommit.data;
    const skills = findSkillFiles(snapshot.directory).map((file) =>
      inspectSkill(snapshot.directory, file),
    );
    rejectDuplicateNames(skills);
    const sessionId = RepositorySessionIdSchema.parse(
      `repo_${digest(`${source}\0${commit}\0${randomBytes(8).toString("hex")}`)}`,
    );
    const result: RemoteRepoScan = {
      sessionId,
      source,
      title: repoTitle(source),
      commit,
      skills,
    };
    assertOpen();
    retainSession(sessions, {
      scan: result,
      directory: snapshot.directory,
      skillsById: new Map(skills.map((skill) => [skill.id, skill])),
      activeLeases: 0,
      retired: false,
    });
    retained = true;
    return result;
  } finally {
    if (!retained) fs.rmSync(snapshot.directory, { recursive: true, force: true });
  }
}

/** Read one opaque remote skill from its pinned repository session. */
async function preview(
  sessions: RepositorySessions,
  sessionId: RepositorySessionId,
  skillId: RemoteSkillId,
): Promise<RemoteSkillPreview> {
  const session = getSession(sessions, sessionId);
  const skill = session.skillsById.get(RemoteSkillIdSchema.parse(skillId));
  if (!skill) {
    throw new DomainError("NOT_FOUND", `Remote skill not found in scan session: ${skillId}`);
  }
  const file = path.resolve(session.directory, skill.relativePath, "SKILL.md");
  const relative = path.relative(session.directory, file);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Remote skill path escaped the repository snapshot.");
  }
  return {
    sessionId: session.scan.sessionId,
    skill,
    content: fs.readFileSync(file, "utf8"),
  };
}

function emptySummary(targets: WorkspaceProviderTarget[]): InstallSummary {
  return {
    kind: "result",
    targets,
    results: [],
    installed: 0,
    skipped: 0,
    overwritten: 0,
    failed: 0,
  };
}

interface ExpectedInstallTarget {
  target: WorkspaceProviderTarget;
  /** server 解析出的 Provider skills 根（投影 root）。 */
  providerRoot: string;
  /** Imported Workspace 根（ccski project scope 的 workspaceDir；实体库父目录）。 */
  workspaceDirectory: string;
  skill: RemoteSkill;
  expectedPath: string;
}

function createExpectedInstallTarget(
  target: WorkspaceProviderTarget,
  providerRoot: string,
  workspaceDirectory: string,
  skill: RemoteSkill,
): ExpectedInstallTarget {
  const expectedPath = path.resolve(providerRoot, skill.name);
  if (path.dirname(expectedPath) !== providerRoot) {
    throw new Error("Remote skill name must resolve to a direct Workspace child.");
  }
  return { target, providerRoot, workspaceDirectory, skill, expectedPath };
}

function expectedInstallEntryBase(target: ExpectedInstallTarget) {
  return {
    target: target.target,
    skill: target.skill.name,
    destination: target.providerRoot,
    path: target.expectedPath,
  };
}

function failedInstallEntry(target: ExpectedInstallTarget, error: string): InstallResultEntry {
  return { ...expectedInstallEntryBase(target), status: "failed", error };
}

function appendInstallEntry(target: InstallSummary, entry: InstallResultEntry): void {
  target.results.push(entry);
  target[entry.status] += 1;
}

/**
 * 内核 typed error → 宿主有限词表文案（批 2.1：不裸透传内核 message）。
 * 码 token 来自 PUBLIC_RESULT_CODES 冻结词表，可安全入文；解释文本宿主自持。
 */
const KERNEL_FAILURE_MESSAGES: Record<string, string> = {
  NAME_COLLISION: "A different skill already owns the destination folder name in the skill store.",
  GUARD_ENTITY: "The skill changed while the install was running; scan again and retry.",
  SOURCE_NOT_FOUND: "The pinned repository snapshot no longer contains the skill.",
  SOURCE_SYMLINK: "The pinned repository snapshot resolved to a symbolic link.",
  SOURCE_NOT_DIRECTORY: "The pinned repository snapshot entry is not a directory.",
  SOURCE_INVALID: "The pinned repository snapshot has no parseable SKILL.md.",
  ENTITY_PATH_OCCUPIED: "The skill store has a conflicting entry at the entity path.",
  ENTITY_SWAP_FAILED: "The skill store could not swap the entity content safely.",
  STATE_RECOVERY_REQUIRED: "The skill store state is degraded; run ccski state repair.",
  STATE_GENERATION_CONFLICT: "The skill store state changed concurrently; retry the install.",
  TARGET_DENIED: "The provider skills directory denied the write.",
  PROJECTION_PATH_OCCUPIED:
    "The destination is occupied by an entry the installer does not own; remove it or install with force.",
  PROJECTION_DISABLED: "The destination projection is disabled; enable it before reinstalling.",
  MODE_CONFLICT: "The destination projection has a different recorded mode.",
  ROOT_SYMLINK: "The provider skills directory resolves through a symbolic link.",
  ROOT_NOT_DIRECTORY: "The provider skills path is not a directory.",
  SYMLINK_FAILED: "The skill could not be projected into the provider directory.",
  COPY_FAILED: "The skill could not be copied into the provider directory.",
  ENTITY_NOT_FOUND: "The skill entity vanished from the skill store; retry the install.",
  ENTITY_MISSING: "The recorded skill entity directory is missing from the skill store.",
  INVALID_ROOTS: "The projection roots could not be resolved.",
  IO: "The installer reported a filesystem failure.",
};

export function kernelFailureMessage(code: string | undefined): string {
  if (code && KERNEL_FAILURE_MESSAGES[code] !== undefined) {
    return `${KERNEL_FAILURE_MESSAGES[code]} (ccski code: ${code})`;
  }
  return "The installer reported an unexpected failure.";
}

/**
 * 内核源准备（批 2.1）：pinned clone 内的技能目录 → 干净真实目录 staging。
 * `.git` / `node_modules` 不进实体（folder-hash 语义本就跳过二者；拷入只留垃圾，
 * 且 repo 根技能（relativePath "."）会把整个 clone 历史带进 workspace 实体库）。
 * skills-update 的 apply 重装共用同一准备（单源语义）。
 */
export function stageSkillSource(sourceDir: string): string {
  const staged = fs.mkdtempSync(path.join(os.tmpdir(), "skill-creator-kernel-source-"));
  fs.cpSync(sourceDir, staged, {
    recursive: true,
    force: true,
    filter: (candidate: string) => {
      const base = path.basename(candidate);
      return base !== ".git" && base !== "node_modules";
    },
  });
  return staged;
}

/** ccski 实体库根（Imported Workspace 的 project scope 实体根）。 */
function entityRootDirectory(workspaceDirectory: string): string {
  return path.join(workspaceDirectory, ".agents", "skills");
}

/** 投影路径上的现存条目是否为本 workspace 实体库的链接（ccski 管辖形态）。 */
function isEntityProjectionLink(
  entryPath: string,
  workspaceDirectory: string,
  name: string,
): boolean {
  let stats: fs.Stats;
  try {
    stats = fs.lstatSync(entryPath);
  } catch {
    return false;
  }
  if (!stats.isSymbolicLink()) return false;
  try {
    return fs.realpathSync(entryPath) === path.join(entityRootDirectory(workspaceDirectory), name);
  } catch {
    return false;
  }
}

/**
 * force 清障（批 2.1）：目标被非 ccski 管辖条目占据时按 force 语义移除。
 * 只动 Provider root 的直属子条目：普通目录 rmSync；异向链接只摘链不碰目标。
 * ccski 管辖链接与实体本地形态（provider root === 实体根）从不清障。
 */
function clearForeignOccupant(expected: ExpectedInstallTarget): {
  cleared: boolean;
  error?: string;
} {
  let stats: fs.Stats;
  try {
    stats = fs.lstatSync(expected.expectedPath);
  } catch {
    return { cleared: false };
  }
  if (
    isEntityProjectionLink(expected.expectedPath, expected.workspaceDirectory, expected.skill.name)
  ) {
    return { cleared: false };
  }
  // 实体本地形态（provider root === 实体根）：条目就是实体本体，清障即毁库——
  // 该形态下投影概念退化（projectEntity 返回 entity-local 收据），从不清障。
  if (!stats.isSymbolicLink()) {
    try {
      if (
        assertPathInsideReturnsInside(
          entityRootDirectory(expected.workspaceDirectory),
          expected.expectedPath,
        )
      ) {
        return { cleared: false };
      }
    } catch {
      // 判定失败按不可清障处理（后续 projectEntity 的 typed 占用拒绝兜底）。
      return { cleared: false };
    }
  }
  try {
    if (stats.isSymbolicLink()) {
      fs.unlinkSync(expected.expectedPath);
    } else {
      fs.rmSync(expected.expectedPath, { recursive: true, force: true });
    }
    return { cleared: true };
  } catch (error) {
    return {
      cleared: false,
      error: `The occupied destination could not be cleared: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

/** assertPathInside 的非抛出变体（清障判定用；判定异常返回 false 走保守路径）。 */
function assertPathInsideReturnsInside(root: string, candidate: string): boolean {
  try {
    assertPathInside(root, candidate);
    return true;
  } catch {
    return false;
  }
}

/**
 * installedSkillId 复核链（AGENTS.md §5.7；ccski-3-host-migration 批 2.1 双形态版）：
 * ExpectedInstallTarget 绑定 → 投影路径 direct-child → 链接投影 realpath 落在
 * 同一 Imported Workspace 实体库内（或物化副本/实体本地 realpath 即自身）→ regular
 * SKILL.md → frontmatter name 匹配 → SkillService.resolve/validate 重新发现 →
 * 签发本地 SkillId。ccski 内核防线不替代宿主防线，两层都要。
 */
async function installedSkillId(
  target: ExpectedInstallTarget,
  skills: SkillService,
): Promise<SkillId> {
  // codex perf-review P1-1：installer 刚写盘——重发现验证链（resolve/validate）
  // 之前必须丢弃同 target 的在途 discovery，否则复用安装前的旧快照会把新
  // 装的技能判成 NOT_FOUND。skills-update 复用同一链路，同样受益。
  skills.invalidateDiscovery(target.target);
  const expectedPath = target.expectedPath;
  if (path.dirname(expectedPath) !== target.providerRoot) {
    throw new Error("Installed skill path must be a direct child of the Workspace Provider.");
  }
  let entryStats: fs.Stats;
  try {
    entryStats = fs.lstatSync(expectedPath);
  } catch {
    throw new Error("The installed skill is not present at the expected destination.");
  }
  let canonicalPath: string;
  if (entryStats.isSymbolicLink()) {
    // link 投影（内核默认形态）：realpath 必须落在同一 Imported Workspace 的
    // 实体库内——这是 link 模式下的 containment 不变量（旧「realpath 即自身」
    // 断言只对物化形态成立）。
    canonicalPath = fs.realpathSync(expectedPath);
    assertPathInside(entityRootDirectory(target.workspaceDirectory), canonicalPath);
  } else if (entryStats.isDirectory()) {
    canonicalPath = fs.realpathSync(expectedPath);
    if (canonicalPath !== expectedPath) {
      throw new Error("Installed skill path must not resolve through a symbolic link.");
    }
    assertPathInside(target.providerRoot, canonicalPath);
  } else {
    throw new Error(
      "The installed destination entry is neither a directory nor a projection link.",
    );
  }
  if (!fs.statSync(canonicalPath).isDirectory()) {
    throw new Error("The installed skill does not resolve to a directory.");
  }
  const skillFile = path.join(canonicalPath, "SKILL.md");
  let skillFileStats: fs.Stats;
  try {
    skillFileStats = fs.lstatSync(skillFile);
  } catch {
    throw new Error("Installed skill directory does not contain SKILL.md.");
  }
  if (!skillFileStats.isFile() || skillFileStats.isSymbolicLink()) {
    throw new Error("Installed skill directory does not contain a regular SKILL.md file.");
  }
  const canonicalSkillFile = fs.realpathSync(skillFile);
  assertPathInside(canonicalPath, canonicalSkillFile);
  if (!fs.lstatSync(canonicalSkillFile).isFile()) {
    throw new Error("Installed skill directory does not contain a regular SKILL.md file.");
  }
  let frontmatterName = "";
  try {
    const frontmatter = SkillFrontmatterSchema.safeParse(
      matter(fs.readFileSync(skillFile, "utf8")).data,
    );
    if (!frontmatter.success) throw frontmatter.error;
    frontmatterName = frontmatter.data.name;
  } catch (error) {
    throw new Error(`Installed skill frontmatter is invalid: ${formatSkillIssue(error)}`);
  }
  if (frontmatterName !== target.skill.name) {
    throw new Error("Installed skill frontmatter name does not match the selected remote skill.");
  }
  const skillId = SkillIdSchema.parse(opaquePathId("sk", canonicalPath));
  const discovered = await skills.resolve(target.target, skillId);
  if (discovered.directoryName !== target.skill.name || discovered.path !== canonicalPath) {
    throw new Error("Installed skill identity does not match the selected remote skill.");
  }
  const validation = await skills.validate(target.target, skillId);
  if (!validation.success) {
    throw new Error("Installed skill frontmatter is invalid.");
  }
  return discovered.id;
}

function formatInstallFailure(error: unknown): string {
  return error instanceof Error ? error.message : "The installer returned an invalid result.";
}

/** 单技能 × 单目标的内核两阶段安装结果（收据判别用）。 */
interface KernelPhases {
  entity: "created" | "exists" | "replaced";
  projection: "projected" | "unchanged";
}

/**
 * 内核两阶段安装（批 2.1）：ensureEntity（源 = pinned clone 的技能目录 staging →
 * 实体入库 scope skills store）→ projectEntity（symlink 投影到 Provider root）。
 * force 语义：NAME_EXISTS 时按 error.existing.expectedRevision 显式 replace；
 * 目标被非 ccski 条目占据时先清障（§5.7 不变量由 installedSkillId 复核链收口）。
 */
async function installThroughKernel(
  kernel: RepositoryKernel,
  expected: ExpectedInstallTarget,
  sessionDirectory: string,
  scanSource: string,
  scanCommit: string,
  force: boolean,
): Promise<{ kind: "ok"; phases: KernelPhases } | { kind: "skip" | "failed"; message: string }> {
  const sourceDir = path.resolve(sessionDirectory, expected.skill.relativePath);
  const sourceIdentity = `${scanSource}#${scanCommit}:${expected.skill.relativePath}`;
  const staged = stageSkillSource(sourceDir);
  try {
    const base = {
      scope: "project" as const,
      workspaceDir: expected.workspaceDirectory,
      source: {
        dir: staged,
        source: sourceIdentity,
        sourceType: "git",
        sourceUrl: scanSource,
        skillPath: expected.skill.relativePath,
      },
    };
    let ensured = await kernel.ensureEntity(base);
    if (ensured.kind === "error" && ensured.code === "NAME_EXISTS" && force && ensured.existing) {
      ensured = await kernel.ensureEntity({
        ...base,
        replace: { expectedRevision: ensured.existing.expectedRevision },
      });
    }
    if (ensured.kind === "error") {
      if (ensured.code === "NAME_EXISTS") {
        return {
          kind: "skip",
          message:
            "The skill is already installed from a different source; install with force to replace it.",
        };
      }
      return { kind: "failed", message: kernelFailureMessage(ensured.code) };
    }
    const projected = await kernel.projectEntity({
      scope: "project",
      workspaceDir: expected.workspaceDirectory,
      name: expected.skill.name,
      roots: [expected.providerRoot],
    });
    if (projected.kind === "error") {
      return { kind: "failed", message: kernelFailureMessage(projected.code) };
    }
    const rootResult = projected.results[0];
    if (!rootResult || rootResult.status === "failed") {
      return {
        kind: "failed",
        message: kernelFailureMessage(rootResult?.errorCode),
      };
    }
    return {
      kind: "ok",
      phases: {
        entity: ensured.status,
        projection: rootResult.status === "projected" ? "projected" : "unchanged",
      },
    };
  } finally {
    fs.rmSync(staged, { recursive: true, force: true });
  }
}

/** Preview or install selected skills from one pinned session into selected Workspace Providers. */
async function install(
  sessions: RepositorySessions,
  workspaces: WorkspaceRegistry,
  skills: SkillService,
  kernel: RepositoryKernel,
  input: RepositoryInstallInput,
): Promise<InstallResult> {
  const session = acquireSession(sessions, input.sessionId);
  try {
    const selected = input.skillIds.map((skillId) => {
      const skill = session.skillsById.get(skillId);
      if (!skill) {
        throw new DomainError("NOT_FOUND", `Remote skill not found in scan session: ${skillId}`);
      }
      if (!skill.installable) {
        throw new DomainError(
          "INVALID_OPERATION",
          `Skill ${skill.name} is not installable: ${skill.issues.join(" ")}`,
        );
      }
      return skill;
    });
    const targets = input.targets.map((target) => {
      const scope = workspaces.resolveWritable(target);
      if (!scope.workspaceDirectory) {
        throw new DomainError(
          "UNAVAILABLE",
          `Provider skills directory is not writable: ${scope.workspaceLabel}`,
        );
      }
      try {
        fs.mkdirSync(scope.directory, { recursive: true });
      } catch (error) {
        throw new DomainError(
          "UNAVAILABLE",
          `Provider skills directory is not writable: ${scope.workspaceLabel}`,
          { cause: error },
        );
      }
      return {
        target,
        providerRoot: scope.directory,
        workspaceDirectory: scope.workspaceDirectory,
      };
    });

    if (input.dryRun) {
      const installPreview: InstallPreview = {
        kind: "preview",
        skills: [],
        destinations: [],
        totalInstalls: 0,
      };
      const destinationKeys = new Set<string>();
      for (const target of targets) {
        for (const skill of selected) {
          installPreview.skills.push({ name: skill.name, description: skill.description });
          installPreview.totalInstalls += 1;
          const key = `${target.target.workspaceId}:${target.target.providerId}:${target.providerRoot}`;
          if (destinationKeys.has(key)) continue;
          destinationKeys.add(key);
          installPreview.destinations.push({
            target: target.target,
            path: canonicalDirectory(target.providerRoot),
            exists: true,
          });
        }
      }
      return installPreview;
    }

    const summary = emptySummary(input.targets);
    for (const target of targets) {
      for (const skill of selected) {
        const expected = createExpectedInstallTarget(
          target.target,
          target.providerRoot,
          target.workspaceDirectory,
          skill,
        );
        try {
          const occupied = fs.existsSync(expected.expectedPath);
          if (occupied && !input.force) {
            appendInstallEntry(
              summary,
              failedInstallSkippedEntry(
                expected,
                "The destination already has an entry; install with force to replace it.",
              ),
            );
            continue;
          }
          if (occupied && input.force) {
            const cleared = clearForeignOccupant(expected);
            if (cleared.error !== undefined) {
              appendInstallEntry(summary, failedInstallEntry(expected, cleared.error));
              continue;
            }
          }
          const outcome = await installThroughKernel(
            kernel,
            expected,
            session.directory,
            session.scan.source,
            session.scan.commit,
            input.force === true,
          );
          if (outcome.kind !== "ok") {
            appendInstallEntry(
              summary,
              outcome.kind === "skip"
                ? failedInstallSkippedEntry(expected, outcome.message)
                : failedInstallEntry(expected, outcome.message),
            );
            continue;
          }
          const skillId = await installedSkillId(expected, skills);
          const status: InstallResultEntry["status"] =
            input.force && occupied
              ? "overwritten"
              : outcome.phases.entity === "replaced"
                ? "overwritten"
                : outcome.phases.projection === "projected" || outcome.phases.entity === "created"
                  ? "installed"
                  : "skipped";
          appendInstallEntry(summary, {
            ...expectedInstallEntryBase(expected),
            ...(status === "installed" || status === "overwritten"
              ? { status, skillId }
              : { status }),
          });
        } catch (error) {
          appendInstallEntry(summary, failedInstallEntry(expected, formatInstallFailure(error)));
        }
      }
    }
    return summary;
  } finally {
    releaseSession(session);
  }
}

/** skip 语义的条目（不签发 skillId；计数入 skipped 不入 failed）。 */
function failedInstallSkippedEntry(
  target: ExpectedInstallTarget,
  message: string,
): InstallResultEntry {
  return { ...expectedInstallEntryBase(target), status: "skipped", error: message };
}

/** Dispose all temporary repository snapshots; used during shutdown and tests. */
function clearSessions(sessions: RepositorySessions): void {
  for (const session of sessions.values()) retireSession(session);
  sessions.clear();
}
