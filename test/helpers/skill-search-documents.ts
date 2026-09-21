/**
 * 测试助手：构造 SkillSearchDocument 与生产引擎配置的临时 @jixoai/search 索引。
 *
 * User input [2026-09-17]: "字段权重、fuzzy/prefix 参数全部集中在 search 模块常量区；
 * 测试经模块导出的引擎工厂与检索助手复用同一配置。"（2026-09-21 Phase 2 迁移：
 * MiniSearch 内存索引 → @jixoai/search 临时目录索引，sqlite 后端保证无 native
 * 依赖的确定性。）
 *
 * Orthogonal intents:
 *   [1] 从部分字段构造完整 SkillSearchDocument（id 按 canonicalPath digest）。
 *   [2] 以生产引擎配置构建临时索引（ranking/benchmark 用例共享，不复制常量）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openIndex } from "@jixoai/search";
import type { SkillSearchDocument } from "../../src/shared/contracts/search.js";
import { SkillIdSchema, type SkillId } from "../../src/shared/contracts/skills.js";
import { opaquePathId } from "../../src/daemon/path-safety.js";
import {
  rankingCandidatesFromHits,
  SKILL_SEARCH_ENGINE_LIMIT,
  SKILL_SEARCH_FIELD_SPECS,
  SKILL_SEARCH_FUZZY,
  SKILL_SEARCH_PREFIX,
  toSearchDocument,
} from "../../src/daemon/skill-search/index.js";
import { ProviderIdSchema } from "../../src/shared/contracts/workspaces.js";

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

/**
 * 以生产引擎配置构建临时目录索引并注入文档；close 释放引擎与临时目录。
 * sqlite 后端：ranking 用例只关心冻结打分与召回（两后端逐位一致），无需 native
 * binding；不读写生产 meta.json。
 */
export async function buildIndexWithDocuments(documents: readonly SkillSearchDocument[]) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "skill-search-doc-index-"));
  const index = await openIndex({
    directory,
    fields: SKILL_SEARCH_FIELD_SPECS,
    backend: "sqlite",
    fuzzy: SKILL_SEARCH_FUZZY,
    prefix: SKILL_SEARCH_PREFIX,
  });
  if (documents.length > 0) await index.upsert(documents.map(toSearchDocument));
  return {
    /** 返回冻结查询参数下的 ranking 候选（与生产 search 完全同路）。 */
    search: async (query: string) => {
      const result = await index.search(query, { limit: SKILL_SEARCH_ENGINE_LIMIT });
      return rankingCandidatesFromHits(result.hits);
    },
    close: async () => {
      await index.close();
      fs.rmSync(directory, { recursive: true, force: true });
    },
  };
}
