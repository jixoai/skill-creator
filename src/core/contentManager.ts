/**
 * Content management with Context7 integration
 */

import { join } from 'node:path'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  writeFileSync,
  rmSync,
  statSync,
  readFileSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import MarkdownIt from 'markdown-it'
import type {
  ContentStats,
  ContentItem,
  UpdateContext7Result,
  AddContentResult,
} from '../types/index.js'

export interface ContentManagerOptions {
  searchEngine: {
    initialize?(): Promise<void>
    buildIndex?(referencesDir: string): Promise<void>
    clearIndex?(): Promise<void> | void
    search(query: string, topK?: number, where?: any): Promise<any[]>
  }
  referencesDir: string
  fetchImpl?: typeof fetch
}

export class ContentManager {
  private options: ContentManagerOptions
  private userDir: string
  private context7BaseDir: string
  private md: MarkdownIt

  constructor(options: ContentManagerOptions) {
    this.options = options
    this.userDir = join(options.referencesDir, 'user')
    this.context7BaseDir = join(options.referencesDir, 'context7')
    this.md = new MarkdownIt()
  }

  /**
   * Get the directory path for a specific context7 project
   */
  private getContext7ProjectDir(projectId: string): string {
    return join(this.context7BaseDir, this.encodeContext7ProjectId(projectId))
  }

  private encodeContext7ProjectId(projectId: string): string {
    return encodeURIComponent(projectId)
  }

  private decodeContext7ProjectId(encodedProjectId: string): string {
    return decodeURIComponent(encodedProjectId)
  }

  async updateFromContext7(
    libraryId: string,
    force: boolean = false
  ): Promise<UpdateContext7Result> {
    const result: UpdateContext7Result = {
      updated: false,
      skipped: false,
      filesCreated: 0,
      message: '',
    }

    try {
      // Download content
      const content = await this.downloadContext7Doc(libraryId)

      // Get project-specific directory
      const projectDir = this.getContext7ProjectDir(libraryId)

      // Check if update needed
      if (!force && !this.needsUpdate(content, libraryId)) {
        result.skipped = true
        result.message = 'Context7 documentation is up to date'
        return result
      }

      // Clear existing context7 docs for this project
      if (existsSync(projectDir)) {
        const files = readdirSync(projectDir)
        for (const file of files) {
          if (file.endsWith('.md')) {
            rmSync(join(projectDir, file))
          }
        }
      }

      // Ensure directory exists
      mkdirSync(projectDir, { recursive: true })

      // Slice and save
      const savedFiles = await this.sliceDocument(content, projectDir)
      result.filesCreated = savedFiles.length

      // Save hash for this project
      this.saveContentHash(content, libraryId)

      // Trigger reindex
      await this.invalidateSearchIndex()

      result.updated = true
      result.message = `Updated ${savedFiles.length} documentation slices for project ${libraryId}`
    } catch (error) {
      result.message = `Failed to update Context7 docs: ${error}`
    }

    return result
  }

  async addUserContent(options: {
    title: string
    content: string
    force?: boolean
    forceAppend?: boolean
    autoUpdate?: boolean
  }): Promise<AddContentResult> {
    const result: AddContentResult = {
      added: false,
      updated: false,
      skipped: false,
      message: '',
      similarFound: 0,
    }

    try {
      // Search for similar content
      await this.prepareSearchEngine()
      const similar = await this.findSimilarContent(options.content)

      if (similar.length > 0 && !options.force) {
        const bestMatch = similar[0]

        if (options.autoUpdate && bestMatch.source === 'user') {
          // Update user file
          const filePath = join(this.options.referencesDir, bestMatch.file_path)

          if (this.isContentEnhanced(bestMatch, options.content)) {
            writeFileSync(filePath, `# ${options.title}\n\n${options.content}`)

            result.updated = true
            result.filePath = filePath
            result.message = `Updated existing content: ${bestMatch.file_path}`

            // Trigger index update
            await this.invalidateSearchIndex()
          } else {
            result.skipped = true
            result.message = 'Existing content is comprehensive enough'
          }
        } else {
          // Similar content found but not updating
          result.message = `Found ${similar.length} similar documents`
          result.similarContent = similar.slice(0, 3).map((s) => ({
            title: s.title,
            score: s.score,
            source: s.source,
            preview: s.content.slice(0, 200) + '...',
          }))
          result.similarFound = similar.length
        }
      } else if (!result.added && !result.updated && !result.skipped) {
        // Create new file only if no similar content was found
        mkdirSync(this.userDir, { recursive: true })

        // Check if file with same title already exists
        const safeTitle =
          options.title
            .toLowerCase()
            .replace(/[^\w\s-]/g, '')
            .replace(/[-\s]+/g, '_')
            .replace(/^_+|_+$/g, '')
            .slice(0, 50) || 'content'
        const expectedFilePath = join(this.userDir, `${safeTitle}.md`)

        if (existsSync(expectedFilePath) && !options.force && !options.forceAppend) {
          // File exists and no force flag - show error and file content
          const { readFileSync } = await import('node:fs')
          const existingContent = readFileSync(expectedFilePath, 'utf-8')

          result.message = `File already exists: ${safeTitle}.md. Use --force to overwrite or --force-append to append.`
          result.existingFile = {
            path: expectedFilePath,
            content: existingContent,
          }
        } else {
          // Either file doesn't exist or force flag is set
          let filePath: string
          let fileName: string

          if (existsSync(expectedFilePath) && options.force) {
            // Force overwrite: directly replace the existing file
            filePath = expectedFilePath
            fileName = safeTitle + '.md'
            writeFileSync(filePath, `# ${options.title}\n\n${options.content}`)
            result.message = `Overwrote existing content: ${fileName}`
          } else if (existsSync(expectedFilePath) && options.forceAppend) {
            // Force append: add content to the end of existing file
            filePath = expectedFilePath
            fileName = safeTitle + '.md'
            const { readFileSync } = await import('node:fs')
            const existingContent = readFileSync(filePath, 'utf-8')
            const newContent = `${existingContent}\n\n---\n\n# ${options.title}\n\n${options.content}`
            writeFileSync(filePath, newContent)
            result.message = `Appended content to existing file: ${fileName}`
          } else {
            // Create new file
            filePath = this.createUniqueFilePath(options.title, this.userDir)
            fileName = filePath.split('/').pop() || safeTitle + '.md'
            writeFileSync(filePath, `# ${options.title}\n\n${options.content}`)
            result.message = `Created new content: ${fileName}`
          }

          result.added = true
          result.filePath = filePath

          // Trigger index update
          await this.invalidateSearchIndex()
        }
      }
    } catch (error) {
      result.message = `Failed to add content: ${error}`
    }

    result.similarFound = result.similarContent?.length || 0
    return result
  }

  getContentStats(): ContentStats {
    const stats: ContentStats = {
      userFiles: 0,
      context7Files: 0,
      totalFiles: 0,
      userDirExists: existsSync(this.userDir),
      context7DirExists: existsSync(this.context7BaseDir),
    }

    if (stats.userDirExists) {
      stats.userFiles = readdirSync(this.userDir).filter((f) => f.endsWith('.md')).length
    }

    if (stats.context7DirExists) {
      // Count files in all context7 project subdirectories
      const projects = readdirSync(this.context7BaseDir, { withFileTypes: true })
        .filter((dirent) => dirent.isDirectory())
        .map((dirent) => dirent.name)

      for (const encodedProjectId of projects) {
        const projectDir = join(this.context7BaseDir, encodedProjectId)
        if (existsSync(projectDir)) {
          stats.context7Files += readdirSync(projectDir).filter((f) => f.endsWith('.md')).length
        }
      }
    }

    stats.totalFiles = stats.userFiles + stats.context7Files
    return stats
  }

  listContent(source?: 'user' | 'context7'): ContentItem[] {
    const contentList: ContentItem[] = []

    // List user content
    if (source === 'user' || !source) {
      if (existsSync(this.userDir)) {
        const files = readdirSync(this.userDir)
        for (const file of files) {
          if (!file.endsWith('.md')) continue

          const filePath = join(this.userDir, file)
          const stat = statSync(filePath)

          let title = file.replace('.md', '')
          try {
            const content = readFileSync(filePath, 'utf-8')
            const firstLine = content.split('\n')[0]
            if (firstLine?.startsWith('# ')) {
              title = firstLine.slice(2)
            }
          } catch {
            // Use filename if can't read
          }

          contentList.push({
            title,
            filename: file,
            source: 'user',
            path: filePath,
            size: stat.size,
            modified: stat.mtime || new Date(),
          })
        }
      }
    }

    // List context7 content from all projects
    if (source === 'context7' || !source) {
      if (existsSync(this.context7BaseDir)) {
        const projects = readdirSync(this.context7BaseDir, { withFileTypes: true })
          .filter((dirent) => dirent.isDirectory())
          .map((dirent) => dirent.name)

        for (const encodedProjectId of projects) {
          const projectId = this.decodeContext7ProjectId(encodedProjectId)
          const projectDir = join(this.context7BaseDir, encodedProjectId)
          if (existsSync(projectDir)) {
            const files = readdirSync(projectDir)
            for (const file of files) {
              if (!file.endsWith('.md')) continue

              const filePath = join(projectDir, file)
              const stat = statSync(filePath)

              let title = file.replace('.md', '')
              try {
                const content = readFileSync(filePath, 'utf-8')
                const firstLine = content.split('\n')[0]
                if (firstLine?.startsWith('# ')) {
                  title = firstLine.slice(2)
                }
              } catch {
                // Use filename if can't read
              }

              contentList.push({
                title,
                filename: file,
                source: 'context7',
                path: filePath,
                size: stat.size,
                modified: stat.mtime || new Date(),
              })
            }
          }
        }
      }
    }

    return contentList.sort((a, b) => b.modified.getTime() - a.modified.getTime())
  }

  private async downloadContext7Doc(libraryId: string): Promise<string> {
    const baseUrl = (process.env.SKILL_CREATOR_CONTEXT7_BASE_URL ?? 'https://context7.com').replace(
      /\/$/,
      ''
    )
    const url = `${baseUrl}${libraryId}/llms.txt?tokens=100000000&topic=*`

    const fetchImpl = this.options.fetchImpl ?? fetch
    const response = await fetchImpl(url)
    if (!response.ok) {
      throw new Error(`Failed to download: ${response.statusText}`)
    }

    return await response.text()
  }

  private async sliceDocument(content: string, outputDir: string): Promise<string[]> {
    const sections = this.extractSections(content)
    const savedFiles: string[] = []

    for (let i = 0; i < sections.length; i++) {
      const { title, content: sectionContent } = sections[i]
      if (!sectionContent.trim()) continue

      const filename = this.createUniqueFileName(title, i, outputDir)
      const filePath = join(outputDir, filename)

      writeFileSync(filePath, `# ${title}\n\n${sectionContent}`)
      savedFiles.push(filePath)
    }

    return savedFiles
  }

  private extractSections(content: string): Array<{ title: string; content: string }> {
    const sections: Array<{ title: string; content: string }> = []
    const lines = content.split('\n')
    let currentSection = { title: 'Introduction', content: '' }
    let sectionContent: string[] = []

    const headingPattern = /^(#{1,6})\s+(.+)$/

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const match = headingPattern.exec(line)

      if (match) {
        // Save previous section if it has content
        if (sectionContent.length > 0) {
          currentSection.content = sectionContent.join('\n').trim()

          // Only add section if it meets minimum content threshold
          if (currentSection.content.length > 50) {
            sections.push({ ...currentSection })
          }

          sectionContent = []
        }

        // Start new section
        currentSection = {
          title: match[2].trim(),
          content: '',
        }
      } else {
        // Add non-heading lines to current section
        if (line.trim() || sectionContent.length > 0) {
          sectionContent.push(line)
        }
      }
    }

    // Add the last section
    if (sectionContent.length > 0) {
      currentSection.content = sectionContent.join('\n').trim()
      if (currentSection.content.length > 50) {
        sections.push(currentSection)
      }
    }

    // Post-process sections to merge very short ones
    return this.mergeShortSections(sections)
  }

  private mergeShortSections(
    sections: Array<{ title: string; content: string }>
  ): Array<{ title: string; content: string }> {
    const merged: Array<{ title: string; content: string }> = []

    for (let i = 0; i < sections.length; i++) {
      const section = sections[i]

      // If section is very short and not the last, consider merging with next
      if (section.content.length < 200 && i < sections.length - 1) {
        const nextSection = sections[i + 1]

        // Merge if next section is not a major section
        if (!this.isMajorSection(nextSection.title)) {
          merged.push({
            title: section.title,
            content: section.content + '\n\n' + nextSection.content,
          })
          i++ // Skip next section
        } else {
          merged.push(section)
        }
      } else {
        merged.push(section)
      }
    }

    return merged
  }

  private isMajorSection(title: string): boolean {
    const majorKeywords = [
      'introduction',
      'getting started',
      'installation',
      'setup',
      'api',
      'reference',
      'examples',
      'tutorial',
      'guide',
      'overview',
      'quick start',
      'basics',
      'advanced',
    ]

    const titleLower = title.toLowerCase()
    return majorKeywords.some((keyword) => titleLower.includes(keyword))
  }

  private createUniqueFileName(title: string, index: number, dir: string): string {
    // Clean up the title for use in filename
    const safeTitle =
      title
        .replace(/[^\w\s-]/g, '')
        .replace(/[-\s]+/g, '_')
        .replace(/^_+|_+$/g, '') // Remove leading/trailing underscores
        .slice(0, 50) || 'section'

    // Create hierarchical naming based on heading level if possible
    const headingLevel = this.extractHeadingLevel(title)
    const prefix =
      headingLevel > 1 ? `${'0'.repeat(Math.min(headingLevel - 1, 3))}${index}` : index.toString()

    // Use both index and title for better organization
    const baseName = `${prefix.padStart(4, '0')}_${safeTitle}`
    let filename = `${baseName}.md`
    let counter = 1

    while (existsSync(join(dir, filename))) {
      filename = `${baseName}_${counter.toString().padStart(2, '0')}.md`
      counter++
    }

    return filename
  }

  private extractHeadingLevel(title: string): number {
    // Try to extract heading level from title if it contains markdown-like indicators
    const match = title.match(/^(#{1,6})\s*(.+)$/)
    if (match) {
      return match[1].length
    }

    // Look for other indicators in the title
    if (/^(Chapter|Section|Part)\s+\d+/i.test(title)) return 1
    if (/^\d+\.\d+/i.test(title)) return 2
    if (/^\d+\.\d+\.\d+/i.test(title)) return 3

    return 1 // Default to level 1
  }

  private createUniqueFilePath(title: string, dir: string): string {
    // Convert to lowercase and clean up for filename
    const safeTitle =
      title
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/[-\s]+/g, '_')
        .replace(/^_+|_+$/g, '') // Remove leading/trailing underscores
        .slice(0, 50) || 'content'

    let filename = `${safeTitle}.md`
    let counter = 1
    while (existsSync(join(dir, filename))) {
      filename = `${safeTitle}_${counter.toString().padStart(2, '0')}.md`
      counter++
    }
    return join(dir, filename)
  }

  private async findSimilarContent(
    content: string,
    threshold: number = 0.85,
    maxResults: number = 10
  ): Promise<any[]> {
    const results = await this.options.searchEngine.search(content, maxResults)
    return results.filter((r: any) => r.score >= threshold)
  }

  private isContentEnhanced(existing: any, newContent: string): boolean {
    const existingWords = existing.content.split(/\s+/).length
    const newWords = newContent.split(/\s+/).length
    return newWords > existingWords * 1.3
  }

  private getHashFilePath(projectId: string): string {
    // Sanitize project ID for use in filename (replace slashes with underscores)
    const safeProjectId = this.encodeContext7ProjectId(projectId)
    return join(this.options.referencesDir, '..', `.context7_hash_${safeProjectId}`)
  }

  private saveContentHash(content: string, projectId: string): void {
    const hash = createHash('md5').update(content).digest('hex')
    const hashFile = this.getHashFilePath(projectId)
    writeFileSync(hashFile, hash)
  }

  private needsUpdate(content: string, projectId: string): boolean {
    const hashFile = this.getHashFilePath(projectId)

    if (!existsSync(hashFile)) {
      return true
    }

    const currentHash = createHash('md5').update(content).digest('hex')
    const storedHash = readFileSync(hashFile, 'utf-8')

    return currentHash !== storedHash
  }

  private async prepareSearchEngine(): Promise<void> {
    if (typeof this.options.searchEngine.initialize === 'function') {
      await this.options.searchEngine.initialize()
    }
    if (typeof this.options.searchEngine.buildIndex === 'function') {
      await this.options.searchEngine.buildIndex(this.options.referencesDir)
    }
  }

  private async invalidateSearchIndex(): Promise<void> {
    if (typeof this.options.searchEngine.clearIndex === 'function') {
      await this.options.searchEngine.clearIndex()
    }

    const searchDir = join(this.options.referencesDir, '..', 'search')
    const searchArtifacts = [
      'index-state.json',
      'minisearch-index.json',
      'vector-index-state.json',
      'vector-index.db',
    ]

    for (const artifact of searchArtifacts) {
      rmSync(join(searchDir, artifact), { force: true })
    }
  }

  /**
   * List all context7 projects
   */
  listContext7Projects(): Array<{ projectId: string; filesCount: number; directory: string }> {
    const projects: Array<{ projectId: string; filesCount: number; directory: string }> = []

    if (!existsSync(this.context7BaseDir)) {
      return projects
    }

    const projectDirs = readdirSync(this.context7BaseDir, { withFileTypes: true })
      .filter((dirent) => dirent.isDirectory())
      .map((dirent) => dirent.name)

    for (const encodedProjectId of projectDirs) {
      const projectId = this.decodeContext7ProjectId(encodedProjectId)
      const projectDir = join(this.context7BaseDir, encodedProjectId)
      if (existsSync(projectDir)) {
        const files = readdirSync(projectDir).filter((f) => f.endsWith('.md'))
        projects.push({
          projectId,
          filesCount: files.length,
          directory: projectDir,
        })
      }
    }

    return projects
  }

  /**
   * Get files for a specific context7 project
   */
  getContext7ProjectFiles(projectId: string): string[] {
    const projectDir = this.getContext7ProjectDir(projectId)

    if (!existsSync(projectDir)) {
      return []
    }

    return readdirSync(projectDir).filter((f) => f.endsWith('.md'))
  }

  /**
   * Remove a context7 project
   */
  removeContext7Project(projectId: string): { success: boolean; message: string } {
    const projectDir = this.getContext7ProjectDir(projectId)

    if (!existsSync(projectDir)) {
      return {
        success: false,
        message: `Context7 project ${projectId} does not exist`,
      }
    }

    try {
      // Remove project directory
      rmSync(projectDir, { recursive: true, force: true })

      // Remove project hash file
      const hashFile = this.getHashFilePath(projectId)
      if (existsSync(hashFile)) {
        rmSync(hashFile)
      }

      // Trigger reindex
      void this.invalidateSearchIndex()

      return {
        success: true,
        message: `Context7 project ${projectId} removed successfully`,
      }
    } catch (error) {
      return {
        success: false,
        message: `Failed to remove Context7 project ${projectId}: ${error}`,
      }
    }
  }
}
