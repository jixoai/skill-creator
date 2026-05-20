import MiniSearch from 'minisearch'
import { glob } from 'glob'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type {
  SearchBackendInfo,
  SearchEngine,
  SearchIndexState,
  SearchOptions,
  SearchResult,
} from './searchAdapter.js'

interface MiniSearchDocument {
  id: string
  title: string
  content: string
  source: 'user' | 'context7'
  file_path: string
}

interface MiniSearchHit {
  id: string | number
  title: string
  source: 'user' | 'context7'
  file_path: string
  score: number
  match: Record<string, string[]>
  terms?: string[]
  queryTerms?: string[]
}

const QUERY_STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'for',
  'how',
  'in',
  'of',
  'on',
  'or',
  'the',
  'to',
  'with',
])

export interface MiniSearchAdapterOptions {
  skillDir: string
}

export class MiniSearchAdapter implements SearchEngine {
  private readonly options: MiniSearchAdapterOptions
  private index: MiniSearch<MiniSearchDocument> | null = null
  private documents: MiniSearchDocument[] = []
  private indexState: SearchIndexState | null = null

  constructor(options: MiniSearchAdapterOptions) {
    this.options = options
  }

  async initialize(): Promise<void> {
    if (this.index) return
    this.index = this.createIndex()
    this.loadPersistedIndexIfAvailable()
  }

  async buildIndex(referencesDir: string): Promise<void> {
    await this.initialize()

    const docs = await this.loadDocuments(referencesDir)
    const referencesHash = this.calculateReferencesHash(docs)

    if (this.indexState?.referencesHash === referencesHash && this.index) {
      return
    }

    this.index = this.createIndex()
    this.index.addAll(docs)
    this.documents = docs

    this.indexState = {
      backendId: 'minisearch',
      referencesHash,
      builtAt: new Date().toISOString(),
      documentCount: docs.length,
    }

    this.persistIndex()
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    await this.initialize()

    if (!this.index) return []
    const { topK = 5, where } = options

    const rawResults = this.index.search(query, {
      boost: { title: 3 },
      prefix: true,
      fuzzy: 0.15,
      filter: (result) => {
        if (!where?.source) return true
        return result.source === where.source
      },
    }) as MiniSearchHit[]

    const rerankedResults = this.rerankResults(rawResults, query).slice(0, topK)

    return rerankedResults.map((item) => ({
      id: String(item.id),
      title: String(item.title),
      content: this.documents.find((doc) => doc.id === String(item.id))?.content || '',
      source: item.source,
      file_path: String(item.file_path),
      score: Number(item.score),
      metadata: {
        match: item.match,
        queryTerms: item.queryTerms,
        matchedTerms: item.terms,
        backendId: 'minisearch',
        rawScore: item.score,
        rerankScore: item.rerankScore,
        titleCoverage: item.titleCoverage,
        contentCoverage: item.contentCoverage,
        termDensity: item.termDensity,
      },
    }))
  }

  getBackendInfo(): SearchBackendInfo {
    return {
      backendId: 'minisearch',
      mode: 'fulltext',
      supportsPersistence: true,
      supportsEmbeddings: false,
    }
  }

  isBuilt(): boolean {
    return this.index !== null && this.documents.length > 0
  }

  async getStats(): Promise<{ totalDocuments: number }> {
    return {
      totalDocuments: this.documents.length,
    }
  }

  async getIndexState(): Promise<SearchIndexState> {
    return this.indexState ?? { backendId: 'minisearch' }
  }

  clearIndex(): void {
    this.index = this.createIndex()
    this.documents = []
    this.indexState = null

    const searchDir = this.getSearchDir()
    rmSync(join(searchDir, 'minisearch-index.json'), { force: true })
    rmSync(join(searchDir, 'index-state.json'), { force: true })
  }

  private createIndex(): MiniSearch<MiniSearchDocument> {
    return new MiniSearch<MiniSearchDocument>({
      fields: ['title', 'content'],
      storeFields: ['id', 'title', 'source', 'file_path'],
      searchOptions: {
        boost: { title: 3 },
        prefix: true,
        fuzzy: 0.15,
      },
    })
  }

  private getSearchDir(): string {
    return join(this.options.skillDir, 'search')
  }

  private ensureSearchDir(): void {
    mkdirSync(this.getSearchDir(), { recursive: true })
  }

  private getIndexFilePath(): string {
    return join(this.getSearchDir(), 'minisearch-index.json')
  }

  private getStateFilePath(): string {
    return join(this.getSearchDir(), 'index-state.json')
  }

  private loadPersistedIndexIfAvailable(): void {
    const indexFile = this.getIndexFilePath()
    const stateFile = this.getStateFilePath()
    if (!existsSync(indexFile) || !existsSync(stateFile)) return

    try {
      const serialized = JSON.parse(readFileSync(indexFile, 'utf-8')) as {
        index: string
        documents: MiniSearchDocument[]
      }
      this.documents = serialized.documents
      this.index = MiniSearch.loadJSON<MiniSearchDocument>(serialized.index, {
        fields: ['title', 'content'],
        storeFields: ['id', 'title', 'source', 'file_path'],
        searchOptions: {
          boost: { title: 3 },
          prefix: true,
          fuzzy: 0.15,
        },
      })
      this.indexState = JSON.parse(readFileSync(stateFile, 'utf-8')) as SearchIndexState
    } catch {
      this.index = this.createIndex()
      this.documents = []
      this.indexState = null
    }
  }

  private persistIndex(): void {
    if (!this.index || !this.indexState) return
    this.ensureSearchDir()
    writeFileSync(
      this.getIndexFilePath(),
      JSON.stringify(
        {
          index: JSON.stringify(this.index),
          documents: this.documents,
        },
        null,
        2
      )
    )
    writeFileSync(this.getStateFilePath(), JSON.stringify(this.indexState, null, 2))
  }

  private async loadDocuments(referencesDir: string): Promise<MiniSearchDocument[]> {
    const files = await glob('**/*.md', { cwd: referencesDir })
    return files.map((relativePath) => {
      const fullPath = join(referencesDir, relativePath)
      const content = readFileSync(fullPath, 'utf-8')
      const title =
        content.split('\n')[0]?.replace(/^#+\s*/, '').trim() ||
        basename(relativePath, '.md').replace(/[-_]/g, ' ')
      return {
        id: relativePath,
        title,
        content,
        source: relativePath.includes('context7/') ? 'context7' : 'user',
        file_path: fullPath,
      }
    })
  }

  private calculateReferencesHash(documents: MiniSearchDocument[]): string {
    const hash = createHash('sha256')
    for (const document of documents) {
      hash.update(document.id)
      hash.update(document.content)
    }
    return hash.digest('hex')
  }

  private rerankResults(
    results: MiniSearchHit[],
    query: string
  ): Array<
    MiniSearchHit & {
      rerankScore: number
      titleCoverage: number
      contentCoverage: number
      termDensity: number
    }
  > {
    const queryTokens = this.normalizeQueryTokens(query)

    return results
      .map((result) => {
        const document = this.documents.find((doc) => doc.id === String(result.id))
        const content = document?.content ?? ''
        const titleCoverage = this.calculateCoverage(result.title, queryTokens)
        const contentCoverage = this.calculateCoverage(content, queryTokens)
        const termDensity = this.calculateTermDensity(content, queryTokens)
        const calibratedScore = this.calibrateRawScore(result.score)

        const rerankScore =
          calibratedScore * 0.25 +
          titleCoverage * 0.35 +
          contentCoverage * 0.2 +
          Math.min(termDensity / 2, 1) * 0.2

        return {
          ...result,
          rerankScore,
          titleCoverage,
          contentCoverage,
          termDensity,
        }
      })
      .sort((left, right) => {
        if (right.rerankScore !== left.rerankScore) {
          return right.rerankScore - left.rerankScore
        }

        return right.score - left.score
      })
  }

  private normalizeQueryTokens(query: string): string[] {
    const normalized = query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
    return normalized.filter((token) => !QUERY_STOPWORDS.has(token))
  }

  private calculateCoverage(text: string, queryTokens: string[]): number {
    if (queryTokens.length === 0) {
      return 0
    }

    const normalizedText = text.toLowerCase()
    let matched = 0
    for (const token of queryTokens) {
      if (normalizedText.includes(token)) {
        matched += 1
      }
    }

    return matched / queryTokens.length
  }

  private calculateTermDensity(content: string, queryTokens: string[]): number {
    if (queryTokens.length === 0) {
      return 0
    }

    const words = content.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
    if (words.length === 0) {
      return 0
    }

    let matches = 0
    for (const token of queryTokens) {
      for (const word of words) {
        if (word === token || word === token.slice(0, -1) || token === word.slice(0, -1)) {
          matches += 1
        }
      }
    }

    return matches / Math.sqrt(words.length)
  }

  private calibrateRawScore(score: number): number {
    if (score <= 0) {
      return 0
    }

    return score / (score + 3)
  }
}
