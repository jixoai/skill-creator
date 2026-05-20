/**
 * Search Engine Factory
 * Provides a simple way to create appropriate search engines based on options
 */

import type { SearchEngine } from './searchAdapter.js'
import type { SearchMode } from './searchAdapter.js'
import { AutoSearchAdapter } from './autoSearchAdapter.js'
import { FuzzySearchAdapter } from './fuzzySearchAdapter.js'
import { MiniSearchAdapter } from './miniSearchAdapter.js'
import type { SkillConfig } from '../types/index.js'

export interface SearchEngineOptions {
  /** Search mode */
  mode?: SearchMode
  /** Skill directory for file operations */
  skillDir?: string
  /** References directory containing documentation */
  referencesDir?: string
  /** Skill configuration */
  config?: SkillConfig
  /** Additional options for adapters */
  adapterOptions?: {
    /** Auto search quality threshold */
    qualityThreshold?: number
    /** ChromaDB fallback is legacy-only and only applies to chroma mode */
    enableChromaFallback?: boolean
    /** ChromaDB startup timeout is legacy-only and only applies to chroma mode */
    chromaStartupTimeout?: number
  }
}

/**
 * Build and return appropriate search engine based on options
 */
export async function buildSearchEngine(options: SearchEngineOptions = {}): Promise<SearchEngine> {
  const { mode = 'auto', skillDir = '', referencesDir = '', config, adapterOptions = {} } = options

  switch (mode) {
    case 'auto':
      if (!config) {
        throw new Error('Config is required for auto mode')
      }

      return new AutoSearchAdapter({
        skillDir,
        qualityThreshold: adapterOptions.qualityThreshold ?? 0.3,
      })

    case 'fulltext':
      return new MiniSearchAdapter({
        skillDir,
      })

    case 'fuzzy':
      return new FuzzySearchAdapter()

    case 'vector':
      return new (await import('./sqliteVectorSearchAdapter.js')).SqliteVectorSearchAdapter({
        skillDir,
      })

    case 'chroma':
      if (!config) {
        throw new Error('Config is required for chroma mode')
      }

      return new (await import('./chromaSearchAdapter.js')).ChromaSearchAdapter({
        skillDir,
        collectionName: `skills`,
        startupTimeout: adapterOptions.chromaStartupTimeout ?? 15000,
        enableFallback: adapterOptions.enableChromaFallback ?? true,
      })

    default:
      throw new Error(`Invalid search mode: ${mode}. Use 'auto', 'fulltext', 'fuzzy', 'vector', or 'chroma'.`)
  }
}
