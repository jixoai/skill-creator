import { createHash } from 'node:crypto'
import { normalizeSearchableText } from './referenceSearchUtils.js'

export interface EmbeddingFunction {
  generate(input: string[]): Promise<number[][]>
}

const TOKEN_PATTERN = /[\p{L}\p{N}]+/gu

export function createEmbeddingFunctionFromEnvironment(
  dimensions: number
): EmbeddingFunction | null {
  const configuredMode = process.env.SKILL_CREATOR_VECTOR_EMBEDDER?.trim().toLowerCase()

  if (configuredMode === 'deterministic' || configuredMode === 'local') {
    return createDeterministicEmbeddingFunction(dimensions)
  }

  return null
}

export function createDeterministicEmbeddingFunction(dimensions: number): EmbeddingFunction {
  const resolvedDimensions = Math.max(1, Math.trunc(dimensions))

  return {
    async generate(input: string[]) {
      return input.map((text) => createDeterministicVector(text, resolvedDimensions))
    },
  }
}

function createDeterministicVector(text: string, dimensions: number): number[] {
  const normalized = normalizeSearchableText(text).toLowerCase()
  const tokens = normalized.match(TOKEN_PATTERN) ?? []
  const features = [
    normalized || '__empty__',
    ...tokens,
    ...createBigrams(tokens),
  ]

  const vector = new Array<number>(dimensions).fill(0)

  if (features.length === 0) {
    vector[0] = 1
    return vector
  }

  for (let index = 0; index < features.length; index++) {
    const feature = features[index]!
    const weight =
      index === 0 ? 0.75 :
      index <= tokens.length ? 1 :
      0.6
    applyFeature(vector, feature, weight)
  }

  const magnitude = Math.hypot(...vector)
  if (magnitude === 0) {
    vector[0] = 1
    return vector
  }

  return vector.map((value) => value / magnitude)
}

function createBigrams(tokens: string[]): string[] {
  const result: string[] = []
  for (let index = 0; index < tokens.length - 1; index++) {
    result.push(`${tokens[index]} ${tokens[index + 1]}`)
  }
  return result
}

function applyFeature(vector: number[], feature: string, weight: number): void {
  const digest = createHash('sha256').update(feature).digest()

  for (let slot = 0; slot < 4; slot++) {
    const position = (digest.readUInt16BE(slot * 2) + slot * 17) % vector.length
    const sign = (digest[16 + slot]! & 1) === 0 ? 1 : -1
    const scale = 1 - slot * 0.15
    vector[position] += sign * weight * scale
  }
}
