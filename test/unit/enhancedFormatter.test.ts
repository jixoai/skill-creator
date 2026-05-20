import { describe, expect, it } from 'vitest'
import { EnhancedFormatter } from '../../src/search_format/enhancedFormatter.js'
import type { SearchResult } from '../../src/core/searchAdapter.js'

describe('EnhancedFormatter', () => {
  it('keeps three-tier output while omitting formatter debug noise', () => {
    const formatter = new EnhancedFormatter()
    const results: SearchResult[] = [
      {
        id: '1',
        title: 'Top Match',
        content: '# Top Match\n\nMost relevant result.\nLine 3',
        source: 'user',
        file_path: '/tmp/skill/assets/references/user/top.md',
        score: 9,
        metadata: { backendId: 'minisearch' },
      },
      {
        id: '2',
        title: 'Middle Match',
        content: '# Middle Match\n\nUseful preview.\nTail line',
        source: 'context7',
        file_path: '/tmp/skill/assets/references/context7/middle.md',
        score: 5,
        metadata: { backendId: 'minisearch' },
      },
      {
        id: '3',
        title: 'Archive Notes',
        content: '# Archive Notes\n\nCompletely unrelated release notes.',
        source: 'context7',
        file_path: '/tmp/skill/assets/references/context7/low.md',
        score: 1,
        metadata: { backendId: 'minisearch' },
      },
    ]

    const formatted = formatter.format(results, {
      skillPath: '/tmp/skill',
      query: 'middle match',
      maxPreviewLength: 200,
      showLineNumbers: true,
    })

    expect(formatted).toHaveLength(3)

    expect(formatted[0]?.contentType).toBe('full-content')
    expect(formatted[0]?.content).toContain('<content lines="4">')
    expect(formatted[0]?.content).not.toContain('<!-- Score:')
    expect(formatted[0]?.result.metadata.displayRank).toBe(1)
    expect(formatted[0]?.result.metadata.displayScore).toBeGreaterThan(70)
    expect(formatted[0]?.result.metadata.sourceRank).toBe('primary')

    expect(formatted[1]?.contentType).toBe('preview')
    expect(formatted[1]?.content).toContain('<limit-content lines-indexs="1,3,4">')
    expect(formatted[1]?.content).not.toContain('<!-- Score:')
    expect(formatted[1]?.result.metadata.displayRank).toBe(2)
    expect(formatted[1]?.result.metadata.displayScore).toBeLessThan(
      formatted[0]?.result.metadata.displayScore ?? 0
    )
    expect(formatted[1]?.result.metadata.sourceRank).toBe('secondary')

    expect(formatted[2]?.contentType).toBe('metadata-only')
    expect(formatted[2]?.content).toBe('Content: (No preview - metadata only)')
  })
})
