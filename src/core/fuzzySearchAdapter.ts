/**
 * Fuzzy Search Engine Adapter
 * Implements the SearchEngine interface using uFuzzy library
 * Clean, focused implementation - formatting handled by separate formatters
 */

import uFuzzy from '@leeoniya/ufuzzy'
import type {
  SearchEngine,
  SearchResult,
  SearchOptions,
  SearchBackendInfo,
  SearchIndexState,
} from './searchAdapter'
import { glob } from 'glob'
import { readFileSync } from 'node:fs'
import { join, basename } from 'node:path'
import { detectReferenceSource, normalizeReferenceContent } from './referenceSearchUtils.js'

/**
 * uFuzzy-based Search Engine Adapter
 * Clean implementation focused only on search functionality
 */
export class FuzzySearchAdapter implements SearchEngine {
  private documents: Array<{
    id: string
    title: string
    content: string
    source: 'user' | 'context7'
    file_path: string
    metadata: any
  }> = []

  private fuzzy: uFuzzy
  private lastSearchInfo: Map<string, any> = new Map()

  constructor() {
    // Initialize uFuzzy with sensible defaults
    this.fuzzy = new uFuzzy({
      unicode: true,
    })
  }

  async buildIndex(referencesDir: string): Promise<void> {
    const files = await glob('**/*.md', { cwd: referencesDir })

    if (files.length === 0) {
      return
    }

    this.documents = []

    for (const filePath of files) {
      try {
        const fullPath = join(referencesDir, filePath)
        const content = normalizeReferenceContent(readFileSync(fullPath, 'utf-8'))

        // Extract title from first line or filename
        const lines = content.split('\n')
        const title =
          lines[0]?.replace(/^#+\s*/, '').trim() || basename(filePath, '.md').replace(/[-_]/g, ' ')

        const source = detectReferenceSource(filePath)

        this.documents.push({
          id: filePath,
          title,
          content,
          source,
          file_path: fullPath,
          metadata: {
            file_name: basename(filePath),
            file_path: filePath,
          },
        })
      } catch (error) {
        console.warn(`Warning: Failed to index file ${filePath}:`, error)
      }
    }

  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const { topK = 5, where } = options

    if (this.documents.length === 0) {
      return []
    }

    // Filter documents by source if specified
    let searchableDocs = this.documents
    if (where?.source) {
      searchableDocs = this.documents.filter((doc) => doc.source === where.source)
    }

    if (searchableDocs.length === 0) {
      return []
    }

    const results: SearchResult[] = []
    const seenIds = new Set<string>()

    // Prepare search arrays
    const titles = searchableDocs.map((doc) => doc.title)
    const contents = searchableDocs.map((doc) => doc.content)
    const fileNames = searchableDocs.map((doc) => doc.metadata.file_name)

    // Search in titles (highest priority - score 1.0)
    const titleMatches = this.fuzzySearch(titles, query)
    titleMatches.forEach((idx) => {
      const doc = searchableDocs[idx]
      if (doc && !seenIds.has(doc.id)) {
        seenIds.add(doc.id)
        results.push({
          id: doc.id,
          title: doc.title,
          content: doc.content,
          source: doc.source,
          file_path: doc.file_path,
          score: 1.0,
          metadata: {
            ...doc.metadata,
            matchType: 'title',
          },
        })
      }
    })

    // Search in content (medium priority - score 0.7)
    const contentMatches = this.fuzzySearch(contents, query)
    contentMatches.forEach((idx) => {
      const doc = searchableDocs[idx]
      if (doc && !seenIds.has(doc.id)) {
        seenIds.add(doc.id)
        results.push({
          id: doc.id,
          title: doc.title,
          content: doc.content,
          source: doc.source,
          file_path: doc.file_path,
          score: 0.7,
          metadata: {
            ...doc.metadata,
            matchType: 'content',
          },
        })
      }
    })

    // Search in file names (lowest priority - score 0.5)
    const fileNameMatches = this.fuzzySearch(fileNames, query)
    fileNameMatches.forEach((idx) => {
      const doc = searchableDocs[idx]
      if (doc && !seenIds.has(doc.id)) {
        seenIds.add(doc.id)
        results.push({
          id: doc.id,
          title: doc.title,
          content: doc.content,
          source: doc.source,
          file_path: doc.file_path,
          score: 0.5,
          metadata: {
            ...doc.metadata,
            matchType: 'filename',
          },
        })
      }
    })

    // Sort by score and limit to topK
    return results.sort((a, b) => b.score - a.score).slice(0, topK)
  }

  /**
   * Basic fuzzy search using uFuzzy
   */
  private fuzzySearch(haystack: string[], needle: string): number[] {
    const result = this.fuzzySearchWithInfo(haystack, needle)
    return result.indices
  }

  /**
   * Enhanced fuzzy search that returns both indices and detailed info
   */
  private fuzzySearchWithInfo(
    haystack: string[],
    needle: string
  ): {
    indices: number[]
    info: any
  } {
    if (!needle || needle.length < 1) return { indices: [], info: null }
    if (!haystack || haystack.length === 0) return { indices: [], info: null }

    const idxs = this.fuzzy.filter(haystack, needle)

    if (!idxs || idxs.length === 0) {
      return { indices: [], info: null }
    }

    const info = this.fuzzy.info(idxs, haystack, needle)
    const order = this.fuzzy.sort(info, haystack, needle)

    // Store info for later use
    const searchKey = `${needle}-${JSON.stringify(haystack.slice(0, 3))}`
    this.lastSearchInfo.set(searchKey, info)

    const indices = order.map((sortedIdx: number) => {
      return info.idx[sortedIdx]
    })

    return { indices, info }
  }

  isBuilt(): boolean {
    return this.documents.length > 0
  }

  async getStats(): Promise<{ totalDocuments: number }> {
    return { totalDocuments: this.documents.length }
  }

  getBackendInfo(): SearchBackendInfo {
    return {
      backendId: 'ufuzzy',
      mode: 'fuzzy',
      supportsPersistence: false,
      supportsEmbeddings: false,
    }
  }

  async getIndexState(): Promise<SearchIndexState> {
    return {
      backendId: 'ufuzzy',
      documentCount: this.documents.length,
      builtAt: this.documents.length > 0 ? new Date().toISOString() : undefined,
    }
  }

  async searchByPriority(query: string, topK: number = 5): Promise<SearchResult[]> {
    // For fuzzy search, this is the same as regular search
    return this.search(query, { topK })
  }

  clearIndex(): void {
    this.documents = []
    this.lastSearchInfo.clear()
  }
}
