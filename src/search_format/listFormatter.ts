/**
 * Simple list formatter for search results
 * Shows basic information with minimal preview
 */

import type {
  SearchResult,
  FormattableSearchResult,
  FormattingOptions,
  FormattedResult,
  SearchFormatter,
} from './types.js'
import { relative } from 'node:path'
import { analyzeSearchQuality } from '../core/searchQuality.js'

/**
 * List formatter - simple, clean display with basic preview
 */
export class ListFormatter implements SearchFormatter {
  getName(): string {
    return 'list'
  }

  getDescription(): string {
    return 'Simple list format with basic preview'
  }

  format(results: SearchResult[], options: FormattingOptions): FormattedResult[] {
    const maxPreviewLength = options.maxPreviewLength || 200
    const qualitySummary = analyzeSearchQuality(results, options.query)

    return results.map((result, index) => {
      const qualityResult = qualitySummary.results[index]
      const formattableResult = result as FormattableSearchResult
      const relativePath = this.getRelativePath(formattableResult, options.skillPath)

      // Extract content for preview
      let previewContent = result.content
      if (formattableResult.fullContent) {
        // Extract original content from <content lines="N">...</content> format
        const match = formattableResult.fullContent.match(
          /^<content lines="\d+">\n(.*)\n<\/content>$/s
        )
        if (match) {
          previewContent = match[1]
        }
      }

      // Create preview
      const preview = this.createPreview(previewContent, maxPreviewLength)
      formattableResult.metadata = {
        ...formattableResult.metadata,
        displayRank: index + 1,
        displayScore: Number(((qualityResult?.displayScore ?? 0) * 100).toFixed(2)),
        sourceRank: index === 0 ? 'primary' : 'secondary',
      }

      return {
        result: formattableResult,
        content: preview,
        contentType: 'preview',
        priority: index,
      }
    })
  }

  private getRelativePath(result: FormattableSearchResult, skillPath: string): string {
    return result.relativePath || relative(skillPath, result.file_path)
  }

  private createPreview(content: string, maxLength: number): string {
    if (content.length <= maxLength) {
      return content.replace(/\n/g, ' ')
    }

    const preview = content.substring(0, maxLength)
    return preview.replace(/\n/g, ' ') + '...'
  }
}
