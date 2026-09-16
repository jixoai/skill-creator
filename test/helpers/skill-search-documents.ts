/**
 * 测试助手：构造 SkillSearchDocument 与内存 MiniSearch 索引（不落盘）。
 *
 * User input [2026-09-17]: "字段权重、fuzzy/prefix 参数全部集中在 search 模块常量区；
 * 测试经模块导出的引擎工厂与检索助手复用同一配置。"
 *
 * Orthogonal intents:
 *   [1] 从部分字段构造完整 SkillSearchDocument（id 按 canonicalPath digest）。
 *   [2] 以生产引擎配置构建纯内存索引（ranking/benchmark 用例共享，不复制常量）。
 */
import path from "node:path";
import type { SkillSearchDocument } from "../../src/shared/contracts/search.js";
import { SkillIdSchema, type SkillId } from "../../src/shared/contracts/skills.js";
import { opaquePathId } from "../../src/daemon/path-safety.js";
import {
  createSearchMiniSearch,
  searchMiniSearchInstance,
} from "../../src/daemon/skill-search/index.js";
import { createSkillTokenizer } from "../../src/daemon/skill-search/tokenizer.js";
import { ProviderIdSchema } from "../../src/shared/contracts/workspaces.js";

const tokenizer = createSkillTokenizer();

/** 按本机路径语义计算 canonical sk_ id（与 canonicalize 一致的 digest 规则）。 */
export function skillSearchDocumentId(canonicalPath: string): SkillId {
  return SkillIdSchema.parse(opaquePathId("sk", path.resolve(canonicalPath)));
}

export interface TestDocumentOverrides {
  name: string;
  canonicalPath?: string;
  description?: string;
  keywords?: string[];
  triggers?: string[];
  headings?: string;
  body?: string;
  contentHash?: string;
  disabled?: boolean;
  conflict?: boolean;
  invalidFrontmatter?: boolean;
}

/** 构造完整索引文档；缺省 canonicalPath 由 name 派生，contentHash 缺省为占位。 */
export function createSkillSearchDocument(overrides: TestDocumentOverrides): SkillSearchDocument {
  const canonicalPath = path.resolve(overrides.canonicalPath ?? `/repo/${overrides.name}`);
  return {
    id: skillSearchDocumentId(canonicalPath),
    name: overrides.name,
    description: overrides.description ?? "",
    keywords: overrides.keywords ?? [],
    triggers: overrides.triggers ?? [],
    headings: overrides.headings ?? "",
    body: overrides.body ?? "",
    canonicalPath,
    installations: [
      {
        path: `/root/${overrides.name}`,
        workspaceId: "~",
        providerId: ProviderIdSchema.parse("claude-code"),
      },
    ],
    contentHash: overrides.contentHash ?? "0".repeat(64),
    disabled: overrides.disabled ?? false,
    conflict: overrides.conflict ?? false,
    invalidFrontmatter: overrides.invalidFrontmatter ?? false,
  };
}

/** 以生产引擎配置构建纯内存索引并注入文档（不读写 search-index.json）。 */
export function buildIndexWithDocuments(documents: readonly SkillSearchDocument[]) {
  const miniSearch = createSearchMiniSearch(tokenizer);
  miniSearch.addAll(documents);
  return {
    /** 返回冻结查询参数下的 ranking 候选（与生产 search 完全同路）。 */
    search: (query: string) => searchMiniSearchInstance(miniSearch, query),
  };
}
