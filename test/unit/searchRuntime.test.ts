import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { normalizeSearchMode } from '../../src/commands/shared.js'
import { MiniSearchAdapter } from '../../src/core/miniSearchAdapter.js'
import { buildSearchEngine } from '../../src/core/searchEngineFactory.js'
import { SqliteVectorSearchAdapter } from '../../src/core/sqliteVectorSearchAdapter.js'
import { createTempDir, cleanupTempDir } from '../test-utils.js'

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
})
