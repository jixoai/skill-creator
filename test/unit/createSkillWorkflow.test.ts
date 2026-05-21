import { describe, expect, it } from 'vitest'
import {
  prepareCreateSkillWorkflow,
  SKILL_CREATION_CANCELLED_MESSAGE,
} from '../../src/utils/createSkillWorkflow.js'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTempDir, cleanupTempDir } from '../test-utils.js'

describe('createSkillWorkflow', () => {
  it('builds non-interactive create options with normalized scope and package hints', async () => {
    const workflow = await prepareCreateSkillWorkflow(
      '@tanstack__react-query@5',
      {
        scope: 'current',
        name: '@tanstack/react-query',
        description: 'React Query skill',
        force: true,
      },
      {
        cwd: '/tmp/project',
        prompt: {
          prompt: async () => {
            throw new Error('prompt should not be called')
          },
        },
      }
    )

    expect(workflow.createOptions).toEqual({
      baseDir: '/tmp/project/.claude/skills',
      skillDirname: '@tanstack__react-query@5',
      skillName: '@tanstack/react-query',
      skillDescription: 'React Query skill',
      sourcePackageName: '@tanstack/react-query',
      sourcePackageVersionHint: '5',
      force: true,
    })
  })

  it('supports separating the visible skill name from the source package identity', async () => {
    const workflow = await prepareCreateSkillWorkflow(
      'tanstack-router@1',
      {
        scope: 'current',
        name: '@tanstack/router',
        skillName: 'router-skill',
        description: 'Router workflow skill',
      },
      {
        cwd: '/tmp/project',
        prompt: {
          prompt: async () => {
            throw new Error('prompt should not be called')
          },
        },
      }
    )

    expect(workflow.createOptions).toEqual({
      baseDir: '/tmp/project/.claude/skills',
      skillDirname: 'tanstack-router@1',
      skillName: 'router-skill',
      skillDescription: 'Router workflow skill',
      sourcePackageName: '@tanstack/router',
      sourcePackageVersionHint: '1',
      force: undefined,
    })
  })

  it('supports interactive custom naming and custom scope selection', async () => {
    const answers = [
      { scope: 'custom' },
      { scope: 'skills-root' },
      { packageNameConfirmed: false },
      { customSkillName: 'custom-skill-name' },
      { customDescription: 'Interactive description' },
      { confirmFinal: true },
    ]

    const workflow = await prepareCreateSkillWorkflow(
      'demo-skill@1',
      {
        interactive: true,
      },
      {
        cwd: '/tmp/project',
        prompt: {
          prompt: async () => answers.shift() ?? {},
          Separator: class Separator {},
        },
      }
    )

    expect(workflow.createOptions).toEqual({
      baseDir: '/tmp/project/skills-root',
      skillDirname: 'demo-skill@1',
      skillName: 'custom-skill-name',
      skillDescription: 'Interactive description',
      sourcePackageName: 'custom-skill-name',
      sourcePackageVersionHint: '1',
      force: undefined,
    })
  })

  it('throws a cancellation sentinel when the final confirmation is rejected', async () => {
    const answers = [
      { scope: 'current' },
      { packageNameConfirmed: true },
      { customDescription: 'Interactive description' },
      { confirmFinal: false },
    ]

    await expect(
      prepareCreateSkillWorkflow(
        'demo-skill@1',
        {
          interactive: true,
        },
        {
          cwd: '/tmp/project',
          prompt: {
            prompt: async () => answers.shift() ?? {},
            Separator: class Separator {},
          },
        }
      )
    ).rejects.toThrow(SKILL_CREATION_CANCELLED_MESSAGE)
  })

  it('defaults the interactive scope to current when the project already has a skill-creator agent', async () => {
    const capturedQuestions: unknown[] = []
    const cwd = createTempDir('workflow-default-scope-')

    try {
      mkdirSync(join(cwd, '.claude', 'agents'), { recursive: true })
      writeFileSync(join(cwd, '.claude', 'agents', 'skill-creator.md'), '# installed')

      await prepareCreateSkillWorkflow(
        'demo-skill@1',
        {
          interactive: true,
        },
        {
          cwd,
          prompt: {
            prompt: async (questions) => {
              capturedQuestions.push(...(questions as unknown[]))
              return {
                scope: 'current',
                packageNameConfirmed: true,
                customDescription: '',
                confirmFinal: false,
              }
            },
            Separator: class Separator {},
          },
        }
      ).catch(() => undefined)

      const scopeQuestion = capturedQuestions[0] as { default?: string } | undefined
      expect(scopeQuestion?.default).toBe('current')
    } finally {
      cleanupTempDir(cwd)
    }
  })
})
