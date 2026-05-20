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
    })

    return rawResults.slice(0, topK).map((item) => ({
      id: String(item.id),
      title: String(item.title),
      content: this.documents.find((doc) => doc.id === String(item.id))?.content || '',
      source: item.source as 'user' | 'context7',
      file_path: String(item.file_path),
      score: Number(item.score),
      metadata: {
        match: item.match,
        backendId: 'minisearch',
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
}
