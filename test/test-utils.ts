import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync, mkdtempSync } from 'node:fs'

export function createTempDir(prefix = 'test-'): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

export function cleanupTempDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    // Ignore cleanup errors
  }
}

export async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function createMockConfig(overrides: any = {}) {
  return {
    name: 'test-skill',
    description: 'Test skill for unit testing',
    context7LibraryId: '/test/docs',
    version: '1.0.0',
    chunkSize: 1000,
    chunkOverlap: 200,
    embeddingModel: 'all-MiniLM-L6-v2',
    similarityThreshold: 0.85,
    maxSearchResults: 10,
    ...overrides,
  }
}
