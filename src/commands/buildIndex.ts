/**
 * Build search index command
 */

import { join } from 'node:path'
import { createSearchEngine, normalizeSearchMode, parseArgs } from './shared.js'

export async function buildIndex(args: string[]): Promise<void> {
  const options = parseArgs(args, [{ name: 'mode', type: 'string', default: 'auto' }])
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
  })

  console.log('Building search index...')
  console.log(`Mode: ${normalizedMode}`)

  // Build index
  const referencesDir = join(process.cwd(), 'assets', 'references')
  await searchEngine.buildIndex(referencesDir)

  // Show stats
  const stats = await searchEngine.getStats()
  const backendInfo = await searchEngine.getBackendInfo()
  console.log(`✅ Index built: ${stats.totalDocuments || 0} documents`)
  if (backendInfo) {
    console.log(`🎯 Active backend: ${backendInfo.backendId} (${backendInfo.mode})`)
  }
}
