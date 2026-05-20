import { z } from 'zod'
import { PackageUtils } from './package.js'

const Context7SearchCandidateSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional().default(''),
  branch: z.string().optional(),
  lastUpdateDate: z.string().optional(),
  state: z.string().optional(),
  totalTokens: z.number().optional().default(0),
  totalSnippets: z.number().optional().default(0),
  stars: z.number().optional().default(0),
  trustScore: z.number().optional().default(0),
  benchmarkScore: z.number().optional().default(0),
  versions: z.array(z.string()).optional().default([]),
})

const Context7SearchResponseSchema = z.object({
  results: z.array(Context7SearchCandidateSchema),
  searchFilterApplied: z.boolean().optional().default(false),
})

export type Context7SearchCandidate = z.infer<typeof Context7SearchCandidateSchema>

export interface ResolvedContext7Candidate extends Context7SearchCandidate {
  matchKind: 'package-path' | 'package-slug' | 'website' | 'other'
  versionMatched: boolean
  selectionScore: number
}

export interface ResolveContext7Result {
  packageName: string
  version?: string
  query: string
  bestMatch: ResolvedContext7Candidate
  candidates: ResolvedContext7Candidate[]
}

export interface ResolveContext7Options {
  version?: string
  limit?: number
  fetchImpl?: typeof fetch
}

export class Context7Utils {
  static async resolveLibrary(
    packageName: string,
    options: ResolveContext7Options = {}
  ): Promise<ResolveContext7Result | null> {
    const version = options.version ?? (await PackageUtils.getPackageVersion(packageName)) ?? undefined
    const query = this.createSearchQuery(packageName, version)
    const response = await this.searchLibraries(packageName, query, options)
    const candidates = response.results
      .map((candidate) => this.annotateCandidate(candidate, packageName, version))
      .sort((left, right) => right.selectionScore - left.selectionScore)
      .slice(0, options.limit ?? 10)

    const bestMatch = candidates[0]
    if (!bestMatch) return null

    return {
      packageName,
      version,
      query,
      bestMatch,
      candidates,
    }
  }

  static createSearchQuery(packageName: string, version?: string): string {
    const baseName = this.getPackageBaseName(packageName)
    const formattedVersion = version ? PackageUtils.formatVersion(version) : ''
    return formattedVersion ? `${baseName} v${formattedVersion}` : baseName
  }

  private static async searchLibraries(
    packageName: string,
    query: string,
    options: ResolveContext7Options
  ): Promise<z.infer<typeof Context7SearchResponseSchema>> {
    const fetchImpl = options.fetchImpl ?? fetch
    const attempts = this.getLibrarySearchNames(packageName)
    const mergedResults = new Map<string, Context7SearchCandidate>()

    for (const libraryName of attempts) {
      const url = new URL(
        process.env.SKILL_CREATOR_CONTEXT7_SEARCH_BASE_URL ?? 'https://context7.com/api/v2/libs/search'
      )
      url.searchParams.set('libraryName', libraryName)
      url.searchParams.set('query', query)

      const response = await fetchImpl(url.toString())
      if (!response.ok) {
        throw new Error(`Failed to search Context7 libraries: ${response.status} ${response.statusText}`)
      }

      const payload = Context7SearchResponseSchema.parse(await response.json())
      for (const candidate of payload.results) {
        const existing = mergedResults.get(candidate.id)
        if (!existing || this.getCandidateMergeScore(candidate) > this.getCandidateMergeScore(existing)) {
          mergedResults.set(candidate.id, candidate)
        }
      }
    }

    return {
      results: Array.from(mergedResults.values()),
      searchFilterApplied: false,
    }
  }

  private static getLibrarySearchNames(packageName: string): string[] {
    const exact = packageName
    const baseName = this.getPackageBaseName(packageName)
    return Array.from(new Set([exact, baseName]))
  }

  private static getPackageBaseName(packageName: string): string {
    return packageName.replace(/^@/, '').split('/').pop() ?? packageName
  }

  private static annotateCandidate(
    candidate: Context7SearchCandidate,
    packageName: string,
    version?: string
  ): ResolvedContext7Candidate {
    const matchKind = this.classifyCandidate(candidate.id, packageName)
    const versionMatched = this.matchesVersion(candidate.versions, version)
    const matchWeight =
      matchKind === 'package-path' ? 4 :
      matchKind === 'package-slug' ? 3 :
      matchKind === 'website' ? 2 :
      1
    const selectionScore =
      matchWeight * 1_000_000_000 +
      (versionMatched ? 100_000_000 : 0) +
      candidate.totalSnippets * 1_000 +
      Math.round(candidate.trustScore * 100) * 10 +
      Math.round(candidate.benchmarkScore)

    return {
      ...candidate,
      matchKind,
      versionMatched,
      selectionScore,
    }
  }

  private static classifyCandidate(
    candidateId: string,
    packageName: string
  ): ResolvedContext7Candidate['matchKind'] {
    const candidateSegments = candidateId
      .replace(/^\/+/, '')
      .toLowerCase()
      .split('/')
      .filter(Boolean)
    const packageSegments = packageName
      .replace(/^@/, '')
      .toLowerCase()
      .split('/')
      .filter(Boolean)

    if (candidateSegments[0] === 'websites') {
      return 'website'
    }

    const candidateTail = candidateSegments.slice(-packageSegments.length)
    if (candidateTail.join('/') === packageSegments.join('/')) {
      return 'package-path'
    }

    const packageBaseName = packageSegments[packageSegments.length - 1]
    if (candidateSegments[candidateSegments.length - 1] === packageBaseName) {
      return 'package-slug'
    }

    return 'other'
  }

  private static matchesVersion(versions: string[], version?: string): boolean {
    if (!version) return false
    const formattedVersion = PackageUtils.formatVersion(version)
    return versions.some((candidateVersion) => {
      const normalizedVersion = candidateVersion.toLowerCase().replace(/^v/, '').replace(/_/g, '.')
      return (
        normalizedVersion === formattedVersion ||
        normalizedVersion.startsWith(`${formattedVersion}.`)
      )
    })
  }

  private static getCandidateMergeScore(candidate: Context7SearchCandidate): number {
    return (
      candidate.totalSnippets * 1_000 +
      Math.round(candidate.trustScore * 100) * 10 +
      Math.round(candidate.benchmarkScore)
    )
  }
}
