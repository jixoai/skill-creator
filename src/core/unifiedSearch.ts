/**
 * Unified Search Engine
 * Acts as a coordinator between search adapters and formatters
 * Provides a clean interface for the complete search pipeline
 */

import { join } from 'node:path'
import type {
  SearchResult,
  SearchOptions,
  SearchMode,
  SearchBackendInfo,
  SearchIndexState,
} from './searchAdapter.js'
import type { SearchFormatter, FormattingOptions, FormattedResult } from '../search_format/types.js'
import { createFormatter } from '../search_format/index.js'
import type { SearchEngineOptions } from './searchEngineFactory.js'
import { buildSearchEngine } from './searchEngineFactory.js'

/**
 * Unified search options including formatting preferences
 */
export interface UnifiedSearchOptions extends SearchEngineOptions {
  /** Output format: list, enhanced, or custom */
  format?: 'list' | 'enhanced' | string
  /** Skill path for relative path calculation */
  skillPath?: string
  /** Formatting options */
  formatting?: {
    maxPreviewLength?: number
    showFullContentThreshold?: number
    minScoreForPreview?: number
    showLineNumbers?: boolean
  }
}

/**
 * Unified Search Engine
 * Coordinates search adapters with formatters for complete search experience
 */
export class UnifiedSearchEngine {
  private searchEngine: Awaited<ReturnType<typeof buildSearchEngine>> | null = null
  private formatter: SearchFormatter | null = null
  private options: UnifiedSearchOptions

  constructor(options: UnifiedSearchOptions) {
    this.options = options
    // Note: actual engine creation happens asynchronously
  }

  /**
   * Initialize the search engine
   */
  async initialize(): Promise<void> {
    const {
      skillDir = '',
      referencesDir = '',
      config,
      mode = 'auto',
      adapterOptions = {},
    } = this.options

    this.searchEngine = await buildSearchEngine({
      mode,
      skillDir,
      referencesDir,
      config,
      adapterOptions,
    })

    // Initialize formatter if format is specified
    if (this.options.format) {
      this.formatter = createFormatter(this.options.format as 'list' | 'enhanced')
    }
  }

  /**
   * Build search index
   */
  async buildIndex(referencesDir: string): Promise<void> {
    await this.ensureInitialized()
    if (this.searchEngine) {
      await this.searchEngine.buildIndex(referencesDir)
    }
  }

  /**
   * Search and optionally format results
   */
  async search(
    query: string,
    topK: number = 5,
    where?: Record<string, any>
  ): Promise<SearchResult[]> {
    await this.ensureInitialized()
    if (!this.searchEngine) {
      return []
    }
    return this.searchEngine.search(query, { topK, where })
  }

  /**
   * Search and return formatted results
   */
  async searchAndFormat(
    query: string,
    topK: number = 5,
    where?: Record<string, any>
  ): Promise<FormattedResult[]> {
    const results = await this.search(query, topK, where)

    if (!this.formatter) {
      throw new Error('No formatter configured. Use format option in constructor.')
    }

    const formattingOptions: FormattingOptions = {
      skillPath: this.options.skillPath || process.cwd(),
      maxPreviewLength: this.options.formatting?.maxPreviewLength || 200,
      showFullContentThreshold: this.options.formatting?.showFullContentThreshold || 0.15,
      minScoreForPreview: this.options.formatting?.minScoreForPreview || 0.1,
      showLineNumbers: this.options.formatting?.showLineNumbers ?? true,
    }

    return this.formatter.format(results, formattingOptions)
  }

  /**
   * Check if search index is built
   */
  async isBuilt(): Promise<boolean> {
    await this.ensureInitialized()
    return this.searchEngine?.isBuilt() || false
  }

  /**
   * Get search statistics
   */
  async getStats(): Promise<{ totalDocuments: number }> {
    await this.ensureInitialized()
    return this.searchEngine?.getStats() || { totalDocuments: 0 }
  }

  async getBackendInfo(): Promise<SearchBackendInfo | null> {
    await this.ensureInitialized()
    return this.searchEngine?.getBackendInfo() || null
  }

  async getIndexState(): Promise<SearchIndexState | null> {
    await this.ensureInitialized()
    if (!this.searchEngine?.getIndexState) return null
    return this.searchEngine.getIndexState()
  }

  /**
   * Clear search index
   */
  async clearIndex(): Promise<void> {
    await this.ensureInitialized()
    if (this.searchEngine && 'clearIndex' in this.searchEngine) {
      await this.searchEngine.clearIndex()
    }
  }

  /**
   * Ensure engine is initialized
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.searchEngine) {
      await this.initialize()
    }
  }
}
