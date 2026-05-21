/**
 * Auto Search Adapter
 * Intelligently selects and switches between search engines based on query characteristics
 * and search quality evaluation
 */

import type {
  SearchEngine,
  SearchResult,
  SearchOptions,
  SearchBackendInfo,
  SearchIndexState,
} from './searchAdapter.js'
import { FuzzySearchAdapter } from './fuzzySearchAdapter.js'
import { MiniSearchAdapter } from './miniSearchAdapter.js'
import { analyzeSearchQuality } from './searchQuality.js'

export interface AutoSearchOptions {
  /** Skill directory */
  skillDir: string
  /** Quality threshold for switching engines */
  qualityThreshold?: number
}

export interface AutoSearchDependencies {
  fulltextAdapter?: SearchEngine
  fuzzyAdapter?: SearchEngine
}

/**
 * Auto Search Adapter
 * Implements intelligent search engine selection and automatic switching
 */
export class AutoSearchAdapter implements SearchEngine {
  private fuzzyAdapter: FuzzySearchAdapter
  private miniSearchAdapter: MiniSearchAdapter
  private options: AutoSearchOptions
  private lastBackendInfo: SearchBackendInfo | null = null
  private lastDecisionReason: string | null = null

  constructor(options: AutoSearchOptions, dependencies: AutoSearchDependencies = {}) {
    this.options = options
    this.fuzzyAdapter = (dependencies.fuzzyAdapter as FuzzySearchAdapter | undefined) ?? new FuzzySearchAdapter()
    this.miniSearchAdapter =
      (dependencies.fulltextAdapter as MiniSearchAdapter | undefined) ??
      new MiniSearchAdapter({
        skillDir: this.options.skillDir,
      })
  }

  async buildIndex(referencesDir: string): Promise<void> {
    await this.miniSearchAdapter.buildIndex(referencesDir)
    await this.fuzzyAdapter.buildIndex(referencesDir)
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const { topK = 5, where } = options
    const qualityThreshold = this.options.qualityThreshold || 0.55

    const fulltextResults = await this.miniSearchAdapter.search(query, { topK, where })

    const quality = this.evaluateSearchQuality(fulltextResults, query)

    if (quality.score >= qualityThreshold) {
      const backendInfo = this.miniSearchAdapter.getBackendInfo()
      this.lastBackendInfo = backendInfo
      this.lastDecisionReason = `Kept fulltext results (${quality.reason}, score ${quality.score.toFixed(2)} >= threshold ${qualityThreshold.toFixed(2)})`
      return fulltextResults.map((result) => ({
        ...result,
        metadata: {
          ...result.metadata,
          autoBackendId: backendInfo.backendId,
          autoRequestedMode: 'auto',
          autoDecisionReason: this.lastDecisionReason,
        },
      }))
    }

    const fuzzyResults = await this.fuzzyAdapter.search(query, { topK, where })
    const backendInfo = this.fuzzyAdapter.getBackendInfo()
    this.lastBackendInfo = backendInfo
    this.lastDecisionReason = `Fell back from fulltext to fuzzy (${quality.reason}, score ${quality.score.toFixed(2)} < threshold ${qualityThreshold.toFixed(2)})`
    return fuzzyResults.map((result) => ({
      ...result,
      metadata: {
        ...result.metadata,
        autoBackendId: backendInfo.backendId,
        autoRequestedMode: 'auto',
        autoDecisionReason: this.lastDecisionReason,
      },
    }))
  }

  /**
   * Evaluate search result quality
   */
  private evaluateSearchQuality(
    results: SearchResult[],
    query: string
  ): { score: number; reason: string } {
    const summary = analyzeSearchQuality(results, query)
    return { score: summary.overallScore, reason: summary.reason }
  }

  isBuilt(): boolean {
    return this.miniSearchAdapter.isBuilt() || this.fuzzyAdapter.isBuilt()
  }

  async getStats(): Promise<{ totalDocuments: number }> {
    const [fulltextStats, fuzzyStats] = await Promise.all([
      this.miniSearchAdapter.getStats(),
      this.fuzzyAdapter.getStats(),
    ])
    return {
      totalDocuments: Math.max(fulltextStats.totalDocuments, fuzzyStats.totalDocuments),
    }
  }

  getBackendInfo(): SearchBackendInfo {
    if (this.lastBackendInfo) {
      return {
        ...this.lastBackendInfo,
        mode: 'auto',
      }
    }

    return {
      backendId: 'minisearch',
      mode: 'auto',
      supportsPersistence: true,
      supportsEmbeddings: false,
    }
  }

  async getIndexState(): Promise<SearchIndexState> {
    return (
      (await this.miniSearchAdapter.getIndexState()) ?? {
        backendId: 'minisearch',
      }
    )
  }

  async searchByPriority(query: string, topK: number = 5): Promise<SearchResult[]> {
    return this.search(query, { topK })
  }

  clearIndex(): void {
    this.fuzzyAdapter.clearIndex()
    this.miniSearchAdapter.clearIndex()
    this.lastBackendInfo = null
    this.lastDecisionReason = null
  }
}
