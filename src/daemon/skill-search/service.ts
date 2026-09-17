/**
 * 用户原始需求 [2026-09-17]：「createSkillSearchService 编排 scan→canonicalize→parse→
 * freshen（含落盘）→search；默认 roots 只来自 provider catalog 与 workspace registry
 * 持久态的 server 侧解析，不接受调用方传入的任意路径。」
 * 修订 [2026-09-18]（search-robustness）：编排升级——排除配置载入（每次维护重读，
 * 摘要进信封）、额外 md 文件集读取（fd 身份校验纪律扩展到文件集）、watcher 事件
 * 驱动（clean 时 search 零扫描、事件后去抖同步刷新）、dispose 生命周期。
 * 正交意图：
 * 1. 默认 root 装配：catalog globalPath（含 env override/XDG/openclaw 约定）+ 持久态 imported roots。
 * 2. 单次调用内完成 freshen+search 的编排；watcher clean 时跳过扫描（纯内存查询）。
 * 3. 文件集读取纪律：身份源 + 额外 md 全部经 O_NOFOLLOW + fstat 身份校验。
 */
import fs from "node:fs";
import path from "node:path";
import { SkillIdSchema } from "../../shared/contracts/skills.js";
import { GLOBAL_WORKSPACE_ID, ProviderIdSchema } from "../../shared/contracts/workspaces.js";
import type { WorkspaceRegistryState } from "../workspace-registry/state.js";
import { createWorkspaceRegistryPersistence } from "../workspace-registry/persistence.js";
import { globalProviderRoot, importedProviderRoot } from "../provider-roots.js";
import { PROVIDER_CATALOG } from "../../shared/provider-catalog.js";
import {
  SkillSearchOptionsSchema,
  type SkillDuplicateGroup,
  type SkillSearchDocument,
  type SkillSearchResult,
} from "../../shared/contracts/search.js";
import { canonicalizeCandidates, type CanonicalSkillScan } from "./canonicalize.js";
import { DomainError } from "../domain-error.js";
import { loadSkillSearchConfig, type SkillSearchConfig } from "./config.js";
import { createSkillSearchIndex } from "./index.js";
import { rankResults } from "./ranking.js";
import { parseSkillDocumentSet } from "./parser.js";
import { scanSkillRoots, type SkillRoot } from "./scanner.js";
import { createSkillTokenizer } from "./tokenizer.js";
import { createSkillSearchWatcher } from "./watcher.js";

/** 只读持久态来源（默认绑定 workspace-registry persistence；测试可替换）。 */
export interface SkillSearchStateSource {
  load: () => WorkspaceRegistryState;
}

/** skill 搜索服务：编排扫描、新鲜度维护、监听与查询。 */
export type SkillSearchService = ReturnType<typeof createSkillSearchEngine>;

/**
 * SKILL.md 在扫描快照后发生替换或变为 symlink 时的读取失败。
 * 该错误宁可终止本轮检索，也不接受无法证明身份的文件字节。
 */
export class SkillSearchDocumentReadError extends DomainError {
  constructor(message: string, options?: { cause?: unknown }) {
    super("UNAVAILABLE", message, options);
    this.name = "SkillSearchDocumentReadError";
  }
}

/**
 * 创建 skill 搜索服务（生产入口）。roots 只来自 provider catalog globalPath 与
 * workspace registry 持久态的 server 侧解析——生产构造不接受任何调用方路径。
 * 索引文件恒由 appDir() 派生（server-owned）。
 */
export function createSkillSearchService(): SkillSearchService {
  return createSkillSearchEngine(defaultResolveRoots(createWorkspaceRegistryPersistence()));
}

/**
 * 测试专用 seam：显式注入 roots（沙箱语料）。仅测试导入，禁止接入 CLI/daemon/
 * RPC 装配——生产 root 解析必须经 createSkillSearchService 的 server-owned 路径。
 */
export function createSkillSearchServiceWithRoots(
  resolveRoots: () => SkillRoot[],
): SkillSearchService {
  return createSkillSearchEngine(resolveRoots);
}

function createSkillSearchEngine(resolveRoots: () => SkillRoot[]) {
  const tokenizer = createSkillTokenizer();
  // 最近一次维护载入的配置（摘要供索引信封校验/落盘；首次维护前为空摘要——
  // 首次 freshen 一定发生在 maintain 内 config 载入之后）。
  let config: SkillSearchConfig | null = null;
  const index = createSkillSearchIndex(tokenizer, () => config?.configDigest ?? "");

  /** 完整维护路径：config 载入 → scan → canonicalize → freshen → watcher reconcile。 */
  function maintain(): void {
    const activeConfig = loadSkillSearchConfig();
    config = activeConfig;
    const roots = resolveRoots();
    const candidates = scanSkillRoots(roots);
    const excluded = new Set(activeConfig.excludedDirs);
    const scans = canonicalizeCandidates(candidates, excluded);
    index.freshen(scans, readSkillSearchDocument);
    watcher.reconcile(canonicalWatchDirs(roots));
  }

  const watcher = createSkillSearchWatcher({
    onFlush: () => maintain(),
    documentCount: () => index.documentCount(),
  });

  /**
   * 维护门：watcher clean 且配置摘要未变时跳过（纯内存查询）。config 是单文件
   * 小读取（~200B），每次查询都重读比对——用户编辑 search-config.toml 后无需
   * 任何文件事件即可触发全量重建（配置变更改变文件集形状，digest 进信封）。
   */
  function ensureMaintained(): void {
    const roots = resolveRoots();
    const configChanged =
      config === null || loadSkillSearchConfig().configDigest !== config.configDigest;
    if (configChanged || !watcher.isClean(canonicalWatchDirs(roots))) {
      maintain();
    }
  }

  return {
    /** 检索本地 skills；query 为空字符串时返回空结果（CLI 层负责把空 query 判为用法错误）。 */
    search: async (
      query: string,
      searchOptions?: Partial<{ limit: number }>,
    ): Promise<SkillSearchResult[]> => {
      const parsedOptions = SkillSearchOptionsSchema.parse(searchOptions ?? {});
      if (query.trim() === "") return [];
      ensureMaintained();
      const hits = index.search(query);
      return rankResults(hits, query, parsedOptions.limit, (text) => tokenizer.tokenize(text));
    },
    /**
     * 内容重复组投影（与 search 共用维护门：clean + 配置未变时零扫描直读内存）。
     */
    duplicates: async (): Promise<SkillDuplicateGroup[]> => {
      ensureMaintained();
      // 索引层 id 是字符串键；跨模块边界收窄回 branded SkillId。
      return index.duplicates().map((group) => ({
        contentHash: group.contentHash,
        members: group.members.map((member) => ({
          ...member,
          id: SkillIdSchema.parse(member.id),
        })),
      }));
    },
    /** watcher 回收（daemon stop coordinator 接线；幂等）。 */
    dispose: (): void => {
      watcher.dispose();
    },
  };
}

/**
 * 去重后的 canonical watch 目录（realpath；不存在/失败目录由 reconcile 的 watch
 * 失败分支处理——它们保持 unwatched，search 回退扫描）。
 */
function canonicalWatchDirs(roots: readonly SkillRoot[]): string[] {
  const dirs = new Set<string>();
  for (const root of roots) {
    try {
      dirs.add(fs.realpathSync(root.rootPath));
    } catch {
      // 不存在的 root 无法 watch：不进集合（isClean 恒 false → 回退扫描）。
    }
  }
  return [...dirs].sort();
}

/** 读取并解析一个 canonical skill 的实际被索引文件集，组合为完整索引文档（供编排与测试复用）。 */
export function readSkillSearchDocument(scan: CanonicalSkillScan): SkillSearchDocument {
  const extras: Array<{ path: string; raw: Buffer }> = [];
  for (const file of scan.files) {
    if (file.path === scan.sourcePath) continue;
    extras.push({ path: file.path, raw: readFileWithIdentity(file.path, file) });
  }
  const sourceRaw = readFileWithIdentity(scan.sourcePath, scan.files[0]);
  const parsed = parseSkillDocumentSet(sourceRaw, extras, path.basename(scan.canonicalPath));
  return {
    id: scan.id,
    name: parsed.name,
    description: parsed.description,
    keywords: parsed.keywords,
    triggers: parsed.triggers,
    headings: parsed.headings,
    body: parsed.body,
    canonicalPath: scan.canonicalPath,
    installations: scan.installations,
    contentHash: parsed.contentHash,
    disabled: scan.disabled,
    conflict: scan.conflict,
    invalidFrontmatter: parsed.invalidFrontmatter,
  };
}

/**
 * fd 纪律读取：POSIX 用 O_NOFOLLOW 关闭末端 symlink 跟随（Windows 不支持该
 * flag，仍由 fstat 的 inode/size 身份校验拒绝扫描快照后的替换），再以扫描时的
 * 四元组核对身份后读全量字节。
 */
function readFileWithIdentity(filePath: string, identity: { ino: number; size: number }): Buffer {
  let fd: number | null = null;
  try {
    try {
      const noFollow = process.platform === "win32" ? 0 : fs.constants.O_NOFOLLOW;
      fd = fs.openSync(filePath, fs.constants.O_RDONLY | noFollow);
    } catch (error) {
      throw new SkillSearchDocumentReadError(
        `Cannot open the scanned skill file ${filePath} without following a symlink.`,
        { cause: error },
      );
    }
    const descriptorStat = fs.fstatSync(fd);
    if (
      !descriptorStat.isFile() ||
      descriptorStat.ino !== identity.ino ||
      descriptorStat.size !== identity.size
    ) {
      throw new SkillSearchDocumentReadError(
        `The scanned skill file identity changed before read: ${filePath}`,
      );
    }
    return fs.readFileSync(fd);
  } catch (error) {
    if (error instanceof SkillSearchDocumentReadError) throw error;
    throw new SkillSearchDocumentReadError(`Cannot read the scanned skill file ${filePath}.`, {
      cause: error,
    });
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

/**
 * 默认 root 装配：catalog 全部 Global roots（globalProviderRoot 含 env override/XDG/
 * openclaw 约定）+ 每个 Imported Workspace 持久态条目的全部 catalog provider roots。
 * 同一物理目录服务多个 provider 时按 provider 分别产出（installations 绑定作用域）。
 */
function defaultResolveRoots(stateSource: SkillSearchStateSource): () => SkillRoot[] {
  return () => {
    const roots: SkillRoot[] = [];
    for (const provider of PROVIDER_CATALOG) {
      const rootPath = globalProviderRoot(provider);
      if (rootPath === null) continue;
      roots.push({
        rootPath,
        workspaceId: GLOBAL_WORKSPACE_ID,
        providerId: ProviderIdSchema.parse(provider.id),
      });
    }
    const state = stateSource.load();
    for (const workspace of state.workspaces) {
      for (const provider of PROVIDER_CATALOG) {
        roots.push({
          rootPath: importedProviderRoot(workspace.path, provider),
          workspaceId: workspace.id,
          providerId: ProviderIdSchema.parse(provider.id),
        });
      }
    }
    return roots;
  };
}
