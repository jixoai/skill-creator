import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { normalizeSearchMode } from '../../src/commands/shared.js'
import { AutoSearchAdapter } from '../../src/core/autoSearchAdapter.js'
import { MiniSearchAdapter } from '../../src/core/miniSearchAdapter.js'
import { buildSearchEngine } from '../../src/core/searchEngineFactory.js'
import type { SearchBackendInfo, SearchEngine, SearchIndexState, SearchOptions, SearchResult } from '../../src/core/searchAdapter.js'
import { SqliteVectorSearchAdapter } from '../../src/core/sqliteVectorSearchAdapter.js'
import { createTempDir, cleanupTempDir } from '../test-utils.js'

class FakeSearchEngine implements SearchEngine {
  private readonly backendInfo: SearchBackendInfo
  private readonly results: SearchResult[]

  constructor(backendInfo: SearchBackendInfo, results: SearchResult[]) {
    this.backendInfo = backendInfo
    this.results = results
  }

  async buildIndex(): Promise<void> {}

  async search(_query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const limit = options.topK ?? this.results.length
    return this.results.slice(0, limit)
  }

  getBackendInfo(): SearchBackendInfo {
    return this.backendInfo
  }

  isBuilt(): boolean {
    return true
  }

  async getStats(): Promise<{ totalDocuments: number }> {
    return { totalDocuments: this.results.length }
  }

  async getIndexState(): Promise<SearchIndexState> {
    return {
      backendId: this.backendInfo.backendId,
      documentCount: this.results.length,
    }
  }

  clearIndex(): void {}
}

describe('search runtime contract', () => {
  it('normalizes chroma mode to vector at the CLI boundary', () => {
    expect(normalizeSearchMode('chroma')).toBe('vector')
    expect(normalizeSearchMode('auto')).toBe('auto')
    expect(normalizeSearchMode('fulltext')).toBe('fulltext')
    expect(normalizeSearchMode('fuzzy')).toBe('fuzzy')
    expect(normalizeSearchMode('vector')).toBe('vector')
  })

  it('builds auto mode on the lightweight runtime path', async () => {
    const engine = await buildSearchEngine({
      mode: 'auto',
      skillDir: '/tmp/skill',
      config: {},
    })
    const backend = engine.getBackendInfo()
    expect(backend.mode).toBe('auto')
    expect(backend.backendId).toBe('minisearch')
  })

  it('resolves chroma mode to the vector backend inside the engine factory', async () => {
    const engine = await buildSearchEngine({
      mode: 'chroma',
      skillDir: '/tmp/skill',
      config: {},
    })

    const backend = engine.getBackendInfo()
    expect(backend.mode).toBe('vector')
    expect(backend.backendId).toBe('sqlite-vec')
  })

  it('persists fulltext index artifacts under assets/search', async () => {
    const tempDir = createTempDir('search-runtime-fulltext-')
    const assetsDir = join(tempDir, 'assets')
    const referencesDir = join(assetsDir, 'references')
    const userDir = join(referencesDir, 'user')
    mkdirSync(userDir, { recursive: true })
    writeFileSync(
      join(userDir, 'react_patterns.md'),
      '# React Patterns\n\nUse composition and stable state boundaries for complex components.\n'
    )

    const adapter = new MiniSearchAdapter({ skillDir: assetsDir })
    await adapter.buildIndex(referencesDir)

    expect(existsSync(join(assetsDir, 'search', 'minisearch-index.json'))).toBe(true)
    expect(existsSync(join(assetsDir, 'search', 'index-state.json'))).toBe(true)

    const state = JSON.parse(readFileSync(join(assetsDir, 'search', 'index-state.json'), 'utf-8')) as {
      backendId: string
      documentCount: number
    }
    expect(state.backendId).toBe('minisearch')
    expect(state.documentCount).toBe(1)

    cleanupTempDir(tempDir)
  })

  it('supports explicit vector mode with an injected embedder', async () => {
    const tempDir = createTempDir('search-runtime-vector-')
    const assetsDir = join(tempDir, 'assets')
    const referencesDir = join(assetsDir, 'references')
    const userDir = join(referencesDir, 'user')
    mkdirSync(userDir, { recursive: true })
    writeFileSync(
      join(userDir, 'router_notes.md'),
      '# Router Notes\n\nRoute loaders should stay deterministic and cancelable.\n'
    )

    const adapter = new SqliteVectorSearchAdapter({
      skillDir: assetsDir,
      embeddingDimensions: 4,
      embeddingFunction: {
        async generate(input: string[]) {
          return input.map((text) => {
            const normalized = text.toLowerCase()
            return [
              normalized.includes('router') ? 1 : 0,
              normalized.includes('loaders') ? 1 : 0,
              normalized.includes('state') ? 1 : 0,
              normalized.length / 1000,
            ]
          })
        },
      },
    })

    await adapter.buildIndex(referencesDir)
    const results = await adapter.search('router loaders', { topK: 1 })

    expect(results).toHaveLength(1)
    expect(results[0]?.title).toBe('Router Notes')
    expect(existsSync(join(assetsDir, 'search', 'vector-index.db'))).toBe(true)
    expect(existsSync(join(assetsDir, 'search', 'vector-index-state.json'))).toBe(true)

    cleanupTempDir(tempDir)
  })

  it('keeps vector recall stable when topK is small and reranks path-specific matches above broader docs', async () => {
    const tempDir = createTempDir('search-runtime-vector-recall-')
    const assetsDir = join(tempDir, 'assets')
    const referencesDir = join(assetsDir, 'references')
    const officialOverviewDir = join(referencesDir, 'official', 'overview')
    const officialProtocolDir = join(referencesDir, 'official', 'protocol')
    const userDir = join(referencesDir, 'user')
    mkdirSync(officialOverviewDir, { recursive: true })
    mkdirSync(officialProtocolDir, { recursive: true })
    mkdirSync(userDir, { recursive: true })

    writeFileSync(
      join(userDir, 'acp-multi-agent-collaboration.md'),
      '# ACP 多 Agent 协作模式\n\nMulti agent collaboration patterns for orchestrating specialist agents.\n'
    )
    writeFileSync(
      join(officialOverviewDir, 'agents.md'),
      '# ACP-Compatible Agents\n\nAgents collaborate through shared protocols and agent planning.\n'
    )
    writeFileSync(
      join(officialOverviewDir, 'introduction.md'),
      '# Agent Client Protocol Introduction\n\nThe protocol supports agents, clients, and collaboration patterns.\n'
    )
    writeFileSync(
      join(officialProtocolDir, 'agent-plan.md'),
      '# Agent Plan Protocol\n\nAgent planning coordinates multiple tool and agent steps.\n'
    )

    const embeddingMap = new Map<string, number[]>([
      ['ACP 多 Agent 协作模式\n# ACP 多 Agent 协作模式\n\nMulti agent collaboration patterns for orchestrating specialist agents.\n', [0.2, 0.1, 0.2, 0]],
      ['ACP-Compatible Agents\n# ACP-Compatible Agents\n\nAgents collaborate through shared protocols and agent planning.\n', [0.9, 0.8, 0.7, 0]],
      ['Agent Client Protocol Introduction\n# Agent Client Protocol Introduction\n\nThe protocol supports agents, clients, and collaboration patterns.\n', [0.85, 0.75, 0.7, 0]],
      ['Agent Plan Protocol\n# Agent Plan Protocol\n\nAgent planning coordinates multiple tool and agent steps.\n', [0.8, 0.7, 0.6, 0]],
      ['multi agent collaboration', [1, 1, 1, 0]],
    ])

    const adapter = new SqliteVectorSearchAdapter({
      skillDir: assetsDir,
      embeddingDimensions: 4,
      embeddingFunction: {
        async generate(input: string[]) {
          return input.map((text) => {
            const vector = embeddingMap.get(text)
            if (!vector) {
              throw new Error(`Missing test embedding for: ${text}`)
            }
            return vector
          })
        },
      },
    })

    await adapter.buildIndex(referencesDir)
    const results = await adapter.search('multi agent collaboration', { topK: 3 })

    expect(results[0]?.id).toBe('user/acp-multi-agent-collaboration.md')
    expect(results[0]?.source).toBe('user')
    expect(results[1]?.source).toBe('context7')

    cleanupTempDir(tempDir)
  })

  it('normalizes camelCase code identifiers for vector reranking and preserves official source classification', async () => {
    const tempDir = createTempDir('search-runtime-vector-camel-')
    const assetsDir = join(tempDir, 'assets')
    const referencesDir = join(assetsDir, 'references')
    const officialDir = join(referencesDir, 'official', 'protocol')
    const userDir = join(referencesDir, 'user', 'implementation')
    mkdirSync(officialDir, { recursive: true })
    mkdirSync(userDir, { recursive: true })

    writeFileSync(
      join(officialDir, 'prompt-turn.md'),
      '# Prompt Turn Protocol\n\nAgents stream text responses via session update notifications during a prompt turn.\n'
    )
    writeFileSync(
      join(userDir, '03-tools-streaming.md'),
      '# 工具系统和流式响应\n\nUse the StreamResponse class to emit stream response events.\n'
    )

    const embeddingMap = new Map<string, number[]>([
      ['Prompt Turn Protocol\n# Prompt Turn Protocol\n\nAgents stream text responses via session update notifications during a prompt turn.\n', [0.92, 0.9, 0.9, 0]],
      ['工具系统和流式响应\n# 工具系统和流式响应\n\nUse the Stream Response class to emit stream response events.\n', [0.3, 0.25, 0.2, 0]],
      ['stream response', [1, 1, 1, 0]],
    ])

    const adapter = new SqliteVectorSearchAdapter({
      skillDir: assetsDir,
      embeddingDimensions: 4,
      embeddingFunction: {
        async generate(input: string[]) {
          return input.map((text) => {
            const vector = embeddingMap.get(text)
            if (!vector) {
              throw new Error(`Missing test embedding for: ${text}`)
            }
            return vector
          })
        },
      },
    })

    await adapter.buildIndex(referencesDir)
    const results = await adapter.search('stream response', { topK: 2 })

    expect(results[0]?.id).toBe('user/implementation/03-tools-streaming.md')
    expect(results[1]?.source).toBe('context7')

    cleanupTempDir(tempDir)
  })

  it('reranks fulltext results to prefer better query coverage over raw lexical score spikes', async () => {
    const tempDir = createTempDir('search-runtime-rerank-')
    const assetsDir = join(tempDir, 'assets')
    const referencesDir = join(assetsDir, 'references')
    const userDir = join(referencesDir, 'user')
    const officialDir = join(referencesDir, 'context7', 'protocol')
    mkdirSync(userDir, { recursive: true })
    mkdirSync(officialDir, { recursive: true })

    writeFileSync(
      join(userDir, 'developer-guide.md'),
      `# ACP 开发者指南：开发新的 Agent\n\nTool tool tool tools results result toolcall toolinput toolresponse.\n`.repeat(
        20
      )
    )
    writeFileSync(
      join(officialDir, 'tool-calls.md'),
      '# Tool Calls Protocol\n\nThis document describes how agents communicate tool call execution results.\n'
    )

    const adapter = new MiniSearchAdapter({ skillDir: assetsDir })
    await adapter.buildIndex(referencesDir)
    const results = await adapter.search('how to stream tool results', { topK: 2 })

    expect(results[0]?.title).toBe('Tool Calls Protocol')
    expect(results[1]?.title).toBe('ACP 开发者指南：开发新的 Agent')

    cleanupTempDir(tempDir)
  })

  it('boosts phrase and proximity matches for protocol-style queries', async () => {
    const tempDir = createTempDir('search-runtime-phrase-')
    const assetsDir = join(tempDir, 'assets')
    const referencesDir = join(assetsDir, 'references')
    const userDir = join(referencesDir, 'user')
    const officialDir = join(referencesDir, 'context7', 'protocol')
    mkdirSync(userDir, { recursive: true })
    mkdirSync(officialDir, { recursive: true })

    writeFileSync(
      join(userDir, 'architecture.md'),
      '# ACP Architecture Overview\n\nPermission request workflow. Delete operations require user approval. Logs may be removed after approval.\n'
    )
    writeFileSync(
      join(officialDir, 'tool-calls.md'),
      '# Tool Calls Protocol\n\nAgents can invoke session/request_permission before executing sensitive operations.\nDelete old logs requires a delete tool call with permission request.\n'
    )

    const adapter = new MiniSearchAdapter({ skillDir: assetsDir })
    await adapter.buildIndex(referencesDir)
    const results = await adapter.search('permission request delete logs', { topK: 2 })

    expect(results[0]?.title).toBe('Tool Calls Protocol')
    expect(results[1]?.title).toBe('ACP Architecture Overview')

    cleanupTempDir(tempDir)
  })

  it('prefers compound stream response matches over broad guide text', async () => {
    const tempDir = createTempDir('search-runtime-stream-response-')
    const assetsDir = join(tempDir, 'assets')
    const referencesDir = join(assetsDir, 'references')
    const userDir = join(referencesDir, 'user')
    mkdirSync(userDir, { recursive: true })

    writeFileSync(
      join(userDir, 'developer-guide.md'),
      '# ACP 开发者指南：开发新的 Agent\n\nThis guide discusses stream handling and general response shaping for custom agents.\n'
    )
    writeFileSync(
      join(userDir, 'tools-streaming.md'),
      '# 工具系统和流式响应\n\nThis guide explains stream response handling with the StreamResponse class.\n\nexport class StreamResponse implements StreamHandler {\n  start() {}\n  write() {}\n  end() {}\n}\n'
    )

    const adapter = new MiniSearchAdapter({ skillDir: assetsDir })
    await adapter.buildIndex(referencesDir)
    const results = await adapter.search('stream response', { topK: 2 })

    expect(results[0]?.title).toBe('工具系统和流式响应')
    expect(results[1]?.title).toBe('ACP 开发者指南：开发新的 Agent')

    cleanupTempDir(tempDir)
  })

  it('uses localized path slugs for type safety queries without relying on linked paths', async () => {
    const tempDir = createTempDir('search-runtime-type-safety-')
    const assetsDir = join(tempDir, 'assets')
    const referencesDir = join(assetsDir, 'references')
    const userDir = join(referencesDir, 'user')
    const bestPracticesDir = join(userDir, 'best-practices')
    mkdirSync(userDir, { recursive: true })
    mkdirSync(bestPracticesDir, { recursive: true })

    writeFileSync(
      join(userDir, 'project-setup.md'),
      '# TypeScript 项目设置和类型定义\n\n遵循 type-safe is runtime-safe 原则，配置严格模式并导出类型定义。\n'
    )
    writeFileSync(
      join(bestPracticesDir, '01-type-safety.md'),
      '# 类型安全设计\n\nType safety should be designed first, then enforced through schemas and narrowing.\n'
    )
    writeFileSync(
      join(userDir, 'tools-streaming.md'),
      '# 工具系统和流式响应\n\n继续阅读： [类型安全设计](../best-practices/01-type-safety.md)\n'
    )

    const adapter = new MiniSearchAdapter({ skillDir: assetsDir })
    await adapter.buildIndex(referencesDir)
    const results = await adapter.search('type safety', { topK: 3 })

    expect(results[0]?.title).toBe('类型安全设计')
    expect(results.some((result) => result.title === '工具系统和流式响应')).toBe(false)

    cleanupTempDir(tempDir)
  })

  it('prefers direct tool calls coverage over incidental tool results mentions', async () => {
    const tempDir = createTempDir('search-runtime-tool-results-')
    const assetsDir = join(tempDir, 'assets')
    const referencesDir = join(assetsDir, 'references')
    const officialDir = join(referencesDir, 'context7', 'protocol')
    mkdirSync(officialDir, { recursive: true })

    writeFileSync(
      join(officialDir, 'prompt-turn.md'),
      '# Prompt Turn Protocol\n\nStreaming updates continue during the turn. Tool results are sent back to the language model for continued processing.\n'
    )
    writeFileSync(
      join(officialDir, 'tool-calls.md'),
      '# Tool Calls Protocol\n\nThis document describes how agents communicate tool call execution results. Agents report tool invocations via session/update notifications.\n'
    )

    const adapter = new MiniSearchAdapter({ skillDir: assetsDir })
    await adapter.buildIndex(referencesDir)
    const results = await adapter.search('how to stream tool results', { topK: 2 })

    expect(results[0]?.title).toBe('Tool Calls Protocol')
    expect(results[1]?.title).toBe('Prompt Turn Protocol')

    cleanupTempDir(tempDir)
  })

  it('keeps strong fulltext results on the auto path', async () => {
    const auto = new AutoSearchAdapter(
      { skillDir: '/tmp/skill', qualityThreshold: 0.55 },
      {
        fulltextAdapter: new FakeSearchEngine(
          {
            backendId: 'minisearch',
            mode: 'fulltext',
            supportsPersistence: true,
            supportsEmbeddings: false,
          },
          [
            {
              id: 'fulltext-1',
              title: 'Query Client Guide',
              content: '# Query Client Guide\n\nQuery client caching and invalidation rules.',
              source: 'user',
              file_path: '/tmp/query-client-guide.md',
              score: 8.4,
              metadata: { backendId: 'minisearch' },
            },
          ]
        ),
        fuzzyAdapter: new FakeSearchEngine(
          {
            backendId: 'ufuzzy',
            mode: 'fuzzy',
            supportsPersistence: false,
            supportsEmbeddings: false,
          },
          [
            {
              id: 'fuzzy-1',
              title: 'Fallback',
              content: '# Fallback\n\nFallback result.',
              source: 'context7',
              file_path: '/tmp/fallback.md',
              score: 1,
              metadata: { backendId: 'ufuzzy' },
            },
          ]
        ),
      }
    )

    const results = await auto.search('query client')

    expect(results[0]?.id).toBe('fulltext-1')
  })

  it('falls back to fuzzy when fulltext confidence is weak', async () => {
    const auto = new AutoSearchAdapter(
      { skillDir: '/tmp/skill', qualityThreshold: 0.55 },
      {
        fulltextAdapter: new FakeSearchEngine(
          {
            backendId: 'minisearch',
            mode: 'fulltext',
            supportsPersistence: true,
            supportsEmbeddings: false,
          },
          [
            {
              id: 'fulltext-weak',
              title: 'Release Notes',
              content: '# Release Notes\n\nPackaging updates and changelog only.',
              source: 'user',
              file_path: '/tmp/release-notes.md',
              score: 0.2,
              metadata: { backendId: 'minisearch' },
            },
          ]
        ),
        fuzzyAdapter: new FakeSearchEngine(
          {
            backendId: 'ufuzzy',
            mode: 'fuzzy',
            supportsPersistence: false,
            supportsEmbeddings: false,
          },
          [
            {
              id: 'fuzzy-strong',
              title: 'Query Client',
              content: '# Query Client\n\nCache invalidation guidance.',
              source: 'context7',
              file_path: '/tmp/query-client.md',
              score: 1,
              metadata: { backendId: 'ufuzzy' },
            },
          ]
        ),
      }
    )

    const results = await auto.search('query client')

    expect(results[0]?.id).toBe('fuzzy-strong')
  })
})
