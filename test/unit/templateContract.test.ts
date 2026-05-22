import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  SKILL_CREATOR_TEMPLATE_CONTRACTS,
  validateTemplateContract,
} from '../../scripts/lib/templateContract.js'

describe('skill-creator template contracts', () => {
  it.each(SKILL_CREATOR_TEMPLATE_CONTRACTS)('keeps $label aligned with the concrete workflow', (contract) => {
    expect(() => validateTemplateContract(contract)).not.toThrow()
  })

  it('keeps the optional project-local skill-creator agent synced when present', () => {
    if (!existsSync('.claude/agents/skill-creator.md')) {
      return
    }

    const template = readFileSync('templates/skill-creator.md', 'utf-8')
    const projectAgent = readFileSync('.claude/agents/skill-creator.md', 'utf-8')

    expect(projectAgent).toBe(template)
  })
})
