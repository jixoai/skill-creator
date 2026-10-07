/**
 * skills-CLI 更新检查与应用：读 lock、对比上游 hash、经 ccski 3.0 内核实体 API 重装。
 *
 * 用户原始需求 [2026-07-27]：「读取 lock 文件、对比上游 hash、按需重装并刷新 lock 条目。」
 * 架构决策 [2026-10-07]（ccski-3-host-migration 批 2.2）：
 * - hash 单源：本仓第二 computeSkillFolderHash 实现删除，import 自 ccski
 *   （SKILL_FOLDER_HASH_VERSION="1.7.1"，与 npm:skills 1.7.1 逐位一致）。
 * - hash 代际裁决：存量 lock 的 40-hex（tree-SHA 旧算法）条目视为 stale，触发一次
 *   重装收敛；收敛后覆盖层持有 64-hex 新算法 hash，后续按位对比。
 * - 上游对比统一走浅克隆 + 单源 folder-hash（GitHub Trees API 只作限流/可达性探针：
 *   1.7.1 lock 的 skillFolderHash 是 64-hex folder hash，与 tree SHA 永不相等，
 *   旧 tree-SHA 等值比较对两代条目都失效——见 import-audit.md 批 2 注记）。
 * - apply 重装直连内核：updateEntity（实体稳路径换新，link 投影按路径语义自然解析；
 *   ENTITY_NOT_FOUND 回退 ensureEntity+projectEntity，legacy 物化目录先迁移再投影）。
 * - lockSyncPending 诚实化：npm lock 唯一写者是 skills CLI（分层单写者），宿主只在
 *   内存覆盖层刷新 hash，apply 成功条目如实携带 lockSyncPending:true。
 * 正交意图：
 *   [1] 读取全局 v3 / 项目 v1 lock（safeParse，失败降级为 null，绝不抛错）。
 *   [2] 对比 lock hash 与上游 hash（统一新算法；40-hex 旧代际条目 stale 收敛）。
 *   [3] 经 ccski 内核实体 API 重装过时技能，并在内存覆盖层刷新 hash。
 * 妥协声明：按 D4，apply 成功后仅在 Skill Creator 内存覆盖层刷新 hash，不写第三方
 * lock 文件；用户下次纯用 CLI 时仍会被 CLI 视作过时（lockSyncPending 如实上报），由
 * 后续决策定稿。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execa } from "execa";
import matter from "gray-matter";
import {
  computeSkillFolderHash as ccskiComputeSkillFolderHash,
  ensureEntity as ccskiEnsureEntity,
  projectEntity as ccskiProjectEntity,
  updateEntity as ccskiUpdateEntity,
  type EnsureEntityOptions,
  type EnsureEntityResult,
  type EntityUpdateOptions,
  type EntityUpdateResult,
  type ProjectEntityOptions,
  type ProjectEntityResult,
} from "ccski";
import {
  parseGlobalSkillLock,
  parseProjectSkillLock,
  type LocalSkillLockEntry,
  type SkillLockEntry,
} from "../shared/contracts/skills-lock.js";
import { SkillFrontmatterSchema } from "../shared/contracts/creator.js";
import type {
  ApplyUpdateInput,
  ApplyUpdateResultEntry,
  UpdateCheckInput,
  UpdateCheckResultEntry,
} from "../shared/contracts/skills-update.js";
import type { SkillId, SkillMetadata } from "../shared/contracts/skills.js";
import type { WorkspaceProviderTarget } from "../shared/contracts/workspaces.js";
import { DomainError } from "./domain-error.js";
import type { RepositoryService } from "./repository-service.js";
import { kernelFailureMessage, stageSkillSource } from "./repository-service.js";
import type { SkillsCliProbe } from "./skills-cli-probe.js";
import type { SkillService } from "./skill-service.js";
import type { WorkspaceRegistry } from "./workspace-registry/index.js";

/**
 * ccski folder-hash 单源转发（批 2.2）：签名与 ccski 一致（异步、返回 64-hex）。
 * 本仓历史上的第二实现已删除——两份实现一旦漂移，lock 对比与 stale 裁决全部失真。
 */
export const computeSkillFolderHash = ccskiComputeSkillFolderHash;

/**
 * ccski store-link 内核实体 API seam（批 2.2）：apply 重装的注入面。
 * typed result 不属于异常流；宿主按冻结码映射有限词表，不裸透传内核 message。
 */
export interface SkillsUpdateKernel {
  updateEntity: (options: EntityUpdateOptions) => Promise<EntityUpdateResult>;
  ensureEntity: (options: EnsureEntityOptions) => Promise<EnsureEntityResult>;
  projectEntity: (options: ProjectEntityOptions) => Promise<ProjectEntityResult>;
}

/**
 * hash 代际裁决（批 2.2）：40-hex = 旧算法条目（GitHub tree SHA 时代），无新算法
 * 语义，视为 stale 触发一次重装收敛；64-hex = npm:skills 1.7.1 folder hash（新代际，
 * 与 ccski 单源实现逐位一致）。非 hex 形状（测试桩/未知来源）按新代际对比处理。
 */
export function isLegacyLockHash(hash: string): boolean {
  return /^[0-9a-f]{40}$/.test(hash);
}

/** GitHub Trees API 响应的最小子集；多余字段忽略。 */
interface GithubTreeResponse {
  truncated?: unknown;
  tree?: unknown;
}

/** fetch 适配器；测试可注入 mock，返回响应文本或 reject。 */
export type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}>;

/** git 克隆适配器；测试可注入 mock。 */
export type UpdateCloner = (
  source: string,
  ref: string | undefined,
) => Promise<{ directory: string }>;

/** 把任一值收窄为 GitHub tree 条目数组；结构不兼容返回 null。 */
function parseGithubTree(value: unknown): Array<{ path: string; sha: string }> | null {
  if (!value || typeof value !== "object") return null;
  const response = value as GithubTreeResponse;
  if (!Array.isArray(response.tree)) return null;
  const entries: Array<{ path: string; sha: string }> = [];
  for (const raw of response.tree) {
    if (!raw || typeof raw !== "object") continue;
    const node = raw as Record<string, unknown>;
    const nodePath = typeof node.path === "string" ? node.path : null;
    const nodeSha = typeof node.sha === "string" ? node.sha : null;
    if (nodePath && nodeSha) entries.push({ path: nodePath, sha: nodeSha });
  }
  return entries;
}

/** 从 `https://github.com/owner/repo[.git]` 或 `owner/repo` 解析出 `{owner, repo}`。 */
export function parseGithubSource(source: string): { owner: string; repo: string } | null {
  const trimmed = source.trim();
  if (!trimmed) return null;
  // 形如 owner/repo
  const shortMatch = trimmed.match(/^([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
  if (shortMatch) return { owner: shortMatch[1], repo: shortMatch[2] };
  // 形如 https://github.com/owner/repo[.git][/.git]
  const urlMatch = trimmed.match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/|$)/);
  if (urlMatch) return { owner: urlMatch[1], repo: urlMatch[2] };
  return null;
}

/** 判断 sourceType 是否为 GitHub 源。 */
function isGithubSource(sourceType: string | undefined, sourceUrl: string): boolean {
  if (sourceType) return sourceType.toLowerCase() === "github";
  return /github\.com/.test(sourceUrl);
}

/**
 * 解析 GitHub tree SHA：从 Trees API 响应中找到与技能路径最匹配的目录条目。
 * `skillPath` 可能指向 `skills/foo/SKILL.md` 或目录 `skills/foo`；取其父目录的 tree SHA。
 */
function matchSkillFolderSha(
  entries: ReadonlyArray<{ path: string; sha: string }>,
  skillPath: string | undefined,
): string | null {
  if (!skillPath) return null;
  // 规范化为相对目录路径：去掉末尾的 SKILL.md / 反斜杠。
  const normalized = skillPath
    .replace(/\\/g, "/")
    .replace(/\/SKILL\.md$/i, "")
    .replace(/\/$/, "");
  // 精确匹配目录条目。
  const exact = entries.find((entry) => entry.path === normalized);
  if (exact) return exact.sha;
  // 退化：匹配以 normalized 开头 + 末尾的条目（tree 通常以目录路径为 key）。
  const prefix = entries.find((entry) => entry.path === `${normalized}`);
  return prefix ? prefix.sha : null;
}

/** 全局 lock 路径：`$XDG_STATE_HOME/skills/.skill-lock.json` 或 `~/.agents/.skill-lock.json`。 */
export function globalSkillLockPath(): string {
  const xdgStateHome = process.env.XDG_STATE_HOME;
  if (xdgStateHome) return path.join(xdgStateHome, "skills", ".skill-lock.json");
  return path.join(os.homedir(), ".agents", ".skill-lock.json");
}

/** 项目 lock 路径：cwd 根下的 `skills-lock.json`。 */
export function projectSkillLockPath(cwd: string): string {
  return path.join(cwd, "skills-lock.json");
}

/** 读取并 safeParse 全局 lock；文件缺失 / 非 JSON / 不兼容 → null。 */
export function readGlobalSkillLock(): {
  version: 3;
  skills: Record<string, SkillLockEntry>;
} | null {
  let content: string;
  try {
    content = fs.readFileSync(globalSkillLockPath(), "utf8");
  } catch {
    return null;
  }
  return parseGlobalSkillLock(safeParseJsonValue(content));
}

/** 读取并 safeParse 项目 lock；文件缺失 / 非 JSON / 不兼容 → null。 */
export function readProjectSkillLock(
  cwd: string,
): { version: 1; skills: Record<string, LocalSkillLockEntry> } | null {
  let content: string;
  try {
    content = fs.readFileSync(projectSkillLockPath(cwd), "utf8");
  } catch {
    return null;
  }
  return parseProjectSkillLock(safeParseJsonValue(content));
}

/** 读取全局 lock 内容字符串；隔离文件读取以便测试注入。文件缺失 → null。 */
function readGlobalLockContent(): string | null {
  try {
    return fs.readFileSync(globalSkillLockPath(), "utf8");
  } catch {
    return null;
  }
}

/** 读取项目 lock 内容字符串；隔离文件读取以便测试注入。文件缺失 → null。 */
function readProjectLockContent(cwd: string): string | null {
  try {
    return fs.readFileSync(projectSkillLockPath(cwd), "utf8");
  } catch {
    return null;
  }
}

/** 一条技能的来源 + 当前 hash 聚合（合并全局 v3 与项目 v1 lock）。 */
interface SkillProvenance {
  /** 来源 URL 或 source。 */
  source: string;
  /** 源类型；缺省时按 sourceUrl 是否含 github.com 推断。 */
  sourceType?: string;
  /** 分支或 tag ref。 */
  ref?: string;
  /** 源仓库内子路径。 */
  skillPath?: string;
  /** 当前记录的 hash（v3 的 skillFolderHash 或 v1 的 computedHash）。 */
  currentHash: string;
  /** 是否为 GitHub 源（决定走 Trees API 还是浅克隆）。 */
  github: boolean;
}

/** 按技能名查找并合并全局 / 项目 lock 中的 provenance；未命中返回 null。 */
function lookupProvenance(
  skillName: string,
  globalLock: { skills: Record<string, SkillLockEntry> } | null,
  projectLock: { skills: Record<string, LocalSkillLockEntry> } | null,
): SkillProvenance | null {
  const globalEntry = globalLock?.skills[skillName];
  if (globalEntry) {
    return {
      source: globalEntry.sourceUrl || globalEntry.source,
      sourceType: globalEntry.sourceType,
      ref: globalEntry.ref,
      skillPath: globalEntry.skillPath,
      currentHash: globalEntry.skillFolderHash,
      github: isGithubSource(globalEntry.sourceType, globalEntry.sourceUrl || globalEntry.source),
    };
  }
  const projectEntry = projectLock?.skills[skillName];
  if (projectEntry) {
    const source = projectEntry.sourceUrl || projectEntry.source;
    return {
      source,
      sourceType: projectEntry.sourceType,
      ref: projectEntry.ref,
      skillPath: projectEntry.skillPath,
      currentHash: projectEntry.computedHash,
      github: isGithubSource(projectEntry.sourceType, source),
    };
  }
  return null;
}

/** 解析 GitHub token：优先 GITHUB_TOKEN / GH_TOKEN，否则 null（不自动调用 gh CLI）。 */
function resolveGithubToken(): string | null {
  return process.env.GITHUB_TOKEN || process.env.GH_TOKEN || null;
}

/** 默认 fetch 实现；测试可注入 mock。 */
async function defaultFetch(
  url: string,
  init?: { headers?: Record<string, string> },
): Promise<{ ok: boolean; status: number; text: () => Promise<string> }> {
  const response = await fetch(url, init);
  return {
    ok: response.ok,
    status: response.status,
    text: () => response.text(),
  };
}

/** 默认 git 浅克隆实现；失败 reject。 */
async function defaultClone(
  source: string,
  ref: string | undefined,
): Promise<{ directory: string }> {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "skill-creator-update-"));
  const args = ["clone", "--depth", "1"];
  if (ref) args.push("--branch", ref);
  args.push("--", source, directory);
  try {
    await execa("git", args, { timeout: 60_000 });
    return { directory };
  } catch (error) {
    fs.rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

/** skills-update-service 依赖注入。 */
export interface SkillsUpdateServiceOptions {
  /** fetch 适配器；默认走全局 fetch。 */
  fetch?: FetchLike;
  /** 克隆适配器；默认走 execa git clone。 */
  clone?: UpdateCloner;
  /** ccski 内核实体 API seam；默认走真实内核（批 2.2）。 */
  kernel?: SkillsUpdateKernel;
  /** 全局 lock 内容读取；默认读 `globalSkillLockPath()`。 */
  readGlobalLock?: () => string | null;
  /** 项目 lock 内容读取；默认读 `projectSkillLockPath(cwd)`。 */
  readProjectLock?: (cwd: string) => string | null;
  /** cwd 解析；默认 `process.cwd()`。 */
  resolveCwd?: () => string;
}

/** daemon 生命周期内的 upstream hash 缓存键。 */
function upstreamCacheKey(
  source: string,
  ref: string | undefined,
  skillPath: string | undefined,
): string {
  return `${source}\0${ref ?? ""}\0${skillPath ?? ""}`;
}

/**
 * 创建一个 skills-CLI 更新服务实例。
 *
 * - `checkUpdates(target, skills, input?)`：读 lock、对比上游 hash、返回逐技能状态。
 * - `applyUpdates(target, skillIds, install)`：复用 repository install 重装、内存覆盖层刷新 hash。
 *
 * upstream hash 与重装后的新 hash 都按 daemon 生命周期缓存；apply 成功后失效对应条目。
 */
export function createSkillsUpdateService(
  workspaces: WorkspaceRegistry,
  skills: SkillService,
  probe: SkillsCliProbe,
  repository: RepositoryService,
  options: SkillsUpdateServiceOptions = {},
) {
  const doFetch = options.fetch ?? defaultFetch;
  const doClone = options.clone ?? defaultClone;
  const kernel: SkillsUpdateKernel = options.kernel ?? {
    updateEntity: ccskiUpdateEntity,
    ensureEntity: ccskiEnsureEntity,
    projectEntity: ccskiProjectEntity,
  };
  const readGlobal = options.readGlobalLock ?? readGlobalLockContent;
  const readProject = options.readProjectLock ?? readProjectLockContent;
  const resolveCwd = options.resolveCwd ?? (() => process.cwd());
  // daemon 生命周期内的 upstream hash 缓存（D6）。
  const upstreamHashCache = new Map<string, string>();
  // apply 成功后的内存覆盖层：技能名 → 新 hash。优先于 lock 文件中的旧值。
  const hashOverlay = new Map<string, string>();

  /**
   * 取 GitHub tree SHA：仅作可达性/限流探针（批 2.2：tree SHA 与 folder hash 是
   * 两个算法域，不再是对比值，也不进 upstream hash 缓存——缓存只存单源
   * folder-hash，防止跨算法域污染等值比较）。
   */
  async function fetchGithubTreeSha(
    source: string,
    ref: string | undefined,
    skillPath: string | undefined,
  ): Promise<{ sha: string | null; unavailable: boolean }> {
    const parsed = parseGithubSource(source);
    if (!parsed) return { sha: null, unavailable: true };
    const refOrMain = ref ?? "main";
    const url = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/git/trees/${refOrMain}?recursive=1`;
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "User-Agent": "skill-creator",
    };
    const token = resolveGithubToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    try {
      const response = await doFetch(url, { headers });
      if (response.status === 403 || response.status === 429) {
        return { sha: null, unavailable: true };
      }
      if (!response.ok) return { sha: null, unavailable: true };
      const text = await response.text();
      let jsonValue: unknown = null;
      try {
        jsonValue = JSON.parse(text);
      } catch {
        return { sha: null, unavailable: true };
      }
      const entries = parseGithubTree(jsonValue);
      if (!entries) return { sha: null, unavailable: true };
      const sha = matchSkillFolderSha(entries, skillPath);
      return { sha, unavailable: sha === null };
    } catch {
      return { sha: null, unavailable: true };
    }
  }

  /** 非 GitHub 源：浅克隆后算 on-disk hash；命中缓存直接返回。 */
  async function computeClonedHash(
    source: string,
    ref: string | undefined,
    skillPath: string | undefined,
  ): Promise<{ hash: string | null; failed: boolean }> {
    const key = upstreamCacheKey(source, ref, skillPath);
    const cached = upstreamHashCache.get(key);
    if (cached) return { hash: cached, failed: false };
    let directory: string | null = null;
    try {
      const cloned = await doClone(source, ref);
      directory = cloned.directory;
      const target = skillPath
        ? path.join(cloned.directory, skillPath.replace(/\\/g, "/").replace(/\/SKILL\.md$/i, ""))
        : cloned.directory;
      if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
        return { hash: null, failed: true };
      }
      const hash = await computeSkillFolderHash(target);
      upstreamHashCache.set(key, hash);
      return { hash, failed: false };
    } catch {
      return { hash: null, failed: true };
    } finally {
      if (directory) fs.rmSync(directory, { recursive: true, force: true });
    }
  }

  /**
   * 统一上游 hash（批 2.2）：所有源类型都经浅克隆 + ccski 单源 folder-hash。
   * GitHub 源先做 Trees API 探针——403/429/解析失败时如实 unavailable（限流保护，
   * 不烧克隆）；探针通过仍需克隆才能得到可与 1.7.1 lock 对比的 64-hex hash
   * （tree SHA 与 folder hash 是两个算法域，永不相等，见文件头架构决策）。
   */
  async function fetchUpstreamHash(
    provenance: SkillProvenance,
  ): Promise<{ hash: string | null; unavailable: boolean; failed: boolean }> {
    if (provenance.github) {
      const probeResult = await fetchGithubTreeSha(
        provenance.source,
        provenance.ref,
        provenance.skillPath,
      );
      if (probeResult.unavailable) return { hash: null, unavailable: true, failed: false };
    }
    const cloned = await computeClonedHash(provenance.source, provenance.ref, provenance.skillPath);
    return { hash: cloned.hash, unavailable: false, failed: cloned.failed };
  }

  /** 读并合并全局 + 项目 lock；文件缺失 / 不兼容 → null（不抛错）。 */
  function readLocks(): {
    globalLock: { skills: Record<string, SkillLockEntry> } | null;
    projectLock: { skills: Record<string, LocalSkillLockEntry> } | null;
  } {
    const globalContent = readGlobal();
    const globalLock = globalContent
      ? parseGlobalSkillLock(safeParseJsonValue(globalContent))
      : null;
    const projectContent = readProject(resolveCwd());
    const projectLock = projectContent
      ? parseProjectSkillLock(safeParseJsonValue(projectContent))
      : null;
    return { globalLock, projectLock };
  }

  /**
   * 内核重装单技能（批 2.2）：scan pinned source → 租约内 staging →
   * updateEntity /（ENTITY_NOT_FOUND 时）ensureEntity+projectEntity → 磁盘复核。
   * 成功收据携带 staged 源的新算法 hash（与实体内容逐位一致）；staged 目录恒清理。
   */
  async function reinstallThroughKernel(
    target: WorkspaceProviderTarget,
    skill: SkillMetadata,
    provenance: SkillProvenance,
  ): Promise<{ kind: "ok"; newHash: string } | { kind: "error"; message: string }> {
    const scan = await repository.scan(provenance.source, provenance.ref);
    const remoteSkill = scan.skills.find(
      (candidate) =>
        candidate.name === skill.name ||
        (provenance.skillPath !== undefined &&
          candidate.relativePath ===
            provenance.skillPath.replace(/\\/g, "/").replace(/\/SKILL\.md$/i, "")),
    );
    if (!remoteSkill || !remoteSkill.installable) {
      return { kind: "error", message: `Remote skill not found in source: ${provenance.source}` };
    }
    return repository.withSession(scan.sessionId, async (sessionDirectory) => {
      const sourceDir = path.resolve(sessionDirectory, remoteSkill.relativePath);
      const staged = stageSkillSource(sourceDir);
      try {
        const outcome = await reinstallFromStagedSource(target, skill, provenance, staged);
        if (outcome.kind === "error") return outcome;
        const newHash = await computeSkillFolderHash(staged);
        return { kind: "ok" as const, newHash };
      } finally {
        fs.rmSync(staged, { recursive: true, force: true });
      }
    });
  }

  /** staging 之后的内核重装主体（无清理责任；typed error 一律转有限词表 message）。 */
  async function reinstallFromStagedSource(
    target: WorkspaceProviderTarget,
    skill: SkillMetadata,
    provenance: SkillProvenance,
    staged: string,
  ): Promise<{ kind: "ok" } | { kind: "error"; message: string }> {
    let scope;
    try {
      scope = workspaces.resolveWritable(target);
    } catch (error) {
      return {
        kind: "error",
        message: error instanceof Error ? error.message : "The update target is not writable.",
      };
    }
    const workspaceDirectory = scope.workspaceDirectory;
    if (!workspaceDirectory) {
      return {
        kind: "error",
        message: "Global Workspace providers are not writable installation targets.",
      };
    }
    const providerRoot = scope.directory;
    const entryPath = path.join(providerRoot, skill.directoryName);
    const entryStats = (() => {
      try {
        return fs.lstatSync(entryPath);
      } catch {
        return null;
      }
    })();
    const base = {
      scope: "project" as const,
      workspaceDir: workspaceDirectory,
      source: {
        dir: staged,
        source: provenance.source,
        sourceType: provenance.sourceType ?? (provenance.github ? "github" : "git"),
        sourceUrl: provenance.source,
        skillPath: provenance.skillPath,
      },
    };

    const projectToProvider = async (): Promise<string | null> => {
      const projected = await kernel.projectEntity({
        scope: "project",
        workspaceDir: workspaceDirectory,
        name: skill.name,
        roots: [providerRoot],
      });
      if (projected.kind === "error") return kernelFailureMessage(projected.code);
      const rootResult = projected.results[0];
      if (!rootResult || rootResult.status === "failed") {
        return kernelFailureMessage(rootResult?.errorCode);
      }
      return null;
    };

    const removeLegacyEntry = (): string | null => {
      if (entryStats === null) return null;
      try {
        if (entryStats.isSymbolicLink()) fs.unlinkSync(entryPath);
        else fs.rmSync(entryPath, { recursive: true, force: true });
        return null;
      } catch (error) {
        return `The legacy skill directory could not be replaced: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    };

    const updated = await kernel.updateEntity({ ...base, name: skill.name });
    if (updated.kind === "error" && updated.code === "ENTITY_NOT_FOUND") {
      // legacy skills-CLI 物化目录（从未入实体库）：迁实体 + 投影。provider root
      // 上的 legacy 目录（含实体本地形态 = 实体路径本身）按已批准的重装语义移除
      // ——ENTITY_NOT_FOUND 已证 state 无实体记录，无 ccski 投影可破。
      const removeFailure = removeLegacyEntry();
      if (removeFailure !== null) return { kind: "error", message: removeFailure };
      let ensured = await kernel.ensureEntity(base);
      if (
        ensured.kind === "error" &&
        ensured.code === "NAME_EXISTS" &&
        ensured.existing !== undefined
      ) {
        ensured = await kernel.ensureEntity({
          ...base,
          replace: { expectedRevision: ensured.existing.expectedRevision },
        });
      }
      if (ensured.kind === "error") {
        return { kind: "error", message: kernelFailureMessage(ensured.code) };
      }
      const projectionFailure = await projectToProvider();
      if (projectionFailure !== null) return { kind: "error", message: projectionFailure };
    } else if (updated.kind === "error") {
      return { kind: "error", message: kernelFailureMessage(updated.code) };
    } else if (entryStats !== null && !entryStats.isSymbolicLink()) {
      // 实体已在但 provider root 上是未入账的真实目录（legacy 副本）：重装语义收敛
      // 为投影。entity-local 形态（realpath 在实体库内 = 实体路径本身）保留不动。
      const entityRootDir = path.join(workspaceDirectory, ".agents", "skills");
      const real = fs.realpathSync(entryPath);
      const relative = path.relative(entityRootDir, real);
      const insideEntityRoot =
        relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
      if (!insideEntityRoot) {
        const removeFailure = removeLegacyEntry();
        if (removeFailure !== null) return { kind: "error", message: removeFailure };
        const projectionFailure = await projectToProvider();
        if (projectionFailure !== null) return { kind: "error", message: projectionFailure };
      }
    } else if (entryStats === null) {
      // 实体已在（updateEntity ok）但本 provider 尚无条目 → 补投影。
      const projectionFailure = await projectToProvider();
      if (projectionFailure !== null) return { kind: "error", message: projectionFailure };
    }

    // 磁盘事实复核（不伪装成功）：条目在场 + SKILL.md frontmatter 与身份一致。
    try {
      fs.lstatSync(entryPath);
    } catch {
      return {
        kind: "error",
        message: "The reinstall did not materialize the skill at its destination.",
      };
    }
    let documentName = "";
    try {
      documentName = matterDocumentName(path.join(entryPath, "SKILL.md"));
    } catch {
      return {
        kind: "error",
        message: "The reinstalled skill directory does not contain a parseable SKILL.md.",
      };
    }
    if (documentName !== skill.name) {
      return {
        kind: "error",
        message: "The reinstalled skill identity does not match the approved skill.",
      };
    }
    return { kind: "ok" };
  }

  return {
    /**
     * 检查作用域内 skills-CLI 来源技能是否过时。
     * 缺 lock / 缺 npx / 限流 / 网络失败时，受影响技能标记为 `unavailable` 或 `failed`，不抛错。
     */
    async checkUpdates(
      target: WorkspaceProviderTarget,
      discovered: SkillMetadata[],
      input?: UpdateCheckInput,
    ): Promise<{ results: UpdateCheckResultEntry[] }> {
      void target;
      const probeMap = await probe.probe();
      // 仅处理经 skills-CLI 安装、probe 命中、且投影标记 updatable 的技能。
      // discovered 已由 skills.list(target) 限定在 server-owned 作用域内，无需重复 containment。
      // input.skillIds 可进一步收窄检查范围。
      const candidates = discovered.filter((skill) => {
        if (!probeMap.has(skill.path)) return false;
        if (!skill.updatable) return false;
        if (input?.skillIds && !input.skillIds.includes(skill.id)) return false;
        return true;
      });

      const { globalLock, projectLock } = readLocks();
      const results: UpdateCheckResultEntry[] = [];
      for (const skill of candidates) {
        // 优先用 frontmatter name 查 lock，回退 directoryName。
        const provenance =
          lookupProvenance(skill.name, globalLock, projectLock) ??
          lookupProvenance(skill.directoryName, globalLock, projectLock);
        if (!provenance) {
          // 无 lock 条目 → 视作上游不可达（无法对比）。
          results.push({
            skillId: skill.id,
            name: skill.name,
            currentHash: "",
            upstreamHash: "",
            source: "",
            status: "unavailable",
            error: "No skills-CLI lock entry recorded for this skill.",
          });
          continue;
        }
        // 内存覆盖层优先（apply 成功后立即反映）。
        const overridden = hashOverlay.get(skill.name) ?? hashOverlay.get(skill.directoryName);
        const currentHash = overridden ?? provenance.currentHash;
        // hash 代际裁决（批 2.2）：40-hex 旧算法条目无新算法语义，视为 stale——
        // 状态恒为 updated（待一次重装收敛），不进入等值比较。
        const generationStale = isLegacyLockHash(currentHash);
        const upstream = await fetchUpstreamHash(provenance);
        if (upstream.unavailable) {
          results.push({
            skillId: skill.id,
            name: skill.name,
            currentHash,
            upstreamHash: "",
            source: provenance.source,
            status: "unavailable",
            error: "Upstream is unreachable (rate limited or no network).",
          });
          continue;
        }
        if (upstream.failed || upstream.hash === null) {
          results.push({
            skillId: skill.id,
            name: skill.name,
            currentHash,
            upstreamHash: "",
            source: provenance.source,
            status: "failed",
            error: "Could not compute the upstream skill hash.",
          });
          continue;
        }
        if (generationStale || upstream.hash !== currentHash) {
          results.push({
            skillId: skill.id,
            name: skill.name,
            currentHash,
            upstreamHash: upstream.hash,
            source: provenance.source,
            status: "updated",
          });
        } else {
          results.push({
            skillId: skill.id,
            name: skill.name,
            currentHash,
            upstreamHash: upstream.hash,
            source: provenance.source,
            status: "already-current",
          });
        }
      }
      return { results };
    },

    /**
     * 对批准的过时技能重装（批 2.2：直连 ccski 内核实体 API）。
     * updateEntity 稳路径换新（link 投影按路径语义自然解析）；ENTITY_NOT_FOUND
     * （legacy skills-CLI 物化目录，从未入实体库）回退 ensureEntity+projectEntity。
     * 成功后在内存覆盖层刷新 64-hex 新算法 hash 并携带 lockSyncPending（npm lock
     * 唯一写者是 skills CLI，宿主不写）；内核 typed error / 复核失败如实 failed，
     * 不刷新覆盖层、不伪装成功。
     */
    async applyUpdates(
      target: WorkspaceProviderTarget,
      skillIds: ReadonlyArray<SkillId>,
      input: ApplyUpdateInput,
    ): Promise<{ results: ApplyUpdateResultEntry[] }> {
      const discovered = await skills.list(target, true);
      const probeMap = await probe.probe();
      const { globalLock, projectLock } = readLocks();
      const results: ApplyUpdateResultEntry[] = [];

      for (const skillId of skillIds) {
        const skill = discovered.find((candidate) => candidate.id === skillId);
        if (!skill) {
          results.push({
            skillId,
            name: skillId,
            status: "failed",
            error: "Skill not found in Workspace Provider.",
          });
          continue;
        }
        if (!probeMap.has(skill.path) || !skill.updatable) {
          results.push({
            skillId: skill.id,
            name: skill.name,
            status: "failed",
            error: "Skill is not tracked by the skills CLI.",
          });
          continue;
        }
        const provenance =
          lookupProvenance(skill.name, globalLock, projectLock) ??
          lookupProvenance(skill.directoryName, globalLock, projectLock);
        if (!provenance) {
          results.push({
            skillId: skill.id,
            name: skill.name,
            status: "failed",
            error: "No skills-CLI lock entry recorded for this skill.",
          });
          continue;
        }
        // 执行前再次对比：40-hex 旧代际条目 stale 收敛（不等值短路）；新代际与
        // 上游一致则跳过（spec scenario）。
        const overridden = hashOverlay.get(skill.name) ?? hashOverlay.get(skill.directoryName);
        const currentHash = overridden ?? provenance.currentHash;
        const generationStale = isLegacyLockHash(currentHash);
        let upstream: string | null = null;
        let alreadyCurrent = false;
        try {
          const upstreamResult = await fetchUpstreamHash(provenance);
          if (upstreamResult.unavailable) {
            throw new DomainError(
              "UNAVAILABLE",
              "Upstream is unreachable; cannot verify or apply the update.",
            );
          }
          if (upstreamResult.failed || upstreamResult.hash === null) {
            throw new DomainError("UNAVAILABLE", "Could not compute the upstream skill hash.");
          }
          upstream = upstreamResult.hash;
          if (!generationStale && upstream === currentHash) {
            alreadyCurrent = true;
          }
        } catch (error) {
          results.push({
            skillId: skill.id,
            name: skill.name,
            status: "failed",
            error: error instanceof Error ? error.message : "Update check failed.",
          });
          continue;
        }
        if (alreadyCurrent) {
          results.push({ skillId: skill.id, name: skill.name, status: "already-current" });
          continue;
        }

        // 内核重装：scan pinned source → 租约内 staging → updateEntity（或回退
        // ensureEntity+projectEntity）→ 磁盘事实复核。
        try {
          const outcome = await reinstallThroughKernel(target, skill, provenance);
          if (outcome.kind === "error") {
            results.push({
              skillId: skill.id,
              name: skill.name,
              status: "failed",
              error: outcome.message,
            });
            continue;
          }
          // 覆盖层刷新为重装内容的新算法 hash（= staged 源的 folder hash，与实体
          // 内容逐位一致）——两代来源（github/local）统一收敛到 64-hex。
          hashOverlay.set(skill.name, outcome.newHash);
          hashOverlay.set(skill.directoryName, outcome.newHash);
          probe.invalidate([skill.path]);
          upstreamHashCache.delete(
            upstreamCacheKey(provenance.source, provenance.ref, provenance.skillPath),
          );
          skills.invalidateDiscovery(target);
          results.push({
            skillId: skill.id,
            name: skill.name,
            status: "updated",
            lockSyncPending: true,
          });
        } catch (error) {
          results.push({
            skillId: skill.id,
            name: skill.name,
            status: "failed",
            error: error instanceof Error ? error.message : "Reinstall failed.",
          });
        }
      }
      // input 已由 RPC 层校验；此处仅消费 skillIds 与 target，引用以保持契约一致性。
      void input;
      return { results };
    },

    /** 暴露给测试：直接读取内存覆盖层。 */
    _hashOverlayForTest(): ReadonlyMap<string, string> {
      return hashOverlay;
    },
  };
}

/** skills-update-service 实例接口。 */
export type SkillsUpdateService = ReturnType<typeof createSkillsUpdateService>;

/** 读一个 SKILL.md 的 frontmatter name（外部输入 safeParse；坏文档抛错）。 */
function matterDocumentName(document: string): string {
  const parsed = SkillFrontmatterSchema.safeParse(matter(fs.readFileSync(document, "utf8")).data);
  if (!parsed.success) throw new Error("invalid frontmatter");
  return parsed.data.name;
}

/** 仅做 JSON.parse，不收窄；语法错误返回 null。 */
function safeParseJsonValue(source: string): unknown {
  try {
    return JSON.parse(source);
  } catch {
    return null;
  }
}
