/**
 * Search Engine Adapter Interface
 * Provides a unified interface for different search implementations
 */

export interface SearchResult {
  id: string
  title: string
  content: string
  source: 'user' | 'context7'
  file_path: string
  score: number
  metadata: Record<string, unknown>
}

export interface SearchOptions {
  topK?: number
  where?: Record<string, any>
  fuzzyThreshold?: number
}

export type SearchMode = 'auto' | 'fulltext' | 'fuzzy' | 'vector' | 'chroma'

export type SearchBackendId = 'minisearch' | 'ufuzzy' | 'sqlite-vec' | 'chroma'

export interface SearchBackendInfo {
  backendId: SearchBackendId
  mode: Exclude<SearchMode, 'chroma'>
  supportsPersistence: boolean
  supportsEmbeddings: boolean
}

export interface SearchIndexState {
  backendId: SearchBackendId
  referencesHash?: string
  builtAt?: string
  documentCount?: number
 }

export interface SearchEngine {
  /**
   * Initialize backend resources if needed
   */
  initialize?(): Promise<void>

  /**
   * Build search index from files
   */
  buildIndex(referencesDir: string): Promise<void>

  /**
   * Search for documents matching the query
   */
  search(query: string, options?: SearchOptions): Promise<SearchResult[]>

  /**
   * Return backend identity/capabilities
   */
  getBackendInfo(): SearchBackendInfo

  /**
   * Check if the search index is built and ready
   */
  isBuilt(): boolean

  /**
   * Get search engine statistics
   */
  getStats(): Promise<{ totalDocuments: number }>

  /**
   * Read index state metadata
   */
  getIndexState?(): Promise<SearchIndexState>

  /**
   * Clear the search index
   */
  clearIndex(): void | Promise<void>
}

/**
 * Simple fuzzy search function for testing
 * Should return array of indices, not undefined values
 */
export interface FuzzySearchFunction {
  (haystack: string[], needle: string): number[]
}
