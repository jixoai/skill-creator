import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import path, { join } from 'node:path'

export type DefaultScopedLocation = 'current' | 'user'
export type ResolvedStorageScope = DefaultScopedLocation | 'custom'

export function hasProjectSkillCreatorAgent(cwd: string): boolean {
  return existsSync(join(cwd, '.claude', 'agents', 'skill-creator.md'))
}

export function getDefaultScopedLocation(cwd: string): DefaultScopedLocation {
  return hasProjectSkillCreatorAgent(cwd) ? 'current' : 'user'
}

export function resolveStorageScopeSelection(
  scope: string,
  cwd: string,
  requestedScope: string = scope
): {
  requestedScope: string
  resolvedScope: ResolvedStorageScope
  scopePath: string
} {
  if (scope === 'auto') {
    return resolveStorageScopeSelection(getDefaultScopedLocation(cwd), cwd, requestedScope)
  }

  if (scope === 'user') {
    return {
      requestedScope,
      resolvedScope: 'user',
      scopePath: path.join(homedir(), '.claude', 'skills'),
    }
  }

  if (scope === 'current') {
    return {
      requestedScope,
      resolvedScope: 'current',
      scopePath: path.join(cwd, '.claude', 'skills'),
    }
  }

  return {
    requestedScope,
    resolvedScope: 'custom',
    scopePath: scope,
  }
}

export function resolveAgentInstallScopeSelection(
  scope: string,
  cwd: string,
  requestedScope: string = scope
): {
  requestedScope: string
  resolvedScope: DefaultScopedLocation
  targetDir: string
  targetFile: string
} {
  if (scope === 'auto') {
    return resolveAgentInstallScopeSelection(getDefaultScopedLocation(cwd), cwd, requestedScope)
  }

  if (scope === 'user') {
    const targetDir = join(homedir(), '.claude', 'agents')
    return {
      requestedScope,
      resolvedScope: 'user',
      targetDir,
      targetFile: join(targetDir, 'skill-creator.md'),
    }
  }

  if (scope === 'current') {
    const targetDir = join(cwd, '.claude', 'agents')
    return {
      requestedScope,
      resolvedScope: 'current',
      targetDir,
      targetFile: join(targetDir, 'skill-creator.md'),
    }
  }

  throw new Error('❌ Invalid scope value. Use: user, current, or auto')
}
