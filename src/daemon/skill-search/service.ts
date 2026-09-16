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
import { createSkillSearchIndex } from "./index.js";
import { rankResults } from "./ranking.js";
import { parseSkillDocument } from "./parser.js";
import { scanSkillRoots, type SkillRoot } from "./scanner.js";
import { createSkillTokenizer } from "./tokenizer.js";

/** 只读持久态来源（默认绑定 workspace-registry persistence；测试可替换）。 */
export interface SkillSearchStateSource {
  load: () => WorkspaceRegistryState;
}

export interface SkillSearchServiceOptions {
  /** Imported Workspace 持久态来源；缺省绑定 appDir 的 workspaces.json（只读，不走 list() 的 ccski 计数）。 */
  registry?: SkillSearchStateSource;
  /** 覆盖默认 root 解析（测试注入沙箱 roots）；提供后 registry 不参与。 */
  resolveRoots?: () => SkillRoot[];
}

/** skill 搜索服务：单次 search 内完成扫描、新鲜度维护与查询。 */
export type SkillSearchService = ReturnType<typeof createSkillSearchService>;

/** 创建 skill 搜索服务；索引文件恒由 appDir() 派生（server-owned，不接受调用方路径）。 */
export function createSkillSearchService(options: SkillSearchServiceOptions = {}) {
  const tokenizer = createSkillTokenizer();
  const resolveRoots =
    options.resolveRoots ??
    defaultResolveRoots(options.registry ?? createWorkspaceRegistryPersistence());
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
  const raw = fs.readFileSync(scan.sourcePath);
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
