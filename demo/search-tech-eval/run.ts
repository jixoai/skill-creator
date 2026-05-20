import {
  cpSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  type Dirent,
  readdirSync,
} from 'node:fs'
import { basename, join } from 'node:path'
import { buildSearchEngine } from '../../src/core/searchEngineFactory.js'
import type { SearchMode, SearchResult } from '../../src/core/searchAdapter.js'
import { demoDocuments, demoQueries, type DemoDocument } from './reference-data.js'
import { loadAcpBenchmarkProfile, type BenchmarkProfile } from './acp-benchmark.js'

interface RankedResult {
  id: string
  score: number
  title: string
  source: DemoDocument['source']
}

interface BackendReport {
  backend: SearchMode
  profile: string
  top1Hits: number
  totalQueries: number
  avgTop1Score: number
  results: Array<{
    query: string
    expectedTopId: string
    actualTopId: string | null
    matched: boolean
    topResults: RankedResult[]
  }>
}

const tempRoot = join(process.cwd(), 'demo', '.tmp', 'search-tech-eval')

function toSafePathSegment(input: string): string {
  return input.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '')
}

function parseArgs(argv: string[]): { skillPath?: string } {
  const args = [...argv]
  const result: { skillPath?: string } = {}

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--skill-path' && i + 1 < args.length) {
      result.skillPath = args[++i]
    }
  }

  return result
}

function getBenchmarkProfile(skillPath?: string): BenchmarkProfile {
  if (skillPath) {
    return loadAcpBenchmarkProfile(skillPath)
  }

  return {
    name: 'demo-static-corpus',
    documents: demoDocuments,
    queries: demoQueries,
  }
}

function prepareProfileArtifactDir(profile: BenchmarkProfile): string {
  const profileDir = join(tempRoot, toSafePathSegment(profile.name))
  rmSync(profileDir, { recursive: true, force: true })
  mkdirSync(profileDir, { recursive: true })
  return profileDir
}

function prepareWorkspace(profile: BenchmarkProfile, artifactDir: string): {
  skillDir: string
  referencesDir: string
} {
  const skillDir = join(artifactDir, 'skill')
  const referencesDir = join(skillDir, 'assets', 'references')
  mkdirSync(join(skillDir, 'assets', 'search'), { recursive: true })
  mkdirSync(referencesDir, { recursive: true })

  if (profile.name === 'demo-static-corpus') {
    writeStaticProfileDocuments(profile, referencesDir)
  } else {
    copyProfileReferences(profile, referencesDir)
  }

  return { skillDir, referencesDir }
}

function writeStaticProfileDocuments(profile: BenchmarkProfile, referencesDir: string): void {
  for (const document of profile.documents) {
    const fullPath = join(referencesDir, document.id)
    mkdirSync(join(fullPath, '..'), { recursive: true })
    writeFileSync(fullPath, document.content)
  }
}

function copyProfileReferences(profile: BenchmarkProfile, referencesDir: string): void {
  const sourceRoots = new Set<string>()

  for (const document of profile.documents) {
    const sourceRoot = inferReferenceRoot(document.filePath)
    if (sourceRoot) {
      sourceRoots.add(sourceRoot)
    }
  }

  for (const sourceRoot of sourceRoots) {
    const targetRoot = join(referencesDir, basename(sourceRoot))
    cpSync(sourceRoot, targetRoot, { recursive: true })
  }
}

function inferReferenceRoot(filePath: string): string | null {
  const normalized = filePath.replace(/\\/g, '/')
  const marker = '/assets/references/'
  const markerIndex = normalized.indexOf(marker)

  if (markerIndex === -1) {
    return null
  }

  const relativePath = normalized.slice(markerIndex + marker.length)
  const firstSegment = relativePath.split('/')[0]
  if (!firstSegment) {
    return null
  }

  return join(normalized.slice(0, markerIndex + marker.length), firstSegment)
}

async function runBackend(
  profile: BenchmarkProfile,
  workspace: { skillDir: string; referencesDir: string },
  mode: SearchMode
): Promise<BackendReport> {
  const engine = await buildSearchEngine({
    mode,
    skillDir: join(workspace.skillDir, 'assets'),
    referencesDir: workspace.referencesDir,
    config: {},
  })

  await engine.buildIndex(workspace.referencesDir)

  const results = []

  for (const queryInfo of profile.queries) {
    const searchResults = await engine.search(queryInfo.query, { topK: 3 })
    const topResults = searchResults.map(toRankedResult)
    const actualTopId = topResults[0]?.id ?? null
    results.push({
      query: queryInfo.query,
      expectedTopId: queryInfo.expectedTopId,
      actualTopId,
      matched: actualTopId === queryInfo.expectedTopId,
      topResults,
    })
  }

  const top1Hits = results.filter((item) => item.matched).length
  const avgTop1Score =
    results.reduce((sum, item) => sum + (item.topResults[0]?.score ?? 0), 0) / results.length

  await persistBackendArtifacts(workspace, mode)

  return {
    backend: mode,
    profile: profile.name,
    top1Hits,
    totalQueries: results.length,
    avgTop1Score,
    results,
  }
}

function toRankedResult(result: SearchResult): RankedResult {
  return {
    id: result.id,
    score: result.score,
    title: result.title,
    source: result.source,
  }
}

async function persistBackendArtifacts(
  workspace: { skillDir: string; referencesDir: string },
  mode: SearchMode
): Promise<void> {
  const searchDir = join(workspace.skillDir, 'assets', 'search')
  const artifactDir = join(join(workspace.skillDir, '..'), mode)
  rmSync(artifactDir, { recursive: true, force: true })
  mkdirSync(artifactDir, { recursive: true })

  if (!existsDirectory(searchDir)) {
    return
  }

  for (const entry of readdirSync(searchDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue
    const source = join(searchDir, entry.name)
    const target = join(artifactDir, entry.name)
    writeFileSync(target, readFileSync(source))
  }
}

function existsDirectory(pathname: string): boolean {
  try {
    const entries = readdirSync(pathname, { withFileTypes: true })
    return Array.isArray(entries)
  } catch {
    return false
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const profile = getBenchmarkProfile(args.skillPath)
  const artifactDir = prepareProfileArtifactDir(profile)
  const workspace = prepareWorkspace(profile, artifactDir)

  const reports = []
  for (const mode of ['fuzzy', 'fulltext', 'vector', 'auto'] satisfies SearchMode[]) {
    reports.push(await runBackend(profile, workspace, mode))
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    nodeVersion: process.version,
    profile: profile.name,
    documents: profile.documents.length,
    queries: profile.queries.length,
    reports,
  }

  writeFileSync(join(artifactDir, 'report.json'), JSON.stringify(payload, null, 2))
  console.log(JSON.stringify(payload, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error))
  process.exit(1)
})
