/**
 * Search result formatting types and interfaces
 */

import type { SearchResult } from '../core/searchAdapter.js'

// Re-export SearchResult for formatter convenience
export type { SearchResult }

/**
 * Enhanced search result with additional metadata for formatting
 */
export interface FormattableSearchResult extends SearchResult {
  /** Relative file path from skill root */
  relativePath?: string
  /** Full content (for high-quality matches) */
  fullContent?: string
  /** Preview content with line numbers (for medium-quality matches) */
  preview?: string
  /** Display tier information */
  metadata: SearchResult['metadata'] & {
    displayTier?: 'full' | 'preview' | 'metadata-only'
    displayRank?: number
    displayScore?: number
    sourceRank?: 'primary' | 'secondary'
    maxScore?: number
    averageScore?: number
    qualityScore?: number
    relativeScore?: number
    queryCoverage?: number
    matchRanges?: number[][]
  }
}

/**
 * Formatting options for search results
 */
export interface FormattingOptions {
  /** Skill path for relative path calculation */
  skillPath: string
  /** Original query text for quality evaluation */
  query?: string
  /** Threshold for showing full content */
  showFullContentThreshold?: number
  /** Minimum score for showing preview */
  minScoreForPreview?: number
  /** Maximum preview length */
  maxPreviewLength?: number
  /** Whether to show line numbers */
  showLineNumbers?: boolean
}

/**
 * Formatted search result ready for display
 */
export interface FormattedResult {
  /** Original result */
  result: FormattableSearchResult
  /** Formatted display content */
  content: string
  /** Content type for styling */
  contentType: 'full-content' | 'preview' | 'metadata-only'
  /** Display priority */
  priority: number
}

/**
 * Base interface for search result formatters
 */
export interface SearchFormatter {
  /**
   * Format search results for display
   */
  format(results: SearchResult[], options: FormattingOptions): FormattedResult[]

  /**
   * Get formatter name
   */
  getName(): string

  /**
   * Get formatter description
   */
  getDescription(): string
}
