import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PackageUtils } from '../../src/utils/package.js'

describe('PackageUtils registry configuration', () => {
  const originalRegistryBase = process.env.SKILL_CREATOR_NPM_REGISTRY_BASE_URL
  const originalSearchBase = process.env.SKILL_CREATOR_NPM_SEARCH_BASE_URL

  beforeEach(() => {
    vi.restoreAllMocks()
    process.env.SKILL_CREATOR_NPM_REGISTRY_BASE_URL = originalRegistryBase
    process.env.SKILL_CREATOR_NPM_SEARCH_BASE_URL = originalSearchBase
  })

  it('uses configurable registry base urls for get-info and latest version lookups', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)

      if (url === 'http://127.0.0.1:3199/registry/demo-pkg/latest') {
        return new Response(JSON.stringify({ version: '1.2.3' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }

      if (url === 'http://127.0.0.1:3199/registry/demo-pkg') {
        return new Response(
          JSON.stringify({
            'dist-tags': {
              latest: '1.2.3',
            },
            versions: {
              '1.2.3': {
                name: 'demo-pkg',
                version: '1.2.3',
                description: 'Demo package',
              },
            },
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }
        )
      }

      throw new Error(`Unexpected fetch URL: ${url}`)
    })

    vi.stubGlobal('fetch', fetchMock)
    process.env.SKILL_CREATOR_NPM_REGISTRY_BASE_URL = 'http://127.0.0.1:3199/registry'

    await expect(PackageUtils.getPackageVersion('demo-pkg')).resolves.toBe('1.2.3')
    await expect(PackageUtils.getPackageInfo('demo-pkg')).resolves.toMatchObject({
      name: 'demo-pkg',
      version: '1.2.3',
    })
  })

  it('uses a configurable search base url for package search', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input))

      if (url.origin === 'http://127.0.0.1:3200' && url.pathname === '/registry/search') {
        return new Response(
          JSON.stringify({
            objects: [
              {
                package: {
                  name: 'demo-pkg',
                  version: '1.2.3',
                  description: 'Demo package',
                  date: '2026-05-21T00:00:00.000Z',
                  publisher: {
                    username: 'demo',
                  },
                },
                score: {
                  detail: {
                    popularity: 0.9,
                  },
                },
              },
            ],
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }
        )
      }

      if (url.origin === 'http://127.0.0.1:3200' && url.pathname === '/registry/demo-pkg') {
        return new Response(
          JSON.stringify({
            'dist-tags': {
              latest: '1.2.3',
            },
            versions: {
              '1.2.3': {
                name: 'demo-pkg',
                version: '1.2.3',
                description: 'Demo package',
                homepage: 'https://example.com/demo-pkg',
                repository: {
                  type: 'git',
                  url: 'https://github.com/example/demo-pkg.git',
                },
              },
            },
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }
        )
      }

      throw new Error(`Unexpected fetch URL: ${String(input)}`)
    })

    vi.stubGlobal('fetch', fetchMock)
    process.env.SKILL_CREATOR_NPM_SEARCH_BASE_URL = 'http://127.0.0.1:3200/registry/search'
    process.env.SKILL_CREATOR_NPM_REGISTRY_BASE_URL = 'http://127.0.0.1:3200/registry'

    const results = await PackageUtils.searchPackages(['demo'], { limit: 5, minScore: 0.1 })
    expect(results[0]).toMatchObject({
      name: 'demo-pkg',
      version: '1.2.3',
      homepage: 'https://example.com/demo-pkg',
      repository: 'https://github.com/example/demo-pkg.git',
      skill_dir_name: 'demo-pkg@1',
    })
  })
})
