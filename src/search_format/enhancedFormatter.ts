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
 * Enhanced formatter - user-facing three-tier display driven by shared search quality signals.
 */
export class EnhancedFormatter implements SearchFormatter {
  getName(): string {
    return 'enhanced'
  }

  getDescription(): string {
    return 'Three-tier enhanced format with intelligent content display'
  }

  format(results: SearchResult[], options: FormattingOptions): FormattedResult[] {
    if (results.length === 0) {
      return []
    }

    const qualitySummary = analyzeSearchQuality(results, options.query)
    const enhancedResults = this.enhanceResults(qualitySummary, options)

    // Format based on display tiers
    return enhancedResults.map((result, index) => {
      const formattedContent = this.formatByTier(result, options)
      const contentType = this.getContentType(result)

      return {
        result,
        content: formattedContent,
        contentType,
        priority: index,
      }
    })
  }

  private enhanceResults(
    qualitySummary: ReturnType<typeof analyzeSearchQuality>,
    options: FormattingOptions
  ): FormattableSearchResult[] {
    const { skillPath } = options

    return qualitySummary.results.map((qualityResult) => {
      const result = qualityResult.result
      const enhancedResult = result as FormattableSearchResult
      let fullContent: string | undefined
      let preview: string | undefined

      if (qualityResult.displayTier === 'full') {
        fullContent = this.wrapContent(result.content, 'content')
      } else if (qualityResult.displayTier === 'preview') {
        preview = this.createEnhancedPreview(result.content)
      }

      // 设置相对路径
      enhancedResult.relativePath = relative(skillPath, result.file_path)

      // 添加质量元数据
      enhancedResult.metadata = {
        ...result.metadata,
        displayRank: qualityResult.index + 1,
        displayScore: Number((qualityResult.displayScore * 100).toFixed(2)),
        sourceRank: qualityResult.index === 0 ? 'primary' : 'secondary',
        displayTier: qualityResult.displayTier,
        maxScore: qualitySummary.maxScore,
        averageScore: qualitySummary.averageScore,
        qualityScore: qualityResult.calibratedScore,
        relativeScore: qualityResult.relativeScore,
        queryCoverage: qualityResult.queryCoverage,
      }

      if (fullContent) enhancedResult.fullContent = fullContent
      if (preview) enhancedResult.preview = preview

      return enhancedResult
    })
  }

  /**
   * Format content based on display tier
   */
  private formatByTier(result: FormattableSearchResult, options: FormattingOptions): string {
    const tier = result.metadata.displayTier

    switch (tier) {
      case 'full':
        return result.fullContent || ''

      case 'preview':
        return result.preview || ''

      case 'metadata-only':
        return 'Content: (No preview - metadata only)'

      default:
        return `${result.content.substring(0, 200).replace(/\n/g, ' ')}...`
    }
  }

  /**
   * Get content type for styling
   */
  private getContentType(result: FormattableSearchResult): FormattedResult['contentType'] {
    switch (result.metadata.displayTier) {
      case 'full':
        return 'full-content'
      case 'preview':
        return 'preview'
      default:
        return 'metadata-only'
    }
  }

  /**
   * Create enhanced preview with line numbers
   */
  private createEnhancedPreview(content: string): string {
    const lines = content.split('\n')
    const lineNumbers: number[] = []

    // Select representative lines (first, middle, last)
    const selectedLines: string[] = []
    if (lines.length > 0) {
      selectedLines.push(lines[0])
      lineNumbers.push(1)
    }

    if (lines.length > 2) {
      const middleLine = Math.floor(lines.length / 2)
      selectedLines.push(lines[middleLine])
      lineNumbers.push(middleLine + 1)
    }

    if (lines.length > 1) {
      selectedLines.push(lines[lines.length - 1])
      lineNumbers.push(lines.length)
    }

    const previewContent = selectedLines.join('\n')
    const lineIndexes = lineNumbers.join(',')

    return this.wrapContent(previewContent, 'limit-content', lineIndexes)
  }

  /**
   * Wrap content in appropriate tags
   */
  private wrapContent(content: string, tag: string, lineIndexes?: string): string {
    if (tag === 'limit-content' && lineIndexes) {
      return `<${tag} lines-indexs="${lineIndexes}">\n${content}\n</${tag}>`
    } else if (tag === 'content') {
      const lines = content.split('\n').length
      return `<${tag} lines="${lines}">\n${content}\n</${tag}>`
    }
    return content
  }
}
