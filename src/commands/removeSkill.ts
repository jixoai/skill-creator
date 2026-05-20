/**
 * Remove skill file command
 */

import { join } from 'node:path'
import { existsSync, unlinkSync, readdirSync } from 'node:fs'
import { parseArgs } from './shared.js'
import { updateSkillMdFile } from '../utils/skillMdManager.js'

export async function removeSkill(args: string[]): Promise<void> {
  // Parse arguments
  const options = parseArgs(args, [
    { name: 'type', type: 'string', required: true },
    { name: 'file', type: 'string', required: true },
  ])

  const type = options.type
  const fileName = options.file

  // Parse type: user or context7:<project_id>
  let source: 'user' | 'context7' = 'user'
  let projectId: string | undefined

  if (type.startsWith('context7:')) {
    source = 'context7'
    projectId = type.slice('context7:'.length)
    if (!projectId) {
      console.error('❌ Invalid type format. Use: user or context7:<project_id>')
      process.exit(1)
    }
  } else if (type === 'user') {
    source = 'user'
  } else {
    console.error('❌ Invalid type. Use: user or context7:<project_id>')
    process.exit(1)
  }

  // Construct file path
  const referencesDir = join(process.cwd(), 'assets', 'references')
  let filePath: string

  if (source === 'user') {
    filePath = join(referencesDir, 'user', fileName)
  } else if (source === 'context7' && projectId) {
    filePath = join(referencesDir, 'context7', encodeURIComponent(projectId), fileName)
  } else {
    console.error('❌ Invalid configuration')
    process.exit(1)
  }

  // Check if file exists
  if (!existsSync(filePath)) {
    console.error(`❌ File not found: ${filePath}`)
    process.exit(1)
  }

  try {
    // Remove file
    unlinkSync(filePath)
    console.log(`✅ Removed file: ${fileName}`)

    // Update SKILL.md
    const skillMdPath = join(process.cwd(), 'SKILL.md')
    if (existsSync(skillMdPath)) {
      if (source === 'user') {
        // Update user-skills tag
        const userDir = join(referencesDir, 'user')
        const files = readdirSync(userDir).filter((f) => f.endsWith('.md'))
        const fileList = files.map((f) => `- ${f}`).join('\n')

        updateSkillMdFile(skillMdPath, 'user-skills', fileList)
        console.log(`📝 Updated SKILL.md`)
      } else if (source === 'context7' && projectId) {
        // Update context7-skills tag
        const projectDir = join(referencesDir, 'context7', encodeURIComponent(projectId))
        const files = readdirSync(projectDir).filter((f) => f.endsWith('.md'))
        const fileList = files.map((f) => `- ${f}`).join('\n')

        updateSkillMdFile(
          skillMdPath,
          'context7-skills',
          fileList,
          projectId,
          `assets/references/context7/${encodeURIComponent(projectId)}`
        )
        console.log(`📝 Updated SKILL.md`)
      }
    }

    console.log(`\n✅ Skill file removed successfully`)
  } catch (error) {
    console.error(`❌ Error removing skill file:`, error)
    process.exit(1)
  }
}
