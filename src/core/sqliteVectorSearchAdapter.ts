import { glob } from 'glob'
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
import {
  SEARCH_RULESET_VERSIONS,
  createSearchRulesetHash,
  detectReferenceSource,
  normalizeSearchableText,
} from './referenceSearchUtils.js'
import {
  createEmbeddingFunctionFromEnvironment,
  type EmbeddingFunction,
} from './embeddingFunctions.js'

interface VectorDocumentRecord {
  id: string
  title: string
  content: string
  searchable_title: string
  searchable_content: string
  source: 'user' | 'context7'
  file_path: string
}

export interface SqliteVectorSearchAdapterOptions {
  skillDir: string
  embeddingDimensions?: number
  embeddingFunction?: EmbeddingFunction
  candidateMultiplier?: number
  minCandidateLimit?: number
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
      documents.map((doc) => `${doc.searchable_title}\n${doc.searchable_content}`)
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
      rulesetVersion: SEARCH_RULESET_VERSIONS.sqliteVec,
    }

    this.persistIndexState()
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    await this.initialize()
    if (!this.db) return []

    const { topK = 5, where } = options
    const candidateLimit = Math.max(
      topK * (this.options.candidateMultiplier ?? 6),
      this.options.minCandidateLimit ?? 24
    )
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
          ? [JSON.stringify(embedding), where.source, candidateLimit]
          : [JSON.stringify(embedding), candidateLimit])
      ) as Array<{
      id: string
      title: string
      content: string
      source: 'user' | 'context7'
      file_path: string
      distance: number
    }>

    const reranked = this.rerankRows(rows, query).slice(0, topK)

    return reranked.map((row) => ({
      id: row.id,
      title: row.title,
      content: row.content,
      source: row.source,
      file_path: row.file_path,
      score: 1 - row.distance,
      metadata: {
        backendId: 'sqlite-vec',
        distance: row.distance,
        rerankScore: row.rerankScore,
        titleCoverage: row.titleCoverage,
        contentCoverage: row.contentCoverage,
        pathCoverage: row.pathCoverage,
        phraseCoverage: row.phraseCoverage,
        proximityScore: row.proximityScore,
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
      if (
        (this.indexState as SearchIndexState & { rulesetVersion?: string }).rulesetVersion !==
        SEARCH_RULESET_VERSIONS.sqliteVec
      ) {
        this.indexState = null
      }
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
      const rawContent = readFileSync(fullPath, 'utf-8')
      const normalizedContent = this.normalizeDocumentContent(rawContent)
      const title =
        rawContent.split('\n')[0]?.replace(/^#+\s*/, '').trim() ||
        basename(relativePath, '.md').replace(/[-_]/g, ' ')
      return {
        id: relativePath,
        title,
        content: rawContent,
        searchable_title: normalizeSearchableText(title),
        searchable_content: normalizedContent,
        source: detectReferenceSource(relativePath),
        file_path: fullPath,
      }
    })
  }

  private calculateReferencesHash(documents: VectorDocumentRecord[]): string {
    return createSearchRulesetHash(
      documents.flatMap((document) => [
        document.id,
        document.title,
        document.content,
        document.source,
        SEARCH_RULESET_VERSIONS.sqliteVec,
      ])
    )
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

    const environmentEmbedder = createEmbeddingFunctionFromEnvironment(this.getEmbeddingDimensions())
    if (environmentEmbedder) {
      this.embedder = environmentEmbedder
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

  private rerankRows(
    rows: Array<{
      id: string
      title: string
      content: string
      searchable_title?: string
      searchable_content?: string
      source: 'user' | 'context7'
      file_path: string
      distance: number
    }>,
    query: string
  ): Array<
    {
      id: string
      title: string
      content: string
      searchable_title?: string
      searchable_content?: string
      source: 'user' | 'context7'
      file_path: string
      distance: number
    } & {
      rerankScore: number
      titleCoverage: number
      contentCoverage: number
      pathCoverage: number
      phraseCoverage: number
      proximityScore: number
    }
  > {
    const queryTokens = this.normalizeQueryTokens(query)
    const queryPhrases = this.extractQueryPhrases(queryTokens)

    return rows
      .map((row) => {
        const searchableTitle = row.searchable_title ?? normalizeSearchableText(row.title)
        const searchableContent = row.searchable_content ?? this.normalizeDocumentContent(row.content)
        const titleCoverage = this.calculateCoverage(searchableTitle, queryTokens)
        const contentCoverage = this.calculateCoverage(searchableContent, queryTokens)
        const pathCoverage = this.calculatePathCoverage(row.id, queryTokens)
        const phraseCoverage = this.calculatePhraseCoverage(searchableTitle, searchableContent, queryPhrases)
        const proximityScore = this.calculateProximityScore(searchableContent, queryTokens)
        const semanticScore = 1 - row.distance

        const rerankScore =
          semanticScore * 0.45 +
          titleCoverage * 0.12 +
          contentCoverage * 0.12 +
          pathCoverage * 0.18 +
          phraseCoverage * 0.08 +
          proximityScore * 0.05

        return {
          ...row,
          rerankScore,
          titleCoverage,
          contentCoverage,
          pathCoverage,
          phraseCoverage,
          proximityScore,
        }
      })
      .sort((left, right) => {
        if (right.rerankScore !== left.rerankScore) {
          return right.rerankScore - left.rerankScore
        }
        return left.distance - right.distance
      })
  }

  private normalizeQueryTokens(query: string): string[] {
    const stopwords = new Set(['a', 'an', 'and', 'for', 'how', 'in', 'of', 'on', 'or', 'the', 'to', 'with'])
    return (query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((token) => !stopwords.has(token))
  }

  private extractQueryPhrases(queryTokens: string[]): string[] {
    if (queryTokens.length < 2) {
      return []
    }

    return queryTokens
      .slice(0, -1)
      .map((token, index) => `${token} ${queryTokens[index + 1]}`)
      .filter((phrase) => phrase.length >= 8)
  }

  private calculateCoverage(text: string, queryTokens: string[]): number {
    if (queryTokens.length === 0) {
      return 0
    }

    const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
    if (words.length === 0) {
      return 0
    }

    let matched = 0
    for (const token of queryTokens) {
      matched += Math.max(...words.map((word) => this.scoreTokenMatch(word, token)), 0)
    }

    return matched / queryTokens.length
  }

  private calculatePathCoverage(path: string, queryTokens: string[]): number {
    if (queryTokens.length === 0) {
      return 0
    }

    const pathTokens = path
      .toLowerCase()
      .replace(/\.md$/g, '')
      .split(/[^a-z0-9]+/g)
      .filter(Boolean)

    let matched = 0
    for (const token of queryTokens) {
      matched += Math.max(...pathTokens.map((pathToken) => this.scoreTokenMatch(pathToken, token)), 0)
    }

    return matched / queryTokens.length
  }

  private calculatePhraseCoverage(title: string, content: string, phrases: string[]): number {
    if (phrases.length === 0) {
      return 0
    }

    const titleText = title.toLowerCase()
    const contentText = content.toLowerCase()
    let matched = 0
    for (const phrase of phrases) {
      if (titleText.includes(phrase)) {
        matched += 1
        continue
      }
      if (contentText.includes(phrase)) {
        matched += 0.8
      }
    }

    return Math.min(matched / phrases.length, 1)
  }

  private calculateProximityScore(content: string, queryTokens: string[]): number {
    if (queryTokens.length < 2) {
      return 0
    }

    const text = content.toLowerCase()
    const positions = queryTokens
      .map((token) => this.findSubstringPositions(text, token))
      .filter((hits) => hits.length > 0)

    if (positions.length < 2) {
      return 0
    }

    let bestSpan = Number.POSITIVE_INFINITY
    for (let i = 0; i < positions.length - 1; i++) {
      for (const start of positions[i]) {
        for (const end of positions[i + 1]) {
          const span = Math.abs(end - start)
          if (span < bestSpan) {
            bestSpan = span
          }
        }
      }
    }

    if (!Number.isFinite(bestSpan)) {
      return 0
    }

    return 1 / (1 + bestSpan / 24)
  }

  private findSubstringPositions(text: string, token: string): number[] {
    const positions: number[] = []
    let startIndex = 0

    while (startIndex < text.length) {
      const matchIndex = text.indexOf(token, startIndex)
      if (matchIndex === -1) {
        break
      }
      positions.push(matchIndex)
      startIndex = matchIndex + 1
    }

    return positions
  }

  private tokensLooselyMatch(left: string, right: string): boolean {
    return this.scoreTokenMatch(left, right) > 0
  }

  private scoreTokenMatch(left: string, right: string): number {
    if (left === right) {
      return 1
    }

    if (left === right.slice(0, -1) || right === left.slice(0, -1)) {
      return 0.8
    }

    if (left.length >= 5 && right.length >= 5) {
      const [shorter, longer] = left.length <= right.length ? [left, right] : [right, left]
      if (longer.startsWith(shorter) && longer.length - shorter.length <= 3) {
        return 0.65
      }
    }

    return 0
  }

  private normalizeDocumentContent(content: string): string {
    return normalizeSearchableText(content)
  }
}
