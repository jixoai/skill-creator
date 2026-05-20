import type { SearchBackendId, SearchResult } from './searchAdapter.js'

export type SearchDisplayTier = 'full' | 'preview' | 'metadata-only'

export interface SearchResultQuality {
  result: SearchResult
  index: number
  backendId: SearchBackendId | 'unknown'
  calibratedScore: number
  displayScore: number
  relativeScore: number
  titleCoverage: number
  contentCoverage: number
  queryCoverage: number
  exactTitleMatch: boolean
  exactPhraseMatch: boolean
  displayTier: SearchDisplayTier
}

export interface SearchQualitySummary {
  overallScore: number
  reason: string
  maxScore: number
  averageScore: number
  results: SearchResultQuality[]
}

const MINI_SEARCH_SOFT_CAP = 3

export function analyzeSearchQuality(
  results: SearchResult[],
  query?: string
): SearchQualitySummary {
  if (results.length === 0) {
    return {
      overallScore: 0,
      reason: 'No results found',
      maxScore: 0,
      averageScore: 0,
      results: [],
    }
  }

  const rawScores = results.map((result) => result.score)
  const maxScore = Math.max(...rawScores)
  const minScore = Math.min(...rawScores)
  const averageScore = rawScores.reduce((sum, score) => sum + score, 0) / rawScores.length

  const normalizedQuery = normalizeText(query ?? '')
  const queryTokens = tokenize(normalizedQuery)
  const lastIndex = Math.max(1, results.length - 1)

  const qualityResults = results.map((result, index) => {
    const backendId = resolveBackendId(result)
    const calibratedScore = calibrateScore(result.score, backendId)
    const relativeScore =
      maxScore === minScore
        ? results.length === 1
          ? 1
          : clamp(1 - index / lastIndex)
        : clamp((result.score - minScore) / (maxScore - minScore))

    const titleText = normalizeText(result.title)
    const contentText = normalizeText(result.content)
    const titleCoverage = calculateCoverage(titleText, queryTokens)
    const contentCoverage = calculateCoverage(contentText, queryTokens)
    const queryCoverage = Math.max(titleCoverage, contentCoverage)
    const exactTitleMatch = normalizedQuery.length > 0 && titleText.includes(normalizedQuery)
    const exactPhraseMatch = normalizedQuery.length > 0 && contentText.includes(normalizedQuery)
    const displayScore = calculateDisplayScore({
      calibratedScore,
      relativeScore,
      queryCoverage,
      exactTitleMatch,
      exactPhraseMatch,
    })

    return {
      result,
      index,
      backendId,
      calibratedScore,
      displayScore,
      relativeScore,
      titleCoverage,
      contentCoverage,
      queryCoverage,
      exactTitleMatch,
      exactPhraseMatch,
      displayTier: recommendDisplayTier({
        index,
        calibratedScore,
        relativeScore,
        queryCoverage,
        exactTitleMatch,
        exactPhraseMatch,
      }),
    } satisfies SearchResultQuality
  })

  const topResult = qualityResults[0]
  const supportiveResults = qualityResults.filter((result) => result.displayTier !== 'metadata-only')
  const topSignal = Math.max(
    topResult.calibratedScore,
    topResult.queryCoverage,
    topResult.exactTitleMatch ? 1 : 0,
    topResult.exactPhraseMatch ? 0.85 : 0
  )
  const supportScore = supportiveResults.length / Math.min(qualityResults.length, 3)

  let overallScore = clamp(topSignal * 0.7 + supportScore * 0.2 + topResult.relativeScore * 0.1)

  if (
    topResult.queryCoverage === 0 &&
    !topResult.exactTitleMatch &&
    !topResult.exactPhraseMatch &&
    topResult.calibratedScore < 0.25
  ) {
    overallScore = Math.min(overallScore, 0.25)
  }

  return {
    overallScore,
    reason: describeQuality(topResult, supportiveResults.length),
    maxScore,
    averageScore,
    results: qualityResults,
  }
}

function recommendDisplayTier(input: {
  index: number
  calibratedScore: number
  relativeScore: number
  queryCoverage: number
  exactTitleMatch: boolean
  exactPhraseMatch: boolean
}): SearchDisplayTier {
  if (input.index === 0) {
    return 'full'
  }

  if (
    input.exactTitleMatch ||
    input.exactPhraseMatch ||
    input.queryCoverage >= 0.5 ||
    input.relativeScore >= 0.75 ||
    input.calibratedScore >= 0.8
  ) {
    return 'preview'
  }

  return 'metadata-only'
}

function calculateDisplayScore(input: {
  calibratedScore: number
  relativeScore: number
  queryCoverage: number
  exactTitleMatch: boolean
  exactPhraseMatch: boolean
}): number {
  const exactBonus =
    input.exactTitleMatch ? 0.05 :
    input.exactPhraseMatch ? 0.025 :
    0

  return clamp(
    input.calibratedScore * 0.5 + input.relativeScore * 0.25 + input.queryCoverage * 0.2 + exactBonus
  )
}

function resolveBackendId(result: SearchResult): SearchBackendId | 'unknown' {
  const metadata = result.metadata
  const backendId = metadata['backendId']

  if (
    backendId === 'minisearch' ||
    backendId === 'ufuzzy' ||
    backendId === 'sqlite-vec'
  ) {
    return backendId
  }

  return result.score > 1 ? 'minisearch' : 'unknown'
}

function calibrateScore(score: number, backendId: SearchBackendId | 'unknown'): number {
  if (backendId === 'minisearch') {
    return clamp(score / (score + MINI_SEARCH_SOFT_CAP))
  }

  return clamp(score)
}

function normalizeText(value: string): string {
  return value.toLowerCase()
}

function tokenize(value: string): string[] {
  return value.match(/[\p{L}\p{N}]+/gu) ?? []
}

function calculateCoverage(text: string, queryTokens: string[]): number {
  if (queryTokens.length === 0) {
    return 0
  }

  let matched = 0
  for (const token of queryTokens) {
    if (text.includes(token)) {
      matched += 1
    }
  }

  return matched / queryTokens.length
}

function describeQuality(topResult: SearchResultQuality, supportiveCount: number): string {
  if (topResult.exactTitleMatch) {
    return 'Exact title match found'
  }

  if (topResult.exactPhraseMatch) {
    return 'Exact content phrase match found'
  }

  if (topResult.queryCoverage >= 0.75) {
    return 'Strong query coverage in top result'
  }

  if (supportiveCount >= 2 && topResult.relativeScore >= 0.75) {
    return 'Multiple supporting results found'
  }

  if (topResult.calibratedScore < 0.25 && topResult.queryCoverage === 0) {
    return 'Weak full-text confidence'
  }

  return 'Moderate search confidence'
}

function clamp(value: number): number {
  if (Number.isNaN(value)) return 0
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}
