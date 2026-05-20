/**
 * Download Context7 documentation command with automatic local index refresh
 */

import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { parseArgs, createSearchEngine } from './shared.js'
import { updateSkillMdFile } from '../utils/skillMdManager.js'

export async function downloadContext7(args: string[]): Promise<void> {
  const searchEngine = await createSearchEngine({})

  const { ContentManager } = await import('../core/contentManager.js')

  const contentManager = new ContentManager({
    searchEngine,
    referencesDir: join(process.cwd(), 'assets', 'references'),
  })

  // Parse arguments
  const options = parseArgs(args, [
    { name: 'force', type: 'boolean' },
    { name: 'project-id', type: 'string' },
    { name: 'skip-indexing', type: 'boolean' },
  ])

  const projectId = options['project-id']
  if (!projectId) {
    console.error('❌ No Context7 project ID provided')
    console.error('   Use --project-id <id>')
    process.exit(1)
  }

  console.log(`📥 Downloading Context7 documentation...`)
  console.log(`Project ID: ${projectId}`)

  try {
    // Download documentation
    const result = await contentManager.updateFromContext7(projectId, options.force)
    console.log(`✅ ${result.message}`)

    // Update SKILL.md with the file list
    const skillMdPath = join(process.cwd(), 'SKILL.md')
    if (existsSync(skillMdPath)) {
      const files = contentManager.getContext7ProjectFiles(projectId)
      const fileList = files.map((f) => `- ${f}`).join('\n')

      updateSkillMdFile(
        skillMdPath,
        'context7-skills',
        fileList,
        projectId,
        `assets/references/context7/${encodeURIComponent(projectId)}`
      )
      console.log(`📝 Updated SKILL.md with ${files.length} files`)
    }

    // Auto-build the active local index unless skipped
    if (!options['skip-indexing']) {
      console.log(`\n🔧 Building search index...`)

      try {
        await searchEngine.initialize()
        await searchEngine.buildIndex(join(process.cwd(), 'assets', 'references'))

        const stats = await searchEngine.getStats()
        console.log(`✅ Search index built successfully!`)
        console.log(`📊 Indexed ${stats.totalDocuments || 0} documents`)
        const backendInfo = await searchEngine.getBackendInfo()
        if (backendInfo) {
          console.log(`🎯 Active backend: ${backendInfo.backendId} (${backendInfo.mode})`)
        }
      } catch (error) {
        console.log(
          `⚠️ Search indexing failed: ${error instanceof Error ? error.message : String(error)}`
        )
        console.log(
          `💡 You can still use search-skill with another mode, or retry with --skip-indexing to skip this step`
        )
      }
    } else {
      console.log(`\n⏭️ Skipping search indexing (as requested)`)
      console.log(`💡 To build index later, run: skill-creator build-index`)
    }
  } catch (error) {
    console.error(`❌ Error downloading Context7 documentation:`, error)
    process.exit(1)
  }
}
