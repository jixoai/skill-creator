import { describe, expect, it } from 'vitest'
import { analyzeSearchQuality } from '../../src/core/searchQuality.js'
import type { SearchResult } from '../../src/core/searchAdapter.js'

describe('search quality analysis', () => {
  it('normalizes unbounded minisearch scores into stable display tiers', () => {
    const results: SearchResult[] = [
      {
        id: '1',
        title: 'TypeScript Safety',
        content: '# TypeScript Safety\n\nType safety keeps runtime behavior predictable.',
        source: 'user',
        file_path: '/tmp/type-safety.md',
        score: 9.248,
        metadata: { backendId: 'minisearch' },
      },
      {
        id: '2',
        title: 'Schema Validation',
        content: '# Schema Validation\n\nType safety patterns belong in schema-first workflows.',
        source: 'user',
        file_path: '/tmp/schema-validation.md',
        score: 8.745,
        metadata: { backendId: 'minisearch' },
      },
      {
        id: '3',
        title: 'Runtime Guarantees',
        content: '# Runtime Guarantees\n\nType safety improves runtime guarantees for APIs.',
        source: 'context7',
        file_path: '/tmp/runtime-guarantees.md',
        score: 8.25,
        metadata: { backendId: 'minisearch' },
      },
      {
        id: '4',
        title: 'UI Layout',
        content: '# UI Layout\n\nDashboard spacing and layout polish.',
        source: 'context7',
        file_path: '/tmp/ui-layout.md',
        score: 4.987,
        metadata: { backendId: 'minisearch' },
      },
      {
        id: '5',
        title: 'Deployment',
        content: '# Deployment\n\nRelease process and packaging only.',
        source: 'context7',
        file_path: '/tmp/deployment.md',
        score: 3.42,
        metadata: { backendId: 'minisearch' },
      },
    ]

    const summary = analyzeSearchQuality(results, 'type safety')

    expect(summary.overallScore).toBeGreaterThan(0.7)
    expect(summary.results[0]?.displayScore).toBeGreaterThan(summary.results[1]?.displayScore ?? 0)
    expect(summary.results[1]?.displayScore).toBeGreaterThan(summary.results[3]?.displayScore ?? 0)
    expect(summary.results[0]?.displayTier).toBe('full')
    expect(summary.results[1]?.displayTier).toBe('preview')
    expect(summary.results[2]?.displayTier).toBe('preview')
    expect(summary.results[3]?.displayTier).toBe('metadata-only')
    expect(summary.results[4]?.displayTier).toBe('metadata-only')
  })

  it('keeps weak lexical hits below the auto-quality threshold', () => {
    const results: SearchResult[] = [
      {
        id: '1',
        title: 'Random Notes',
        content: '# Random Notes\n\nUnrelated housekeeping and packaging details.',
        source: 'user',
        file_path: '/tmp/random-notes.md',
        score: 0.2,
        metadata: { backendId: 'minisearch' },
      },
    ]

    const summary = analyzeSearchQuality(results, 'query client')

    expect(summary.overallScore).toBeLessThan(0.3)
    expect(summary.results[0]?.displayScore).toBeLessThan(0.3)
    expect(summary.reason).toBe('Weak full-text confidence')
  })
})
