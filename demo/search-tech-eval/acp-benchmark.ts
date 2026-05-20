import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

export interface BenchmarkDocument {
  id: string
  title: string
  content: string
  source: 'user' | 'context7'
  filePath: string
}

export interface BenchmarkQueryExpectation {
  query: string
  expectedTopId: string
  note: string
}

export interface BenchmarkProfile {
  name: string
  documents: BenchmarkDocument[]
  queries: BenchmarkQueryExpectation[]
}

export function loadAcpBenchmarkProfile(skillPath: string): BenchmarkProfile {
  const referencesDir = join(skillPath, 'assets', 'references')
  if (!existsSync(referencesDir)) {
    throw new Error(`Benchmark references directory not found: ${referencesDir}`)
  }

  const documents = collectMarkdownDocuments(referencesDir).map((filePath) => {
    const relativePath = relative(referencesDir, filePath)
    const content = readFileSync(filePath, 'utf-8')
    const title =
      content.split('\n')[0]?.replace(/^#+\s*/, '').trim() ||
      relativePath.replace(/\.md$/, '').replace(/[-_]/g, ' ')

    return {
      id: relativePath,
      title,
      content,
      source: relativePath.includes('context7/') ? 'context7' : 'user',
      filePath,
    } satisfies BenchmarkDocument
  })

  return {
    name: 'acp-real-skill',
    documents,
    queries: [
      {
        query: 'how to stream tool results',
        expectedTopId: 'official/protocol/tool-calls.md',
        note: 'Tool call protocol should outrank broad developer guides.',
      },
      {
        query: 'permission request delete logs',
        expectedTopId: 'official/protocol/tool-calls.md',
        note: 'Permission request workflow should resolve to the concrete tool call protocol.',
      },
      {
        query: 'stream response',
        expectedTopId: 'user/implementation/03-tools-streaming.md',
        note: 'Stream response implementation notes should outrank broad guides.',
      },
      {
        query: 'session update tool call',
        expectedTopId: 'official/protocol/tool-calls.md',
        note: 'Session update + tool call query should land on tool call protocol.',
      },
      {
        query: 'multi agent collaboration',
        expectedTopId: 'user/acp-multi-agent-collaboration.md',
        note: 'Multi-agent collaboration queries should land on the dedicated collaboration guide.',
      },
      {
        query: 'type safety',
        expectedTopId: 'user/best-practices/01-type-safety.md',
        note: 'Type safety queries should land on the dedicated best-practices guide.',
      },
    ],
  }
}

function collectMarkdownDocuments(rootDir: string): string[] {
  const files: string[] = []

  for (const entry of readdirSync(rootDir, { withFileTypes: true })) {
    const fullPath = join(rootDir, entry.name)
    if (entry.isDirectory()) {
      files.push(...collectMarkdownDocuments(fullPath))
      continue
    }
    if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(fullPath)
    }
  }

  return files
}
