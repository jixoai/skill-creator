/**
 * Build search index command
 */

import { join } from 'node:path'
import { createSearchEngine } from './shared.js'

export async function buildIndex(args: string[]): Promise<void> {
  const searchEngine = await createSearchEngine({})

  console.log('Building search index...')

  // Build index
  const referencesDir = join(process.cwd(), 'assets', 'references')
  await searchEngine.buildIndex(referencesDir)

  // Show stats
  const stats = await searchEngine.getStats()
  console.log(`✅ Index built: ${stats.totalDocuments || 0} documents`)
}
