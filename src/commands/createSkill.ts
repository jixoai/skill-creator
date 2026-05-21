import { SkillCreator } from '../core/skillCreator.js'
import type { CreateSkillOptions } from '../types/index.js'
import gradient from 'gradient-string'

/**
 * Helper function to create a skill for a package with interactive confirmation
 */
export async function createSkillForPackage(
  createOptions: CreateSkillOptions,
  options: {
    json?: boolean
  } = {}
): Promise<string> {
  const creator = new SkillCreator()

  // const createOptions: CreateSkillOptions = {
  //   packageName: packageName, // Use the user-provided package name directly
  //   pwd: scope === 'user' ? undefined : '.claude/skills',
  //   scope: scope, // Map 'current' to 'project' for internal storage
  //   noInitDocs: true, // Docs are downloaded in a separate step in the new flow
  //   force: force, // Pass force option to SkillCreator
  //   description: description, // Pass description option to SkillCreator
  // }

  if (!options.json) {
    console.log(gradient('cyan', 'magenta')('\n🚀 Creating skill...'))
  }

  const result = await creator.createSkill(createOptions)

  if (result.created) {
    if (!options.json) {
      console.log(gradient('green', 'cyan')(`\n✅ ${result.message}`))
      console.log(gradient('blue', 'cyan')(`📍 Skill Path: ${result.skillPath}`))
      console.log('\n🎉 Skill created successfully!')
      console.log('\nNext steps:')
      console.log(
        `1. Add content: skill-creator add-skill --pwd "${result.skillPath}" --title "My Note" --content "Your content"`
      )
      console.log(`2. Search skill: skill-creator search-skill --pwd "${result.skillPath}" "query"`)
      console.log(
        `3. Download docs: skill-creator download-context7 --pwd "${result.skillPath}"`
      )
      console.log(
        `4. Resolve Context7 id explicitly when needed: skill-creator resolve-context7 <package-name> [--package-version <version>]`
      )
    }
    return result.skillPath!
  } else {
    throw new Error(result.message || 'Failed to create skill')
  }
}
