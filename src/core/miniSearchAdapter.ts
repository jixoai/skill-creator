import MiniSearch from 'minisearch'
import { glob } from 'glob'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
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
  normalizeReferenceContent,
} from './referenceSearchUtils.js'

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
      rulesetVersion: SEARCH_RULESET_VERSIONS.minisearch,
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
        pathCoverage: item.pathCoverage,
        termDensity: item.termDensity,
        phraseCoverage: item.phraseCoverage,
        proximityScore: item.proximityScore,
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
      if (
        (this.indexState as SearchIndexState & { rulesetVersion?: string }).rulesetVersion !==
        SEARCH_RULESET_VERSIONS.minisearch
      ) {
        this.index = this.createIndex()
        this.documents = []
        this.indexState = null
      }
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
      const content = normalizeReferenceContent(readFileSync(fullPath, 'utf-8'))
      const title =
        content.split('\n')[0]?.replace(/^#+\s*/, '').trim() ||
        basename(relativePath, '.md').replace(/[-_]/g, ' ')
      return {
        id: relativePath,
        title,
        content,
        source: detectReferenceSource(relativePath),
        file_path: fullPath,
      }
    })
  }

  private calculateReferencesHash(documents: MiniSearchDocument[]): string {
    return createSearchRulesetHash(
      documents.flatMap((document) => [
        document.id,
        document.title,
        document.content,
        document.source,
        SEARCH_RULESET_VERSIONS.minisearch,
      ])
    )
  }

  private rerankResults(
    results: MiniSearchHit[],
    query: string
  ): Array<
    MiniSearchHit & {
      rerankScore: number
      titleCoverage: number
      contentCoverage: number
      pathCoverage: number
      termDensity: number
      phraseCoverage: number
      proximityScore: number
    }
  > {
    const queryTokens = this.normalizeQueryTokens(query)
    const queryPhrases = this.extractQueryPhrases(query, queryTokens)

    return results
      .map((result) => {
        const document = this.documents.find((doc) => doc.id === String(result.id))
        const content = document?.content ?? ''
        const pathCoverage = this.calculatePathCoverage(document?.id ?? '', queryTokens)
        const titleCoverage = this.calculateCoverage(result.title, queryTokens)
        const contentCoverage = this.calculateCoverage(content, queryTokens)
        const termDensity = this.calculateTermDensity(content, queryTokens)
        const phraseCoverage = this.calculatePhraseCoverage(content, result.title, queryPhrases)
        const proximityScore = this.calculateProximityScore(content, queryTokens)
        const calibratedScore = this.calibrateRawScore(result.score)

        const rerankScore =
          calibratedScore * 0.17 +
          titleCoverage * 0.18 +
          contentCoverage * 0.1 +
          pathCoverage * 0.17 +
          Math.min(termDensity * 1.5, 1) * 0.08 +
          phraseCoverage * 0.18 +
          proximityScore * 0.12

        return {
          ...result,
          rerankScore,
          titleCoverage,
          contentCoverage,
          pathCoverage,
          termDensity,
          phraseCoverage,
          proximityScore,
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

    const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
    if (words.length === 0) {
      return 0
    }

    let matched = 0
    for (const token of queryTokens) {
      if (words.some((word) => this.tokensLooselyMatch(word, token))) {
        matched += 1
      }
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

    if (pathTokens.length === 0) {
      return 0
    }

    let matched = 0
    for (const token of queryTokens) {
      if (pathTokens.some((pathToken) => this.tokensLooselyMatch(pathToken, token))) {
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
      if (words.some((word) => this.tokensLooselyMatch(word, token))) {
        matches += 1
      }
    }

    return matches / Math.sqrt(words.length)
  }

  private extractQueryPhrases(query: string, queryTokens: string[]): string[] {
    const normalizedQuery = query.toLowerCase()
    const explicitPhrases = (normalizedQuery.match(/[a-z0-9_/-]+/g) ?? []).filter((phrase) =>
      /[/_-]/.test(phrase)
    )
    const tokenPairs =
      queryTokens.length >= 2
        ? queryTokens.slice(0, -1).map((token, index) => [
            `${token} ${queryTokens[index + 1]}`,
            `${token}/${queryTokens[index + 1]}`,
            `${token}_${queryTokens[index + 1]}`,
            `${token}-${queryTokens[index + 1]}`,
            `${token}${queryTokens[index + 1]}`,
          ])
        : []
    const multiWordPhrase = queryTokens.length >= 2 ? [queryTokens.join(' ')] : []

    return Array.from(
      new Set(
        [...explicitPhrases, ...multiWordPhrase, ...tokenPairs.flat()].filter(
          (phrase) =>
            phrase.length >= 8 &&
            !QUERY_STOPWORDS.has(phrase) &&
            phrase.split(/[\s/_-]+/).filter(Boolean).length >= 2
        )
      )
    )
  }

  private calculatePhraseCoverage(content: string, title: string, phrases: string[]): number {
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
    if (text.length === 0) {
      return 0
    }

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

  private calibrateRawScore(score: number): number {
    if (score <= 0) {
      return 0
    }

    return score / (score + 3)
  }

  private tokensLooselyMatch(left: string, right: string): boolean {
    if (left === right) {
      return true
    }

    if (left.length >= 5 && right.length >= 5) {
      const [shorter, longer] = left.length <= right.length ? [left, right] : [right, left]
      if (longer.startsWith(shorter) && longer.length - shorter.length <= 3) {
        return true
      }
    }

    return left === right.slice(0, -1) || right === left.slice(0, -1)
  }
}
