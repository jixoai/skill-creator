import { describe, expect, it } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTempDir, cleanupTempDir } from '../test-utils.js'
import {
  inferPackageMetadataFromSkill,
  inferVersionHintFromSkillDirectory,
  resolveSkillDirectoryFromOptions,
} from '../../src/utils/skillIdentity.js'

describe('skillIdentity', () => {
  it('infers package metadata from SKILL.md', () => {
    const tempDir = createTempDir('skill-identity-')

    try {
      const skillDir = join(tempDir, 'demo-skill@1')
      mkdirSync(skillDir, { recursive: true })
      writeFileSync(
        join(skillDir, 'SKILL.md'),
        `# Demo\n\n<skill-package name="@demo/pkg" version="1"></skill-package>\n`
      )

      expect(inferPackageMetadataFromSkill(skillDir)).toEqual({
        packageName: '@demo/pkg',
        versionHint: '1',
      })
    } finally {
      cleanupTempDir(tempDir)
    }
  })

  it('resolves package lookups from skill metadata before directory names', () => {
    const tempDir = createTempDir('skill-identity-')

    try {
      const skillsBase = join(tempDir, '.claude', 'skills')
      const exactSkillDir = join(skillsBase, 'custom-react-query-skill@5')
      const misleadingSkillDir = join(skillsBase, 'tanstack__react-query@5')

      mkdirSync(exactSkillDir, { recursive: true })
      mkdirSync(misleadingSkillDir, { recursive: true })

      writeFileSync(
        join(exactSkillDir, 'SKILL.md'),
        `# Exact\n\n<skill-package name="@tanstack/react-query" version="5"></skill-package>\n`
      )
      writeFileSync(
        join(misleadingSkillDir, 'SKILL.md'),
        `# Misleading\n\n<skill-package name="tanstack__react-query" version="5"></skill-package>\n`
      )

      const resolved = resolveSkillDirectoryFromOptions(
        { package: '@tanstack/react-query' },
        {},
        tempDir
      )

      expect(resolved).toBe(exactSkillDir)
    } finally {
      cleanupTempDir(tempDir)
    }
  })

  it('infers version hints from skill directory names', () => {
    expect(inferVersionHintFromSkillDirectory('/tmp/demo-skill@1.2.3')).toBe('1.2.3')
    expect(inferVersionHintFromSkillDirectory('/tmp/demo-skill')).toBeUndefined()
  })
})
