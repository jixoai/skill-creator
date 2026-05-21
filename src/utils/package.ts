/**
 * Package utilities
 */

import { readFileSync } from 'node:fs'
import type { PackageVersion } from '../types/index.js'
import { resolve } from 'node:path'
import { rootResolver } from './path.js'

export interface SearchResult {
  name: string
  description: string
  version: string
  date: string
  publisher: string
  score: number
  homepage?: string
  repository?: string
  skill_dir_name?: string
}

export interface SearchOptions {
  limit?: number
  minScore?: number
}

export class PackageUtils {
  private static getRegistryBaseUrl(): string {
    return (process.env.SKILL_CREATOR_NPM_REGISTRY_BASE_URL ?? 'https://registry.npmjs.org').replace(
      /\/+$/,
      ''
    )
  }

  private static getSearchBaseUrl(): string {
    return (
      process.env.SKILL_CREATOR_NPM_SEARCH_BASE_URL ?? `${this.getRegistryBaseUrl()}/-/v1/search`
    ).replace(/\/+$/, '')
  }

  /**
   * Get package version from npm registry
   */
  static async getPackageVersion(packageName: string): Promise<string | null> {
    try {
      const response = await fetch(`${this.getRegistryBaseUrl()}/${packageName}/latest`)
      if (!response.ok) return null

      const data = await response.json()
      return data.version as string
    } catch {
      return null
    }
  }

  /**
   * Get full package info from npm registry for the latest version
   */
  static async getPackageInfo(packageName: string): Promise<{
    name: string
    version: string
    description: string
    homepage?: string
    repository?: { type: string; url: string }
    [key: string]: any
  } | null> {
    try {
      const response = await fetch(`${this.getRegistryBaseUrl()}/${packageName}`)
      if (!response.ok) return null

      const data = await response.json()
      const latestVersionTag = data['dist-tags']?.latest
      if (!latestVersionTag) return null

      const latestVersionInfo = data.versions?.[latestVersionTag]
      if (!latestVersionInfo) return null

      return latestVersionInfo
    } catch {
      return null
    }
  }

  /**
   * Get full package info from npm registry for the latest version
   */
  static getCurrentPackageInfo(): {
    name: string
    version: string
    description: string
    homepage?: string
    repository?: { type: string; url: string }
    [key: string]: any
  } | null {
    try {
      const packageInfo = JSON.parse(readFileSync(rootResolver('package.json'), 'utf-8'))
      return packageInfo
    } catch {
      return null
    }
  }

  /**
   * Format version according to doc-downloader rules
   */
  static formatVersion(version: string): string {
    if (!version) return ''

    // Remove 'v' prefix if present
    if (version.startsWith('v')) {
      version = version.slice(1)
    }

    const parts = version.split('.')
    if (parts.length >= 2) {
      const major = parseInt(parts[0], 10)
      if (major >= 1) {
        return String(major)
      } else {
        return `${major}.${parts[1]}`
      }
    }

    return version
  }

  /**
   * Create skill folder name according to spec
   */
  static createSkillFolderName(packageName: string, version: string): string {
    // Replace / with __ as specified in doc-downloader.md
    const safePackage = packageName.replace(/\//g, '__')
    const formattedVersion = this.formatVersion(version)

    if (formattedVersion) {
      return `${safePackage}@${formattedVersion}`
    } else {
      return safePackage
    }
  }

  /**
   * Normalize package name (remove @ prefix)
   */
  static normalizePackageName(packageName: string): string {
    return packageName
      .replace(/^@/, '')
      .replace(/\//g, '__')
      .replace(/[^a-z0-9@._-]/gi, '')
      .toLowerCase()
  }

  /**
   * Validate package name format
   */
  static validatePackageName(packageName: string): boolean {
    if (!packageName || packageName.length === 0) {
      return false
    }

    // Basic validation for npm package names
    const validNamePattern = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/
    return validNamePattern.test(packageName)
  }

  /**
   * Search for packages on npm registry
   */
  static async searchPackages(
    keywords: string[],
    options: SearchOptions = {}
  ): Promise<SearchResult[]> {
    const { limit = 10, minScore = 0.3 } = options

    try {
      const query = keywords.join(' ')
      const searchUrl = new URL(this.getSearchBaseUrl())
      searchUrl.searchParams.set('text', query)
      searchUrl.searchParams.set('size', String(limit * 2))
      const response = await fetch(searchUrl)

      if (!response.ok) return []

      const data = await response.json()
      const results: SearchResult[] = []

      for (const pkg of data.objects || []) {
        const score = pkg.score?.detail?.popularity || 0
        if (score >= minScore) {
          // Get detailed package information including homepage
          const packageInfo = await this.getPackageInfo(pkg.package.name)

          results.push({
            name: pkg.package.name,
            description: pkg.package.description || '',
            version: pkg.package.version,
            date: pkg.package.date,
            publisher: pkg.package.publisher?.username || 'unknown',
            score,
            homepage: packageInfo?.homepage,
            repository: packageInfo?.repository?.url,
            skill_dir_name: packageInfo
              ? this.createSkillFolderName(packageInfo.name, packageInfo.version)
              : undefined,
          })
        }
      }

      return results.slice(0, limit)
    } catch {
      return []
    }
  }

  /**
   * Find exact package match
   */
  static async findExactPackage(packageName: string): Promise<SearchResult | null> {
    try {
      const packageInfo = await this.getPackageInfo(packageName)
      if (!packageInfo) return null

      return {
        name: packageInfo.name,
        description: packageInfo.description || '',
        version: packageInfo.version,
        date: packageInfo.time?.modified || new Date().toISOString(),
        publisher: packageInfo.publisher?.username || 'unknown',
        score: 1.0,
        homepage: packageInfo.homepage,
        repository: packageInfo.repository?.url,
        skill_dir_name: this.createSkillFolderName(packageInfo.name, packageInfo.version),
      }
    } catch {
      return null
    }
  }

  /**
   * Suggest packages based on keywords
   */
  static async suggestPackages(
    input: string,
    options: SearchOptions = {}
  ): Promise<SearchResult[]> {
    const results: SearchResult[] = []

    // Check if input looks like an exact package name and include it as first result
    if (PackageUtils.validatePackageName(input)) {
      const exact = await PackageUtils.findExactPackage(input)
      if (exact) {
        results.push(exact)
      }
    }

    // Always perform broader search to find related packages
    // Extract keywords from input
    const keywords = input
      .split(/[\s-]+/)
      .filter((word) => word.length > 2)
      .slice(0, 3)

    if (keywords.length === 0) {
      // Fallback: search with the whole input
      keywords.push(input)
    }

    const searchResults = await PackageUtils.searchPackages(keywords, options)

    // Merge exact match with search results, avoiding duplicates
    const exactMatchNames = new Set(results.map((r) => r.name))
    const additionalResults = searchResults.filter((r) => !exactMatchNames.has(r.name))

    return [...results, ...additionalResults].slice(0, options.limit || 10)
  }

  /**
   * Select package from multiple options
   */
  static async selectPackage(input: string): Promise<{ name: string; version: string } | null> {
    const suggestions = await PackageUtils.suggestPackages(input, { limit: 5 })

    if (suggestions.length === 0) {
      return null
    }

    if (suggestions.length === 1) {
      const pkg = suggestions[0]
      const version = await PackageUtils.getPackageVersion(pkg.name)
      return { name: pkg.name, version: version || pkg.version }
    }

    // Multiple options found - would need interactive selection in CLI
    // For now, return the highest scored package
    const best = suggestions.reduce((prev, curr) => (curr.score > prev.score ? curr : prev))

    const version = await PackageUtils.getPackageVersion(best.name)
    return { name: best.name, version: version || best.version }
  }
}
