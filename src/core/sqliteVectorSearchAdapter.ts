import { glob } from 'glob'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type {
  SearchBackendInfo,
  SearchEngine,
  SearchIndexState,
  SearchOptions,
  SearchResult,
} from './searchAdapter.js'

export interface EmbeddingFunction {
  generate(input: string[]): Promise<number[][]>
}

interface VectorDocumentRecord {
  id: string
  title: string
  content: string
  source: 'user' | 'context7'
  file_path: string
}

export interface SqliteVectorSearchAdapterOptions {
  skillDir: string
  embeddingDimensions?: number
  embeddingFunction?: EmbeddingFunction
}

export class SqliteVectorSearchAdapter implements SearchEngine {
  private readonly options: SqliteVectorSearchAdapterOptions
  private db: DatabaseSync | null = null
  private indexState: SearchIndexState | null = null
  private embedder: EmbeddingFunction | null = null

  constructor(options: SqliteVectorSearchAdapterOptions) {
    this.options = options
    this.embedder = options.embeddingFunction ?? null
  }

  async initialize(): Promise<void> {
    if (this.db) return

    this.ensureSearchDir()
    const runtime = await this.loadRuntimeDependencies()
    this.db = new runtime.DatabaseSync(this.getDbPath(), { allowExtension: true })
    this.db.enableLoadExtension(true)
    runtime.sqliteVec.load(this.db)
    this.prepareSchema()
    this.loadIndexState()
  }

  async buildIndex(referencesDir: string): Promise<void> {
    await this.initialize()
    if (!this.db) return

    const documents = await this.loadDocuments(referencesDir)
    const referencesHash = this.calculateReferencesHash(documents)

    if (this.indexState?.referencesHash === referencesHash) {
      return
    }

    this.db.exec('delete from vec_docs; delete from doc_meta;')

    const insertVec = this.db.prepare('insert into vec_docs (id, embedding) values (?, ?)')
    const insertMeta = this.db.prepare(
      'insert into doc_meta (id, title, content, source, file_path) values (?, ?, ?, ?, ?)'
    )

    const embeddings = await (await this.ensureEmbedder()).generate(
      documents.map((doc) => `${doc.title}\n${doc.content}`)
    )

    for (let i = 0; i < documents.length; i++) {
      const doc = documents[i]
      insertVec.run(doc.id, JSON.stringify(embeddings[i]))
      insertMeta.run(doc.id, doc.title, doc.content, doc.source, doc.file_path)
    }

    this.indexState = {
      backendId: 'sqlite-vec',
      referencesHash,
      builtAt: new Date().toISOString(),
      documentCount: documents.length,
    }

    this.persistIndexState()
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    await this.initialize()
    if (!this.db) return []

    const { topK = 5, where } = options
    const [embedding] = await (await this.ensureEmbedder()).generate([query])
    const rows = this.db
      .prepare(
        `
        select
          vec_docs.id as id,
          doc_meta.title as title,
          doc_meta.content as content,
          doc_meta.source as source,
          doc_meta.file_path as file_path,
          vec_distance_cosine(vec_docs.embedding, ?) as distance
        from vec_docs
        join doc_meta on doc_meta.id = vec_docs.id
        ${where?.source ? 'where doc_meta.source = ?' : ''}
        order by distance asc
        limit ?
      `
      )
      .all(
        ...(where?.source
          ? [JSON.stringify(embedding), where.source, topK]
          : [JSON.stringify(embedding), topK])
      ) as Array<{
      id: string
      title: string
      content: string
      source: 'user' | 'context7'
      file_path: string
      distance: number
    }>

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      content: row.content,
      source: row.source,
      file_path: row.file_path,
      score: 1 - row.distance,
      metadata: {
        backendId: 'sqlite-vec',
        distance: row.distance,
      },
    }))
  }

  getBackendInfo(): SearchBackendInfo {
    return {
      backendId: 'sqlite-vec',
      mode: 'vector',
      supportsPersistence: true,
      supportsEmbeddings: true,
    }
  }

  isBuilt(): boolean {
    return this.indexState?.documentCount != null && this.indexState.documentCount > 0
  }

  async getStats(): Promise<{ totalDocuments: number }> {
    await this.initialize()
    if (!this.db) return { totalDocuments: 0 }
    const result = this.db.prepare('select count(*) as count from doc_meta').get() as { count: number }
    return { totalDocuments: result.count }
  }

  async getIndexState(): Promise<SearchIndexState> {
    return this.indexState ?? { backendId: 'sqlite-vec' }
  }

  clearIndex(): void {
    if (this.db) {
      this.db.exec('delete from vec_docs; delete from doc_meta;')
      this.db.close()
      this.db = null
    }
    this.indexState = null
    rmSync(this.getDbPath(), { force: true })
    rmSync(this.getStateFilePath(), { force: true })
  }

  private getSearchDir(): string {
    return join(this.options.skillDir, 'search')
  }

  private getEmbeddingDimensions(): number {
    return this.options.embeddingDimensions ?? 384
  }

  private ensureSearchDir(): void {
    mkdirSync(this.getSearchDir(), { recursive: true })
  }

  private getDbPath(): string {
    return join(this.getSearchDir(), 'vector-index.db')
  }

  private getStateFilePath(): string {
    return join(this.getSearchDir(), 'vector-index-state.json')
  }

  private prepareSchema(): void {
    if (!this.db) return
    this.db.exec(`
      create virtual table if not exists vec_docs using vec0(
        id text primary key,
        embedding float[${this.getEmbeddingDimensions()}]
      );
      create table if not exists doc_meta (
        id text primary key,
        title text not null,
        content text not null,
        source text not null,
        file_path text not null
      );
    `)
  }

  private loadIndexState(): void {
    const stateFile = this.getStateFilePath()
    if (!existsSync(stateFile)) return
    try {
      this.indexState = JSON.parse(readFileSync(stateFile, 'utf-8')) as SearchIndexState
    } catch {
      this.indexState = null
    }
  }

  private persistIndexState(): void {
    if (!this.indexState) return
    writeFileSync(this.getStateFilePath(), JSON.stringify(this.indexState, null, 2))
  }

  private async loadDocuments(referencesDir: string): Promise<VectorDocumentRecord[]> {
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

  private calculateReferencesHash(documents: VectorDocumentRecord[]): string {
    const hash = createHash('sha256')
    for (const document of documents) {
      hash.update(document.id)
      hash.update(document.content)
    }
    return hash.digest('hex')
  }

  private async loadRuntimeDependencies(): Promise<{
    DatabaseSync: typeof import('node:sqlite').DatabaseSync
    sqliteVec: typeof import('sqlite-vec')
  }> {
    try {
      const [sqlite, sqliteVec] = await Promise.all([import('node:sqlite'), import('sqlite-vec')])
      return {
        DatabaseSync: sqlite.DatabaseSync,
        sqliteVec,
      }
    } catch (error) {
      throw new Error(
        `Vector mode requires node:sqlite support and sqlite-vec at runtime. ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
  }

  static async isRuntimeSupported(): Promise<boolean> {
    try {
      await Promise.all([import('node:sqlite'), import('sqlite-vec')])
      return true
    } catch {
      return false
    }
  }

  private async ensureEmbedder(): Promise<EmbeddingFunction> {
    if (this.embedder) {
      return this.embedder
    }

    const { DefaultEmbeddingFunction } = await import('@chroma-core/default-embed')
    this.embedder = new DefaultEmbeddingFunction({
      modelName: 'Xenova/all-MiniLM-L6-v2',
      quantized: true,
      wasm: true,
    })
    return this.embedder
  }
}
