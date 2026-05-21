/**
 * Skill Creator - Main exports
 */

export { SkillCreator } from './core/skillCreator.js'
export type {
  SearchEngine,
  SearchMode,
  SearchBackendInfo,
  SearchIndexState,
} from './core/searchAdapter.js'
export { FuzzySearchAdapter } from './core/fuzzySearchAdapter.js'
export { MiniSearchAdapter } from './core/miniSearchAdapter.js'
export { SqliteVectorSearchAdapter } from './core/sqliteVectorSearchAdapter.js'
export { UnifiedSearchEngine } from './core/unifiedSearch.js'
export { ContentManager } from './core/contentManager.js'
export { Config } from './utils/config.js'
export { PackageUtils } from './utils/package.js'
export { Context7Utils } from './utils/context7.js'
export type {
  SkillConfig,
  SearchResult,
  ContentStats,
  ContentItem,
  CreateSkillOptions,
  CreateSkillResult,
  UpdateContext7Result,
  DownloadContext7CommandResult,
  CommandIndexingResult,
  AddContentResult,
  AddContentCommandResult,
  BuildIndexCommandResult,
  PackageVersion,
  Context7Library,
  Context7ResolvedLibrary,
} from './types/index.js'
