import path, { join } from 'node:path'
import { homedir } from 'node:os'
import { existsSync } from 'node:fs'
import type { CreateSkillOptions } from '../types/index.js'
import { inferVersionHintFromSkillDirectory } from './skillIdentity.js'

export const SKILL_CREATION_CANCELLED_MESSAGE = 'Skill creation cancelled.'

export interface CreateSkillCliOptions {
  interactive?: boolean
  scope?: string
  name?: string
  skillName?: string
  description?: string
  force?: boolean
}

export interface CreateSkillPrompt {
  prompt<T extends Record<string, unknown>>(questions: unknown[]): Promise<T>
  Separator?: new () => unknown
}

export interface PreparedCreateSkillWorkflow {
  createOptions: CreateSkillOptions
  summary: {
    scopePath: string
    skillDirName: string
    skillName: string
    sourcePackageName: string
    sourcePackageVersionHint?: string
    skillDescription?: string
  }
}

export async function prepareCreateSkillWorkflow(
  skillDirName: string,
  options: CreateSkillCliOptions,
  dependencies: {
    cwd?: string
    prompt: CreateSkillPrompt
  }
): Promise<PreparedCreateSkillWorkflow> {
  const cwd = dependencies.cwd ?? process.cwd()
  let { scope, interactive, force, description, name: sourcePackageName, skillName } = options
  let finalSkillName = skillName || sourcePackageName || skillDirName

  if (interactive) {
    console.log('Skill Creation Configuration:')

    if (!scope) {
      const scopeAnswer = await dependencies.prompt.prompt<{ scope: string }>([
        {
          type: 'list',
          name: 'scope',
          message: 'Where would you like to store this skill?',
          choices: [
            {
              name: 'Current directory (./.claude/skills/)',
              value: 'current',
            },
            {
              name: 'User home directory (~/.claude/skills)',
              value: 'user',
            },
            ...(dependencies.prompt.Separator ? [new dependencies.prompt.Separator()] : []),
            {
              name: 'Custom directory',
              value: 'custom',
            },
          ],
          default: existsSync(join(cwd, '.claude/agents/skill-creator.md')) ? 'current' : 'user',
        },
      ])
      scope = scopeAnswer.scope
      if (scope === 'custom') {
        const customScopeAnswer = await dependencies.prompt.prompt<{ scope: string }>([
          {
            type: 'input',
            name: 'scope',
            message: 'Directory to store skills',
            validate: (input: string) => input.trim() !== '' || 'Directory cannot be empty',
          },
        ])
        scope = path.join(cwd, customScopeAnswer.scope)
      }
    }

    if (!skillName) {
      const { packageNameConfirmed } = await dependencies.prompt.prompt<{
        packageNameConfirmed: boolean
      }>([
        {
          type: 'confirm',
          name: 'packageNameConfirmed',
          message: `Use '${finalSkillName}' as the skill name?`,
          default: true,
        },
      ])

      if (!packageNameConfirmed) {
        const { customSkillName } = await dependencies.prompt.prompt<{ customSkillName: string }>([
          {
            type: 'input',
            name: 'customSkillName',
            message: 'Enter the skill name:',
            validate: (input: string) => input.trim() !== '' || 'Skill name cannot be empty',
          },
        ])
        finalSkillName = customSkillName.trim()
      }
    }

    if (!description) {
      const { customDescription } = await dependencies.prompt.prompt<{ customDescription: string }>([
        {
          type: 'input',
          name: 'customDescription',
          message: 'Enter the skill description:',
        },
      ])
      description = customDescription.trim()
    }
  }

  if (scope == null) {
    throw new Error('Error: --scope is required. Use --scope current or --scope user.')
  }

  const scopePath =
    scope === 'user' ? path.join(homedir(), '.claude/skills') :
    scope === 'current' ? path.join(cwd, '.claude/skills') :
    scope

  if (interactive) {
    console.log('\nFinal Configuration:')
    console.log(`- Storage location: ${scopePath}`)
    console.log(`- Skill directory name: ${skillDirName}`)
    console.log(`- Skill Name: ${finalSkillName}`)
    console.log(`- Skill Description: ${description}`)

    const { confirmFinal } = await dependencies.prompt.prompt<{ confirmFinal: boolean }>([
      {
        type: 'confirm',
        name: 'confirmFinal',
        message: 'Proceed with skill creation?',
        default: true,
      },
    ])

    if (!confirmFinal) {
      throw new Error(SKILL_CREATION_CANCELLED_MESSAGE)
    }
  }

  const resolvedSourcePackageName = sourcePackageName ?? finalSkillName
  const sourcePackageVersionHint = inferVersionHintFromSkillDirectory(skillDirName)

  return {
    createOptions: {
      baseDir: scopePath,
      skillDirname: skillDirName,
      skillName: finalSkillName,
      skillDescription: description,
      sourcePackageName: resolvedSourcePackageName,
      sourcePackageVersionHint,
      force,
    },
    summary: {
      scopePath,
      skillDirName,
      skillName: finalSkillName,
      sourcePackageName: resolvedSourcePackageName,
      sourcePackageVersionHint,
      skillDescription: description,
    },
  }
}
