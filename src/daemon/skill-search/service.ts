/**
 * 用户原始需求 [2026-09-17]：「createSkillSearchService 编排 scan→canonicalize→parse→
 * freshen（含落盘）→search；默认 roots 只来自 provider catalog 与 workspace registry
 * 持久态的 server 侧解析，不接受调用方传入的任意路径。」
 * 正交意图：
 * 1. 默认 root 装配：catalog globalPath（含 env override/XDG/openclaw 约定）+ 持久态 imported roots。
 * 2. 单次调用内完成 freshen+search 的无状态编排（不做后台 watcher）。
 */
import fs from "node:fs";
import path from "node:path";
import { GLOBAL_WORKSPACE_ID, ProviderIdSchema } from "../../shared/contracts/workspaces.js";
import type { WorkspaceRegistryState } from "../workspace-registry/state.js";
import { createWorkspaceRegistryPersistence } from "../workspace-registry/persistence.js";
import { globalProviderRoot, importedProviderRoot } from "../provider-roots.js";
import { PROVIDER_CATALOG } from "../../shared/provider-catalog.js";
import {
  SkillSearchOptionsSchema,
  type SkillSearchDocument,
  type SkillSearchResult,
} from "../../shared/contracts/search.js";
import { canonicalizeCandidates, type CanonicalSkillScan } from "./canonicalize.js";
import { DomainError } from "../domain-error.js";
import { createSkillSearchIndex } from "./index.js";
import { rankResults } from "./ranking.js";
import { parseSkillDocument } from "./parser.js";
import { scanSkillRoots, type SkillRoot } from "./scanner.js";
import { createSkillTokenizer } from "./tokenizer.js";

/** 只读持久态来源（默认绑定 workspace-registry persistence；测试可替换）。 */
export interface SkillSearchStateSource {
  load: () => WorkspaceRegistryState;
}

/** skill 搜索服务：单次 search 内完成扫描、新鲜度维护与查询。 */
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
  const index = createSkillSearchIndex(tokenizer);

  return {
    /** 检索本地 skills；query 为空字符串时返回空结果（CLI 层负责把空 query 判为用法错误）。 */
    search: async (
      query: string,
      searchOptions?: Partial<{ limit: number }>,
    ): Promise<SkillSearchResult[]> => {
      const parsedOptions = SkillSearchOptionsSchema.parse(searchOptions ?? {});
      if (query.trim() === "") return [];
      const roots = resolveRoots();
      const candidates = scanSkillRoots(roots);
      const scans = canonicalizeCandidates(candidates);
      index.freshen(scans, readSkillSearchDocument);
      const hits = index.search(query);
      return rankResults(hits, query, parsedOptions.limit, (text) => tokenizer.tokenize(text));
    },
  };
}

/** 读取并解析一个 canonical skill 的实际被索引文件，组合为完整索引文档（供编排与测试复用）。 */
export function readSkillSearchDocument(scan: CanonicalSkillScan): SkillSearchDocument {
  let fd: number | null = null;
  try {
    try {
      // POSIX 用 O_NOFOLLOW 关闭末端 symlink 跟随；Windows 不支持该 flag，仍由
      // fstat 的 inode/size 身份校验拒绝扫描快照后的替换。
      const noFollow = process.platform === "win32" ? 0 : fs.constants.O_NOFOLLOW;
      fd = fs.openSync(scan.sourcePath, fs.constants.O_RDONLY | noFollow);
    } catch (error) {
      throw new SkillSearchDocumentReadError(
        `Cannot open the scanned skill document ${scan.sourcePath} without following a symlink.`,
        { cause: error },
      );
    }

    const descriptorStat = fs.fstatSync(fd);
    if (
      !descriptorStat.isFile() ||
      descriptorStat.ino !== scan.stat.ino ||
      descriptorStat.size !== scan.stat.size
    ) {
      throw new SkillSearchDocumentReadError(
        `The scanned skill document identity changed before read: ${scan.sourcePath}`,
      );
    }

    const raw = fs.readFileSync(fd);
    const parsed = parseSkillDocument(raw, path.basename(scan.canonicalPath));
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
  } catch (error) {
    if (error instanceof SkillSearchDocumentReadError) throw error;
    throw new SkillSearchDocumentReadError(
      `Cannot read the scanned skill document ${scan.sourcePath}.`,
      { cause: error },
    );
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
