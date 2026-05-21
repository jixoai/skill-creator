import { describe, expect, it } from 'vitest'
import {
  SKILL_CREATOR_TEMPLATE_CONTRACTS,
  validateTemplateContract,
} from '../../scripts/lib/templateContract.js'

describe('skill-creator template contracts', () => {
  it.each(SKILL_CREATOR_TEMPLATE_CONTRACTS)('keeps $label aligned with the concrete workflow', (contract) => {
    expect(() => validateTemplateContract(contract)).not.toThrow()
  })
})
