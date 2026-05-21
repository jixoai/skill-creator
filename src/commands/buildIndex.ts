/**
 * Build search index command
 */

import { join } from 'node:path'
import { createSearchEngine, normalizeSearchMode, parseArgs } from './shared.js'
import type { BuildIndexCommandResult } from '../types/index.js'

export async function buildIndex(args: string[]): Promise<BuildIndexCommandResult> {
  const options = parseArgs(args, [
    { name: 'mode', type: 'string', default: 'auto' },
    { name: 'vector-embedder', type: 'string' },
    { name: 'json', type: 'boolean' },
  ])
  const jsonMode = Boolean(options.json)
  const normalizedMode = normalizeSearchMode(options.mode)

  if (normalizedMode === 'fuzzy') {
    console.error(
      '❌ Fuzzy mode does not support standalone prebuilt indexes. Use auto, fulltext, or vector.'
    )
    process.exit(1)
  }

  if (normalizedMode === 'vector') {
    const { SqliteVectorSearchAdapter } = await import('../core/sqliteVectorSearchAdapter.js')
    const runtimeSupported = await SqliteVectorSearchAdapter.isRuntimeSupported()
    if (!runtimeSupported) {
      console.error(
        '❌ Vector mode is unavailable in this runtime. It requires node:sqlite support and sqlite-vec.'
      )
      process.exit(1)
    }
  }

  const searchEngine = await createSearchEngine({
    searchMode: normalizedMode,
    useFormatting: false,
    vectorEmbedder: options['vector-embedder'],
  })

  // Build index
  const referencesDir = join(process.cwd(), 'assets', 'references')
  await searchEngine.buildIndex(referencesDir)

  // Show stats
  const stats = await searchEngine.getStats()
  const backendInfo = await searchEngine.getBackendInfo()
  if (!jsonMode) {
    console.log('Building search index...')
    console.log(`Mode: ${normalizedMode}`)
    if (options['vector-embedder']) {
      console.log(`Vector embedder: ${options['vector-embedder']}`)
    }
    console.log(`✅ Index built: ${stats.totalDocuments || 0} documents`)
    if (backendInfo) {
      console.log(`🎯 Active backend: ${backendInfo.backendId} (${backendInfo.mode})`)
    }
  }
  return {
    mode: normalizedMode,
    vectorEmbedder: options['vector-embedder'],
    totalDocuments: stats.totalDocuments || 0,
    backendInfo,
  }
}
