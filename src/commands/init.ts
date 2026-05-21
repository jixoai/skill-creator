/**
 * Interactive init command to install skill-creator as subagent
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { parseArgs } from './shared.js'
import { rootResolver } from '../utils/path.js'

/**
 * Install skill-creator as subagent in specified directory
 */
async function installSubagent(location: 'current' | 'user'): Promise<void> {
  let targetDir: string

  if (location === 'user') {
    targetDir = join(homedir(), '.claude', 'agents')
  } else {
    // current directory
    targetDir = join(process.cwd(), '.claude', 'agents')
  }

  // Create directories
  mkdirSync(targetDir, { recursive: true })

  // Read the skill-creator template
  const templatePath = rootResolver('templates/skill-creator.md')
  const templateContent = readFileSync(templatePath, 'utf-8')

  // Write skill-creator.md file
  const targetFile = join(targetDir, 'skill-creator.md')
  writeFileSync(targetFile, templateContent)

  const { default: gradient } = await import('gradient-string')
  console.log(gradient('green', 'cyan')('\n✅ Skill-creator subagent installed successfully!'))
  console.log(`📍 Location: ${targetFile}`)
  console.log(`📁 Default scope: ${location}`)

  if (location === 'user') {
    console.log('💡 This makes skill-creator available in all Claude Code sessions')
  } else {
    console.log('💡 This makes skill-creator available in this project only')
  }
}

export async function init(args: string[]): Promise<void> {
  const { default: gradient } = await import('gradient-string')

  // Parse arguments
  const options = parseArgs(args, [{ name: 'scope', type: 'string' }])

  let location: 'current' | 'user'

  // Non-interactive mode if scope is provided
  if (options.scope) {
    if (options.scope === 'user') {
      location = 'user'
    } else if (options.scope === 'current') {
      location = 'current'
    } else {
      console.error('❌ Invalid scope value. Use: user or current')
      process.exit(1)
    }
  } else {
    // Interactive mode
    console.log(gradient('blue', 'cyan')('\n🚀 Installing skill-creator as subagent...\n'))

    const { default: inquirer } = await import('inquirer')

    const answers = await inquirer.prompt([
      {
        type: 'list',
        name: 'location',
        message: 'Where would you like to install skill-creator?',
        choices: [
          {
            name: 'User directory (recommended) - Available in all Claude Code sessions',
            value: 'user',
          },
          {
            name: 'Current directory only - Available in this project only',
            value: 'current',
          },
        ],
        default: 'user',
      },
    ])

    location = answers.location
  }

  console.log(
    `\n📦 Installing in ${location === 'user' ? 'user directory' : 'current directory'}...\n`
  )

  try {
    await installSubagent(location)
  } catch (error) {
    console.error('❌ Installation failed:', error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
