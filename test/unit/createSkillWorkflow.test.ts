import { describe, expect, it } from 'vitest'
import {
  prepareCreateSkillWorkflow,
  SKILL_CREATION_CANCELLED_MESSAGE,
} from '../../src/utils/createSkillWorkflow.js'

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
})
