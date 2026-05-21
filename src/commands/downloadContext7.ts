/**
 * Download Context7 documentation command with automatic local index refresh
 */

import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { parseArgs, createSearchEngine } from './shared.js'
import {
  updateSkillMdFile,
  updateSkillPackageMetadataFile,
} from '../utils/skillMdManager.js'
import type {
  CommandIndexingResult,
  DownloadContext7CommandResult,
} from '../types/index.js'
import { inferPackageMetadataFromSkill } from '../utils/skillIdentity.js'

export async function downloadContext7(
  args: string[]
): Promise<DownloadContext7CommandResult> {
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
    { name: 'package-name', type: 'string' },
    { name: 'package-version', type: 'string' },
    { name: 'skip-indexing', type: 'boolean' },
    { name: 'json', type: 'boolean' },
  ])
  const jsonMode = Boolean(options.json)

  const projectId = options['project-id']
  if (!projectId) {
    console.error('❌ No Context7 project ID provided')
    console.error('   Use --project-id <id>')
    process.exit(1)
  }

  const packageName = options['package-name']
  const packageVersion = options['package-version']

  try {
    if (!jsonMode) {
      console.log(`📥 Downloading Context7 documentation...`)
      console.log(`Project ID: ${projectId}`)
    }

    // Download documentation
    const result = await contentManager.updateFromContext7(projectId, options.force)
    if (!jsonMode) {
      console.log(`✅ ${result.message}`)
    }

    // Update SKILL.md with the file list
    let skillMdUpdated = false
    let context7Files: string[] = []
    const skillMdPath = join(process.cwd(), 'SKILL.md')
    if (existsSync(skillMdPath)) {
      const currentMetadata = inferPackageMetadataFromSkill(process.cwd())
      const effectivePackageName = packageName || currentMetadata.packageName
      if (effectivePackageName) {
        updateSkillPackageMetadataFile(skillMdPath, {
          name: effectivePackageName,
          version: packageVersion || currentMetadata.versionHint,
        })
        skillMdUpdated = true
      }

      context7Files = contentManager.getContext7ProjectFiles(projectId)
      const fileList = context7Files.map((f) => `- ${f}`).join('\n')

      updateSkillMdFile(
        skillMdPath,
        'context7-skills',
        fileList,
        projectId,
        `assets/references/context7/${encodeURIComponent(projectId)}`
      )
      skillMdUpdated = true
      if (!jsonMode) {
        console.log(`📝 Updated SKILL.md with ${context7Files.length} files`)
      }
    }

    // Auto-build the active local index unless skipped
    const indexing: CommandIndexingResult = {
      attempted: !options['skip-indexing'],
      skipped: Boolean(options['skip-indexing']),
      succeeded: false,
      totalDocuments: 0,
    }

    if (!options['skip-indexing']) {
      if (!jsonMode) {
        console.log(`\n🔧 Building search index...`)
      }
      try {
        await searchEngine.initialize()
        await searchEngine.buildIndex(join(process.cwd(), 'assets', 'references'))

        const stats = await searchEngine.getStats()
        indexing.succeeded = true
        indexing.totalDocuments = stats.totalDocuments || 0
        const backendInfo = await searchEngine.getBackendInfo()
        indexing.backendInfo = backendInfo
        if (!jsonMode) {
          console.log(`✅ Search index built successfully!`)
          console.log(`📊 Indexed ${indexing.totalDocuments} documents`)
          if (backendInfo) {
            console.log(`🎯 Active backend: ${backendInfo.backendId} (${backendInfo.mode})`)
          }
        }
      } catch (error) {
        indexing.error = error instanceof Error ? error.message : String(error)
        if (!jsonMode) {
          console.log(`⚠️ Search indexing failed: ${indexing.error}`)
          console.log(
            `💡 You can still use search-skill with another mode, or rebuild later with: skill-creator build-index --pwd "${process.cwd()}"`
          )
        }
      }
    } else if (!jsonMode) {
      console.log(`\n⏭️ Skipping search indexing (as requested)`)
      console.log(`💡 To build index later, run: skill-creator build-index --pwd "${process.cwd()}"`)
    }

    return {
      projectId,
      update: result,
      skillMdUpdated,
      context7Files,
      indexing,
    }
  } catch (error) {
    console.error(`❌ Error downloading Context7 documentation:`, error)
    process.exit(1)
  }
}
