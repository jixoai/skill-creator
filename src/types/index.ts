import type { SearchBackendInfo, SearchMode } from '../core/searchAdapter.js'

export type { SkillConfig } from '../utils/config.js'

export interface SearchResult {
  id: string
  title: string
  content: string
  score: number
  source: 'user' | 'context7'
  file_path: string
  metadata: Record<string, unknown>
}

export interface ContentStats {
  userFiles: number
  context7Files: number
  totalFiles: number
  userDirExists: boolean
  context7DirExists: boolean
}

export interface ContentItem {
  title: string
  filename: string
  source: 'user' | 'context7'
  path: string
  size: number
  modified: Date
}

export interface CreateSkillOptions {
  baseDir: string
  skillDirname: string
  skillName: string
  skillDescription?: string
  sourcePackageName?: string
  sourcePackageVersionHint?: string
  packageSummary?: string
  packageHomepage?: string
  packageRepository?: string
  force?: boolean
}

export interface CreateSkillResult {
  created: boolean
  skillPath?: string
  message: string
}

export interface UpdateContext7Result {
  updated: boolean
  skipped: boolean
  filesCreated: number
  message: string
}

export interface CommandIndexingResult {
  attempted: boolean
  skipped: boolean
  succeeded: boolean
  totalDocuments: number
  backendInfo?: SearchBackendInfo | null
  error?: string
}

export interface DownloadContext7CommandResult {
  projectId: string
  update: UpdateContext7Result
  skillMdUpdated: boolean
  context7Files: string[]
  indexing: CommandIndexingResult
}

export interface AddContentResult {
  added: boolean
  updated: boolean
  skipped: boolean
  filePath?: string
  message: string
  similarFound: number
  similarContent?: Array<{
    title: string
    score: number
    sourceRank?: 'primary' | 'secondary'
    source: string
    preview: string
  }>
  existingFile?: {
    path: string
    content: string
  }
}

export interface AddContentCommandResult extends AddContentResult {
  skillMdUpdated: boolean
  userFiles: string[]
}

export interface BuildIndexCommandResult {
  mode: Exclude<SearchMode, 'chroma'>
  vectorEmbedder?: string
  totalDocuments: number
  backendInfo?: SearchBackendInfo | null
}

export interface PackageVersion {
  version: string
  formatted: string
}

export interface Context7Library {
  context7_compatible_library_id: string
  name: string
  description: string
  code_snippets: number
  trust_score: number
  versions?: string[]
}

export interface Context7ResolvedLibrary {
  packageName: string
  version?: string
  query: string
  bestMatch: {
    id: string
    title: string
    description: string
    totalSnippets: number
    trustScore: number
    benchmarkScore: number
    versions: string[]
    matchKind: 'package-path' | 'package-slug' | 'website' | 'other'
    versionMatched: boolean
    selectionScore: number
  }
  candidates: Array<{
    id: string
    title: string
    description: string
    totalSnippets: number
    trustScore: number
    benchmarkScore: number
    versions: string[]
    matchKind: 'package-path' | 'package-slug' | 'website' | 'other'
    versionMatched: boolean
    selectionScore: number
  }>
}
