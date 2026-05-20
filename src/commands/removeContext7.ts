/**
 * Remove Context7 project command
 */

import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { parseArgs, createSearchEngine } from './shared.js'
import { removeContext7TagFromFile } from '../utils/skillMdManager.js'

export async function removeContext7(args: string[]): Promise<void> {
  const searchEngine = await createSearchEngine({})

  const { ContentManager } = await import('../core/contentManager.js')

  const contentManager = new ContentManager({
    searchEngine,
    referencesDir: join(process.cwd(), 'assets', 'references'),
  })

  // Parse arguments
  const options = parseArgs(args, [{ name: 'project-id', type: 'string' }])

  const projectId = options['project-id']
  if (!projectId) {
    console.error('❌ No Context7 project ID provided')
    console.error('   Use --project-id <id>')
    process.exit(1)
  }

  console.log(`🗑️  Removing Context7 project: ${projectId}`)

  try {
    // Remove project from filesystem
    const result = contentManager.removeContext7Project(projectId)

    if (!result.success) {
      console.error(`❌ ${result.message}`)
      process.exit(1)
    }

    console.log(`✅ ${result.message}`)

    // Remove from SKILL.md
    const skillMdPath = join(process.cwd(), 'SKILL.md')
    if (existsSync(skillMdPath)) {
      removeContext7TagFromFile(skillMdPath, projectId)
      console.log(`📝 Updated SKILL.md`)
    }

    // Rebuild index
    console.log(`\n🔧 Rebuilding search index...`)
    try {
      await searchEngine.initialize()
      await searchEngine.buildIndex(join(process.cwd(), 'assets', 'references'))
      console.log(`✅ Index rebuilt successfully`)
    } catch (error) {
      console.log(
        `⚠️  Index rebuild failed: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  } catch (error) {
    console.error(`❌ Error removing Context7 project:`, error)
    process.exit(1)
  }
}
