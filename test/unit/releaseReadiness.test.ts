import { describe, expect, it } from 'vitest'
import { evaluatePublishedVersionReadiness } from '../../scripts/lib/releaseReadiness.js'

describe('release readiness', () => {
  it('fails readiness when the local version is already published', () => {
    const result = evaluatePublishedVersionReadiness({
      packageName: 'skill-creator',
      localVersion: '1.5.1',
      publishedVersion: '1.5.1',
    })

    expect(result.ready).toBe(false)
    expect(result.message).toContain('already published')
    expect(result.message).toContain('npm version patch|minor|major')
  })

  it('passes readiness when the local version is newer than the published version', () => {
    const result = evaluatePublishedVersionReadiness({
      packageName: 'skill-creator',
      localVersion: '1.5.2',
      publishedVersion: '1.5.1',
    })

    expect(result.ready).toBe(true)
    expect(result.message).toContain('New version: 1.5.2')
  })

  it('throws when the published version lookup is empty', () => {
    expect(() =>
      evaluatePublishedVersionReadiness({
        packageName: 'skill-creator',
        localVersion: '1.5.2',
        publishedVersion: '   ',
      })
    ).toThrow('returned an empty result')
  })
})
