/**
 * skills-CLI 更新检查与应用：读 lock、对比上游 hash、复用 repository install 重装。
 *
 * 用户原始需求 [2026-07-27]：「读取 lock 文件、对比上游 hash、按需重装并刷新 lock 条目。」
 * 正交意图：
 *   [1] 读取全局 v3 / 项目 v1 lock（safeParse，失败降级为 null，绝不抛错）。
 *   [2] 对比 lock hash 与上游 hash（GitHub 源走 Trees API，其余浅克隆算 on-disk hash）。
 *   [3] 复用 repository-service 安装流水线重装过时技能，并在内存覆盖层刷新 hash。
 * 妥协声明：按 Open Question 与 D4，apply 成功后仅在 Skill Creator 内存覆盖层刷新 hash，
 * 不写第三方 lock 文件；用户下次纯用 CLI 时仍会被 CLI 视作过时，由后续决策定稿。
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execa } from "execa";
import {
  parseGlobalSkillLock,
  parseProjectSkillLock,
  type LocalSkillLockEntry,
  type SkillLockEntry,
} from "../shared/contracts/skills-lock.js";
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
import type { SkillsCliProbe } from "./skills-cli-probe.js";
import type { SkillService } from "./skill-service.js";
import type { WorkspaceRegistry } from "./workspace-registry/index.js";

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

/** 按 vercel-labs/skills 算法计算技能目录的 SHA-256（路径升序、拼接路径+内容）。 */
export function computeSkillFolderHash(skillDir: string): string {
  const files: Array<{ relativePath: string; content: Buffer }> = [];
  collectFiles(skillDir, skillDir, files);
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file.relativePath);
    hash.update(file.content);
  }
  return hash.digest("hex");
}

function collectFiles(
  baseDir: string,
  currentDir: string,
  results: Array<{ relativePath: string; content: Buffer }>,
): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(currentDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(baseDir, fullPath, results);
    } else if (entry.isFile()) {
      const relativePath = path.relative(baseDir, fullPath).split(path.sep).join("/");
      results.push({ relativePath, content: fs.readFileSync(fullPath) });
    }
  }
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
  const readGlobal = options.readGlobalLock ?? readGlobalLockContent;
  const readProject = options.readProjectLock ?? readProjectLockContent;
  const resolveCwd = options.resolveCwd ?? (() => process.cwd());
  // daemon 生命周期内的 upstream hash 缓存（D6）。
  const upstreamHashCache = new Map<string, string>();
  // apply 成功后的内存覆盖层：技能名 → 新 hash。优先于 lock 文件中的旧值。
  const hashOverlay = new Map<string, string>();

  /** 取 GitHub tree SHA：命中缓存或调 Trees API；限流 / 网络失败返回 null。 */
  async function fetchGithubTreeSha(
    source: string,
    ref: string | undefined,
    skillPath: string | undefined,
  ): Promise<{ sha: string | null; unavailable: boolean }> {
    const key = upstreamCacheKey(source, ref, skillPath);
    const cached = upstreamHashCache.get(key);
    if (cached) return { sha: cached, unavailable: false };
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
      if (sha) upstreamHashCache.set(key, sha);
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
      const hash = computeSkillFolderHash(target);
      upstreamHashCache.set(key, hash);
      return { hash, failed: false };
    } catch {
      return { hash: null, failed: true };
    } finally {
      if (directory) fs.rmSync(directory, { recursive: true, force: true });
    }
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
        let upstream: string | null = null;
        let unavailable = false;
        let failed = false;
        if (provenance.github) {
          const result = await fetchGithubTreeSha(
            provenance.source,
            provenance.ref,
            provenance.skillPath,
          );
          upstream = result.sha;
          unavailable = result.unavailable;
        } else {
          const result = await computeClonedHash(
            provenance.source,
            provenance.ref,
            provenance.skillPath,
          );
          upstream = result.hash;
          failed = result.failed;
        }
        if (unavailable) {
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
        if (failed || upstream === null) {
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
        if (upstream === currentHash) {
          results.push({
            skillId: skill.id,
            name: skill.name,
            currentHash,
            upstreamHash: upstream,
            source: provenance.source,
            status: "already-current",
          });
        } else {
          results.push({
            skillId: skill.id,
            name: skill.name,
            currentHash,
            upstreamHash: upstream,
            source: provenance.source,
            status: "updated",
          });
        }
      }
      return { results };
    },

    /**
     * 对批准的过时技能重装，复用 repository-service 的 pinned clone + install 流水线。
     * 成功后在内存覆盖层刷新 hash；失败透传 DomainError，不写半装文件。
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
        // 执行前再次对比：若已与上游一致则跳过（spec scenario）。
        const overridden = hashOverlay.get(skill.name) ?? hashOverlay.get(skill.directoryName);
        const currentHash = overridden ?? provenance.currentHash;
        let upstream: string | null = null;
        let alreadyCurrent = false;
        try {
          if (provenance.github) {
            const treeResult = await fetchGithubTreeSha(
              provenance.source,
              provenance.ref,
              provenance.skillPath,
            );
            upstream = treeResult.sha;
            if (treeResult.unavailable) {
              throw new DomainError(
                "UNAVAILABLE",
                "Upstream is unreachable; cannot verify or apply the update.",
              );
            }
          } else {
            const cloneResult = await computeClonedHash(
              provenance.source,
              provenance.ref,
              provenance.skillPath,
            );
            upstream = cloneResult.hash;
            if (cloneResult.failed || upstream === null) {
              throw new DomainError("UNAVAILABLE", "Could not compute the upstream skill hash.");
            }
          }
          if (upstream === currentHash) {
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

        // 复用 repository install 流水线：scan pinned source → install 到原 target。
        try {
          const scan = await repository.scan(provenance.source, provenance.ref);
          const remoteSkill = scan.skills.find(
            (candidate) =>
              candidate.name === skill.name ||
              (provenance.skillPath &&
                candidate.relativePath ===
                  provenance.skillPath.replace(/\\/g, "/").replace(/\/SKILL\.md$/i, "")),
          );
          if (!remoteSkill) {
            throw new DomainError(
              "NOT_FOUND",
              `Remote skill not found in source: ${provenance.source}`,
            );
          }
          await repository.install({
            sessionId: scan.sessionId,
            skillIds: [remoteSkill.id],
            targets: [{ workspaceId: target.workspaceId, providerId: target.providerId }],
            force: true,
          });
          // 安装成功后在内存覆盖层刷新 hash；同时失效 probe + upstream 缓存。
          if (upstream) {
            hashOverlay.set(skill.name, upstream);
            hashOverlay.set(skill.directoryName, upstream);
          }
          probe.invalidate([skill.path]);
          upstreamHashCache.delete(
            upstreamCacheKey(provenance.source, provenance.ref, provenance.skillPath),
          );
          results.push({ skillId: skill.id, name: skill.name, status: "updated" });
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

/** 仅做 JSON.parse，不收窄；语法错误返回 null。 */
function safeParseJsonValue(source: string): unknown {
  try {
    return JSON.parse(source);
  } catch {
    return null;
  }
}
