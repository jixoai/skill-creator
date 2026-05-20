import { describe, it, expect, beforeEach } from 'vitest'
import { PackageUtils } from '../../src/utils/package.js'
import { Context7Utils } from '../../src/utils/context7.js'

describe('PackageUtils', () => {
  describe('createSkillFolderName', () => {
    it('should create skill folder name with package and major version', () => {
      const name = PackageUtils.createSkillFolderName('react', '18.2.0')
      expect(name).toBe('react@18')
    })

    it('should handle scoped packages', () => {
      const name = PackageUtils.createSkillFolderName('@tanstack/router', '1.0.0')
      expect(name).toBe('@tanstack__router@1')
    })

    it('should handle complex package names', () => {
      const name = PackageUtils.createSkillFolderName('@my-org/complex-package-name', '2.5.1-beta')
      expect(name).toBe('@my-org__complex-package-name@2')
    })

    it('should handle version 0.x releases', () => {
      const name = PackageUtils.createSkillFolderName('express', '0.1.0')
      expect(name).toBe('express@0.1')
    })

    it('should return package name only if no version', () => {
      const name = PackageUtils.createSkillFolderName('react', '')
      expect(name).toBe('react')
    })
  })

  describe('getPackageVersion', () => {
    // Note: These tests would require actual npm registry access
    // In a real scenario, you might want to mock npm commands

    it('should handle known packages', async () => {
      // This would test actual npm command execution
      // For now, just ensure the method exists
      expect(typeof PackageUtils.getPackageVersion).toBe('function')
    })

    it('should return null for unknown packages', async () => {
      // This would test actual npm command execution
      const version = await PackageUtils.getPackageVersion('non-existent-package-12345')
      expect(version).toBeNull()
    })
  })

  describe('validatePackageName', () => {
    it('should validate correct package names', () => {
      expect(PackageUtils.validatePackageName('react')).toBe(true)
      expect(PackageUtils.validatePackageName('@tanstack/router')).toBe(true)
    })

    it('should reject invalid package names', () => {
      expect(PackageUtils.validatePackageName('')).toBe(false)
      expect(PackageUtils.validatePackageName('invalid name')).toBe(false)
    })
  })

  describe('normalizePackageName', () => {
    it('should normalize scoped package names for skill directory lookup', () => {
      expect(PackageUtils.normalizePackageName('@tanstack/react-query')).toBe(
        'tanstack__react-query'
      )
    })

    it('should preserve unscoped package names in lowercase', () => {
      expect(PackageUtils.normalizePackageName('Vitest')).toBe('vitest')
    })
  })

  describe('getPackageInfo', () => {
    it('should return full package info for a known package', async () => {
      const info = await PackageUtils.getPackageInfo('zod')
      expect(info).not.toBeNull()
      expect(info.name).toBe('zod')
      expect(info.version).toBeDefined()
      expect(info.description).toBeDefined()
      expect(info.homepage).toBeDefined()
      expect(info.repository).toBeDefined()
    })

    it('should return null for an unknown package', async () => {
      const info = await PackageUtils.getPackageInfo('non-existent-package-12345abc')
      expect(info).toBeNull()
    })
  })

  describe('resolveContext7Library', () => {
    it('should prefer package-path matches with version alignment over website mirrors', async () => {
      const fetchMock = async () =>
        new Response(
          JSON.stringify({
            results: [
              {
                id: '/websites/zod_dev',
                title: 'Zod',
                description: 'Website mirror',
                totalSnippets: 10283,
                trustScore: 9.9,
                benchmarkScore: 85.07,
                versions: [],
              },
              {
                id: '/colinhacks/zod',
                title: 'Zod',
                description: 'Repository docs',
                totalSnippets: 682,
                trustScore: 9.6,
                benchmarkScore: 89.2,
                versions: ['v3.24.2', 'v4.0.1'],
              },
            ],
            searchFilterApplied: false,
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }
        )

      const resolved = await Context7Utils.resolveLibrary('zod', {
        version: '4.1.7',
        fetchImpl: fetchMock as typeof fetch,
      })

      expect(resolved).not.toBeNull()
      expect(resolved?.bestMatch.id).toBe('/colinhacks/zod')
      expect(resolved?.bestMatch.matchKind).toBe('package-path')
      expect(resolved?.bestMatch.versionMatched).toBe(true)
      expect(resolved?.candidates[1]?.id).toBe('/websites/zod_dev')
    })
  })
})
