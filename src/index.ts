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
export type {
  SkillConfig,
  SearchResult,
  ContentStats,
  ContentItem,
  CreateSkillOptions,
  CreateSkillResult,
  UpdateContext7Result,
  AddContentResult,
  PackageVersion,
  Context7Library,
} from './types/index.js'
