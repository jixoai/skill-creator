#!/usr/bin/env node
/**
 * CLI interface for skill creator
 */

import { Command } from 'commander'
import gradient from 'gradient-string'
import { PackageUtils } from './utils/package.js'
import { createSkillForPackage } from './commands/createSkill.js'
import {
  prepareCreateSkillWorkflow,
  SKILL_CREATION_CANCELLED_MESSAGE,
} from './utils/createSkillWorkflow.js'
import {
  inferPackageMetadataFromSkill,
  inferVersionHintFromSkillDirectory,
  resolveSkillDirectoryFromOptions,
} from './utils/skillIdentity.js'

const program = new Command()

// Global options storage
interface GlobalOptions {
  pwd?: string
}

let globalOptions: GlobalOptions = {}

program
  .name('skill-creator')
  .description('Create claude-code-skills with documentation management')
  .version(PackageUtils.getCurrentPackageInfo()?.version ?? '0.0.0')
  .option('--pwd <path>', 'Global path to the skill directory (used for all commands)')

// Handle global options
program.hook('preAction', (thisCommand) => {
  const options = thisCommand.opts()
  globalOptions.pwd = options.pwd
})

// Add create-cc-skill command
program
  .command('create-cc-skill')
  .option('--interactive', 'Enable interactive confirmation prompts')
  .option(
    '--scope <scope>',
    'Storage scope (user, current, or auto), or a custom directory to store skills'
  )
  .option('--name <name>', 'Source package name stored in SKILL.md for later package-aware workflows')
  .option('--skill-name <name>', 'Visible skill name used in SKILL.md and JSON output')
  .option('--description <description>', 'Custom description for the skill')
  .option('--force', 'Force overwrite existing files in the skill directory')
  .option('--json', 'Print machine-readable creation output')
  .argument('<skill_dir_name>', 'The name of the skill directory to create')
  .action(async (skillDirName, options) => {
    try {
      const { default: inquirer } = await import('inquirer')
      const workflow = await prepareCreateSkillWorkflow(skillDirName, options, {
        cwd: process.cwd(),
        prompt: {
          prompt: inquirer.prompt.bind(inquirer),
          Separator: inquirer.Separator,
        },
      })
      const skillPath = await createSkillForPackage(workflow.createOptions, {
        json: options.json,
      })
      if (options.json) {
        console.log(
          JSON.stringify(
            {
              skillPath,
              requestedScope: workflow.summary.requestedScope,
              resolvedScope: workflow.summary.resolvedScope,
              scopePath: workflow.summary.scopePath,
              skillDirName: workflow.summary.skillDirName,
              skillName: workflow.summary.skillName,
              sourcePackageName: workflow.summary.sourcePackageName,
              sourcePackageVersionHint: workflow.summary.sourcePackageVersionHint ?? '',
              skillDescription: workflow.summary.skillDescription ?? '',
            },
            null,
            2
          )
        )
      } else {
        console.log(`Skill created successfully at: ${skillPath}`)
      }
    } catch (error) {
      if (error instanceof Error && error.message === SKILL_CREATION_CANCELLED_MESSAGE) {
        console.log(error.message)
        process.exit(0)
      }
      console.error(
        'Error:',
        error instanceof Error ? (error.stack ?? error.message) : String(error)
      )
      process.exit(1)
    }
  })

// Add interactive init command
program
  .command('init')
  .description('Install skill-creator as subagent (interactive mode)')
  .option('--scope <scope>', 'Storage scope (user, current, or auto)')
  .option('--json', 'Print machine-readable installation output')
  .action(async (options) => {
    const { runScript } = await import('./core/runScript.js')
    const args = []

    // Pass scope to init command
    if (options.scope) {
      args.push('--scope', options.scope)
    }
    if (options.json) {
      args.push('--json')
    }

    await runScript('init', args)
  })

// Add init command to install subagents (non-interactive version)
program
  .command('init-cc')
  .description('Install skill-creator as subagent in ~/.claude/agents/')
  .option('--json', 'Print machine-readable installation output')
  .action(async (options) => {
    const { runScript } = await import('./core/runScript.js')
    // For init-cc, we want the non-interactive version that installs to user directory
    // Use --scope=user for consistency with other CLI commands
    const args = ['--scope', 'user']
    if (options.json) {
      args.push('--json')
    }
    await runScript('init', args)
  })

// Add search command for package searching
program
  .command('search')
  .argument('<keywords>', 'Search keywords for npm packages')
  .option('-l, --limit <limit>', 'Number of results to show', '10')
  .action(async (keywords: string, options) => {
    const query = keywords
    const suggestions = await PackageUtils.suggestPackages(query, {
      limit: parseInt(options.limit),
    })
    console.log(JSON.stringify(suggestions, null, 2))
  })

// Add get-info command for package information
program
  .command('get-info')
  .argument('<package_name>', 'The npm package name to get information for')
  .action(async (packageName: string) => {
    const packageInfo = await PackageUtils.getPackageInfo(packageName)

    if (!packageInfo) {
      console.error(`❌ Package "${packageName}" not found or API error occurred.`)
      process.exit(1)
    }

    const version = packageInfo.version
    const skillDirName = PackageUtils.createSkillFolderName(packageName, version)

    const result = {
      skill_dir_name: skillDirName,
      name: packageInfo.name,
      version: version,
      description: packageInfo.description || '',
      keywords: packageInfo.keywords || [],
      license: packageInfo.license || '',
      author: packageInfo.author || '',
      maintainers: packageInfo.maintainers || [],
      homepage: packageInfo.homepage || '',
      repo: packageInfo.repository?.url || '',
      repository: {
        url: packageInfo.repository?.url || '',
        type: packageInfo.repository?.type || '',
      },
      bugs: {
        url: packageInfo.bugs?.url || '',
      },
      funding: packageInfo.funding || '',
      scripts: packageInfo.scripts || {},
      engines: packageInfo.engines || {},
      types: packageInfo.types || '',
      dependencies: packageInfo.dependencies || {},
      devDependencies: packageInfo.devDependencies || {},
      time: {
        created: packageInfo.time?.created || '',
        modified: packageInfo.time?.modified || '',
      },
    }

    console.log(JSON.stringify(result, null, 2))
  })

program
  .command('resolve-context7')
  .description('Resolve the best Context7 library id for an npm package')
  .argument('<package_name>', 'The npm package name to resolve against Context7')
  .option('--package-version <version>', 'Explicit package version to use in the Context7 query')
  .option('-l, --limit <limit>', 'Number of candidates to keep in the response', '5')
  .action(async (packageName: string, options) => {
    const { Context7Utils } = await import('./utils/context7.js')

    const resolved = await Context7Utils.resolveLibrary(packageName, {
      version: options.packageVersion,
      limit: parseInt(options.limit, 10),
    })

    if (!resolved) {
      console.error(`❌ No Context7 library found for package "${packageName}".`)
      process.exit(1)
    }

    console.log(JSON.stringify(resolved, null, 2))
  })

// Add search-skill command
program
  .command('search-skill')
  .argument('<query>', 'Search query')
  .option('--pwd <path>', 'Path to the skill directory')
  .option('--package <name>', 'Package name to find skill directory for')
  .option('--mode <mode>', 'Search mode: auto, fulltext, fuzzy, or vector', 'auto')
  .option(
    '--vector-embedder <mode>',
    'Vector embedder mode: deterministic for offline local embeddings, or omit for the default runtime embedder'
  )
  .option('--list', 'Show simplified list view (basic info only)', false)
  .action(async (query, options) => {
    try {
      const skillDir = resolveSkillDirectoryFromOptions(options, globalOptions)

      console.log(gradient('cyan', 'magenta')('\n🔍 Searching in skill...'))
      console.log(`Skill Path: ${skillDir}`)
      console.log(`Query: ${query}`)

      const { chdir } = await import('node:process')
      const originalCwd = process.cwd()
      chdir(skillDir)

      try {
        const { runScript } = await import('./core/runScript.js')
        const args = ['--query', query]
        if (options.mode !== 'auto') args.push('--mode', options.mode)
        if (options.vectorEmbedder) args.push('--vector-embedder', options.vectorEmbedder)
        if (options.list) args.push('--list')
        // Enhanced search is now enabled by default, no need for --enhanced flag
        await runScript('search-skill', args)
      } finally {
        chdir(originalCwd)
      }
    } catch (error) {
      console.error(error)
      process.exit(1)
    }
  })

// Add download-context7 command
program
  .command('download-context7')
  .argument('[project_id]', 'Context7 library ID')
  .option('--pwd <path>', 'Path to the skill directory')
  .option('--package <name>', 'Package name to find skill directory for')
  .option(
    '--package-version <version>',
    'Version hint used when resolving a Context7 library from --package'
  )
  .option('-f, --force', 'Force update even if up to date')
  .option('--skip-indexing', 'Skip automatic local index building after download')
  .action(async (projectId, options) => {
    try {
      const skillDir = resolveSkillDirectoryFromOptions(options, globalOptions)
      let resolvedProjectId = projectId as string | undefined

      if (!resolvedProjectId) {
        const inferredMetadata = inferPackageMetadataFromSkill(skillDir)
        const packageName = options.package || inferredMetadata.packageName
        const versionHint =
          options.packageVersion ||
          inferredMetadata.versionHint ||
          inferVersionHintFromSkillDirectory(skillDir)

        if (!packageName) {
          console.error(
            '❌ Please provide either a Context7 project ID, --package <name>, or a skill created with package metadata'
          )
          process.exit(1)
        }

        const { Context7Utils } = await import('./utils/context7.js')

        console.log(gradient('cyan', 'magenta')('\n🧭 Resolving Context7 library...'))
        console.log(`Package: ${packageName}`)
        if (versionHint) {
          console.log(`Version hint: ${versionHint}`)
        }

        const resolved = await Context7Utils.resolveLibrary(packageName, {
          version: versionHint,
        })

        if (!resolved) {
          console.error(`❌ No Context7 library found for package "${packageName}".`)
          process.exit(1)
        }

        resolvedProjectId = resolved.bestMatch.id
        console.log(`Resolved Context7 ID: ${resolvedProjectId}`)
        console.log(`Resolution query: ${resolved.query}`)
      }

      console.log(gradient('cyan', 'magenta')('\n📥 Downloading Context7 documentation...'))
      console.log(`Skill Path: ${skillDir}`)
      console.log(`Context7 ID: ${resolvedProjectId}`)

      const { chdir } = await import('node:process')
      const originalCwd = process.cwd()
      chdir(skillDir)

      try {
        const { runScript } = await import('./core/runScript.js')
        const args = []

        if (options.force) args.push('--force')
        if (options['skipIndexing']) args.push('--skip-indexing')
        args.push('--project-id', resolvedProjectId)

        await runScript('download-context7', args)
      } finally {
        chdir(originalCwd)
      }

      console.log(gradient('green', 'cyan')('\n✅ Documentation downloaded and sliced!'))
    } catch (error) {
      console.error(error)
      process.exit(1)
    }
  })

// Add add-skill command
program
  .command('add-skill')
  .option('--pwd <path>', 'Path to the skill directory')
  .option('--package <name>', 'Package name to find skill directory for')
  .option('-t, --title <title>', 'Content title')
  .option('-c, --content <content>', 'Content text')
  .option('-f, --file <file>', 'Read content from file')
  .option('--force', 'Replace the closest matching user knowledge note')
  .option(
    '--force-append',
    'Append content as a knowledge update in the closest matching user note'
  )
  .action(async (options) => {
    if (!options.title && !options.file) {
      console.error('❌ Please provide either --title or --file')
      process.exit(1)
    }

    try {
      const skillDir = resolveSkillDirectoryFromOptions(options, globalOptions)

      console.log(gradient('cyan', 'magenta')('\n📝 Adding content to skill...'))
      console.log(`Skill Path: ${skillDir}`)

      const { chdir } = await import('node:process')
      const originalCwd = process.cwd()
      chdir(skillDir)

      try {
        const { runScript } = await import('./core/runScript.js')
        const args = []

        if (options.title) args.push('--title', options.title)
        if (options.content) args.push('--content', options.content)
        if (options.file) args.push('--file', options.file)
        if (options.force) args.push('--force')
        if (options.forceAppend) args.push('--force-append')

        await runScript('add', args)
      } finally {
        chdir(originalCwd)
      }

    } catch (error) {
      console.error(error)
      process.exit(1)
    }
  })

// Add build-index command
program
  .command('build-index')
  .description('Build or refresh the local search index for a skill')
  .option('--pwd <path>', 'Path to the skill directory')
  .option('--package <name>', 'Package name to find skill directory for')
  .option('--mode <mode>', 'Index mode: auto, fulltext, or vector', 'auto')
  .option(
    '--vector-embedder <mode>',
    'Vector embedder mode: deterministic for offline local embeddings, or omit for the default runtime embedder'
  )
  .action(async (options) => {
    try {
      const skillDir = resolveSkillDirectoryFromOptions(options, globalOptions)

      console.log(gradient('cyan', 'magenta')('\n🔧 Building search index...'))
      console.log(`Skill Path: ${skillDir}`)

      const { chdir } = await import('node:process')
      const originalCwd = process.cwd()
      chdir(skillDir)

      try {
        const { buildIndex } = await import('./commands/buildIndex.js')
        const args = []
        if (options.mode !== 'auto') args.push('--mode', options.mode)
        if (options.vectorEmbedder) args.push('--vector-embedder', options.vectorEmbedder)
        await buildIndex(args)
      } finally {
        chdir(originalCwd)
      }

      console.log(gradient('green', 'cyan')('\n✅ Search index ready!'))
    } catch (error) {
      console.error(error)
      process.exit(1)
    }
  })

// Add sub-commands for script execution
program
  .command('list-skills')
  .description('List all skill content files')
  .option('--pwd <path>', 'Path to the skill directory')
  .option('--package <name>', 'Package name to find skill directory for')
  .action(async (options) => {
    try {
      const skillDir = resolveSkillDirectoryFromOptions(options, globalOptions)

      console.log(gradient('cyan', 'magenta')('\n📚 Skill Content'))
      console.log(`Skill Path: ${skillDir}`)

      const { chdir } = await import('node:process')
      const originalCwd = process.cwd()
      chdir(skillDir)

      try {
        const { runScript } = await import('./core/runScript.js')
        await runScript(
          'list-skills',
          process.argv
            .slice(3)
            .filter(
              (arg) =>
                !arg.startsWith('--pwd') &&
                !arg.startsWith('--package') &&
                arg !== options.pwd &&
                arg !== options.package
            )
        )
      } finally {
        chdir(originalCwd)
      }
    } catch (error) {
      console.error(error)
      process.exit(1)
    }
  })

// Add remove-skill command
program
  .command('remove-skill')
  .description('Remove a skill file')
  .option('--pwd <path>', 'Path to the skill directory')
  .option('--package <name>', 'Package name to find skill directory for')
  .option('--type <type>', 'Type: user or context7:<project_id>', 'user')
  .option('--file <file>', 'File name to remove')
  .action(async (options) => {
    try {
      if (!options.file) {
        console.error('❌ Please provide --file <filename>')
        process.exit(1)
      }

      const skillDir = resolveSkillDirectoryFromOptions(options, globalOptions)

      console.log(gradient('cyan', 'magenta')('\n🗑️  Remove Skill File'))
      console.log(`Skill Path: ${skillDir}`)
      console.log(`Type: ${options.type}`)
      console.log(`File: ${options.file}`)

      const { chdir } = await import('node:process')
      const originalCwd = process.cwd()
      chdir(skillDir)

      try {
        const { removeSkill } = await import('./commands/removeSkill.js')
        await removeSkill(['--type', options.type, '--file', options.file])
      } finally {
        chdir(originalCwd)
      }

      console.log(gradient('green', 'cyan')('\n✅ Skill file removed!'))
    } catch (error) {
      console.error(error)
      process.exit(1)
    }
  })

// Add list-context7 command
program
  .command('list-context7')
  .description('List all Context7 projects')
  .option('--pwd <path>', 'Path to the skill directory')
  .option('--package <name>', 'Package name to find skill directory for')
  .action(async (options) => {
    try {
      const skillDir = resolveSkillDirectoryFromOptions(options, globalOptions)

      console.log(gradient('cyan', 'magenta')('\n📦 Context7 Projects'))
      console.log(`Skill Path: ${skillDir}`)

      const { chdir } = await import('node:process')
      const originalCwd = process.cwd()
      chdir(skillDir)

      try {
        const { listContext7 } = await import('./commands/listContext7.js')
        await listContext7()
      } finally {
        chdir(originalCwd)
      }
    } catch (error) {
      console.error(error)
      process.exit(1)
    }
  })

// Add remove-context7 command
program
  .command('remove-context7')
  .argument('<project_id>', 'Context7 project ID to remove')
  .description('Remove a Context7 project')
  .option('--pwd <path>', 'Path to the skill directory')
  .option('--package <name>', 'Package name to find skill directory for')
  .action(async (projectId, options) => {
    try {
      const skillDir = resolveSkillDirectoryFromOptions(options, globalOptions)

      console.log(gradient('cyan', 'magenta')('\n🗑️  Remove Context7 Project'))
      console.log(`Skill Path: ${skillDir}`)
      console.log(`Project ID: ${projectId}`)

      const { chdir } = await import('node:process')
      const originalCwd = process.cwd()
      chdir(skillDir)

      try {
        const { removeContext7 } = await import('./commands/removeContext7.js')
        await removeContext7(['--project-id', projectId])
      } finally {
        chdir(originalCwd)
      }

      console.log(gradient('green', 'cyan')('\n✅ Context7 project removed!'))
    } catch (error) {
      console.error(error)
      process.exit(1)
    }
  })

// Export for testing
export { program }

// Run CLI if this file is executed directly
// Always parse for now since we're using this as the main CLI entry point
program.parse()
