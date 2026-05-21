import { describe, expect, it } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { cleanupTempDir, createTempDir } from '../test-utils.js'
import {
  getDefaultScopedLocation,
  resolveAgentInstallScopeSelection,
  resolveStorageScopeSelection,
} from '../../src/utils/scopeSelection.js'

describe('scopeSelection', () => {
  it('defaults to current when the project already has a skill-creator agent', () => {
    const cwd = createTempDir('scope-selection-current-')

    try {
      mkdirSync(join(cwd, '.claude', 'agents'), { recursive: true })
      writeFileSync(join(cwd, '.claude', 'agents', 'skill-creator.md'), '# installed')

      expect(getDefaultScopedLocation(cwd)).toBe('current')
      expect(resolveStorageScopeSelection('auto', cwd)).toEqual({
        requestedScope: 'auto',
        resolvedScope: 'current',
        scopePath: join(cwd, '.claude', 'skills'),
      })
      expect(resolveAgentInstallScopeSelection('auto', cwd)).toEqual({
        requestedScope: 'auto',
        resolvedScope: 'current',
        targetDir: join(cwd, '.claude', 'agents'),
        targetFile: join(cwd, '.claude', 'agents', 'skill-creator.md'),
      })
    } finally {
      cleanupTempDir(cwd)
    }
  })

  it('defaults to user when the project does not have a skill-creator agent', () => {
    const cwd = createTempDir('scope-selection-user-')

    try {
      expect(getDefaultScopedLocation(cwd)).toBe('user')
      expect(resolveStorageScopeSelection('auto', cwd)).toEqual({
        requestedScope: 'auto',
        resolvedScope: 'user',
        scopePath: join(homedir(), '.claude', 'skills'),
      })
      expect(resolveAgentInstallScopeSelection('auto', cwd)).toEqual({
        requestedScope: 'auto',
        resolvedScope: 'user',
        targetDir: join(homedir(), '.claude', 'agents'),
        targetFile: join(homedir(), '.claude', 'agents', 'skill-creator.md'),
      })
    } finally {
      cleanupTempDir(cwd)
    }
  })

  it('rejects invalid install scopes with the expanded error contract', () => {
    expect(() => resolveAgentInstallScopeSelection('elsewhere', '/tmp/project')).toThrow(
      '❌ Invalid scope value. Use: user, current, or auto'
    )
  })
})
