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

export interface AutoSearchOptions {
  /** Skill directory */
  skillDir: string
  /** Quality threshold for switching engines */
  qualityThreshold?: number
}

/**
 * Auto Search Adapter
 * Implements intelligent search engine selection and automatic switching
 */
export class AutoSearchAdapter implements SearchEngine {
  private fuzzyAdapter: FuzzySearchAdapter
  private miniSearchAdapter: MiniSearchAdapter
  private options: AutoSearchOptions

  constructor(options: AutoSearchOptions) {
    this.options = options
    this.fuzzyAdapter = new FuzzySearchAdapter()
    this.miniSearchAdapter = new MiniSearchAdapter({
      skillDir: this.options.skillDir,
    })
  }

  async buildIndex(referencesDir: string): Promise<void> {
    await this.miniSearchAdapter.buildIndex(referencesDir)
    await this.fuzzyAdapter.buildIndex(referencesDir)
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const { topK = 5, where } = options
    const qualityThreshold = this.options.qualityThreshold || 0.3

    const fulltextResults = await this.miniSearchAdapter.search(query, { topK, where })

    const quality = this.evaluateSearchQuality(fulltextResults, query)

    if (quality.score >= qualityThreshold) {
      return fulltextResults
    }

    return this.fuzzyAdapter.search(query, { topK, where })
  }

  /**
   * Evaluate search result quality
   */
  private evaluateSearchQuality(
    results: SearchResult[],
    query: string
  ): { score: number; reason: string } {
    if (results.length === 0) {
      return { score: 0, reason: 'No results found' }
    }

    // Quick win: check for exact matches
    const topResult = results[0]
    const queryLower = query.toLowerCase()

    if (topResult.title.toLowerCase().includes(queryLower)) {
      return { score: 1.0, reason: 'Exact title match found' }
    }

    // Check score distribution
    const scores = results.map((r) => r.score)
    const maxScore = Math.max(...scores)
    const avgScore = scores.reduce((sum, score) => sum + score, 0) / scores.length

    // High score threshold
    if (maxScore >= 0.8) {
      return { score: maxScore, reason: 'High quality matches found' }
    }

    // Multiple decent results
    if (results.length >= 3 && avgScore >= 0.5) {
      return { score: avgScore, reason: 'Multiple decent quality results' }
    }

    // Low quality indicators
    if (maxScore < 0.3) {
      return { score: maxScore, reason: 'Low quality matches only' }
    }

    if (results.length < 2) {
      return { score: maxScore * 0.8, reason: 'Too few results' }
    }

    // Default: return average score
    return { score: avgScore, reason: 'Average quality results' }
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
  }
}
