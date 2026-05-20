import { createHash } from 'node:crypto'

export const SEARCH_RULESET_VERSIONS = {
  minisearch: '2026-05-21-v1',
  sqliteVec: '2026-05-21-v2',
} as const

export function detectReferenceSource(relativePath: string): 'user' | 'context7' {
  const normalizedPath = relativePath.replace(/\\/g, '/')
  if (normalizedPath.startsWith('context7/') || normalizedPath.startsWith('official/')) {
    return 'context7'
  }
  return 'user'
}

export function normalizeReferenceContent(content: string): string {
  return content
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
}

export function normalizeSearchableText(content: string): string {
  return normalizeReferenceContent(content)
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
}

export function createSearchRulesetHash(parts: Array<string>): string {
  const hash = createHash('sha256')
  for (const part of parts) {
    hash.update(part)
  }
  return hash.digest('hex')
}
