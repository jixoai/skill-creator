/**
 * Interactive init command to install skill-creator as subagent
 */

import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { parseArgs } from './shared.js'
import { rootResolver } from '../utils/path.js'
import {
  type DefaultScopedLocation,
  getDefaultScopedLocation,
  resolveAgentInstallScopeSelection,
} from '../utils/scopeSelection.js'

interface InitCliOptions {
  scope?: string
  json?: boolean
}

interface InitCommandResult {
  requestedScope: string
  resolvedScope: DefaultScopedLocation
  defaultScope: DefaultScopedLocation
  targetDir: string
  targetFile: string
}

/**
 * Install skill-creator as subagent in specified directory
 */
async function installSubagent(
  selection: ReturnType<typeof resolveAgentInstallScopeSelection>,
  options: {
    quiet?: boolean
  } = {}
): Promise<void> {
  const { targetDir, targetFile, resolvedScope } = selection
  const { quiet = false } = options

  // Create directories
  mkdirSync(targetDir, { recursive: true })

  // Read the skill-creator template
  const templatePath = rootResolver('templates/skill-creator.md')
  const templateContent = readFileSync(templatePath, 'utf-8')

  // Write skill-creator.md file
  writeFileSync(targetFile, templateContent)

  if (quiet) {
    return
  }

  const { default: gradient } = await import('gradient-string')
  console.log(gradient('green', 'cyan')('\n✅ Skill-creator subagent installed successfully!'))
  console.log(`📍 Location: ${targetFile}`)
  console.log(`📁 Installed scope: ${resolvedScope}`)

  if (resolvedScope === 'user') {
    console.log('💡 This makes skill-creator available in all Claude Code sessions')
  } else {
    console.log('💡 This makes skill-creator available in this project only')
  }
}

export async function init(args: string[]): Promise<void> {
  const { default: gradient } = await import('gradient-string')
  const cwd = process.cwd()

  // Parse arguments
  const options = parseArgs(args, [
    { name: 'scope', type: 'string' },
    { name: 'json', type: 'boolean' },
  ]) as InitCliOptions

  let scopeSelection: ReturnType<typeof resolveAgentInstallScopeSelection>
  const defaultScope = getDefaultScopedLocation(cwd)

  // Non-interactive mode if scope is provided
  if (options.scope) {
    try {
      scopeSelection = resolveAgentInstallScopeSelection(options.scope, cwd)
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error))
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
        default: defaultScope,
      },
    ])

    scopeSelection = resolveAgentInstallScopeSelection(answers.location, cwd)
  }

  const result: InitCommandResult = {
    requestedScope: scopeSelection.requestedScope,
    resolvedScope: scopeSelection.resolvedScope,
    defaultScope,
    targetDir: scopeSelection.targetDir,
    targetFile: scopeSelection.targetFile,
  }

  if (!options.json) {
    console.log(
      `\n📦 Installing in ${
        scopeSelection.resolvedScope === 'user' ? 'user directory' : 'current directory'
      }...\n`
    )
  }

  try {
    await installSubagent(scopeSelection, { quiet: options.json === true })
    if (options.json) {
      console.log(JSON.stringify(result, null, 2))
    }
  } catch (error) {
    console.error('❌ Installation failed:', error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
